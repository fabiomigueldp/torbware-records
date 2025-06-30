// --- Global State ---
let ws;
let userId = null;
let userName = null;
let currentPartyId = null;
let currentPartyMode = 'host';
let isHost = false;
let isSyncing = false; // Prevents feedback loops from player events
let hostSyncInterval = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let lastPlayerAction = 0; // Timestamp of last player action sent
let actionDebounceTime = 300; // ms to debounce player actions (host mode)
let democraticDebounceTime = 500; // ms to debounce player actions (democratic mode)
let lastSyncReceived = 0; // Timestamp of last sync received
let pendingSeek = null; // Debounced seek action

// --- DOM Elements ---
const nameModal = new bootstrap.Modal(document.getElementById('nameModal'));
const nameInput = document.getElementById('userNameInput');
const joinButton = document.getElementById('joinButton');
const alternativeJoinButton = document.getElementById('alternativeJoinButton');
const alternativeEntry = document.getElementById('alternativeEntry');
const alternativeNameInput = document.getElementById('alternativeNameInput');
const alternativeSubmitButton = document.getElementById('alternativeSubmitButton');
const player = document.getElementById('player');
const playerControls = document.getElementById('player-controls');
const playerStatus = document.getElementById('playerStatus');
const libraryList = document.getElementById('libraryList');
const userList = document.getElementById('userList');
const partyList = document.getElementById('partyList');
const createPartyBtn = document.getElementById('createPartyBtn');
const leavePartyBtn = document.getElementById('leavePartyBtn');
const currentPartyPanel = document.getElementById('currentPartyPanel');
const welcomeCard = document.getElementById('welcomeCard');
const partyInfo = document.getElementById('partyInfo');
const partyMemberList = document.getElementById('partyMemberList');
const hostControls = document.getElementById('hostControls');
const memberControls = document.getElementById('memberControls');
const democraticModeToggle = document.getElementById('democraticModeToggle');
const connectionStatus = document.getElementById('connectionStatus');
const debugInfo = document.getElementById('debugInfo');
const debugUserAgent = document.getElementById('debugUserAgent');
const debugTimestamp = document.getElementById('debugTimestamp');

// --- WebSocket Communication ---

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${userId}`);

    ws.onopen = () => {
        console.log('WebSocket connected.');
        reconnectAttempts = 0;
        updateConnectionStatus(true);
        sendMessage('user_join', { name: userName });
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        switch (message.type) {
            case 'state_update':
                handleStateUpdate(message.payload);
                break;
            case 'party_sync':
                handlePartySync(message.payload);
                break;
            case 'action_rejected':
                console.log('🚫 Ação rejeitada pelo servidor:', message.payload);
                showNotification('Ação muito rápida, aguarde um momento', 'warning');
                break;
            case 'error':
                showNotification(`Erro: ${message.payload.message}`, 'error');
                break;
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected.');
        updateConnectionStatus(false);
        
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            showNotification(`Reconectando... (${reconnectAttempts}/${maxReconnectAttempts})`, 'warning');
            setTimeout(connectWebSocket, 3000);
        } else {
            showNotification('Falha na conexão. Recarregue a página.', 'error');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
}

function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatus.textContent = '🟢 Conectado';
        connectionStatus.className = 'connection-status connected';
    } else {
        connectionStatus.textContent = '🔴 Desconectado';
        connectionStatus.className = 'connection-status disconnected';
    }
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    } else {
        showNotification('Sem conexão. Tentando reconectar...', 'warning');
    }
}

// --- UI Helper Functions ---

function showNotification(message, type = 'info') {
    // Create toast notification
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'primary'} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(container);
    return container;
}

function setLoadingState(element, loading, text = '') {
    if (loading) {
        element.classList.add('loading');
        if (text) {
            const spinner = element.querySelector('.btn-text');
            if (spinner) spinner.textContent = text;
        }
    } else {
        element.classList.remove('loading');
    }
}

// --- UI Rendering ---

function renderUserList(users) {
    userList.innerHTML = '';
    if (users.length === 0) {
        userList.innerHTML = '<li class="list-group-item text-center text-muted">Nenhum usuário conectado</li>';
        return;
    }
    
    users.forEach(user => {
        const li = document.createElement('li');
        li.className = `list-group-item d-flex align-items-center ${user.id === userId ? 'active' : ''}`;
        li.innerHTML = `
            <span class="user-indicator"></span>
            <strong>${user.name}</strong>
            ${user.id === userId ? '<small class="ms-auto">Você</small>' : ''}
        `;
        userList.appendChild(li);
    });
}

function renderPartyList(parties) {
    partyList.innerHTML = '';
    if (parties.length === 0) {
        partyList.innerHTML = `
            <li class="list-group-item text-center">
                <div class="text-muted">
                    <h6>🎉 Nenhuma festa ativa</h6>
                    <small>Seja o primeiro a criar uma festa!</small>
                </div>
            </li>
        `;
        return;
    }
    
    parties.forEach(party => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <strong>🎊 ${party.host_name}</strong>
                        <span class="party-status ${party.mode === 'democratic' ? 'democratic-mode' : 'host-mode'}">
                            ${party.mode === 'democratic' ? '🗳️ Democrático' : '👑 Host'}
                        </span>
                    </div>
                    <small class="text-muted d-block">
                        👥 ${party.member_count} membro(s) | 🎵 ${party.current_track_title}
                    </small>
                </div>
                <button class="btn btn-primary btn-sm" onclick="joinParty('${party.party_id}')" ${currentPartyId ? 'disabled' : ''}>
                    ${currentPartyId === party.party_id ? '✓ Na festa' : 'Entrar'}
                </button>
            </div>
        `;
        partyList.appendChild(li);
    });
}

