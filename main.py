import os
import socket
import json
import uuid
import time
from typing import Dict, List, Set

from fastapi import (
    FastAPI, UploadFile, File, HTTPException, Request, WebSocket, WebSocketDisconnect
)
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.templating import Jinja2Templates
from pydantic import BaseModel, HttpUrl

from app.database import SessionLocal, Track, Playlist, PlaylistTrack, init_db
from app.convert import convert_to_aac
from app.importer import import_from_youtube

# --- Pydantic Models ---
class URLImportRequest(BaseModel):
    url: HttpUrl

class PlaylistCreateRequest(BaseModel):
    name: str
    owner_user_id: str

class PlaylistAddTrackRequest(BaseModel):
    track_id: int

class PlaylistUpdateTracksRequest(BaseModel):
    tracks: List[dict]  # [{"track_id": 1, "position": 0}, ...]

# --- Range Requests Support ---
def range_requests_response(
    file_path: str, 
    range_header: str = None, 
    media_type: str = "audio/mpeg"
):
    """
    Handles HTTP Range Requests for audio streaming.
    This enables proper seeking in audio players by allowing partial content requests.
    """
    file_size = os.path.getsize(file_path)
    
    # If no range header, return the full file
    if not range_header:
        def iterfile():
            with open(file_path, mode="rb") as file_like:
                yield from file_like
        
        return StreamingResponse(
            iterfile(), 
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            }
        )
    
    # Parse the range header (e.g., "bytes=0-1023")
    try:
        range_match = range_header.replace("bytes=", "")
        range_start, range_end = range_match.split("-")
        range_start = int(range_start) if range_start else 0
        range_end = int(range_end) if range_end else file_size - 1
        
        # Ensure range is within file bounds
        range_start = max(0, range_start)
        range_end = min(file_size - 1, range_end)
        content_length = range_end - range_start + 1
        
        def iterfile():
            with open(file_path, mode="rb") as file_like:
                file_like.seek(range_start)
                remaining = content_length
                while remaining > 0:
                    chunk_size = min(8192, remaining)  # 8KB chunks
                    chunk = file_like.read(chunk_size)
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        
        return StreamingResponse(
            iterfile(),
            status_code=206,  # Partial Content
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
                "Content-Range": f"bytes {range_start}-{range_end}/{file_size}",
            }
        )
        
    except (ValueError, AttributeError):
        # If range header is malformed, return full file
        def iterfile():
            with open(file_path, mode="rb") as file_like:
                yield from file_like
        
        return StreamingResponse(
            iterfile(), 
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            }
        )

# --- App Setup ---
MEDIA_DIR = "media"
app = FastAPI(title="Simple Music Streaming App")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
os.makedirs(MEDIA_DIR, exist_ok=True)
init_db()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- WebSocket State Management ---

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_names: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.user_names:
            del self.user_names[user_id]

    async def broadcast(self, message: dict):
        for connection in self.active_connections.values():
            await connection.send_json(message)

    def get_users_list(self) -> List[Dict[str, str]]:
        return [{"id": uid, "name": name} for uid, name in self.user_names.items()]

    def get_users_list_for_ids(self, user_ids: Set[str]) -> List[Dict[str, str]]:
        return [{"id": uid, "name": self.user_names.get(uid, "Unknown")} for uid in user_ids]

