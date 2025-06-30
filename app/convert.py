import subprocess
import os
import json
from pathlib import Path
from typing import Optional

def convert_to_aac(src_path: str, dest_dir: str, bitrate: int = 128) -> Optional[str]:
    """Convert any audio file to AAC (M4A) using ffmpeg for universal compatibility.
    Falls back to MP3 if AAC conversion fails.
    
    Args:
        src_path: Path to source audio file
        dest_dir: Destination directory for converted file
        bitrate: Audio bitrate in kbps (128k is good quality/size balance)
    
    Returns:
        Path to converted file or None on failure
    """
    dest_dir_path = Path(dest_dir)
    dest_dir_path.mkdir(parents=True, exist_ok=True)
    stem = Path(src_path).stem
    dest_path = dest_dir_path / f"{stem}.m4a"
    
    try:
        # Use AAC with optimal settings for universal compatibility
        # -vn = no video (ignore album art/cover images)
        # -map 0:a:0 = map only the first audio stream
        cmd = [
            "ffmpeg", "-y", "-i", src_path,
            "-vn",                   # No video (ignore album art)
            "-map", "0:a:0",         # Map only first audio stream
            "-c:a", "aac",           # AAC codec
            "-b:a", f"{bitrate}k",   # Bitrate
            "-ar", "44100",          # Standard sample rate
            "-ac", "2",              # Stereo
            "-movflags", "+faststart", # Optimize for streaming
            "-profile:a", "aac_low", # AAC-LC profile (best compatibility)
            str(dest_path)
        ]
        
        print(f"Converting {src_path} to AAC...")
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        
        # Verify the output file was created and has content
        if dest_path.exists() and dest_path.stat().st_size > 0:
            print(f"✅ Successfully converted to {dest_path} ({dest_path.stat().st_size} bytes)")
            return str(dest_path)
        else:
            print(f"❌ AAC conversion failed: output file is empty or doesn't exist")
            
    except subprocess.CalledProcessError as e:
        print(f"❌ AAC conversion failed: {e}")
        if e.stderr:
            print(f"AAC Error details: {e.stderr}")
    except Exception as e:
        print(f"❌ Unexpected error during AAC conversion: {e}")
    
    # If AAC failed, try MP3 as fallback
    print("🔄 AAC conversion failed, trying MP3 fallback...")
    return convert_to_mp3_fallback(src_path, dest_dir, bitrate)

def get_audio_info(file_path: str) -> dict:
    """Get audio file information using ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json", 
            "-show_format", "-show_streams", file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)
    except Exception as e:
        print(f"Failed to get audio info: {e}")
        return {}

# Keep the old function name for backward compatibility
def convert_to_vorbis(src_path: str, dest_dir: str, quality: int = 5) -> Optional[str]:
    """Convert to AAC for universal compatibility (renamed from vorbis for compatibility)."""
    return convert_to_aac(src_path, dest_dir, 128)

def convert_to_mp3(src_path: str, dest_dir: str, bitrate: str = "192k") -> Optional[str]:
    """Convert to AAC (better than MP3) for compatibility."""
    bitrate_num = int(bitrate.replace('k', ''))
    return convert_to_aac(src_path, dest_dir, bitrate_num)

def convert_to_mp3_fallback(src_path: str, dest_dir: str, bitrate: int = 192) -> Optional[str]:
    """Fallback function to convert to MP3 if AAC fails."""
    dest_dir_path = Path(dest_dir)
    dest_dir_path.mkdir(parents=True, exist_ok=True)
    stem = Path(src_path).stem
    dest_path = dest_dir_path / f"{stem}.mp3"
    
    try:
        cmd = [
            "ffmpeg", "-y", "-i", src_path,
            "-vn",                   # No video (ignore album art)
            "-map", "0:a:0",         # Map only first audio stream
            "-c:a", "libmp3lame",    # MP3 encoder
            "-b:a", f"{bitrate}k",   # Bitrate
            "-ar", "44100",          # Standard sample rate
            "-ac", "2",              # Stereo
            str(dest_path)
        ]
        
        print(f"Converting {src_path} to MP3 (fallback)...")
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        
        if dest_path.exists() and dest_path.stat().st_size > 0:
            print(f"✅ Successfully converted to MP3: {dest_path} ({dest_path.stat().st_size} bytes)")
            return str(dest_path)
        else:
            print(f"❌ MP3 conversion failed: output file is empty or doesn't exist")
            return None
            
    except subprocess.CalledProcessError as e:
        print(f"❌ MP3 conversion failed: {e}")
        if e.stderr:
            print(f"Error details: {e.stderr}")
        return None
    except Exception as e:
        print(f"❌ Unexpected error during MP3 conversion: {e}")
        return None
