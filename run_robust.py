#!/usr/bin/env python3

import subprocess
import sys
import os
import time
import json

def check_docker():
    """Check if Docker is running"""
    try:
        subprocess.run(['docker', 'info'], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def check_docker_compose():
    """Check if Docker Compose is available"""
    try:
        subprocess.run(['docker-compose', '--version'], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            # Try docker compose (newer syntax)
            subprocess.run(['docker', 'compose', '--version'], check=True, capture_output=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

def pull_base_image():
    """Try to pull the base image first"""
    print("🐳 Tentando baixar imagem base...")
    try:
        result = subprocess.run(['docker', 'pull', 'python:3.11-slim'], 
                              check=True, capture_output=True, text=True, timeout=60)
        print("✅ Imagem base baixada com sucesso")
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"❌ Erro ao baixar imagem base: {e}")
        return False

def run_with_docker_compose():
    """Run with docker-compose"""
    try:
        print("🚀 Usando docker-compose...")
        subprocess.run(['docker-compose', 'up', '-d', '--build'], check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro com docker-compose: {e}")
        return False

def run_with_docker_compose_v2():
    """Run with docker compose (v2 syntax)"""
    try:
        print("🚀 Usando docker compose (v2)...")
        subprocess.run(['docker', 'compose', 'up', '-d', '--build'], check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro com docker compose v2: {e}")
        return False

def run_direct_docker():
    """Run directly with docker commands"""
    try:
        print("🚀 Usando comandos Docker diretos...")
        
        # Build the image
        print("🔨 Construindo imagem...")
        subprocess.run(['docker', 'build', '-t', 'torbware-records', '.'], check=True)
        
        # Stop existing container if running
        print("🛑 Parando container existente...")
        subprocess.run(['docker', 'stop', 'torbware-records-app'], 
                      capture_output=True)
        subprocess.run(['docker', 'rm', 'torbware-records-app'], 
                      capture_output=True)
        
        # Run the container
        print("▶️ Iniciando container...")
        subprocess.run([
            'docker', 'run', '-d',
            '--name', 'torbware-records-app',
            '-p', '8000:8000',
            '-v', f'{os.getcwd()}/media:/app/media',
            '-v', f'{os.getcwd()}/library.db:/app/library.db',
            'torbware-records'
        ], check=True)
        
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro com Docker direto: {e}")
        return False

def run_locally():
    """Run locally with Python"""
    try:
        print("🐍 Executando localmente com Python...")
        
        # Check if requirements are installed
        try:
            import fastapi
            import uvicorn
        except ImportError:
            print("📦 Instalando dependências...")
            subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'], 
                          check=True)
        
        # Run the server
        print("🚀 Iniciando servidor local na porta 8000...")
        subprocess.run([sys.executable, 'start_server.py'], check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro na execução local: {e}")
        return False
    except KeyboardInterrupt:
        print("\n👋 Servidor interrompido pelo usuário")
        return True

def main():
    print("🎵 Torbware Records - Setup Script Robusto")
    print("=" * 50)
    
    # Check prerequisites
    if not check_docker():
        print("⚠️ Docker não está rodando ou não foi encontrado")
        print("🐍 Tentando executar localmente...")
        return run_locally()
    
    print("✅ Docker está rodando")
    
    # Try to pull base image first
    if not pull_base_image():
        print("⚠️ Problema de conectividade com Docker Hub")
        print("🔄 Tentando alternativas...")
        
        # Try different Docker approaches without pulling
        if check_docker_compose():
            print("🚀 Tentando com docker-compose sem pull...")
            try:
                subprocess.run(['docker-compose', 'up', '-d', '--build'], 
                             check=True, timeout=120)
                print("✅ Aplicação iniciada com docker-compose!")
                print("🌐 Acesse: http://localhost:8000")
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        
        print("🐍 Fallback para execução local...")
        return run_locally()
    
    # Try different Docker approaches
    if check_docker_compose():
        if run_with_docker_compose():
            print("✅ Aplicação iniciada com docker-compose!")
            print("🌐 Acesse: http://localhost:8000")
            return True
    
    # Try docker compose v2
    if run_with_docker_compose_v2():
        print("✅ Aplicação iniciada com docker compose v2!")
        print("🌐 Acesse: http://localhost:8000")
        return True
    
    # Try direct docker
    if run_direct_docker():
        print("✅ Aplicação iniciada com Docker direto!")
        print("🌐 Acesse: http://localhost:8000")
        return True
    
    # Fallback to local execution
    print("⚠️ Todos os métodos Docker falharam")
    print("🐍 Tentando executar localmente...")
    return run_locally()

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            print("\n❌ Falha em todos os métodos de execução")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 Execução interrompida pelo usuário")
        sys.exit(0)
