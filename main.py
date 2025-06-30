import os
import socket
import json
import uuid
import time
from typing import Dict, List, Set

from fastapi import (
    FastAPI, UploadFile, File, HTTPException, Request, WebSocket, WebSocketDisconnect
)
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.templating import Jinja2Templates

from app.database import SessionLocal, Track, init_db
from app.convert import convert_to_vorbis

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
    output_path = convert_to_vorbis(temp_path, MEDIA_DIR)
    os.remove(temp_path)
    if output_path is None:
        raise HTTPException(status_code=500, detail="Conversion failed")
    db = SessionLocal()
    track = Track(title=os.path.splitext(file.filename)[0], filename=os.path.basename(output_path))
    db.add(track); db.commit(); db.refresh(track); db.close()
    return {"id": track.id, "title": track.title}

@app.get("/library")
def get_library():
    db = SessionLocal()
    tracks = db.query(Track).all()
    db.close()
    return [{"id": t.id, "title": t.title} for t in tracks]

@app.get("/stream/{track_id}")
def stream_track(track_id: int):
    db = SessionLocal()
    track = db.query(Track).filter(Track.id == track_id).first()
    db.close()
    if not track: raise HTTPException(status_code=404, detail="Track not found")
    file_path = os.path.join(MEDIA_DIR, track.filename)
    if not os.path.exists(file_path): raise HTTPException(status_code=404, detail="File not found")
    
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
    
    return FileResponse(file_path, media_type=media_type, filename=track.filename)