function renderCurrentParty(party) {
    if (!party || !party.party_id) {
        currentPartyPanel.style.display = 'none';
        welcomeCard.style.display = 'block';
        currentPartyId = null;
        currentPartyMode = 'host';
        isHost = false;
        updatePlayerControls(true); // Enable controls when returning to solo mode
        updatePlayerStatus('solo');
        if (hostSyncInterval) {
            clearInterval(hostSyncInterval);
            hostSyncInterval = null;
        }
        return;
    }

    currentPartyId = party.party_id;
    currentPartyMode = party.mode;
    isHost = party.host_id === userId;
    currentPartyPanel.style.display = 'block';
    welcomeCard.style.display = 'none';

    const hostMember = party.members.find(m => m.id === party.host_id);
    partyInfo.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <div>
                <h6 class="mb-1">👑 Anfitrião: <strong>${hostMember?.name || 'Desconhecido'}</strong></h6>
                <span class="party-status ${party.mode === 'democratic' ? 'democratic-mode' : 'host-mode'}">
                    ${party.mode === 'democratic' ? '🗳️ Modo Democrático' : '👑 Modo Host'}
                </span>
            </div>
            <div class="text-muted small">
                ID: ${party.party_id.substr(0, 8)}...
            </div>
        </div>
    `;

    // Render party members
    partyMemberList.innerHTML = '';
    party.members.forEach(member => {
        const li = document.createElement('li');
        li.className = `list-group-item d-flex align-items-center ${member.id === userId ? 'active' : ''}`;
        li.innerHTML = `
            <span class="user-indicator"></span>
            <span class="flex-grow-1">
                <strong>${member.name}</strong>
                ${member.id === party.host_id ? ' <small class="text-warning">👑 Host</small>' : ''}
                ${member.id === userId ? ' <small class="text-primary">(Você)</small>' : ''}
            </span>
        `;
        partyMemberList.appendChild(li);
    });

    // Update controls visibility
    hostControls.style.display = isHost ? 'block' : 'none';
    memberControls.style.display = (!isHost && party.mode === 'democratic') ? 'block' : 'none';
    
    if (isHost) {
        democraticModeToggle.checked = party.mode === 'democratic';
    }

    const canControl = isHost || party.mode === 'democratic';
    
    console.log('🎯 Determinando controle do player:', {
        isHost,
        partyMode: party.mode,
        canControl,
        userId,
        hostId: party.host_id,
        isUserTheHost: party.host_id === userId
    });
    
    updatePlayerControls(canControl);
    updatePlayerStatus(isHost ? 'host' : (party.mode === 'democratic' ? 'democratic' : 'member'));
}

function updatePlayerControls(enabled) {
    const canControl = enabled || !currentPartyId; // Always allow control when not in party
    
    console.log('🎮 Atualizando controles do player:', {
        enabled,
        currentPartyId,
        canControl,
        isHost,
        currentPartyMode,
        playerControlsDisabled: playerControls.classList.contains('disabled'),
        playerPointerEvents: player.style.pointerEvents
    });
    
    if (canControl) {
        playerControls.classList.remove('disabled');
        // Ensure all player controls are actually enabled
        player.controls = true;
        player.style.pointerEvents = 'auto';
        player.style.opacity = '1';
        player.style.filter = 'none';
        
        // Force enable the HTML5 audio element controls
        player.removeAttribute('disabled');
        
        // Ensure the player element itself is interactive
        player.style.setProperty('pointer-events', 'auto', 'important');
        
        console.log('✅ Controles do player habilitados - Estado final:', {
            controls: player.controls,
            pointerEvents: player.style.pointerEvents,
            disabled: player.disabled,
            classDisabled: playerControls.classList.contains('disabled')
        });
    } else {
        playerControls.classList.add('disabled');
        // Keep native controls but disable interaction
        player.controls = true;
        player.style.pointerEvents = 'none';
        
        console.log('🚫 Controles do player desabilitados - Estado final:', {
            controls: player.controls,
            pointerEvents: player.style.pointerEvents,
            classDisabled: playerControls.classList.contains('disabled')
        });
    }
}

function updatePlayerStatus(mode) {
    playerStatus.style.display = 'block';
    switch(mode) {
        case 'solo':
            playerStatus.textContent = '🎧 Modo Solo';
            playerStatus.className = 'party-status host-mode';
            break;
        case 'host':
            playerStatus.textContent = '👑 Você controla';
            playerStatus.className = 'party-status host-mode';
            break;
        case 'democratic':
            playerStatus.textContent = '🗳️ Controle compartilhado';
            playerStatus.className = 'party-status democratic-mode';
            
            // Adiciona indicador de debounce se necessário
            const timeSinceAction = Date.now() - lastPlayerAction;
            if (timeSinceAction < actionDebounceTime * 2) {
                playerStatus.textContent += ' ⏳';
                playerStatus.title = 'Aguardando sincronização...';
            } else {
                playerStatus.title = 'Você pode controlar o player';
            }
            break;
        case 'member':
            playerStatus.textContent = '🎵 Ouvindo festa';
            playerStatus.className = 'party-status democratic-mode';
            break;
    }
}

// --- State Handlers ---

function handleStateUpdate(payload) {
    renderUserList(payload.users);
    renderPartyList(payload.parties);
}

function handlePartySync(party) {
    console.log('🔄 Party sync recebido:', party);
    
    const syncTimestamp = Date.now();
    lastSyncReceived = syncTimestamp;
    
    // Atualiza estado da interface
    renderCurrentParty(party);

    // NOVA LÓGICA DE SINCRONIZAÇÃO INTELIGENTE:
    
    if (party.mode === 'host') {
        // MODO HOST: Apenas o host controla, membros sincronizam
        if (party.host_id === userId) {
            console.log('👑 HOST MODE: Você é o host - mantendo controle total');
            
            // Host apenas atualiza música se necessário
            if (party.track_id && party.track_id !== getCurrentTrackId()) {
                console.log('🎵 Host: Mudando para nova música:', party.track_id);
                const newTrackSrc = new URL(`/stream/${party.track_id}`, window.API_BASE_URL).href;
                player.src = newTrackSrc;
                player.load();
            }
            
            // HOST NÃO DEVE SER FORÇADO A SINCRONIZAR - ele controla tudo
            // Apenas inicia/mantém intervalo de sincronização para enviar seu estado
            if (!hostSyncInterval) {
                console.log('⏰ Iniciando intervalo de sincronização do host');
                hostSyncInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN && !isSyncing) {
                        sendMessage('sync_update', {
                            currentTime: player.currentTime,
                            is_playing: !player.paused
                        });
                    }
                }, 1000);
            }
        } else {
            console.log('� HOST MODE: Você é membro - sincronizando com host');
            // Membros sempre sincronizam no modo host
            applySyncUpdate(party, false);
            
            // Limpa intervalo do host se existir
            if (hostSyncInterval) {
                clearInterval(hostSyncInterval);
                hostSyncInterval = null;
            }
        }
        
    } else if (party.mode === 'democratic') {
        // MODO DEMOCRÁTICO: Todos podem controlar
        
        // Verifica se houve ação recente do próprio usuário com debounce específico do modo
        const currentDebounce = currentPartyMode === 'democratic' ? democraticDebounceTime : actionDebounceTime;
        const hasRecentAction = (syncTimestamp - lastPlayerAction) < currentDebounce * 3;
        
        if (hasRecentAction) {
            console.log('🗳️ DEMOCRATIC MODE: Ignorando sync - você acabou de fazer uma ação (debounce ativo)');
            
            // Apenas atualiza música se for diferente
            if (party.track_id && party.track_id !== getCurrentTrackId()) {
                console.log('🎵 Democrático: Mudando música');
                const newTrackSrc = new URL(`/stream/${party.track_id}`, window.API_BASE_URL).href;
                player.src = newTrackSrc;
                player.load();
            }
        } else {
            console.log('🗳️ DEMOCRATIC MODE: Aplicando sincronização de outro membro');
            // Aplica sincronização gentle (mais tolerante)
            applySyncUpdate(party, true);
        }
        
        // No modo democrático, não há host sync interval
        if (hostSyncInterval) {
            clearInterval(hostSyncInterval);
            hostSyncInterval = null;
        }
    }
}

// Função auxiliar para aplicar sincronização
function applySyncUpdate(party, gentle = false) {
    isSyncing = true;
    
    console.log(`🔄 Aplicando sincronização ${gentle ? '(gentle)' : '(forceful)'}:`, {
        track_id: party.track_id,
        currentTime: party.currentTime,
        is_playing: party.is_playing,
        player_currentTime: player.currentTime,
        player_paused: player.paused
    });

    try {
        // Sync da música
        if (party.track_id) {
            const newTrackSrc = new URL(`/stream/${party.track_id}`, window.API_BASE_URL).href;
            if (player.src !== newTrackSrc) {
                console.log(`🎵 Mudando música: ${getCurrentTrackId()} -> ${party.track_id}`);
                player.src = newTrackSrc;
                player.load();
            }
        }

        // Sync do tempo com tolerância diferente baseada no modo
        const timeTolerance = gentle ? 4.0 : 1.5; // Mais tolerante no modo democrático (aumentado de 3.0 para 4.0)
        const timeDifference = Math.abs(player.currentTime - party.currentTime);
        
        if (party.track_id && timeDifference > timeTolerance) {
            console.log(`⏰ Ajustando tempo: ${player.currentTime.toFixed(2)}s -> ${party.currentTime.toFixed(2)}s (diff: ${timeDifference.toFixed(2)}s, tolerance: ${timeTolerance}s)`);
            player.currentTime = party.currentTime;
        } else if (party.track_id && timeDifference > 0.5) {
            console.log(`⏰ Diferença de tempo pequena: ${timeDifference.toFixed(2)}s (dentro da tolerância: ${timeTolerance}s)`);
        }

        // Sync do estado play/pause
        if (party.is_playing && player.paused) {
            console.log('▶️ Iniciando reprodução (sync)');
            player.play().catch(e => {
                console.warn("Autoplay prevented:", e);
                showNotification('Clique no player para iniciar', 'info');
            });
        } else if (!party.is_playing && !player.paused) {
            console.log('⏸️ Pausando reprodução (sync)');
            player.pause();
        }
        
    } catch (error) {
        console.error('Erro na sincronização:', error);
    } finally {
        setTimeout(() => { 
            isSyncing = false; 
            console.log('✅ Sincronização concluída');
        }, 300);
    }
}

// Função auxiliar para obter ID da música atual
function getCurrentTrackId() {
    if (!player.src) return null;
    const match = player.src.match(/\/stream\/(\d+)/);
    return match ? parseInt(match[1]) : null;
}

// --- Library & Upload ---

async function fetchLibrary() {
    try {
        const res = await fetch(new URL('/library', window.API_BASE_URL));
        if (!res.ok) throw new Error('Falha ao carregar biblioteca');
        
        const data = await res.json();
        libraryList.innerHTML = '';
        
        if (data.length === 0) {
            libraryList.innerHTML = `
                <li class="list-group-item text-center">
                    <div class="text-muted">
                        <h6>📁 Biblioteca vazia</h6>
                        <small>Faça upload de suas músicas favoritas!</small>
                    </div>
                </li>
            `;
            return;
        }
        
        data.forEach(track => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.innerHTML = `
                <div class="flex-grow-1">
                    <strong>${track.title}</strong>
                    <small class="d-block text-muted">ID: ${track.id}</small>
                </div>
            `;
            
            const playBtn = document.createElement('button');
            playBtn.className = 'btn btn-outline-primary btn-sm';
            playBtn.innerHTML = '▶️ Tocar';
            playBtn.onclick = () => playTrack(track.id);
            
            li.appendChild(playBtn);
            libraryList.appendChild(li);
        });
    } catch (error) {
        console.error('Error fetching library:', error);
        showNotification('Erro ao carregar biblioteca', 'error');
        libraryList.innerHTML = '<li class="list-group-item text-center text-danger">Erro ao carregar biblioteca</li>';
    }
}

function playTrack(trackId) {
    if (currentPartyId) {
        const canControl = isHost || currentPartyMode === 'democratic';
        if (canControl) {
            lastPlayerAction = Date.now();
            sendMessage('player_action', { action: 'change_track', track_id: trackId });
            showNotification('Alterando música da festa...', 'info');
            console.log('📤 Enviando ação: change_track to', trackId);
        } else {
            showNotification('Você não pode controlar o player neste modo', 'warning');
        }
    } else {
        // Standard non-party playback
        player.src = new URL(`/stream/${trackId}`, window.API_BASE_URL);
        player.play().catch(e => {
            console.warn("Play failed:", e);
            showNotification('Erro ao reproduzir música', 'error');
        });
    }
}
// --- Event Listeners ---

function setupEventListeners() {
    // Player events with debouncing and smart logic
    player.onplay = () => {
        console.log('🎵 Player play event - currentPartyId:', currentPartyId, 'isSyncing:', isSyncing);
        
        // Only send to server if in party mode and not syncing
        if (!isSyncing && currentPartyId) {
            const canControl = isHost || currentPartyMode === 'democratic';
            console.log('▶️ Play event - canControl:', canControl, 'isHost:', isHost, 'mode:', currentPartyMode);
            
            if (canControl) {
                lastPlayerAction = Date.now();
                sendMessage('player_action', { action: 'play' });
                console.log('📤 Enviando ação: play');
            }
        }
        // In solo mode, just let it play normally (no server communication)
    };
    
    player.onpause = () => {
        console.log('🎵 Player pause event - currentPartyId:', currentPartyId, 'isSyncing:', isSyncing);
        
        // Only send to server if in party mode and not syncing
        if (!isSyncing && currentPartyId) {
            const canControl = isHost || currentPartyMode === 'democratic';
            console.log('⏸️ Pause event - canControl:', canControl, 'isHost:', isHost, 'mode:', currentPartyMode);
            
            if (canControl) {
                lastPlayerAction = Date.now();
                sendMessage('player_action', { action: 'pause' });
                console.log('📤 Enviando ação: pause');
            }
        }
        // In solo mode, just let it pause normally (no server communication)
    };
    
    // Handle seeking - works in both solo and party modes
    player.addEventListener('seeking', () => {
        console.log('🔄 Player seeking event - currentPartyId:', currentPartyId, 'isSyncing:', isSyncing);
        console.log('🔄 Seeking context:', {
            isHost,
            currentPartyMode,
            playerControlsDisabled: playerControls.classList.contains('disabled'),
            playerPointerEvents: player.style.pointerEvents
        });
        
        // Only send to server if in party mode and not syncing
        if (!isSyncing && currentPartyId) {
            const canControl = isHost || currentPartyMode === 'democratic';
            console.log('🔄 Seeking event - canControl:', canControl, 'isHost:', isHost, 'mode:', currentPartyMode);
            
            if (canControl) {
                // Clear any pending seek
                if (pendingSeek) {
                    clearTimeout(pendingSeek);
                }
                
                // Debounce the seek action with different timing based on mode
                const debounceTime = currentPartyMode === 'democratic' ? democraticDebounceTime : actionDebounceTime;
                pendingSeek = setTimeout(() => {
                    lastPlayerAction = Date.now();
                    sendMessage('player_action', { 
                        action: 'seek', 
                        currentTime: player.currentTime 
                    });
                    console.log('📤 Enviando ação: seek to', player.currentTime, `(${currentPartyMode} mode)`);
                    pendingSeek = null;
                }, debounceTime);
            } else {
                console.log('🚫 Seek bloqueado - sem permissão de controle');
            }
        } else {
            // In solo mode, seeking works normally without server communication
            console.log('🔄 Seeking to:', player.currentTime, '(Solo mode)');
        }
    });
    
    // Also handle seeked event for immediate feedback
    player.onseeked = () => {
        console.log('✅ Player seeked event - currentPartyId:', currentPartyId, 'isSyncing:', isSyncing);
        
        // Only send to server if in party mode and not syncing
        if (!isSyncing && currentPartyId) {
            const canControl = isHost || currentPartyMode === 'democratic';
            console.log('✅ Seeked event - canControl:', canControl, 'isHost:', isHost, 'mode:', currentPartyMode);
            
            if (canControl && !pendingSeek) {
                // Only send if no pending seek (avoid double-sending)
                lastPlayerAction = Date.now();
                sendMessage('player_action', { 
                    action: 'seek', 
                    currentTime: player.currentTime 
                });
                console.log('📤 Enviando ação: seeked to', player.currentTime);
            }
        } else {
            // In solo mode, seeked works normally
            console.log('✅ Seeked to:', player.currentTime, '(Solo mode)');
        }
    };

    // Button events
    createPartyBtn.onclick = () => {
        if (!currentPartyId) {
            setLoadingState(createPartyBtn, true, '⏳ Criando...');
            sendMessage('create_party', {});
            setTimeout(() => {
                setLoadingState(createPartyBtn, false);
                createPartyBtn.querySelector('.btn-text').textContent = '➕ Criar Festa';
            }, 2000);
        }
    };
    
    leavePartyBtn.onclick = () => {
        if (currentPartyId) {
            if (confirm('Tem certeza que deseja sair da festa?')) {
                sendMessage('leave_party', {});
                showNotification('Saindo da festa...', 'info');
            }
        }
    };
    
    democraticModeToggle.onchange = (e) => {
        if (isHost) {
            sendMessage('set_mode', { mode: e.target.checked ? 'democratic' : 'host' });
            showNotification(
                e.target.checked ? 'Modo democrático ativado!' : 'Modo host ativado!', 
                'success'
            );
        }
    };

    // Upload form
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fileInput = document.getElementById('audioFile');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        
        if (!fileInput.files.length) {
            showNotification('Selecione um arquivo de áudio', 'warning');
            return;
        }

        const file = fileInput.files[0];
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            showNotification('Arquivo muito grande. Máximo: 50MB', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        
        const status = document.getElementById('uploadStatus');
        status.className = 'alert alert-info';
        status.innerHTML = '⏳ Fazendo upload...';
        setLoadingState(submitBtn, true, '⏳ Enviando...');

        try {
            const res = await fetch(new URL('/upload', window.API_BASE_URL), { 
                method: 'POST', 
                body: formData 
            });
            
            if (res.ok) {
                const result = await res.json();
                status.className = 'alert alert-success';
                status.innerHTML = `✅ Upload realizado com sucesso! <strong>${result.title}</strong>`;
                fileInput.value = '';
                fetchLibrary();
                showNotification('Música adicionada à biblioteca!', 'success');
                
                setTimeout(() => {
                    status.innerHTML = '';
                    status.className = '';
                }, 5000);
            } else {
                const err = await res.json();
                throw new Error(err.detail || 'Erro no upload');
            }
        } catch (error) {
            console.error('Upload error:', error);
            status.className = 'alert alert-danger';
            status.innerHTML = `❌ Erro: ${error.message}`;
            showNotification('Erro no upload', 'error');
        } finally {
            setLoadingState(submitBtn, false);
            submitBtn.querySelector('.btn-text').textContent = '📤 Fazer Upload';
        }
    });
}

// --- Party Actions ---

function joinParty(partyId) {
    if (!currentPartyId) {
        sendMessage('join_party', { party_id: partyId });
        showNotification('Entrando na festa...', 'info');
    }
}

function scrollToParties() {
    document.getElementById('partyList').scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
    });
}

// --- Initialization ---

window.onload = () => {
    console.log('🌐 Window loaded');
    console.log('📱 User Agent:', navigator.userAgent);
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log('📱 Is Mobile:', isMobile);
    
    // Detecta se é mobile e adiciona classe específica
    if (isMobile) {
        document.body.classList.add('mobile-device');
        console.log('📱 Classe mobile-device adicionada');
    }
    
    // Adiciona info de debug se for mobile
    if (isMobile && debugInfo) {
        debugInfo.style.display = 'block';
        debugUserAgent.textContent = navigator.userAgent.substring(0, 50) + '...';
        debugTimestamp.textContent = new Date().toISOString();
    }
    
    // Inicializa entrada de nome de forma mais robusta
    initializeNameEntry(isMobile);
};

function initializeNameEntry(isMobile) {
    console.log('� Inicializando entrada de nome...');
    
    // Aguarda um pouco para garantir que Bootstrap esteja carregado
    setTimeout(() => {
        // Tenta usar o modal primeiro
        try {
            console.log('🚪 Tentando exibir modal...');
            nameModal.show();
            console.log('✅ Modal exibido com sucesso');
            
            // Se for mobile, configura fallback após um tempo
            if (isMobile) {
                setupMobileFallback();
            }
            
        } catch (error) {
            console.error('❌ Erro ao exibir modal:', error);
            
            // Fallback imediato para entrada alternativa
            console.log('🔧 Usando entrada alternativa devido a erro no modal');
            showAlternativeEntry();
        }
    }, 200);
}

function setupMobileFallback() {
    // Mostra botão alternativo após 5 segundos se for mobile
    setTimeout(() => {
        const modalElement = document.getElementById('nameModal');
        const isModalVisible = modalElement.classList.contains('show') || 
                              modalElement.style.display !== 'none';
        
        if (isModalVisible && !userName && alternativeJoinButton) {
            alternativeJoinButton.classList.remove('d-none');
            console.log('🔧 Botão alternativo disponibilizado');
        }
    }, 5000);
    
    // Verifica se modal travou após 10 segundos
    setTimeout(() => {
        const modalElement = document.getElementById('nameModal');
        const isModalVisible = modalElement.classList.contains('show') || 
                              modalElement.style.display !== 'none';
        
        if (isModalVisible && !userName) {
            console.log('⚠️ Modal pode estar com problema no mobile');
            showNotification('Problemas com o modal? Use a entrada alternativa.', 'info');
            
            if (alternativeJoinButton) {
                alternativeJoinButton.classList.remove('d-none');
            }
        }
    }, 10000);
}

joinButton.onclick = () => {
    console.log('🔘 Botão principal clicado');
    const name = nameInput.value.trim();
    processUserEntry(name, false);
};

// Event listener para entrada alternativa
if (alternativeSubmitButton) {
    alternativeSubmitButton.onclick = () => {
        console.log('� Botão alternativo clicado');
        const name = alternativeNameInput.value.trim();
        processUserEntry(name, true);
    };
}

// Event listener para mostrar entrada alternativa
if (alternativeJoinButton) {
    alternativeJoinButton.onclick = () => {
        showAlternativeEntry();
    };
}

// Allow enter key on name inputs
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        joinButton.click();
    }
});

if (alternativeNameInput) {
    alternativeNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            alternativeSubmitButton.click();
        }
    });
}

// Handle modal events properly for mobile
document.getElementById('nameModal').addEventListener('shown.bs.modal', function () {
    // Focus on input when modal is shown (helps with mobile)
    nameInput.focus();
});

document.getElementById('nameModal').addEventListener('hidden.bs.modal', function () {
    // Ensure modal backdrop is removed (common issue on mobile)
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());
    
    // Remove modal-open class from body (mobile issue)
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
});

function init() {
    console.log('🎵 Iniciando Torbware Records...');
    console.log('User ID:', userId);
    console.log('User Name:', userName);
    console.log('User Agent:', navigator.userAgent);
    
    // Check if running on mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        console.log('📱 Detectado dispositivo móvel');
        // Add mobile-specific class
        document.body.classList.add('mobile-device');
    }
    
    connectWebSocket();
    fetchLibrary();
    setupEventListeners();
    updatePlayerControls(true); // Enable controls for solo mode
    updatePlayerStatus('solo');
    
    // Add some helpful tooltips
    createPartyBtn.title = 'Crie sua própria festa musical';
    leavePartyBtn.title = 'Sair da festa atual';
    
    console.log('✅ Torbware Records inicializado com sucesso!');
    showNotification('Bem-vindo ao Torbware Records!', 'success');
}

// --- Helper Functions ---

function getPartyMode() {
    // Return current party mode from global state
    return currentPartyMode || 'host';
}

// --- Alternative Entry Logic ---

function showAlternativeEntry() {
    console.log('🔧 Mostrando entrada alternativa');
    
    // Força fechamento completo do modal primeiro
    const modalElement = document.getElementById('nameModal');
    modalElement.style.display = 'none';
    modalElement.classList.remove('show');
    
    // Remove todos os backdrops
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());
    
    // Limpa classes do body e adiciona classe para entrada alternativa
    document.body.classList.remove('modal-open');
    document.body.classList.add('alternative-active');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    
    // Mostra entrada alternativa
    alternativeEntry.classList.remove('d-none');
    alternativeEntry.classList.add('show');
    alternativeEntry.style.display = 'flex';
    alternativeEntry.style.setProperty('display', 'flex', 'important');
    
    // Foca no input
    setTimeout(() => {
        alternativeNameInput.focus();
    }, 100);
}

function hideAlternativeEntry() {
    console.log('🔧 Escondendo entrada alternativa');
    document.body.classList.remove('alternative-active');
    alternativeEntry.style.display = 'none';
    alternativeEntry.classList.remove('show');
    alternativeEntry.classList.add('d-none');
}

function processUserEntry(name, isAlternative = false) {
    console.log('👤 Processando entrada de usuário:', name, 'Alternativa:', isAlternative);
    
    if (!name || name.length < 2 || name.length > 20) {
        const message = 'Nome deve ter entre 2 e 20 caracteres';
        showNotification(message, 'warning');
        return false;
    }
    
    // Verifica se já existe um usuário (evita duplicação)
    if (userName && userId) {
        console.log('⚠️ Usuário já existe, ignorando nova entrada');
        return false;
    }
    
    userName = name;
    userId = crypto.randomUUID();
    
    console.log('✅ Usuário criado:', {userId, userName});
    
    // Esconde todas as interfaces de entrada
    hideAlternativeEntry();
    
    const modalElement = document.getElementById('nameModal');
    modalElement.style.display = 'none';
    modalElement.classList.remove('show');
    
    // Remove backdrop
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());
    
    // Limpa body
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    
    // Inicializa aplicação
    setTimeout(() => {
        console.log('🚀 Inicializando aplicação...');
        init();
    }, 100);
    
    return true;
}
