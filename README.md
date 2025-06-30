# Simple Music Streaming App

This project lets you upload audio files, automatically converts them to Ogg Vorbis and streams them back.

## Quick start

```bash
# Ensure Docker is installed and running
cd music_stream_app
python run.py
```

Then open <http://localhost:8000> in your browser.

## Tech stack

* **FastAPI** – backend API and HTML templating  
* **SQLite** – simple metadata storage  
* **FFmpeg** – server‑side audio conversion to Vorbis  
* **Bootstrap 5** – basic styling for a clean UI  
* **Docker** – packaged for consistent deployment

## Directories

| Path          | Purpose                    |
| ------------- | -------------------------- |
| `app/`        | Backend support modules    |
| `media/`      | Converted `.ogg` files     |
| `static/`     | CSS & JS assets            |
| `templates/`  | HTML (Jinja2) templates    |

Enjoy!
