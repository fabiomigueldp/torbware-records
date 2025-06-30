import os
import socket
import mimetypes
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.templating import Jinja2Templates
from app.database import SessionLocal, Track, init_db
from app.convert import convert_to_aac, get_audio_info, convert_to_vorbis

MEDIA_DIR = "media"

app = FastAPI(title="Simple Music Streaming App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

os.makedirs(MEDIA_DIR, exist_ok=True)
init_db()

templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

def get_host_ip():
    """Get the host IP address to display to the user."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

@app.on_event("startup")
async def startup_event():
    """On startup, print the accessible IP address."""
    host_ip = get_host_ip()
    print("---")
    print("Application running at:")
    print(f"  - Local:   http://localhost:8000")
    print(f"  - Network: http://{host_ip}:8000")
    print("---")

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

def _save_track_to_db(title: str, filename: str):
    db = SessionLocal()
    track = Track(title=title, filename=filename)
    db.add(track)
    db.commit()
    db.refresh(track)
    db.close()
    return track

@app.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload and convert audio file to AAC for universal compatibility."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    
    # Validate file type
    allowed_extensions = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.aiff', '.mp4', '.avi', '.mov', '.mkv'}
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file format: {file_ext}")
    
    # Create temp file
    temp_path = os.path.join(MEDIA_DIR, f"temp_{file.filename}")
    
    try:
        # Save uploaded file
        with open(temp_path, "wb") as buffer:
            content = await file.read()
            if len(content) == 0:
                raise HTTPException(status_code=400, detail="Empty file uploaded")
            buffer.write(content)
        
        # Get original file info
        audio_info = get_audio_info(temp_path)
        print(f"Uploaded file info: {audio_info}")
        
        # Convert to AAC
        output_path = convert_to_aac(temp_path, MEDIA_DIR, bitrate=128)
        
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        if output_path is None:
            raise HTTPException(status_code=500, detail="Audio conversion failed. Please check if the file is a valid audio/video file.")
        
        # Save to database
        track = _save_track_to_db(
            title=os.path.splitext(file.filename)[0], 
            filename=os.path.basename(output_path)
        )
        
        return {
            "id": track.id, 
            "title": track.title,
            "filename": track.filename,
            "message": "File uploaded and converted successfully"
        }
        
    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(temp_path):
            os.remove(temp_path)
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/library")
def get_library():
    db = SessionLocal()
    tracks = db.query(Track).all()
    db.close()
    return [{"id": t.id, "title": t.title} for t in tracks]

@app.get("/stream/{track_id}")
def stream_track(track_id: int, request: Request):
    """Stream audio track with proper headers for universal compatibility."""
    db = SessionLocal()
    track = db.query(Track).filter(Track.id == track_id).first()
    db.close()
    
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    file_path = os.path.join(MEDIA_DIR, track.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    file_size = os.path.getsize(file_path)
    
    # Determine MIME type based on file extension
    if track.filename.endswith('.m4a'):
        mime_type = "audio/mp4"  # Correct MIME type for M4A/AAC
    elif track.filename.endswith('.mp3'):
        mime_type = "audio/mpeg"
    elif track.filename.endswith('.ogg'):
        mime_type = "audio/ogg"
    else:
        mime_type = "audio/mp4"  # Default to AAC
    
    # Handle range requests for streaming compatibility (required for Safari/iOS)
    range_header = request.headers.get('range')
    
    if range_header:
        # Parse range header (e.g., "bytes=0-1023" or "bytes=1024-")
        range_match = range_header.replace('bytes=', '').split('-')
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if range_match[1] else file_size - 1
        
        # Ensure end doesn't exceed file size
        end = min(end, file_size - 1)
        
        def iterfile(file_path: str, start: int, end: int):
            """Generator to read file in chunks for streaming."""
            with open(file_path, 'rb') as file_like:
                file_like.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk_size = min(8192, remaining)
                    chunk = file_like.read(chunk_size)
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        
        # Return partial content with proper headers for range requests
        headers = {
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(end - start + 1),
            'Content-Type': mime_type,
            'Cache-Control': 'public, max-age=3600',
        }
        
        return StreamingResponse(
            iterfile(file_path, start, end),
            status_code=206,  # Partial Content
            headers=headers
        )
    else:
        # Return the full file for non-range requests
        headers = {
            'Accept-Ranges': 'bytes',
            'Content-Length': str(file_size),
            'Content-Type': mime_type,
            'Cache-Control': 'public, max-age=3600',
        }
        
        return FileResponse(
            file_path, 
            media_type=mime_type, 
            filename=track.filename,
            headers=headers
        )

@app.get("/test")
def test_connection():
    """Test endpoint to verify server connectivity."""
    return {"status": "ok", "message": "Server is running"}

@app.head("/stream/{track_id}")
def stream_track_head(track_id: int):
    """Handle HEAD requests for streaming compatibility (required for Safari)."""
    db = SessionLocal()
    track = db.query(Track).filter(Track.id == track_id).first()
    db.close()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    file_path = os.path.join(MEDIA_DIR, track.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    file_size = os.path.getsize(file_path)
    
    # Determine MIME type based on file extension
    if track.filename.endswith('.m4a'):
        mime_type = "audio/mp4"
    elif track.filename.endswith('.mp3'):
        mime_type = "audio/mpeg"
    elif track.filename.endswith('.ogg'):
        mime_type = "audio/ogg"  
    else:
        mime_type = "audio/mp4"  # Default to AAC
    
    headers = {
        'Content-Type': mime_type,
        'Content-Length': str(file_size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
    }
    
    return StreamingResponse(
        iter([]),  # Empty iterator for HEAD request
        headers=headers,
        status_code=200
    )

@app.get("/debug", response_class=HTMLResponse)
def debug_page():
    """Debug page to help troubleshoot issues."""
    with open("debug.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.options("/stream/{track_id}")
def stream_track_options(track_id: int):
    """Handle OPTIONS preflight requests for CORS."""
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Range, Authorization',
        'Access-Control-Max-Age': '86400',
    }
    return StreamingResponse(
        iter([]),
        headers=headers,
        status_code=200
    )