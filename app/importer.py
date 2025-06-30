import yt_dlp
import uuid
from pathlib import Path
from app.convert import convert_to_aac
from app.database import SessionLocal, Track


def import_from_youtube(url: str) -> Track:
    """
    Importa uma track do YouTube usando yt-dlp, converte para AAC e salva no banco de dados.
    
    Args:
        url: URL do YouTube
        
    Returns:
        Track: Objeto Track criado
        
    Raises:
        Exception: Se falhar no download, conversão ou salvamento
    """
    temp_dir = Path("media/temp")
    temp_dir.mkdir(exist_ok=True)
    
    # Gerar nome único para arquivo temporário
    temp_filename = f"{uuid.uuid4()}"
    temp_path = temp_dir / temp_filename
    
    # Configurações do yt-dlp
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': str(temp_path) + '.%(ext)s',  # Adicionar extensão automaticamente
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
    }
    
    try:
        # Download do áudio
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'Untitled')
            
            # Encontrar o arquivo baixado (yt-dlp adiciona extensão)
            actual_temp_files = list(temp_dir.glob(f"{temp_filename}.*"))
            if not actual_temp_files:
                # Se não encontrou com extensão, procurar sem extensão
                temp_file_without_ext = temp_dir / temp_filename
                if temp_file_without_ext.exists():
                    actual_temp_file = temp_file_without_ext
                else:
                    raise Exception(f"Falha no download: arquivo não encontrado. Procurados: {temp_filename}.* e {temp_filename}")
            else:
                actual_temp_file = actual_temp_files[0]
        
        # Converter para AAC
        converted_path = convert_to_aac(str(actual_temp_file), "media")
        if not converted_path:
            raise Exception("Falha na conversão para AAC")
        
        # Extrair apenas o nome do arquivo convertido
        converted_filename = Path(converted_path).name
        
        # Salvar no banco de dados
        db = SessionLocal()
        try:
            track = Track(
                title=title,
                filename=converted_filename,
                source_url=url
            )
            db.add(track)
            db.commit()
            db.refresh(track)
            return track
        finally:
            db.close()
    
    finally:
        # Limpar arquivos temporários
        for temp_file in temp_dir.glob(f"{temp_filename}.*"):
            try:
                temp_file.unlink()
            except Exception as e:
                print(f"Erro ao remover arquivo temporário {temp_file}: {e}")