class Party:
    def __init__(self, host_id: str, host_name: str):
        self.party_id: str = str(uuid.uuid4())
        self.host_id: str = host_id
        self.host_name: str = host_name
        self.members: Set[str] = {host_id}
        self.current_track_id: int | None = None
        self.current_time: float = 0.0
        self.is_playing: bool = False
        self.mode: str = 'host'  # 'host' or 'democratic'
        self.last_action_timestamp: float = time.time()
        self.last_action_user: str = host_id
        self.action_debounce_time: float = 0.5  # 500ms debounce
        
        # Novos atributos para queue e playlist
        self.queue: List[int] = []  # Lista de track IDs para a queue simples
        self.chat_history: List[Dict] = []  # Histórico do chat (opcional)
        
        # Para integração com playlists
        self.active_playlist_id: int | None = None
        self.current_playlist_index: int = 0
        self.is_playlist_active: bool = False

    def can_accept_action(self, user_id: str, action_timestamp: float = None) -> bool:
        """
        Determina se uma ação pode ser aceita baseada no timestamp e modo da festa.
        No modo host, apenas o host pode controlar.
        No modo democrático, implementa "última ação vence" com debounce.
        """
        if action_timestamp is None:
            action_timestamp = time.time()
            
        # Modo host: apenas o host pode controlar
        if self.mode == 'host':
            return user_id == self.host_id
            
        # Modo democrático: última ação vence com debounce
        if self.mode == 'democratic':
            # Se é a primeira ação ou já passou o tempo de debounce
            time_since_last = action_timestamp - self.last_action_timestamp
            if time_since_last >= self.action_debounce_time:
                return True
            # Se é do mesmo usuário da última ação, permite (continuação da ação)
            return user_id == self.last_action_user
            
        return False

    def update_action_timestamp(self, user_id: str, timestamp: float = None):
        """Atualiza o timestamp da última ação"""
        if timestamp is None:
            timestamp = time.time()
        self.last_action_timestamp = timestamp
        self.last_action_user = user_id

    def to_dict(self, manager: ConnectionManager) -> Dict:
        db = SessionLocal()
        track_title = "Nothing playing"
        if self.current_track_id:
            track = db.query(Track).filter(Track.id == self.current_track_id).first()
            if track:
                track_title = track.title
        db.close()

        return {
            "party_id": self.party_id,
            "host_name": self.host_name,
            "member_count": len(self.members),
            "current_track_title": track_title,
            "mode": self.mode,
            "queue": self.queue,
            "active_playlist_id": self.active_playlist_id,
            "is_playlist_active": self.is_playlist_active,
            "current_playlist_index": self.current_playlist_index,
        }

    async def broadcast_sync(self, manager: ConnectionManager):
        message = {
            "type": "party_sync",
            "payload": {
                "party_id": self.party_id,
                "host_id": self.host_id,
                "members": manager.get_users_list_for_ids(self.members),
                "track_id": self.current_track_id,
                "currentTime": self.current_time,
                "is_playing": self.is_playing,
                "mode": self.mode,
                "queue": self.queue,
                "active_playlist_id": self.active_playlist_id,
                "is_playlist_active": self.is_playlist_active,
                "current_playlist_index": self.current_playlist_index,
            }
        }
        for member_id in self.members:
            if member_id in manager.active_connections:
                await manager.active_connections[member_id].send_json(message)

manager = ConnectionManager()
parties: Dict[str, Party] = {}

# Sistema de limpeza automática para evitar travas
import asyncio

async def cleanup_old_actions():
    """Limpa ações antigas para evitar que o debounce trave por muito tempo"""
    while True:
        try:
            current_time = time.time()
            for party in parties.values():
                # Se passou muito tempo desde a última ação (5 segundos), limpa o debounce
                if current_time - party.last_action_timestamp > 5.0:
                    party.last_action_timestamp = 0
                    party.last_action_user = ""
            await asyncio.sleep(2)  # Verifica a cada 2 segundos
        except Exception as e:
            print(f"Erro na limpeza automática: {e}")
            await asyncio.sleep(5)

async def broadcast_state_update():
    """Broadcasts the current list of users and parties to everyone."""
    await manager.broadcast({
        "type": "state_update",
        "payload": {
            "users": manager.get_users_list(),
            "parties": [p.to_dict(manager) for p in parties.values()],
        }
    })

