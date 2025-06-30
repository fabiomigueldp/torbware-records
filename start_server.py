#!/usr/bin/env python3
"""
Script para executar o Torbware Records diretamente (sem Docker)
Para desenvolvimento e teste local com acesso de rede
"""

import os
import sys
import socket
import subprocess
import webbrowser
from pathlib import Path

def get_local_ip():
    """Obtém o IP local da máquina"""
    try:
        # Conecta a um servidor externo para obter o IP local
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return "127.0.0.1"

def check_dependencies():
    """Verifica se as dependências estão instaladas"""
    print("🔍 Verificando dependências...")
    
    missing_deps = []
    
    try:
        import fastapi
        print("✅ FastAPI instalado")
    except ImportError:
        missing_deps.append("fastapi")
    
    try:
        import uvicorn
        print("✅ Uvicorn instalado")
    except ImportError:
        missing_deps.append("uvicorn")
    
    try:
        import sqlalchemy
        print("✅ SQLAlchemy instalado")
    except ImportError:
        missing_deps.append("sqlalchemy")
    
    try:
        import jinja2
        print("✅ Jinja2 instalado")
    except ImportError:
        missing_deps.append("jinja2")
    
    if missing_deps:
        print(f"\n❌ Dependências faltando: {', '.join(missing_deps)}")
        print("Execute: pip install -r requirements.txt")
        return False
    
    print("✅ Todas as dependências estão instaladas")
    return True

def check_port(port=8000):
    """Verifica se a porta está disponível"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        result = s.connect_ex(('localhost', port))
        return result != 0

def main():
    print("🎵 TORBWARE RECORDS - SERVIDOR LOCAL")
    print("=" * 50)
    
    # Verifica dependências
    if not check_dependencies():
        sys.exit(1)
    
    # Verifica se a porta está disponível
    port = 8000
    if not check_port(port):
        print(f"❌ Porta {port} já está em uso")
        print("Tentando porta 8001...")
        port = 8001
        if not check_port(port):
            print("❌ Portas 8000 e 8001 estão em uso")
            sys.exit(1)
    
    # Obtém IPs
    local_ip = get_local_ip()
    
    print(f"\n🚀 Iniciando servidor na porta {port}...")
    print("📍 URLs de acesso:")
    print(f"   - Local:    http://localhost:{port}")
    print(f"   - Rede:     http://{local_ip}:{port}")
    print(f"   - Mobile:   http://{local_ip}:{port}")
    print("\n💡 Para acessar pelo celular:")
    print(f"   1. Conecte o celular na mesma rede WiFi")
    print(f"   2. Acesse: http://{local_ip}:{port}")
    print("\n⚠️  Certifique-se de que o firewall permite conexões na porta {port}")
    print("\n🛑 Para parar o servidor: Ctrl+C")
    print("=" * 50)
    
    try:
        # Inicia o servidor
        subprocess.run([
            sys.executable, "-m", "uvicorn", 
            "main:app",
            "--host", "0.0.0.0",  # Permite acesso de qualquer IP
            "--port", str(port),
            "--reload",  # Auto-reload para desenvolvimento
        ], check=True)
        
    except KeyboardInterrupt:
        print("\n\n🛑 Servidor parado pelo usuário")
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Erro ao iniciar servidor: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Erro inesperado: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
