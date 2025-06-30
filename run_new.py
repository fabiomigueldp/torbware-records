#!/usr/bin/env python3
"""Robust cross-platform helper to build and run the Torbware Records Docker container."""

import os
import subprocess
import sys
import argparse
from shutil import which

HERE = os.path.abspath(os.path.dirname(__file__))

def has_docker():
    """Checks if Docker is installed and available in the PATH."""
    return which("docker") is not None

def has_docker_compose_v1():
    """Checks if docker-compose (V1) is installed."""
    return which("docker-compose") is not None

def has_docker_compose_v2():
    """Checks if the docker compose plugin (V2) is available."""
    try:
        subprocess.check_call(["docker", "compose", "version"], 
                            stdout=subprocess.DEVNULL, 
                            stderr=subprocess.DEVNULL)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def run(cmd, cwd=HERE):
    """Prints and runs a command."""
    print(f"$ {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)

def run_with_docker_compose():
    """Run using Docker Compose (preferred method)."""
    print("🐳 Attempting to use Docker Compose...")
    
    if has_docker_compose_v2():
        compose_cmd = ["docker", "compose"]
        print("Using Docker Compose V2 (plugin)")
    elif has_docker_compose_v1():
        compose_cmd = ["docker-compose"]
        print("Using Docker Compose V1 (standalone)")
    else:
        print("❌ No Docker Compose found")
        return False
    
    try:
        run(compose_cmd + ["up", "-d", "--build"])
        print("✅ Docker Compose succeeded")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Docker Compose failed: {e}")
        return False

def run_with_docker_direct():
    """Run using Docker directly (fallback method)."""
    print("🐳 Using Docker directly as fallback...")
    
    image_name = "torbware-records"
    container_name = "torbware-records-app"
    
    try:
        # Stop and remove existing container
        print("Cleaning up existing container...")
        try:
            subprocess.run(["docker", "stop", container_name], 
                         check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["docker", "rm", container_name], 
                         check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except:
            pass  # Container might not exist
        
        # Build image
        print("Building Docker image...")
        run(["docker", "build", "-t", image_name, "."])
        
        # Prepare volume path (handle Windows paths)
        volume_path = os.path.abspath(".")
        if sys.platform == "win32":
            # Convert Windows path to Docker-compatible format
            drive, path_no_drive = os.path.splitdrive(volume_path)
            volume_path = f"/{drive.rstrip(':').lower()}{path_no_drive.replace(os.sep, '/')}"
        
        # Run container
        print("Starting container...")
        run([
            "docker", "run", "-d",
            "--name", container_name,
            "-p", "8000:8000",
            "-v", f"{volume_path}:/app",
            "--restart", "unless-stopped",
            image_name
        ])
        
        print("✅ Docker direct succeeded")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Docker direct failed: {e}")
        return False

def run_with_python_direct():
    """Run using Python directly (development fallback)."""
    print("🐍 Running with Python directly (development mode)...")
    
    try:
        # Check if requirements are installed
        try:
            import fastapi
            import uvicorn
        except ImportError:
            print("Installing requirements...")
            run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        
        # Run the application
        print("Starting application with Python...")
        run([sys.executable, "start_server.py"])
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Python direct failed: {e}")
        return False
    except KeyboardInterrupt:
        print("\n🛑 Application stopped by user")
        return True

def main():
    """Main script execution."""
    parser = argparse.ArgumentParser(description="Build and run Torbware Records application.")
    parser.add_argument(
        "--python", 
        action="store_true",
        help="Run with Python directly (development mode)"
    )
    parser.add_argument(
        "--docker-only", 
        action="store_true",
        help="Skip Docker Compose and use Docker directly"
    )
    args = parser.parse_args()

    print("🎵 Torbware Records - Deployment Script")
    print("=" * 50)

    # Check if Python direct mode is requested
    if args.python:
        if run_with_python_direct():
            return
        else:
            sys.exit(1)

    # Check if Docker is available
    if not has_docker():
        print("❌ Docker is not installed or not in PATH")
        print("Options:")
        print("1. Install Docker Desktop or Docker Engine")
        print("2. Run with --python flag for development mode")
        sys.exit(1)

    success = False
    
    # Try Docker Compose first (unless --docker-only is specified)
    if not args.docker_only:
        success = run_with_docker_compose()
    
    # Fall back to direct Docker if Compose fails
    if not success:
        success = run_with_docker_direct()
    
    # Final fallback to Python direct
    if not success:
        print("\n⚠️ All Docker methods failed. Trying Python direct mode...")
        success = run_with_python_direct()
    
    if success:
        print("\n🎉 Application is running!")
        print("🌐 Access at: http://localhost:8000")
        if not args.python:
            print("📋 Container logs: docker logs torbware-records-app")
            print("🛑 Stop container: docker stop torbware-records-app")
    else:
        print("\n❌ All deployment methods failed!")
        print("Please check the error messages above and:")
        print("1. Ensure Docker is properly installed")
        print("2. Check file permissions")
        print("3. Try running with --python flag")
        sys.exit(1)

if __name__ == "__main__":
    main()