# --- WebSocket Endpoint ---

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(websocket, user_id)
    user_party_id: str | None = None

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            payload = data.get("payload", {})

            # User joins for the first time
            if msg_type == "user_join":
                manager.user_names[user_id] = payload.get("name", "Anonymous")
                await broadcast_state_update()

            # Create a new party
            elif msg_type == "create_party":
                if user_id not in [p.host_id for p in parties.values()]:
                    party = Party(host_id=user_id, host_name=manager.user_names.get(user_id, "Unknown"))
                    parties[party.party_id] = party
                    user_party_id = party.party_id
                    await party.broadcast_sync(manager)
                    await broadcast_state_update()

            # Join an existing party
            elif msg_type == "join_party":
                party_id = payload.get("party_id")
                if party_id in parties:
                    party = parties[party_id]
                    party.members.add(user_id)
                    user_party_id = party_id
                    await party.broadcast_sync(manager)
                    await broadcast_state_update()

            # Leave the current party
            elif msg_type == "leave_party":
                if user_party_id and user_party_id in parties:
                    party = parties[user_party_id]
                    if user_id in party.members:
                        party.members.remove(user_id)
                    # If host leaves, disband party
                    if user_id == party.host_id or not party.members:
                        del parties[user_party_id]
                    else:
                        await party.broadcast_sync(manager)
                    user_party_id = None
                    await broadcast_state_update()

            # Player action from a client
            elif msg_type == "player_action" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                action_timestamp = time.time()
                
                # Verifica se a ação pode ser aceita (anti-race condition)
                if party.can_accept_action(user_id, action_timestamp):
                    action = payload.get("action")
                    
                    # Atualiza timestamp da ação
                    party.update_action_timestamp(user_id, action_timestamp)
                    
                    print(f"🎮 Ação aceita: {action} de {manager.user_names.get(user_id, 'Unknown')} (modo: {party.mode})")
                    
                    if action in ["play", "pause"]:
                        party.is_playing = action == "play"
                    elif action == "seek":
                        party.current_time = payload.get("currentTime", 0)
                    elif action == "change_track":
                        party.current_track_id = payload.get("track_id")
                        party.current_time = 0
                        party.is_playing = True # Autoplay new track
                        
                        # Se uma playlist está ativa, atualiza o índice
                        if party.is_playlist_active and party.current_track_id in party.queue:
                            party.current_playlist_index = party.queue.index(party.current_track_id)
                    
                    elif action == "next_track":
                        if party.is_playlist_active and party.queue:
                            if party.current_playlist_index < len(party.queue) - 1:
                                party.current_playlist_index += 1
                                party.current_track_id = party.queue[party.current_playlist_index]
                                party.current_time = 0
                                party.is_playing = True
                                print(f"⏭️ Próxima música: {party.current_track_id}")
                        elif party.queue and not party.is_playlist_active:
                            # Queue simples - move para a próxima
                            if party.current_track_id in party.queue:
                                current_index = party.queue.index(party.current_track_id)
                                if current_index < len(party.queue) - 1:
                                    party.current_track_id = party.queue[current_index + 1]
                                    party.current_time = 0
                                    party.is_playing = True
                    
                    elif action == "prev_track":
                        if party.is_playlist_active and party.queue:
                            if party.current_playlist_index > 0:
                                party.current_playlist_index -= 1
                                party.current_track_id = party.queue[party.current_playlist_index]
                                party.current_time = 0
                                party.is_playing = True
                                print(f"⏮️ Música anterior: {party.current_track_id}")
                        elif party.queue and not party.is_playlist_active:
                            # Queue simples - move para a anterior
                            if party.current_track_id in party.queue:
                                current_index = party.queue.index(party.current_track_id)
                                if current_index > 0:
                                    party.current_track_id = party.queue[current_index - 1]
                                    party.current_time = 0
                                    party.is_playing = True
                        
                    await party.broadcast_sync(manager)
                    await broadcast_state_update() # To update track title
                else:
                    # Ação rejeitada devido ao debounce ou permissões
                    print(f"🚫 Ação rejeitada: {payload.get('action')} de {manager.user_names.get(user_id, 'Unknown')} - debounce ativo")
                    # Envia sync para realinhar o cliente que teve ação rejeitada
                    await party.broadcast_sync(manager)

            # Sync update from the host (ou membro em modo democrático)
            elif msg_type == "sync_update" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                # Hosts sempre podem enviar sync updates
                # Em modo democrático, aceita sync de qualquer membro mas com debounce
                if user_id == party.host_id or (party.mode == 'democratic' and party.can_accept_action(user_id)):
                    if party.mode == 'democratic' and user_id != party.host_id:
                        party.update_action_timestamp(user_id)
                        
                    party.current_time = payload.get("currentTime", party.current_time)
                    party.is_playing = payload.get("is_playing", party.is_playing)
                    await party.broadcast_sync(manager)

            # Set party mode (host only)
            elif msg_type == "set_mode" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                if user_id == party.host_id:
                    party.mode = payload.get("mode", "host")
                    await party.broadcast_sync(manager)
                    await broadcast_state_update()

            # Queue actions (host or democratic mode)
            elif msg_type == "queue_action" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                # Verifica permissões: host ou modo democrático
                can_control = (user_id == party.host_id) or (party.mode == 'democratic')
                
                if can_control:
                    action = payload.get("action")
                    
                    if action == "add":
                        track_id = payload.get("track_id")
                        if track_id and not party.is_playlist_active:
                            party.queue.append(track_id)
                            print(f"🎵 Track {track_id} adicionada à queue por {manager.user_names.get(user_id, 'Unknown')}")
                    
                    elif action == "remove":
                        position = payload.get("position")
                        if position is not None and 0 <= position < len(party.queue) and not party.is_playlist_active:
                            removed_track = party.queue.pop(position)
                            print(f"🗑️ Track {removed_track} removida da queue (posição {position})")
                    
                    elif action == "clear":
                        if not party.is_playlist_active:
                            party.queue.clear()
                            print(f"🧹 Queue limpa por {manager.user_names.get(user_id, 'Unknown')}")
                    
                    # Broadcast da atualização da queue
                    queue_message = {
                        "type": "queue_update",
                        "payload": {"queue": party.queue}
                    }
                    for member_id in party.members:
                        if member_id in manager.active_connections:
                            await manager.active_connections[member_id].send_json(queue_message)

            # Chat message
            elif msg_type == "chat_message" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                text = payload.get("text", "").strip()
                
                if text:  # Não enviar mensagens vazias
                    message_obj = {
                        "author": manager.user_names.get(user_id, "Unknown"),
                        "text": text,
                        "timestamp": time.time()
                    }
                    
                    # Opcional: salvar no histórico
                    party.chat_history.append(message_obj)
                    # Manter apenas as últimas 100 mensagens
                    if len(party.chat_history) > 100:
                        party.chat_history = party.chat_history[-100:]
                    
                    # Broadcast da mensagem
                    chat_message = {
                        "type": "chat_message",
                        "payload": message_obj
                    }
                    for member_id in party.members:
                        if member_id in manager.active_connections:
                            await manager.active_connections[member_id].send_json(chat_message)

            # Set playlist (host or democratic mode)
            elif msg_type == "set_playlist" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                # Verifica permissões: host ou modo democrático
                can_control = (user_id == party.host_id) or (party.mode == 'democratic')
                
                if can_control:
                    playlist_id = payload.get("playlist_id")
                    
                    if playlist_id:
                        db = SessionLocal()
                        try:
                            # Busca a playlist e suas tracks
                            playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
                            if playlist:
                                playlist_tracks = db.query(PlaylistTrack).filter(
                                    PlaylistTrack.playlist_id == playlist_id
                                ).order_by(PlaylistTrack.position).all()
                                
                                if playlist_tracks:
                                    # Ativa a playlist
                                    party.is_playlist_active = True
                                    party.active_playlist_id = playlist_id
                                    party.queue = [pt.track_id for pt in playlist_tracks]
                                    party.current_playlist_index = 0
                                    party.current_track_id = party.queue[0]
                                    party.is_playing = True
                                    party.current_time = 0.0
                                    
                                    print(f"🎵 Playlist '{playlist.name}' ativada por {manager.user_names.get(user_id, 'Unknown')}")
                                    
                                    await party.broadcast_sync(manager)
                                    await broadcast_state_update()
                        finally:
                            db.close()

    except WebSocketDisconnect:
        # Handle user disconnecting
        if user_party_id and user_party_id in parties:
            party = parties[user_party_id]
            if user_id in party.members:
                party.members.remove(user_id)
            if user_id == party.host_id or not party.members:
                del parties[user_party_id]
            else:
                await party.broadcast_sync(manager)
    finally:
        manager.disconnect(user_id)
        await broadcast_state_update()


