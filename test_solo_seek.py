#!/usr/bin/env python3
"""
🧪 Teste Rápido - Verificação de Seek no Modo Solo
"""

import webbrowser
import time
import subprocess
import sys
import os

def test_solo_seek():
    print("🎵 TESTE: Seek no Modo Solo")
    print("=" * 40)
    
    print("1. 🚀 Iniciando servidor...")
    
    # Inicia o servidor em background
    try:
        server_process = subprocess.Popen([
            sys.executable, "-m", "uvicorn", 
            "main:app",
            "--host", "127.0.0.1",
            "--port", "8000",
            "--reload"
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        print("2. ⏳ Aguardando servidor inicializar...")
        time.sleep(3)
        
        print("3. 🌐 Abrindo navegador...")
        webbrowser.open("http://localhost:8000")
        
        print("\n📋 TESTE MANUAL:")
        print("1. ✅ Inserir nome e entrar")
        print("2. ✅ Fazer upload de uma música")
        print("3. ✅ Tocar a música")
        print("4. 🔍 TESTAR: Arrastar a barra de progresso (seek)")
        print("5. 🔍 VERIFICAR: Se o seek funciona normalmente")
        print("6. 🔍 VERIFICAR: Se não há mensagens de erro no console")
        
        print("\n🔧 PONTOS DE VERIFICAÇÃO:")
        print("- Player deve permitir seek/scrub normalmente")
        print("- Console deve mostrar: 'Controles do player habilitados'")
        print("- Console deve mostrar: 'Seeking to: X (Solo mode)'")
        print("- Não deve haver mensagens de erro")
        
        print("\n⚠️  Pressione ENTER quando terminar o teste...")
        input()
        
    except KeyboardInterrupt:
        print("\n🛑 Teste interrompido")
    except Exception as e:
        print(f"❌ Erro no teste: {e}")
    finally:
        print("🛑 Parando servidor...")
        server_process.terminate()
        server_process.wait()
        print("✅ Teste finalizado")

if __name__ == "__main__":
    test_solo_seek()
