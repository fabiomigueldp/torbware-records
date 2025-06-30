async function fetchLibrary() {
    try {
        const res = await fetch('/library');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        const list = document.getElementById('libraryList');
        list.innerHTML = '';
        
        if (data.length === 0) {
            list.innerHTML = '<li class="list-group-item text-muted">Nenhuma música encontrada. Faça upload de um arquivo.</li>';
            return;
        }
        
        data.forEach(track => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `
                <span>${track.title}</span>
                <button class="btn btn-outline-primary btn-sm" onclick="playTrack(${track.id})">Play</button>
            `;
            list.appendChild(li);
        });
    } catch (error) {
        console.error('Error fetching library:', error);
        const list = document.getElementById('libraryList');
        list.innerHTML = '<li class="list-group-item text-danger">Erro ao carregar biblioteca</li>';
    }
}

async function playTrack(id) {
    const player = document.getElementById('player');
    const statusDiv = document.getElementById('playerStatus');
    const streamUrl = `/stream/${id}`;
    
    try {
        console.log('Playing track:', id, 'URL:', streamUrl);
        
        // Update status
        if (statusDiv) statusDiv.textContent = 'Carregando música...';
        
        // Clear previous source
        player.pause();
        player.src = '';
        player.load();
        
        // Test if the stream URL is accessible
        const headResponse = await fetch(streamUrl, { method: 'HEAD' });
        if (!headResponse.ok) {
            throw new Error(`Stream não acessível: ${headResponse.status} ${headResponse.statusText}`);
        }
        
        // Set new source
        player.src = streamUrl;
        player.load();
        
        // Wait for audio to be ready to play
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: Áudio demorou muito para carregar'));
            }, 10000);
            
            const onCanPlay = () => {
                clearTimeout(timeout);
                player.removeEventListener('canplay', onCanPlay);
                player.removeEventListener('error', onError);
                resolve();
            };
            
            const onError = () => {
                clearTimeout(timeout);
                player.removeEventListener('canplay', onCanPlay);
                player.removeEventListener('error', onError);
                reject(new Error(`Erro do player: ${player.error?.message || 'Erro desconhecido'}`));
            };
            
            player.addEventListener('canplay', onCanPlay);
            player.addEventListener('error', onError);
        });
        
        // Try to play
        const playPromise = player.play();
        if (playPromise !== undefined) {
            await playPromise;
        }
        
        if (statusDiv) statusDiv.textContent = 'Reproduzindo...';
        console.log('Playback started successfully');
        
    } catch (error) {
        console.error('Error playing track:', error);
        
        if (statusDiv) statusDiv.textContent = 'Erro na reprodução';
        
        // Provide user-friendly error messages
        let message = 'Erro desconhecido';
        if (error.message.includes('não acessível')) {
            message = 'Arquivo de música não encontrado no servidor';
        } else if (error.message.includes('Timeout')) {
            message = 'Música demorou muito para carregar. Tente novamente.';
        } else if (error.message.includes('formato')) {
            message = 'Formato de áudio não suportado pelo seu dispositivo';
        } else if (error.name === 'NotAllowedError') {
            message = 'Reprodução bloqueada. Clique em play novamente.';
        }
        
        alert(`Erro ao reproduzir a música: ${message}`);
    }
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('audioFile');
    if (!fileInput.files.length) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    const status = document.getElementById('uploadStatus');
    status.innerHTML = `<div class="alert alert-info">Fazendo upload de "${file.name}"...</div>`;

    try {
        const res = await fetch('/upload', { 
            method: 'POST', 
            body: formData,
            // Don't set Content-Type header, let browser set it with boundary
        });
        
        if (res.ok) {
            const result = await res.json();
            status.innerHTML = `<div class="alert alert-success">Upload realizado com sucesso! "${result.title}" foi adicionado à biblioteca.</div>`;
            fileInput.value = '';
            await fetchLibrary(); // Refresh the library
        } else {
            const err = await res.json();
            console.error('Upload error response:', err);
            status.innerHTML = `<div class="alert alert-danger">Erro no upload: ${err.detail || 'Erro desconhecido'}</div>`;
        }
    } catch (error) {
        console.error('Upload error:', error);
        status.innerHTML = `<div class="alert alert-danger">Erro de conectividade durante o upload. Verifique sua conexão.</div>`;
    }
});

async function testConnection() {
    try {
        const response = await fetch('/test');
        const data = await response.json();
        console.log('Connection test:', data);
        return data.status === 'ok';
    } catch (error) {
        console.error('Connection test failed:', error);
        return false;
    }
}

function setupAudioEventListeners() {
    const player = document.getElementById('player');
    const statusDiv = document.getElementById('playerStatus');
    
    if (!player || !statusDiv) return;
    
    player.addEventListener('loadstart', () => {
        statusDiv.textContent = 'Carregando áudio...';
    });
    
    player.addEventListener('canplay', () => {
        statusDiv.textContent = 'Áudio carregado e pronto para reprodução';
    });
    
    player.addEventListener('playing', () => {
        statusDiv.textContent = 'Reproduzindo...';
    });
    
    player.addEventListener('pause', () => {
        statusDiv.textContent = 'Pausado';
    });
    
    player.addEventListener('ended', () => {
        statusDiv.textContent = 'Reprodução finalizada';
    });
    
    player.addEventListener('error', (e) => {
        console.error('Audio player error:', e, player.error);
        let errorMsg = 'Erro desconhecido no player de áudio';
        
        if (player.error) {
            switch (player.error.code) {
                case player.error.MEDIA_ERR_ABORTED:
                    errorMsg = 'Reprodução abortada';
                    break;
                case player.error.MEDIA_ERR_NETWORK:
                    errorMsg = 'Erro de rede';
                    break;
                case player.error.MEDIA_ERR_DECODE:
                    errorMsg = 'Erro de decodificação - formato não suportado';
                    break;
                case player.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMsg = 'Formato não suportado';
                    break;
            }
        }
        
        statusDiv.innerHTML = `<span class="text-danger">${errorMsg}</span>`;
    });
    
    player.addEventListener('stalled', () => {
        statusDiv.innerHTML = '<span class="text-warning">Buffering...</span>';
    });
    
    player.addEventListener('waiting', () => {
        statusDiv.innerHTML = '<span class="text-warning">Aguardando dados...</span>';
    });
}

window.onload = async function() {
    console.log('App loading...');
    
    // Setup audio event listeners first
    setupAudioEventListeners();
    
    // Test connection first
    const isConnected = await testConnection();
    if (!isConnected) {
        console.warn('Connection test failed, but proceeding anyway...');
    }
    
    // Load library
    await fetchLibrary();
    
    console.log('App loaded successfully');
};