# --- Standard HTTP Routes ---

def get_host_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
        return ip
    except Exception: return "localhost"

@app.on_event("startup")
async def startup_event():
    host_ip = get_host_ip()
    print("---")
    print(f"  - Local:   http://localhost:8000")
    print(f"  - Network: http://{host_ip}:8000")
    print("---")
    
    # Inicia a limpeza automática de ações antigas
    asyncio.create_task(cleanup_old_actions())
    print("🧹 Sistema de limpeza automática iniciado")

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    temp_path = os.path.join(MEDIA_DIR, file.filename)
    with open(temp_path, "wb") as buffer:
        buffer.write(await file.read())
    output_path = convert_to_aac(temp_path, MEDIA_DIR)
    os.remove(temp_path)
    if output_path is None:
        raise HTTPException(status_code=500, detail="Conversion failed")
    db = SessionLocal()
    track = Track(title=os.path.splitext(file.filename)[0], filename=os.path.basename(output_path))
    db.add(track); db.commit(); db.refresh(track); db.close()
    return {"id": track.id, "title": track.title}

@app.post("/import_from_url")
async def import_from_url(request: URLImportRequest):
    """
    Importa uma track do YouTube a partir de uma URL.
    """
    try:
        # Importar track usando o módulo importer
        track = import_from_youtube(str(request.url))
        return {
            "id": track.id, 
            "title": track.title,
            "filename": track.filename,
            "source_url": track.source_url
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Falha na importação: {str(e)}")

@app.get("/library")
def get_library():
    db = SessionLocal()
    tracks = db.query(Track).all()
    db.close()
    return [{"id": t.id, "title": t.title} for t in tracks]

# --- Playlist CRUD Endpoints ---

@app.post("/playlists")
def create_playlist(request: PlaylistCreateRequest):
    """Cria uma nova playlist vazia"""
    db = SessionLocal()
    try:
        playlist = Playlist(
            name=request.name,
            owner_user_id=request.owner_user_id
        )
        db.add(playlist)
        db.commit()
        db.refresh(playlist)
        return {
            "id": playlist.id,
            "name": playlist.name,
            "owner_user_id": playlist.owner_user_id
        }
    finally:
        db.close()

@app.get("/users/{user_id}/playlists")
def get_user_playlists(user_id: str):
    """Busca todas as playlists de um usuário"""
    db = SessionLocal()
    try:
        playlists = db.query(Playlist).filter(Playlist.owner_user_id == user_id).all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "owner_user_id": p.owner_user_id,
                "track_count": len(p.tracks)
            }
            for p in playlists
        ]
    finally:
        db.close()

