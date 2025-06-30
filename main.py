import os
import socket
import json
import uuid
import time
from typing import Dict, List, Set, Literal
import random # Added for shuffle

from fastapi import (
    FastAPI, UploadFile, File, HTTPException, Request, WebSocket, WebSocketDisconnect
)
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.templating import Jinja2Templates
from pydantic import BaseModel, HttpUrl

from app.database import SessionLocal, Track, Playlist, PlaylistTrack, User, init_db
from app.convert import convert_to_aac
from app.importer import import_from_youtube

# --- Pydantic Models ---
class URLImportRequest(BaseModel):
    url: HttpUrl

class AuthRequest(BaseModel):
    nickname: str

class NicknameUpdateRequest(BaseModel):
    nickname: str

class PlaylistCreateRequest(BaseModel):
    name: str
    owner_user_id: int  # Changed to int

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

class PlayerState:
    def __init__(self):
        self.queue: List[int] = []
        self.original_queue: List[int] = [] # For unshuffling
        self.current_index: int = -1 # Index in the queue
        self.current_track_id: int | None = None
        self.current_time: float = 0.0
        self.is_playing: bool = False
        self.repeat_mode: Literal['off', 'all', 'one'] = 'off'
        self.is_shuffled: bool = False

    def set_current_track(self):
        if 0 <= self.current_index < len(self.queue):
            self.current_track_id = self.queue[self.current_index]
        else:
            self.current_track_id = None
            self.current_index = -1 # Ensure index is reset if queue is empty or out of bounds
            self.is_playing = False # Stop playing if no track

    def to_dict(self):
        return {
            "queue": self.queue,
            "original_queue": self.original_queue,
            "current_index": self.current_index,
            "current_track_id": self.current_track_id,
            "current_time": self.current_time,
            "is_playing": self.is_playing,
            "repeat_mode": self.repeat_mode,
            "is_shuffled": self.is_shuffled,
        }

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_names: Dict[str, str] = {}
        self.player_states: Dict[str, PlayerState] = {} # For solo users

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        if user_id not in self.player_states: # Create player state if not exists
            self.player_states[user_id] = PlayerState()

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.user_names:
            del self.user_names[user_id]
        # Note: We might want to persist player_states or clear them based on requirements.
        # For now, let's keep them, they might reconnect.
        # If memory becomes an issue, a cleanup strategy for player_states would be needed.

    async def broadcast(self, message: dict):
        for connection in self.active_connections.values():
            await connection.send_json(message)

    async def send_solo_state_update(self, user_id: str):
        if user_id in self.active_connections and user_id in self.player_states:
            state = self.player_states[user_id]
            await self.active_connections[user_id].send_json({
                "type": "solo_state_update",
                "payload": state.to_dict()
            })

    def get_users_list(self) -> List[Dict[str, str]]:
        return [{"id": uid, "name": name} for uid, name in self.user_names.items()]

    def get_users_list_for_ids(self, user_ids: Set[str]) -> List[Dict[str, str]]:
        return [{"id": uid, "name": self.user_names.get(uid, "Unknown")} for uid in user_ids]

