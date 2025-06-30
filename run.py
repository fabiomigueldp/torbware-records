#!/usr/bin/env python3
"""Cross-platform helper to build and run the Music Stream Docker container."""

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
        subprocess.check_call(["docker", "compose", "version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def run(cmd, cwd=HERE):
    """Prints and runs a command."""
    print(f"$ {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)

def main():
    """Main script execution."""
    parser = argparse.ArgumentParser(description="Build and run the Music Stream Docker container.")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Quickly restart the container without forcing an image rebuild. "
             "Useful for code changes that don't involve new dependencies."
    )
    args = parser.parse_args()

    if not has_docker():
        print("Docker is required but not found. Please install Docker Desktop or Docker Engine.", file=sys.stderr)
        sys.exit(1)

    compose_up_command = ["up", "-d"]
    if not args.quick:
        compose_up_command.append("--build")
    else:
        print("--- Quick mode enabled: Skipping forced image build. ---")

    try:
        compose_cmd_base = None
        if has_docker_compose_v1():
            compose_cmd_base = ["docker-compose"]
        elif has_docker_compose_v2():
            compose_cmd_base = ["docker", "compose"]

        if compose_cmd_base:
            run(compose_cmd_base + compose_up_command)
        else:
            print("Warning: docker-compose not found. Falling back to plain Docker commands.", file=sys.stderr)
            image = "music_stream_app:latest"
            container_name = "music_stream_app"

            if not args.quick:
                run(["docker", "build", "-t", image, "."])
                # Stop and remove existing container to avoid conflicts
                subprocess.run(["docker", "stop", container_name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                subprocess.run(["docker", "rm", container_name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                volume_path = HERE
                if sys.platform == "win32":
                    drive, path_no_drive = os.path.splitdrive(HERE)
                    volume_path = f"/{drive.rstrip(':').lower()}{path_no_drive.replace('\\', '/')}"

                run([
                    "docker", "run", "-d",
                    "--name", container_name,
                    "-p", "8000:8000",
                    "-v", f"{volume_path}:/app",
                    image
                ])
            else:
                # Just try to start the existing container
                print(f"Attempting to start existing container '{container_name}'...")
                try:
                    run(["docker", "start", container_name])
                except subprocess.CalledProcessError:
                    print(f"Failed to start existing container '{container_name}'. It might not exist.", file=sys.stderr)
                    print("Please run the script without --quick first to create it.", file=sys.stderr)
                    sys.exit(1)

        print("\nContainer running at http://localhost:8000")

    except subprocess.CalledProcessError as e:
        print(f"\nAn error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()