@app.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: int):
    """Busca uma playlist com suas tracks ordenadas por posição"""
    db = SessionLocal()
    try:
        playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        # Busca as tracks da playlist ordenadas por posição
        playlist_tracks = db.query(PlaylistTrack).filter(
            PlaylistTrack.playlist_id == playlist_id
        ).order_by(PlaylistTrack.position).all()
        
        tracks = []
        for pt in playlist_tracks:
            track = db.query(Track).filter(Track.id == pt.track_id).first()
            if track:
                tracks.append({
                    "id": track.id,
                    "title": track.title,
                    "position": pt.position
                })
        
        return {
            "id": playlist.id,
            "name": playlist.name,
            "owner_user_id": playlist.owner_user_id,
            "tracks": tracks
        }
    finally:
        db.close()

@app.post("/playlists/{playlist_id}/tracks")
def add_track_to_playlist(playlist_id: int, request: PlaylistAddTrackRequest):
    """Adiciona uma track ao final de uma playlist"""
    db = SessionLocal()
    try:
        # Verifica se a playlist existe
        playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        # Verifica se a track existe
        track = db.query(Track).filter(Track.id == request.track_id).first()
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
        
        # Verifica se a track já está na playlist
        existing = db.query(PlaylistTrack).filter(
            PlaylistTrack.playlist_id == playlist_id,
            PlaylistTrack.track_id == request.track_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Track already in playlist")
        
        # Encontra a próxima posição
        max_position = db.query(PlaylistTrack).filter(
            PlaylistTrack.playlist_id == playlist_id
        ).count()
        
        # Cria a nova entrada
        playlist_track = PlaylistTrack(
            playlist_id=playlist_id,
            track_id=request.track_id,
            position=max_position
        )
        db.add(playlist_track)
        db.commit()
        
        return {"message": "Track added to playlist successfully"}
    finally:
        db.close()

@app.put("/playlists/{playlist_id}/tracks")
def update_playlist_tracks(playlist_id: int, request: PlaylistUpdateTracksRequest):
    """Atualiza as posições de todas as tracks em uma playlist (para drag-and-drop)"""
    db = SessionLocal()
    try:
        # Verifica se a playlist existe
        playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        # Remove todas as tracks existentes da playlist
        db.query(PlaylistTrack).filter(PlaylistTrack.playlist_id == playlist_id).delete()
        
        # Adiciona as tracks com as novas posições
        for track_data in request.tracks:
            playlist_track = PlaylistTrack(
                playlist_id=playlist_id,
                track_id=track_data["track_id"],
                position=track_data["position"]
            )
            db.add(playlist_track)
        
        db.commit()
        return {"message": "Playlist tracks updated successfully"}
    finally:
        db.close()

@app.delete("/playlists/{playlist_id}/tracks/{track_id}")
def remove_track_from_playlist(playlist_id: int, track_id: int):
    """Remove uma track específica de uma playlist"""
    db = SessionLocal()
    try:
        # Encontra a track na playlist
        playlist_track = db.query(PlaylistTrack).filter(
            PlaylistTrack.playlist_id == playlist_id,
            PlaylistTrack.track_id == track_id
        ).first()
        
        if not playlist_track:
            raise HTTPException(status_code=404, detail="Track not found in playlist")
        
        # Remove a track
        removed_position = playlist_track.position
        db.delete(playlist_track)
        
        # Atualiza as posições das tracks subsequentes
        subsequent_tracks = db.query(PlaylistTrack).filter(
            PlaylistTrack.playlist_id == playlist_id,
            PlaylistTrack.position > removed_position
        ).all()
        
        for track in subsequent_tracks:
            track.position -= 1
        
        db.commit()
        return {"message": "Track removed from playlist successfully"}
    finally:
        db.close()

@app.delete("/playlists/{playlist_id}")
def delete_playlist(playlist_id: int):
    """Deleta uma playlist e todas suas tracks"""
    db = SessionLocal()
    try:
        playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        # O cascade="all, delete-orphan" no relacionamento vai deletar as PlaylistTracks automaticamente
        db.delete(playlist)
        db.commit()
        return {"message": "Playlist deleted successfully"}
    finally:
        db.close()

@app.get("/stream/{track_id}")
def stream_track(track_id: int, request: Request):
    db = SessionLocal()
    track = db.query(Track).filter(Track.id == track_id).first()
    db.close()
    if not track: 
        raise HTTPException(status_code=404, detail="Track not found")
    
    file_path = os.path.join(MEDIA_DIR, track.filename)
    if not os.path.exists(file_path): 
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine correct MIME type based on file extension
    file_ext = os.path.splitext(track.filename)[1].lower()
    mime_type_map = {
        '.mp3': 'audio/mpeg',
        '.mp4': 'audio/mp4',
        '.m4a': 'audio/mp4',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.webm': 'audio/webm'
    }
    media_type = mime_type_map.get(file_ext, 'audio/mpeg')  # Default to mp3
    
    # Get Range header for partial content requests (enables seeking)
    range_header = request.headers.get('range')
    
    return range_requests_response(file_path, range_header, media_type)