class Party(PlayerState): # Inherits from PlayerState
    def __init__(self, host_id: str, host_name: str, initial_player_state: PlayerState | None = None):
        super().__init__() # Initialize PlayerState attributes
        self.party_id: str = str(uuid.uuid4())
        self.host_id: str = host_id
        self.host_name: str = host_name
        self.members: Set[str] = {host_id}
        # self.current_track_id, self.current_time, self.is_playing, self.queue are now in PlayerState
        self.mode: str = 'host'  # 'host' or 'democratic'
        self.last_action_timestamp: float = time.time()
        self.last_action_user: str = host_id
        self.action_debounce_time: float = 0.5  # 500ms debounce
        self.chat_history: List[Dict] = []

        if initial_player_state:
            self.queue = initial_player_state.queue[:]
            self.original_queue = initial_player_state.original_queue[:]
            self.current_index = initial_player_state.current_index
            self.current_track_id = initial_player_state.current_track_id
            self.current_time = initial_player_state.current_time
            self.is_playing = initial_player_state.is_playing
            self.repeat_mode = initial_player_state.repeat_mode
            self.is_shuffled = initial_player_state.is_shuffled
            self.set_current_track() # Ensure current_track_id is consistent

        # Deprecated attributes (or their logic needs fundamental change)
        # self.active_playlist_id: int | None = None
        # self.current_playlist_index: int = 0 # Replaced by self.current_index
        # self.is_playlist_active: bool = False # Logic changes: playlists just load into queue

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

        # Merge PlayerState's dict representation
        payload = self.to_dict() # This now comes from PlayerState
        payload.update({
            "party_id": self.party_id,
            "host_name": self.host_name,
            "member_count": len(self.members),
            "current_track_title": track_title, # Keep this for convenience if needed by UI
            "mode": self.mode,
            # "queue": self.queue, # Already in PlayerState.to_dict()
            # "active_playlist_id": self.active_playlist_id, # Deprecated
            # "is_playlist_active": self.is_playlist_active, # Deprecated
            # "current_playlist_index": self.current_playlist_index, # Replaced by current_index
        })
        return payload

    async def broadcast_sync(self, manager: ConnectionManager):
        # Prepare the full party state including player state
        party_state_payload = self.to_dict(manager) # Uses the overridden to_dict

        # Add members list, specific to party context
        party_state_payload["members"] = manager.get_users_list_for_ids(self.members)
        # Ensure host_id is present for client-side logic (e.g. identifying host)
        party_state_payload["host_id"] = self.host_id


        message = {
            "type": "party_sync",
            "payload": party_state_payload
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
                # Ensure player state is initialized (connect already does this, but good to be sure)
                if user_id not in manager.player_states:
                    manager.player_states[user_id] = PlayerState()
                await manager.send_solo_state_update(user_id) # Send initial solo state
                await broadcast_state_update()

            # Create a new party
            elif msg_type == "create_party":
                if user_id not in [p.host_id for p in parties.values()]: # User is not already a host
                    # Retrieve solo player state
                    solo_player_state = manager.player_states.get(user_id)

                    party = Party(
                        host_id=user_id,
                        host_name=manager.user_names.get(user_id, "Unknown"),
                        initial_player_state=solo_player_state # Pass solo state to party
                    )
                    parties[party.party_id] = party
                    user_party_id = party.party_id

                    # Clear or reset solo player state for the user who created the party
                    if user_id in manager.player_states:
                        manager.player_states[user_id] = PlayerState() # Reset to default
                        # Optionally, send an update for the now-empty solo state
                        # await manager.send_solo_state_update(user_id)

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
                    # If user leaves party, send them their current solo state
                    await manager.send_solo_state_update(user_id)
                    await broadcast_state_update()

            # Player action from a client
            elif msg_type == "player_action":
                action = payload.get("action")
                target_state: PlayerState | None = None
                is_party_action = False

                if user_party_id and user_party_id in parties:
                    party = parties[user_party_id]
                    action_timestamp = time.time()
                    if party.can_accept_action(user_id, action_timestamp):
                        party.update_action_timestamp(user_id, action_timestamp)
                        target_state = party
                        is_party_action = True
                    else:
                        print(f"🚫 Party action rejected: {action} from {user_id} (debounce/permissions)")
                        await party.broadcast_sync(manager) # Realign client
                        continue # Skip processing this action
                elif not user_party_id and user_id in manager.player_states: # Solo user
                    target_state = manager.player_states[user_id]
                
                if target_state:
                    print(f"🎮 Player action: {action} for {'party ' + user_party_id if is_party_action else 'solo user ' + user_id}")
                    if action in ["play", "pause"]:
                        target_state.is_playing = action == "play"
                    elif action == "seek":
                        target_state.current_time = payload.get("currentTime", 0)
                    elif action == "change_track":
                        new_track_id = payload.get("track_id")
                        if new_track_id in target_state.queue:
                            target_state.current_index = target_state.queue.index(new_track_id)
                            target_state.set_current_track()
                            target_state.current_time = 0
                            target_state.is_playing = True
                        else: # Track not in queue, try adding it (e.g. from library click)
                            target_state.queue.append(new_track_id)
                            target_state.current_index = len(target_state.queue) -1
                            target_state.set_current_track()
                            target_state.current_time = 0
                            target_state.is_playing = True
                            if target_state.is_shuffled: # also add to original_queue if shuffled
                                target_state.original_queue.append(new_track_id)


                    elif action == "next_track":
                        if not target_state.queue: continue

                        if target_state.repeat_mode == 'one' and target_state.is_playing:
                            target_state.current_time = 0 # Repeat current track
                        elif target_state.current_index < len(target_state.queue) - 1:
                            target_state.current_index += 1
                        elif target_state.repeat_mode == 'all': # End of queue, repeat all
                            target_state.current_index = 0
                        else: # End of queue, no repeat or repeat one (but not playing)
                            target_state.is_playing = False
                            # Optionally, could set current_index to -1 or keep it at end

                        if target_state.is_playing or target_state.repeat_mode == 'all' or \
                           (target_state.current_index != len(target_state.queue) -1 and target_state.current_index != -1) : # only reset time if actually moving to a track
                            target_state.set_current_track()
                            target_state.current_time = 0
                            target_state.is_playing = True # Autoplay next track

                    elif action == "prev_track":
                        if not target_state.queue: continue

                        if target_state.current_time > 3 or target_state.current_index == 0 : # If played for >3s or first track, restart current
                            target_state.current_time = 0
                        elif target_state.current_index > 0:
                            target_state.current_index -= 1
                        # No wrap-around for previous in this logic, can be added if needed
                        
                        target_state.set_current_track()
                        target_state.current_time = 0
                        target_state.is_playing = True # Autoplay previous track

                    if is_party_action:
                        await parties[user_party_id].broadcast_sync(manager)
                        await broadcast_state_update() # To update track title in party list
                    else:
                        await manager.send_solo_state_update(user_id)

            # Sync update from party host/democratic member (Only for parties)
            elif msg_type == "sync_update" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                is_host_or_democratic_controller = (user_id == party.host_id) or \
                                                 (party.mode == 'democratic' and party.can_accept_action(user_id))

                if is_host_or_democratic_controller:
                    if party.mode == 'democratic' and user_id != party.host_id:
                        party.update_action_timestamp(user_id) # Update if democratic non-host sends
                        
                    party.current_time = payload.get("currentTime", party.current_time)
                    party.is_playing = payload.get("is_playing", party.is_playing)
                    # Potentially sync other parts of PlayerState if needed, but usually just time/play state
                    await party.broadcast_sync(manager)

            # Set party mode (host only)
            elif msg_type == "set_mode" and user_party_id and user_party_id in parties:
                party = parties[user_party_id]
                if user_id == party.host_id: # Only host can change mode
                    party.mode = payload.get("mode", "host")
                    await party.broadcast_sync(manager)
                    await broadcast_state_update() # Update party list display

            # Queue actions (add, remove, clear)
            elif msg_type == "queue_action":
                action = payload.get("action")
                track_id = payload.get("track_id")
                position = payload.get("position")
                
                target_state: PlayerState | None = None
                is_party_action = False

                if user_party_id and user_party_id in parties:
                    party = parties[user_party_id]
                    # Check permissions for party queue modification
                    if (user_id == party.host_id) or (party.mode == 'democratic'):
                        target_state = party
                        is_party_action = True
                    else:
                        print(f"🚫 Party queue action rejected: {action} from {user_id} (permissions)")
                        # Optionally send a rejection message or just ignore
                        continue
                elif not user_party_id and user_id in manager.player_states: # Solo user
                    target_state = manager.player_states[user_id]

                if target_state:
                    if action == "add":
                        if track_id:
                            target_state.queue.append(track_id)
                            if target_state.is_shuffled: # If shuffled, also add to original_queue
                                target_state.original_queue.append(track_id)
                            # If queue was empty and this is the first track, set as current
                            if target_state.current_index == -1:
                                target_state.current_index = 0
                                target_state.set_current_track()
                                # target_state.is_playing = True # Optionally auto-play
                    
                    elif action == "remove":
                        if position is not None and 0 <= position < len(target_state.queue):
                            removed_track_id = target_state.queue.pop(position)
                            if target_state.is_shuffled:
                                if removed_track_id in target_state.original_queue:
                                    target_state.original_queue.remove(removed_track_id)

                            # Adjust current_index if the removed track was before or at current_index
                            if position < target_state.current_index:
                                target_state.current_index -= 1
                            elif position == target_state.current_index:
                                # If current track removed, try to play next or stop
                                if target_state.current_index >= len(target_state.queue): # Was last track
                                     target_state.current_index = len(target_state.queue) -1 # Point to new last or -1
                                target_state.set_current_track()
                                if not target_state.current_track_id:
                                    target_state.is_playing = False
                                else: # auto play next if current was removed
                                    target_state.current_time = 0
                                    target_state.is_playing = True


                    elif action == "clear":
                        target_state.queue.clear()
                        target_state.original_queue.clear()
                        target_state.current_index = -1
                        target_state.set_current_track() # This will set current_track_id to None
                        target_state.is_playing = False
                    
                    if is_party_action:
                        await parties[user_party_id].broadcast_sync(manager)
                    else:
                        await manager.send_solo_state_update(user_id)

            # Toggle Shuffle
            elif msg_type == "toggle_shuffle":
                target_state: PlayerState | None = None
                is_party_action = False
                if user_party_id and user_party_id in parties:
                    party = parties[user_party_id]
                    if (user_id == party.host_id) or (party.mode == 'democratic'):
                        target_state = party
                        is_party_action = True
                elif not user_party_id and user_id in manager.player_states:
                    target_state = manager.player_states[user_id]

                if target_state:
                    target_state.is_shuffled = not target_state.is_shuffled
                    current_track_playing_id = target_state.current_track_id

                    if target_state.is_shuffled:
                        target_state.original_queue = target_state.queue[:]

                        # Shuffle queue but keep current track at index 0 if playing
                        if current_track_playing_id and current_track_playing_id in target_state.queue:
                            playing_track = target_state.queue.pop(target_state.current_index)
                            random.shuffle(target_state.queue)
                            target_state.queue.insert(0, playing_track)
                            target_state.current_index = 0
                        else:
                            random.shuffle(target_state.queue)
                            target_state.current_index = 0 if target_state.queue else -1
                    else: # Unshuffle
                        target_state.queue = target_state.original_queue[:]
                        if current_track_playing_id and current_track_playing_id in target_state.queue:
                            target_state.current_index = target_state.queue.index(current_track_playing_id)
                        elif target_state.queue: # If no specific track was playing or it's not in original, pick first
                            target_state.current_index = 0
                        else: # Queue is empty
                            target_state.current_index = -1

                    target_state.set_current_track() # Update current_track_id based on new index

                    if is_party_action:
                        await parties[user_party_id].broadcast_sync(manager)
                    else:
                        await manager.send_solo_state_update(user_id)

            # Set Repeat Mode
            elif msg_type == "set_repeat_mode":
                new_mode = payload.get("mode")
                if new_mode not in ['off', 'all', 'one']: continue

                target_state: PlayerState | None = None
                is_party_action = False
                if user_party_id and user_party_id in parties:
                    party = parties[user_party_id]
                    if (user_id == party.host_id) or (party.mode == 'democratic'):
                        target_state = party
                        is_party_action = True
                elif not user_party_id and user_id in manager.player_states:
                    target_state = manager.player_states[user_id]

                if target_state:
                    target_state.repeat_mode = new_mode
                    if is_party_action:
                        await parties[user_party_id].broadcast_sync(manager)
                    else:
                        await manager.send_solo_state_update(user_id)

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
                                    # Load playlist tracks into the queue
                                    party.queue = [pt.track_id for pt in playlist_tracks]
                                    party.original_queue = party.queue[:] # Store for unshuffling
                                    party.is_shuffled = False # Reset shuffle when loading new playlist
                                    party.current_index = 0 if party.queue else -1
                                    party.set_current_track()
                                    party.is_playing = True if party.current_track_id else False
                                    party.current_time = 0.0
                                    
                                    print(f"🎵 Playlist '{playlist.name}' loaded into party queue by {manager.user_names.get(user_id, 'Unknown')}")
                                    
                                    await party.broadcast_sync(manager)
                                    await broadcast_state_update() # Update party list display if needed
                        finally:
                            db.close()
                # If solo user wants to play a playlist, this logic needs to be handled client-side
                # or via a new specific solo_playlist_play message.
                # For now, "set_playlist" is a party-only concept on backend.
                # Solo users would typically add tracks from a playlist to their queue one by one or via a "play all" client-side.


    except WebSocketDisconnect:
        # Handle user disconnecting
        if user_party_id and user_party_id in parties:
            party = parties[user_party_id]
            if user_id in party.members:
                party.members.remove(user_id)
            if not party.members or user_id == party.host_id : # If party empty or host left
                if user_id == party.host_id and party.members: # Host left, but members remain
                    # Simplistic: disband. Could also implement host migration.
                    print(f"Host {user_id} left party {party.party_id}, disbanding.")
                del parties[user_party_id]
            else: # Member left, party continues
                await party.broadcast_sync(manager)
        # Note: Solo player state in manager.player_states[user_id] persists after disconnect.
    finally:
        manager.disconnect(user_id) # Removes from active_connections and user_names
        await broadcast_state_update() # Update lists for all clients


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

@app.post("/auth/login")
def login_user(request: AuthRequest):
    """
    Endpoint de autenticação por nickname. 
    Cria um novo usuário se não existir, ou retorna o existente.
    """
    db = SessionLocal()
    try:
        # Busca usuário existente
        user = db.query(User).filter(User.nickname == request.nickname).first()
        
        if user:
            # Usuário já existe
            return {
                "id": user.id,
                "nickname": user.nickname,
                "status": "existing_user"
            }
        else:
            # Cria novo usuário
            new_user = User(nickname=request.nickname)
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            return {
                "id": new_user.id,
                "nickname": new_user.nickname,
                "status": "new_user"
            }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Erro na autenticação: {str(e)}")
    finally:
        db.close()

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
def get_user_playlists(user_id: int):
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

@app.put("/users/{user_id}")
async def update_user_nickname(user_id: int, request: NicknameUpdateRequest):
    """Atualiza o nickname de um usuário"""
    db = SessionLocal()
    try:
        # Verifica se o novo nickname já está em uso
        existing_user = db.query(User).filter(User.nickname == request.nickname).first()
        if existing_user and existing_user.id != user_id:
            raise HTTPException(status_code=409, detail="Nickname already taken")

        # Encontra e atualiza o usuário
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.nickname = request.nickname
        db.commit()
        db.refresh(user)

        # Atualiza o estado in-memory
        user_id_str = str(user_id)
        if user_id_str in manager.user_names:
            manager.user_names[user_id_str] = request.nickname

        # Notifica todos os clientes sobre a mudança
        await manager.broadcast({
            "type": "user_updated",
            "payload": {"id": user_id, "new_nickname": request.nickname}
        })
        
        # Atualiza o nome do host se ele estiver em uma festa
        for party in parties.values():
            if party.host_id == user_id_str:
                party.host_name = request.nickname

        await broadcast_state_update()

        return {"id": user.id, "nickname": user.nickname}
    finally:
        db.close()

@app.delete("/users/{user_id}")
async def delete_user(user_id: int):
    """Deleta um usuário e todos os seus dados associados"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user_id_str = str(user_id)

        # Disband any parties hosted by the user
        parties_to_disband = [p.party_id for p in parties.values() if p.host_id == user_id_str]
        for party_id in parties_to_disband:
            del parties[party_id]

        # Remove user from any parties they are a member of
        for party in parties.values():
            if user_id_str in party.members:
                party.members.remove(user_id_str)
                # If the party becomes empty, remove it
                if not party.members:
                    del parties[party.party_id]
                else:
                    # Notify remaining members
                    await party.broadcast_sync(manager)
        
        # O cascade no modelo User cuidará da exclusão de playlists
        db.delete(user)
        db.commit()

        # Notifica todos os clientes sobre a exclusão
        await manager.broadcast({
            "type": "user_deleted",
            "payload": {"id": user_id}
        })

        # Limpa o estado in-memory
        manager.disconnect(user_id_str)
        
        await broadcast_state_update()

        return {"message": "User deleted successfully"}
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
