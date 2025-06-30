// --- Torbware Records - Modern UI JavaScript ---

// --- Utility Functions ---

function generateUUID() {
    // Fallback para navegadores que não suportam crypto.randomUUID
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    
    // Fallback manual para compatibilidade
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- Global State ---
let ws;
let userId = null;
let userName = null;
let currentPartyId = null;
let currentPartyMode = 'host';
let isHost = false;
let isSyncing = false;
let hostSyncInterval = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let lastPlayerAction = 0;
let actionDebounceTime = 300;
let democraticDebounceTime = 500;
let lastSyncReceived = 0;
let pendingSeek = null;
let currentVolume = 100;
let isMuted = false;
let shouldAutoPlay = false;  // Controla reprodução automática após carregamento
let currentQueue = [];
let libraryData = [];
let filteredLibrary = [];
let currentTrackId = null;
let currentTrackData = null;

// --- DOM Elements ---
let nameModal = null;
const nameInput = document.getElementById('userNameInput');
const joinButton = document.getElementById('joinButton');
const alternativeJoinButton = document.getElementById('alternativeJoinButton');
const alternativeEntry = document.getElementById('alternativeEntry');
const alternativeNameInput = document.getElementById('alternativeNameInput');
const alternativeSubmitButton = document.getElementById('alternativeSubmitButton');

// Player Elements
const player = document.getElementById('player');
const playerControls = document.getElementById('playerControls');
const playPauseBtn = document.getElementById('playPauseBtn');
const playPauseIcon = document.getElementById('playPauseIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const currentTimeDisplay = document.getElementById('currentTime');
const totalTimeDisplay = document.getElementById('totalTime');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressHandle = document.getElementById('progressHandle');
const playerTrackTitle = document.getElementById('playerTrackTitle');
const playerStatus = document.getElementById('playerStatus');
const volumeBtn = document.getElementById('volumeBtn');
const volumeIcon = document.getElementById('volumeIcon');
const volumeRange = document.getElementById('volumeRange');

// UI Elements
const connectionStatus = document.getElementById('connectionStatus');
const libraryList = document.getElementById('libraryList');
const librarySearch = document.getElementById('librarySearch');
const userList = document.getElementById('userList');
const userCount = document.getElementById('userCount');
const partyList = document.getElementById('partyList');
const createPartyBtn = document.getElementById('createPartyBtn');
const leavePartyBtn = document.getElementById('leavePartyBtn');

// Views
const partiesView = document.getElementById('partiesView');
const partyView = document.getElementById('partyView');

// Party Elements
const partyHostName = document.getElementById('partyHostName');
const partyModeStatus = document.getElementById('partyModeStatus');
const partyMemberCount = document.getElementById('partyMemberCount');
const currentTrackTitle = document.getElementById('currentTrackTitle');
const currentTrackArtist = document.getElementById('currentTrackArtist');
const partyMemberList = document.getElementById('partyMemberList');
const queueList = document.getElementById('queueList');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const democraticModeToggle = document.getElementById('democraticModeToggle');
const partyIdDisplay = document.getElementById('partyIdDisplay');
const partyCreatedTime = document.getElementById('partyCreatedTime');

// Upload Elements
const uploadForm = document.getElementById('uploadForm');
const audioFile = document.getElementById('audioFile');
const uploadStatus = document.getElementById('uploadStatus');

// Debug Elements
const debugInfo = document.getElementById('debugInfo');
const debugUserAgent = document.getElementById('debugUserAgent');
const debugTimestamp = document.getElementById('debugTimestamp');

// --- WebSocket Communication ---

function getBaseURL() {
    // Usa a variável definida no HTML ou constrói a URL
    if (window.API_BASE_URL) {
        return window.API_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
    }
    
    // Fallback para construir a URL manualmente
    const protocol = window.location.protocol;
    const host = window.location.host;
    return `${protocol}//${host}`;
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/${userId}`;
    
    console.log('🔌 Conectando WebSocket:', wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        reconnectAttempts = 0;
        updateConnectionStatus(true);
        sendMessage('user_join', { name: userName });
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };

    ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
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
        console.error('🔌 WebSocket error:', error);
        updateConnectionStatus(false);
    };
}

function handleWebSocketMessage(message) {
    console.log('📨 WebSocket message:', message.type, message.payload);
    
    switch (message.type) {
        case 'state_update':
            handleStateUpdate(message.payload);
            break;
        case 'party_sync':
            handlePartySync(message.payload);
            break;
        case 'party_left':
            console.log('🚪 Party left confirmation');
            currentPartyId = null;
            currentPartyMode = 'host';
            isHost = false;
            
            // Clear sync interval
            if (hostSyncInterval) {
                clearInterval(hostSyncInterval);
                hostSyncInterval = null;
            }
            
            // Update UI immediately
            if (partiesView) partiesView.style.display = 'block';
            if (partyView) partyView.style.display = 'none';
            
            // Reset player controls
            updatePlayerControls(true);
            updatePlayerStatus('solo');
            
            // Refresh parties list
            sendMessage('get_parties', {});
            
            showNotification('Você saiu da festa com sucesso', 'success');
            break;
        case 'party_joined':
            console.log('🎉 Party joined confirmation');
            showNotification('Você entrou na festa!', 'success');
            break;
        case 'party_created':
            console.log('🎊 Party created confirmation');
            showNotification('Festa criada com sucesso!', 'success');
            break;
        case 'chat_message':
            handleChatMessage(message.payload);
            break;
        case 'queue_update':
            console.log('🎵 Queue update received:', message.payload);
            if (message.payload && message.payload.queue) {
                renderQueue(message.payload.queue);
            }
            break;
        case 'action_rejected':
            console.log('🚫 Ação rejeitada:', message.payload);
            showNotification('Ação muito rápida, aguarde um momento', 'warning');
            break;
        case 'error':
            console.error('❌ WebSocket error:', message.payload);
            showNotification(`Erro: ${message.payload.message || 'Erro desconhecido'}`, 'error');
            
            // Handle specific error cases
            if (message.payload.code === 'PARTY_NOT_FOUND') {
                forceLeaveParty();
            }
            break;
        default:
            console.log('❓ Unknown message type:', message.type);
    }
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    } else {
        showNotification('Sem conexão. Tentando reconectar...', 'warning');
    }
}

// --- State Handlers ---

function handleStateUpdate(payload) {
    renderUserList(payload.users);
    renderPartyList(payload.parties);
}

function handlePartySync(party) {
    console.log('🔄 Party sync recebido:', party);
    
    // Validação de estado: verificar se ainda estamos na mesma festa
    if (currentPartyId && party.party_id !== currentPartyId) {
        console.warn('⚠️ Recebido sync de festa diferente! Forçando saída...');
        forceLeaveParty();
        return;
    }
    
    // Validação: verificar se ainda somos membros da festa
    if (currentPartyId && party.party_id === currentPartyId) {
        const isMember = party.members && party.members.some(member => member.id === userId);
        if (!isMember) {
            console.warn('⚠️ Não somos mais membros desta festa! Forçando saída...');
            forceLeaveParty();
            return;
        }
    }
    
    lastSyncReceived = Date.now();
    
    // SEMPRE renderizar a party primeiro (para UI)
    renderCurrentParty(party);

    if (party.mode === 'host') {
        if (party.host_id === userId) {
            console.log('👑 HOST MODE: Você é o host - IGNORANDO TOTALMENTE sync de controles');
            
            // Host NUNCA aplica sync de controles do servidor
            // Apenas verifica se precisa mudar música (e somente se não foi ele que mudou)
            const currentTrackId = getCurrentTrackId();
            if (party.track_id && party.track_id !== currentTrackId) {
                const timeSinceAction = Date.now() - lastPlayerAction;
                
                // Se o host fez uma ação recente, ignore mudanças de música vindas do servidor
                if (timeSinceAction < 2000) {
                    console.log('👑 Host: Ignorando mudança de música - ação recente própria');
                } else {
                    console.log('🎵 Host: Mudança de música externa:', party.track_id);
                    loadTrack(party.track_id);
                }
            }
            
            // Host faz broadcast do seu estado (com limite de frequência)
            if (!hostSyncInterval) {
                console.log('👑 Host: Iniciando broadcast limitado do estado');
                hostSyncInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN && player && currentPartyId) {
                        const timeSinceLastSync = Date.now() - lastSyncReceived;
                        
                        // Só envia se não recebeu sync muito recentemente (evita loops)
                        if (timeSinceLastSync > 2000) {
                            sendMessage('sync_update', {
                                currentTime: player.currentTime,
                                is_playing: !player.paused,
                                track_id: getCurrentTrackId()
                            });
                        }
                    }
                }, 1500); // Reduzido para 1.5s para menos spam
            }
            
            // HOST PARA AQUI - NUNCA APLICA SYNC
            return;
            
        } else {
            console.log('👥 HOST MODE: Você é membro - aplicando sync do host');
            
            // Membros SEMPRE aplicam sync do host
            applySyncUpdate(party, false);
            
            // Membros não fazem broadcast
            if (hostSyncInterval) {
                clearInterval(hostSyncInterval);
                hostSyncInterval = null;
            }
        }
    } else if (party.mode === 'democratic') {
        console.log('🗳️ DEMOCRATIC MODE: Aplicando sync democrático');
        
        // Em modo democrático, todos sincronizam, mas com proteção para ações recentes
        const timeSinceAction = Date.now() - lastPlayerAction;
        const hasRecentAction = timeSinceAction < 2000;
        
        if (hasRecentAction) {
            console.log('🗳️ Ignorando sync - ação recente do usuário');
            
            // Apenas muda música se diferente
            if (party.track_id && party.track_id !== getCurrentTrackId()) {
                console.log('🎵 Democrático: Mudando música apenas');
                loadTrack(party.track_id);
            }
        } else {
            console.log('🗳️ Aplicando sincronização democrática');
            applySyncUpdate(party, true);
        }
        
        // Em modo democrático não há broadcast específico
        if (hostSyncInterval) {
            clearInterval(hostSyncInterval);
            hostSyncInterval = null;
        }
    }
}

function applySyncUpdate(party, gentle = false) {
    isSyncing = true;
    
    console.log(`🔄 Aplicando sync ${gentle ? '(gentle)' : '(forceful)'}:`, {
        track_id: party.track_id,
        currentTime: party.currentTime,
        is_playing: party.is_playing,
        currentPlayerTime: player.currentTime,
        currentPlayerPaused: player.paused
    });

    try {
        // Change track if needed
        if (party.track_id && party.track_id !== getCurrentTrackId()) {
            console.log('🎵 Sync: Mudando música:', party.track_id);
            loadTrack(party.track_id);
        }

        // Calculate time difference and tolerance
        const timeTolerance = gentle ? 4.0 : 1.5;
        const timeDifference = Math.abs(player.currentTime - party.currentTime);
        
        // Protection against recent actions - be more conservative
        const timeSinceAction = Date.now() - lastPlayerAction;
        const hasVeryRecentAction = timeSinceAction < 2000; // 2 second protection padronizado
        const effectiveTolerance = hasVeryRecentAction ? timeTolerance * 3 : timeTolerance;
        
        console.log(`⏰ Time analysis: diff=${timeDifference.toFixed(2)}s, tolerance=${effectiveTolerance.toFixed(1)}s, timeSinceAction=${timeSinceAction}ms`);
        
        // Only sync time if significant difference and no recent action
        if (party.track_id && timeDifference > effectiveTolerance) {
            if (hasVeryRecentAction && timeDifference < 8.0) {
                console.log(`⏰ SKIP: Ação muito recente (${timeSinceAction}ms) e diferença pequena (${timeDifference.toFixed(2)}s)`);
            } else {
                console.log(`⏰ Ajustando tempo: ${player.currentTime.toFixed(2)}s -> ${party.currentTime.toFixed(2)}s`);
                player.currentTime = party.currentTime;
            }
        } else {
            console.log(`⏰ Tempo OK: diferença ${timeDifference.toFixed(2)}s dentro da tolerância`);
        }

        // Sync play/pause state - be more careful with recent actions
        const playStateDifferent = (party.is_playing && player.paused) || (!party.is_playing && !player.paused);
        
        if (playStateDifferent) {
            if (hasVeryRecentAction) {
                console.log(`▶️⏸️ SKIP: Estado de reprodução - ação muito recente (${timeSinceAction}ms)`);
            } else {
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
            }
        } else {
            console.log('▶️⏸️ Estado de reprodução já sincronizado');
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

function handleChatMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    messageElement.innerHTML = `
        <div class="chat-message-author">${message.author}</div>
        <div class="chat-message-text">${message.text}</div>
        <div class="chat-message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
    `;
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- UI Helper Functions ---

function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Conectado';
        connectionStatus.className = 'connection-indicator connected';
    } else {
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Desconectado';
        connectionStatus.className = 'connection-indicator disconnected';
    }
}

function showNotification(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();
    const toast = document.createElement('div');
    const bgClass = type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'primary';
    
    toast.className = `toast align-items-center text-bg-${bgClass} border-0`;
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
    container.style.zIndex = '9999';
    document.body.appendChild(container);
    return container;
}

// --- Rendering Functions ---

function renderUserList(users) {
    if (!userList) return;
    
    userList.innerHTML = '';
    
    if (users.length === 0) {
        userList.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-users"></i>
                <span>Nenhum usuário conectado</span>
            </div>
        `;
        if (userCount) userCount.textContent = '0';
        return;
    }
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = `user-item ${user.id === userId ? 'current-user' : ''}`;
        userItem.innerHTML = `
            <div class="user-avatar">${user.name.charAt(0).toUpperCase()}</div>
            <div class="user-name">${user.name}</div>
            <div class="user-status"></div>
            ${user.id === userId ? '<small class="text-primary">(Você)</small>' : ''}
        `;
        userList.appendChild(userItem);
    });
    
    if (userCount) userCount.textContent = users.length.toString();
}

function renderPartyList(parties) {
    if (!partyList) return;
    
    partyList.innerHTML = '';
    
    if (parties.length === 0) {
        partyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-party-horn"></i>
                <p>Nenhuma festa ativa</p>
                <small>Seja o primeiro a criar uma festa!</small>
            </div>
        `;
        return;
    }
    
    parties.forEach(party => {
        const partyCard = document.createElement('div');
        partyCard.className = 'party-card';
        partyCard.innerHTML = `
            <div class="party-card-header">
                <div class="party-host">
                    <i class="fas fa-crown"></i> ${party.host_name}
                </div>
                <span class="party-mode-badge ${party.mode}">
                    ${party.mode === 'democratic' ? '<i class="fas fa-vote-yea"></i> Democrático' : '<i class="fas fa-crown"></i> Host'}
                </span>
            </div>
            <div class="party-info">
                <div class="party-stats">
                    <div class="party-stat">
                        <i class="fas fa-users"></i>
                        <span>${party.member_count} membro(s)</span>
                    </div>
                    <div class="party-stat">
                        <i class="fas fa-music"></i>
                        <span>${party.current_track_title || 'Nenhuma música'}</span>
                    </div>
                </div>
            </div>
            <div class="party-actions">
                <button class="btn btn-primary join-party-btn" 
                        onclick="joinParty('${party.party_id}')" 
                        ${currentPartyId ? 'disabled' : ''}>
                    ${currentPartyId === party.party_id ? '<i class="fas fa-check"></i> Na festa' : '<i class="fas fa-sign-in-alt"></i> Entrar'}
                </button>
            </div>
        `;
        partyList.appendChild(partyCard);
    });
}

function renderCurrentParty(party) {
    if (!party || !party.party_id) {
        // Not in party
        if (partiesView) partiesView.style.display = 'block';
        if (partyView) partyView.style.display = 'none';
        
        currentPartyId = null;
        currentPartyMode = 'host';
        isHost = false;
        updatePlayerControls(true);
        updatePlayerStatus('solo');
        
        if (hostSyncInterval) {
            clearInterval(hostSyncInterval);
            hostSyncInterval = null;
        }
        return;
    }

    // In party
    if (partiesView) partiesView.style.display = 'none';
    if (partyView) partyView.style.display = 'block';
    
    currentPartyId = party.party_id;
    currentPartyMode = party.mode;
    isHost = party.host_id === userId;

    // Update party header
    const hostMember = party.members.find(m => m.id === party.host_id);
    if (partyHostName) partyHostName.textContent = hostMember?.name || 'Desconhecido';
    if (partyModeStatus) {
        partyModeStatus.className = `mode-badge ${party.mode}`;
        partyModeStatus.innerHTML = party.mode === 'democratic' ? 
            '<i class="fas fa-vote-yea"></i> Democrático' : 
            '<i class="fas fa-crown"></i> Host';
    }
    if (partyMemberCount) partyMemberCount.textContent = `${party.members.length} membros`;

    // Update now playing
    updateNowPlaying(party);

    // Update members list
    renderPartyMembers(party.members, party.host_id);

    // Update controls
    const hostControlsTab = document.getElementById('hostControlsTab');
    if (hostControlsTab) {
        hostControlsTab.style.display = isHost ? 'block' : 'none';
    }
    
    if (democraticModeToggle && isHost) {
        democraticModeToggle.checked = party.mode === 'democratic';
    }

    // Update party details
    if (partyIdDisplay) partyIdDisplay.textContent = party.party_id.substr(0, 8) + '...';
    if (partyCreatedTime) partyCreatedTime.textContent = new Date().toLocaleString();

    const canControl = isHost || party.mode === 'democratic';
    console.log('🎮 renderCurrentParty - Determinando controle:', {
        isHost,
        partyMode: party.mode,
        canControl,
        userId,
        hostId: party.host_id
    });
    
    updatePlayerControls(canControl);
    updatePlayerStatus(isHost ? 'host' : (party.mode === 'democratic' ? 'democratic' : 'member'));
}

function updateNowPlaying(party) {
    console.log('🎵 Updating now playing:', party);
    
    let trackTitle = 'Nenhuma música tocando';
    let trackArtist = 'Selecione uma música da biblioteca';
    
    if (party.track_id) {
        // First try to get title from party data
        if (party.current_track_title) {
            trackTitle = party.current_track_title;
            trackArtist = `ID: ${party.track_id}`;
        } else {
            // Try to find track in local library
            const track = libraryData.find(t => t.id === party.track_id);
            if (track) {
                trackTitle = track.title;
                trackArtist = track.filename ? `Arquivo: ${track.filename}` : `ID: ${party.track_id}`;
            } else {
                trackTitle = `Música ID: ${party.track_id}`;
                trackArtist = 'Carregando informações...';
                
                // Try to fetch track info from server
                fetchTrackInfo(party.track_id);
            }
        }
    }
    
    console.log('🎵 Setting track info:', { trackTitle, trackArtist });
    
    if (currentTrackTitle) currentTrackTitle.textContent = trackTitle;
    if (currentTrackArtist) currentTrackArtist.textContent = trackArtist;
}

async function fetchTrackInfo(trackId) {
    try {
        const baseUrl = getBaseURL();
        const response = await fetch(`${baseUrl}/track/${trackId}`);
        if (response.ok) {
            const trackData = await response.json();
            
            // Update library data
            const existingIndex = libraryData.findIndex(t => t.id === trackId);
            if (existingIndex >= 0) {
                libraryData[existingIndex] = trackData;
            } else {
                libraryData.push(trackData);
            }
            
            // Update display if this is still the current track and we're still in the same party
            if (currentPartyId && currentTrackTitle && currentTrackArtist) {
                // Validar se ainda é a música atual antes de aplicar informações
                const currentDisplayedTrackId = getCurrentTrackId();
                if (currentDisplayedTrackId === trackId && currentTrackTitle.textContent.includes(`ID: ${trackId}`)) {
                    console.log('✅ Atualizando informações da música atual:', trackData.title);
                    currentTrackTitle.textContent = trackData.title;
                    currentTrackArtist.textContent = trackData.filename ? `Arquivo: ${trackData.filename}` : `ID: ${trackId}`;
                } else {
                    console.log('⚠️ Música mudou durante fetch, não aplicando informações antigas');
                }
            }
        }
    } catch (error) {
        console.error('Error fetching track info:', error);
    }
}

function renderPartyMembers(members, hostId) {
    if (!partyMemberList) return;
    
    partyMemberList.innerHTML = '';
    
    members.forEach(member => {
        const memberItem = document.createElement('div');
        memberItem.className = 'member-item';
        memberItem.innerHTML = `
            <div class="member-avatar">${member.name.charAt(0).toUpperCase()}</div>
            <div class="member-info">
                <div class="member-name">${member.name}</div>
                <div class="member-status">
                    ${member.id === hostId ? '<span class="member-badge host"><i class="fas fa-crown"></i> Host</span>' : ''}
                    ${member.id === userId ? '<span class="member-badge you"><i class="fas fa-user"></i> Você</span>' : ''}
                </div>
            </div>
        `;
        partyMemberList.appendChild(memberItem);
    });
}

function updatePlayerControls(enabled) {
    const canControl = enabled || !currentPartyId;
    
    console.log('🎮 Atualizando controles do player:', { 
        enabled, 
        currentPartyId, 
        canControl,
        isHost,
        currentPartyMode 
    });
    
    if (canControl) {
        playerControls.classList.remove('disabled');
        
        if (playPauseBtn) {
            playPauseBtn.disabled = false;
            console.log('✅ Play/Pause button habilitado');
        }
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (progressBar) {
            progressBar.style.pointerEvents = 'auto';
            progressBar.style.cursor = 'pointer';
            console.log('✅ Progress bar habilitada para interação');
        }
        // Volume sempre habilitado (controle local)
        if (volumeRange) {
            volumeRange.disabled = false;
            console.log('✅ Volume sempre habilitado (controle local)');
        }
        
        console.log('✅ Controles habilitados para o usuário');
    } else {
        playerControls.classList.add('disabled');
        
        if (playPauseBtn) {
            playPauseBtn.disabled = true;
            console.log('🚫 Play/Pause button desabilitado');
        }
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (progressBar) {
            progressBar.style.pointerEvents = 'none';
            progressBar.style.cursor = 'not-allowed';
            console.log('🚫 Progress bar desabilitada para interação');
        }
        // Volume sempre habilitado (controle local)
        if (volumeRange) {
            volumeRange.disabled = false;
            console.log('✅ Volume mantido habilitado (controle local)');
        }
        
        console.log('🚫 Controles desabilitados para o usuário');
    }
}

function updatePlayerStatus(mode) {
    if (!playerStatus) return;
    
    switch(mode) {
        case 'solo':
            playerStatus.innerHTML = '<i class="fas fa-headphones"></i> Modo Solo';
            break;
        case 'host':
            playerStatus.innerHTML = '<i class="fas fa-crown"></i> Você controla';
            break;
        case 'democratic':
            playerStatus.innerHTML = '<i class="fas fa-vote-yea"></i> Controle compartilhado';
            
            const timeSinceAction = Date.now() - lastPlayerAction;
            if (timeSinceAction < actionDebounceTime * 2) {
                playerStatus.innerHTML += ' <i class="fas fa-clock"></i>';
                playerStatus.title = 'Aguardando sincronização...';
            } else {
                playerStatus.title = 'Você pode controlar o player';
            }
            break;
        case 'member':
            playerStatus.innerHTML = '<i class="fas fa-music"></i> Ouvindo festa';
            break;
    }
}

// --- Track Management Functions ---

function getCurrentTrackId() {
    return currentTrackId;
}

function getCurrentTrackData() {
    return currentTrackData;
}

async function loadTrack(trackId) {
    if (!trackId) {
        console.log('❌ Track ID is null/undefined');
        return;
    }
    
    console.log('🎵 Loading track:', trackId);
    
    try {
        // Find track in library data
        const track = libraryData.find(t => t.id === trackId);
        if (!track) {
            console.error('❌ Track not found in library:', trackId);
            showNotification('Música não encontrada na biblioteca', 'error');
            return;
        }
        
        // Desabilitar a barra de progresso imediatamente para evitar race condition
        if (progressBar) {
            progressBar.parentElement.classList.add('loading');
            console.log('🚫 Progress bar desabilitada durante carregamento');
        }
        
        currentTrackId = trackId;
        currentTrackData = track;
        
        // Update player source
        const baseUrl = getBaseURL();
        const streamUrl = `${baseUrl}/stream/${trackId}`;
        console.log('🎵 Setting player source:', streamUrl);
        
        player.src = streamUrl;
        
        // Update UI elements
        updateTrackDisplay(track);
        
        // Update now playing in party view if in party
        if (currentPartyId && currentTrackTitle && currentTrackArtist) {
            currentTrackTitle.textContent = track.title;
            currentTrackArtist.textContent = `Arquivo: ${track.filename || 'Unknown'}`;
        }
        
        console.log('✅ Track loaded successfully:', track.title);
        
    } catch (error) {
        console.error('❌ Error loading track:', error);
        showNotification('Erro ao carregar música', 'error');
        
        // Sempre re-habilitar a barra de progresso em caso de erro
        if (progressBar) {
            progressBar.parentElement.classList.remove('loading');
            console.log('🔄 Progress bar re-habilitada após erro');
        }
    }
}

function updateTrackDisplay(track) {
    // Update player bar
    if (playerTrackTitle) {
        playerTrackTitle.textContent = track.title;
    }
    
    // Update status based on party mode
    updatePlayerStatus(currentPartyId ? 
        (isHost ? 'host' : (currentPartyMode === 'democratic' ? 'democratic' : 'member')) : 
        'solo'
    );
}

// --- Player Functions ---

function playTrack(trackId) {
    console.log('🎵 Play track requested:', trackId);
    console.log('🎵 Current state:', { currentPartyId, isHost, currentPartyMode });
    
    if (!currentPartyId) {
        // MODO SOLO - Apenas carrega a música. O autoplay via canplay cuidará da reprodução.
        console.log('🎧 SOLO: Apenas carregando música. O autoplay cuidará do resto.');
        shouldAutoPlay = true;  // Sinaliza que deve reproduzir quando o áudio carregar
        loadTrack(trackId);
        // Removido: player.play() - agora delegamos para o evento canplay
        return;
    }
    
    if (currentPartyMode === 'host') {
        if (isHost) {
            // HOST EM MODO HOST - Controle total, mas notifica mudança de música
            console.log('👑 HOST: Mudando música com controle total');
            lastPlayerAction = Date.now();
            loadTrack(trackId);
            
            // Host agora envia mudança de música para sincronizar membros
            sendMessage('player_action', { 
                action: 'change_track', 
                track_id: trackId 
            });
            
            showNotification('Alterando música da festa (host)', 'info');
        } else {
            // MEMBRO EM MODO HOST - Não pode controlar
            console.log('🚫 MEMBRO: Não pode trocar música em modo host');
            showNotification('Apenas o host pode trocar a música', 'warning');
        }
    } else if (currentPartyMode === 'democratic') {
        // MODO DEMOCRÁTICO - Todos podem controlar e sincronizam
        console.log('🗳️ DEMOCRÁTICO: Enviando mudança de música para sincronização');
        lastPlayerAction = Date.now();
        
        sendMessage('player_action', { 
            action: 'change_track', 
            track_id: trackId 
        });
        
        showNotification('Alterando música da festa (democrático)', 'info');
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function seekToTime(time) {
    if (!player || !player.duration || isNaN(player.duration)) {
        console.log('🚫 Seek bloqueado: player ou duração indisponível.');
        return;
    }

    const clampedTime = Math.max(0, Math.min(player.duration, time));
    
    // 1. Determina se o usuário PODE controlar o player
    const canControl = !currentPartyId || isHost || currentPartyMode === 'democratic';

    if (!canControl) {
        console.log('🚫 MEMBRO: Não pode dar seek em modo host');
        showNotification('Apenas o host (ou todos em modo democrático) pode controlar o player', 'warning');
        return; // Ação bloqueada
    }
    
    // 2. Se o controle é permitido, aplica a ação localmente para feedback IMEDIATO.
    console.log(`� Aplicando seek local para ${formatTime(clampedTime)}`);
    player.currentTime = clampedTime;
    lastPlayerAction = Date.now(); // Marca a ação para evitar conflitos de sync

    // 3. Lida com a comunicação de rede APÓS a ação local.
    if (!currentPartyId) {
        // MODO SOLO: Ação já foi feita, nada mais a fazer.
        showNotification(`Posição alterada`, 'success');
    } else if (isHost) {
        // MODO HOST: Ação já foi feita. O broadcast automático do host fará a sincronização.
        showNotification(`Posição alterada (host)`, 'success');
    } else if (currentPartyMode === 'democratic') {
        // MODO DEMOCRÁTICO: Ação local já foi feita, agora notifica o servidor.
        console.log('🗳️ DEMOCRÁTICO: Enviando seek para sincronização');
        sendMessage('player_action', { 
            action: 'seek', 
            currentTime: clampedTime 
        });
        showNotification(`Posição alterada (democrático)`, 'info');
    }
}

function updateProgressVisual(percentage) {
    if (!progressFill || !progressHandle) return;
    
    const clampedPercentage = Math.max(0, Math.min(100, percentage * 100));
    progressFill.style.width = `${clampedPercentage}%`;
    progressHandle.style.left = `${clampedPercentage}%`;
}

function updateProgress() {
    if (!player || !progressFill || !progressHandle || !currentTimeDisplay) return;
    
    const current = player.currentTime;
    const duration = player.duration;
    
    if (isNaN(duration) || duration === 0) return;
    
    const percentage = (current / duration) * 100;
    progressFill.style.width = `${percentage}%`;
    progressHandle.style.left = `${percentage}%`;
    
    currentTimeDisplay.textContent = formatTime(current);
    
    if (totalTimeDisplay) {
        totalTimeDisplay.textContent = formatTime(duration);
    }
}

// --- Library Functions ---

async function fetchLibrary() {
    try {
        const baseUrl = getBaseURL();
        console.log('🌍 Fetching library from:', `${baseUrl}/library`);
        
        const res = await fetch(`${baseUrl}/library`);
        if (!res.ok) throw new Error('Falha ao carregar biblioteca');
        
        libraryData = await res.json();
        filteredLibrary = [...libraryData];
        renderLibrary();
        
        console.log('✅ Biblioteca carregada:', libraryData.length, 'músicas');
        
    } catch (error) {
        console.error('Error fetching library:', error);
        showNotification('Erro ao carregar biblioteca', 'error');
        if (libraryList) {
            libraryList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Erro ao carregar biblioteca</p>
                    <small>Verifique sua conexão</small>
                </div>
            `;
        }
    }
}

function renderLibrary() {
    if (!libraryList) return;
    
    libraryList.innerHTML = '';
    
    if (filteredLibrary.length === 0) {
        libraryList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-music"></i>
                <p>Biblioteca vazia</p>
                <small>Faça upload de suas músicas favoritas!</small>
            </div>
        `;
        return;
    }
    
    filteredLibrary.forEach(track => {
        const libraryItem = document.createElement('div');
        libraryItem.className = 'library-item';
        libraryItem.innerHTML = `
            <div class="library-item-icon">
                <i class="fas fa-music"></i>
            </div>
            <div class="library-item-info">
                <div class="library-item-title">${track.title}</div>
                <div class="library-item-meta">ID: ${track.id}</div>
            </div>
            <div class="library-item-actions">
                <button class="btn btn-primary library-action-btn" onclick="playTrack(${track.id})">
                    <i class="fas fa-play"></i>
                </button>
                <button class="btn btn-outline-secondary library-action-btn" onclick="addToQueue(${track.id})" title="Adicionar à fila">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
        `;
        libraryList.appendChild(libraryItem);
    });
}

function filterLibrary(searchTerm) {
    if (!searchTerm.trim()) {
        filteredLibrary = [...libraryData];
    } else {
        filteredLibrary = libraryData.filter(track => 
            track.title.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }
    renderLibrary();
}

function addToQueue(trackId) {
    if (!currentPartyId) {
        showNotification('Você precisa estar em uma festa para usar a fila', 'warning');
        return;
    }
    
    const canControl = isHost || currentPartyMode === 'democratic';
    if (!canControl) {
        showNotification('Você não pode adicionar músicas à fila neste modo', 'warning');
        return;
    }
    
    const track = libraryData.find(t => t.id === trackId);
    if (!track) {
        showNotification('Música não encontrada', 'error');
        return;
    }
    
    // Send add to queue message to server
    sendMessage('queue_action', { 
        action: 'add', 
        track_id: trackId,
        party_id: currentPartyId 
    });
    
    showNotification(`"${track.title}" adicionada à fila`, 'success');
}

function renderQueue(queue) {
    if (!queueList) return;
    
    queueList.innerHTML = '';
    
    if (!queue || queue.length === 0) {
        queueList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list-ul"></i>
                <p>A fila está vazia</p>
                <small>Adicione músicas da biblioteca</small>
            </div>
        `;
        return;
    }
    
    queue.forEach((queueItem, index) => {
        const track = libraryData.find(t => t.id === queueItem.track_id) || 
                     { id: queueItem.track_id, title: queueItem.title || `Track ${queueItem.track_id}` };
        
        const queueItemElement = document.createElement('div');
        queueItemElement.className = 'queue-item';
        queueItemElement.innerHTML = `
            <div class="queue-item-position">${index + 1}</div>
            <div class="queue-item-info">
                <div class="queue-item-title">${track.title}</div>
                <div class="queue-item-added-by">Adicionado por: ${queueItem.added_by || 'Desconhecido'}</div>
            </div>
            <div class="queue-item-actions">
                <button class="btn btn-sm btn-outline-danger remove-queue-btn" 
                        onclick="removeFromQueue(${index})" 
                        title="Remover da fila">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        queueList.appendChild(queueItemElement);
    });
}

function removeFromQueue(position) {
    if (!currentPartyId) return;
    
    const canControl = isHost || currentPartyMode === 'democratic';
    if (!canControl) {
        showNotification('Você não pode remover músicas da fila neste modo', 'warning');
        return;
    }
    
    sendMessage('queue_action', { 
        action: 'remove', 
        position: position,
        party_id: currentPartyId 
    });
}

function clearQueue() {
    if (!currentPartyId) return;
    
    const canControl = isHost || currentPartyMode === 'democratic';
    if (!canControl) {
        showNotification('Você não pode limpar a fila neste modo', 'warning');
        return;
    }
    
    if (confirm('Tem certeza que deseja limpar toda a fila?')) {
        sendMessage('queue_action', { 
            action: 'clear',
            party_id: currentPartyId 
        });
    }
}

// --- Initialization ---

window.addEventListener('load', () => {
    console.log('🌐 Window loaded');
    console.log('📱 User Agent:', navigator.userAgent);
    console.log('🌍 Base URL:', getBaseURL());
    console.log('🌐 Current Location:', window.location.href);
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log('📱 Is Mobile:', isMobile);
    
    // Adicionar classe para dispositivos móveis
    if (isMobile) {
        document.body.classList.add('mobile-device');
        console.log('📱 Classe mobile-device adicionada');
    }
    
    // Mostrar informações de debug em mobile
    if (isMobile && debugInfo) {
        debugInfo.style.display = 'block';
        if (debugUserAgent) debugUserAgent.textContent = navigator.userAgent.substring(0, 50) + '...';
        if (debugTimestamp) debugTimestamp.textContent = new Date().toISOString();
        console.log('📱 Debug info exibido');
    }
    
    // Verificar conectividade básica
    testConnectivity().then(isConnected => {
        console.log('🌐 Conectividade:', isConnected ? 'OK' : 'Problemas detectados');
        
        // Inicializar modal com verificação de erro
        setTimeout(() => {
            initializeModal(isMobile);
        }, 300);
        
        // Configurar event listeners após um pequeno delay
        setTimeout(() => {
            setupEventListeners();
        }, 600);
    });
});

async function testConnectivity() {
    try {
        const baseUrl = getBaseURL();
        console.log('🌐 Testando conectividade com:', baseUrl);
        
        // Criar controller para timeout manual (compatibilidade)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        // Usar GET ao invés de HEAD para evitar erro 405
        const response = await fetch(`${baseUrl}/library`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('🌐 Resposta do servidor:', response.status);
        return response.ok;
    } catch (error) {
        console.warn('⚠️ Erro na conectividade:', error);
        return false;
    }
}

function initializeModal(isMobile) {
    console.log('🚪 Inicializando modal...');
    console.log('📱 Dispositivo móvel:', isMobile);
    console.log('🌍 Bootstrap disponível:', typeof bootstrap !== 'undefined');
    
    // Força entrada alternativa em dispositivos móveis problemáticos
    const forceFallback = isMobile && (
        navigator.userAgent.includes('iPhone') ||
        navigator.userAgent.includes('iPad') ||
        navigator.userAgent.includes('Android')
    );
    
    if (forceFallback) {
        console.log('📱 Forçando entrada alternativa para dispositivo móvel');
        setTimeout(() => showAlternativeEntry(), 500);
        return;
    }
    
    try {
        const modalElement = document.getElementById('nameModal');
        if (modalElement && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            nameModal = new bootstrap.Modal(modalElement, {
                backdrop: 'static',
                keyboard: false
            });
            console.log('✅ Bootstrap Modal inicializado');
            
            // Tentar mostrar o modal após um delay
            setTimeout(() => {
                initializeNameEntry(isMobile);
            }, 200);
        } else {
            console.warn('⚠️ Bootstrap Modal não disponível, usando entrada alternativa');
            showAlternativeEntry();
        }
    } catch (error) {
        console.error('❌ Erro ao inicializar modal:', error);
        showAlternativeEntry();
    }
}

function initializeNameEntry(isMobile) {
    console.log('🚪 Inicializando entrada de nome...');
    
    if (!nameModal) {
        console.warn('⚠️ Modal não disponível, usando entrada alternativa');
        showAlternativeEntry();
        return;
    }
    
    try {
        console.log('🚪 Tentando exibir modal...');
        nameModal.show();
        console.log('✅ Modal exibido com sucesso');
        
        if (isMobile) {
            setupMobileFallback();
        }
        
    } catch (error) {
        console.error('❌ Erro ao exibir modal:', error);
        showAlternativeEntry();
    }
}

function setupMobileFallback() {
    setTimeout(() => {
        const modalElement = document.getElementById('nameModal');
        const isModalVisible = modalElement.classList.contains('show');
        
        if (isModalVisible && !userName && alternativeJoinButton) {
            alternativeJoinButton.classList.remove('d-none');
        }
    }, 5000);
    
    setTimeout(() => {
        const modalElement = document.getElementById('nameModal');
        const isModalVisible = modalElement.classList.contains('show');
        
        if (isModalVisible && !userName) {
            showNotification('Problemas com o modal? Use a entrada alternativa.', 'info');
            if (alternativeJoinButton) {
                alternativeJoinButton.classList.remove('d-none');
            }
        }
    }, 10000);
}

// Name Entry Event Listeners - Configurar imediatamente
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM Content Loaded - Configurando event listeners de entrada');
    
    const nameInput = document.getElementById('userNameInput');
    const joinButton = document.getElementById('joinButton');
    const alternativeSubmitButton = document.getElementById('alternativeSubmitButton');
    const alternativeJoinButton = document.getElementById('alternativeJoinButton');
    const alternativeNameInput = document.getElementById('alternativeNameInput');
    
    if (joinButton) {
        joinButton.addEventListener('click', () => {
            const name = nameInput?.value.trim() || '';
            processUserEntry(name, false);
        });
        console.log('✅ Event listener adicionado ao joinButton');
    }

    if (alternativeSubmitButton) {
        alternativeSubmitButton.addEventListener('click', () => {
            const name = alternativeNameInput?.value.trim() || '';
            processUserEntry(name, true);
        });
        console.log('✅ Event listener adicionado ao alternativeSubmitButton');
    }

    if (alternativeJoinButton) {
        alternativeJoinButton.addEventListener('click', () => {
            showAlternativeEntry();
        });
        console.log('✅ Event listener adicionado ao alternativeJoinButton');
    }

    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                joinButton?.click();
            }
        });
        console.log('✅ Event listener adicionado ao nameInput');
    }

    if (alternativeNameInput) {
        alternativeNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                alternativeSubmitButton?.click();
            }
        });
        console.log('✅ Event listener adicionado ao alternativeNameInput');
    }
});

function showAlternativeEntry() {
    console.log('🔧 Mostrando entrada alternativa');
    
    try {
        // Esconder modal se estiver visível
        const modalElement = document.getElementById('nameModal');
        if (modalElement) {
            modalElement.style.display = 'none';
            modalElement.classList.remove('show');
        }
        
        // Remover backdrops do Bootstrap
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());
        
        // Limpar classes do body
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        
        // Mostrar entrada alternativa
        if (alternativeEntry) {
            alternativeEntry.classList.remove('d-none');
            alternativeEntry.classList.add('show');
            alternativeEntry.style.display = 'flex';
            
            // Focar no input após um delay
            setTimeout(() => {
                if (alternativeNameInput) {
                    alternativeNameInput.focus();
                    alternativeNameInput.select();
                }
            }, 100);
        }
        
        console.log('✅ Entrada alternativa exibida');
    } catch (error) {
        console.error('❌ Erro ao mostrar entrada alternativa:', error);
    }
}

function hideAlternativeEntry() {
    document.body.classList.remove('alternative-active');
    alternativeEntry.style.display = 'none';
    alternativeEntry.classList.remove('show');
    alternativeEntry.classList.add('d-none');
}

function processUserEntry(name, isAlternative = false) {
    console.log('👤 Processando entrada:', name, 'Alternativa:', isAlternative);
    console.log('🌍 URL Base:', getBaseURL());
    
    if (!name || name.length < 2 || name.length > 20) {
        showNotification('Nome deve ter entre 2 e 20 caracteres', 'warning');
        return false;
    }
    
    if (userName && userId) {
        console.log('⚠️ Usuário já existe');
        return false;
    }
    
    userName = name;
    userId = generateUUID();
    
    console.log('✅ Usuário criado:', {userId, userName});
    console.log('🌐 Host atual:', window.location.host);
    console.log('🌐 Protocol:', window.location.protocol);
    
    hideAlternativeEntry();
    
    const modalElement = document.getElementById('nameModal');
    if (modalElement) {
        modalElement.style.display = 'none';
        modalElement.classList.remove('show');
    }
    
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());
    
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    
    setTimeout(() => {
        console.log('🚀 Inicializando aplicação...');
        init();
    }, 100);
    
    return true;
}

function init() {
    console.log('🎵 Iniciando Torbware Records...');
    console.log('User ID:', userId);
    console.log('User Name:', userName);
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        document.body.classList.add('mobile-device');
    }
    
    if (!player) {
        console.error('❌ Player element not found');
        showNotification('Erro na inicialização: player não encontrado', 'error');
        return;
    }
    
    connectWebSocket();
    fetchLibrary();
    // Remover setupEventListeners() daqui - já foi chamado no window.load
    updatePlayerControls(true);
    updatePlayerStatus('solo');
    
    // Set initial volume
    if (volumeRange) {
        volumeRange.value = currentVolume;
        player.volume = currentVolume / 100;
        updateVolumeIcon(currentVolume);
    }
    
    console.log('✅ Torbware Records inicializado!');
    showNotification('Bem-vindo ao Torbware Records!', 'success');
}

// --- Party Functions ---

function joinParty(partyId) {
    if (!currentPartyId) {
        sendMessage('join_party', { party_id: partyId });
        showNotification('Entrando na festa...', 'info');
    }
}

function sendChatMessage() {
    if (!chatInput || !currentPartyId) return;
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    sendMessage('chat_message', { 
        text: message,
        party_id: currentPartyId 
    });
    
    chatInput.value = '';
}

// Force leave party when WebSocket doesn't respond
function forceLeaveParty() {
    console.log('🚪 Forçando saída da festa...');
    
    currentPartyId = null;
    currentPartyMode = 'host';
    isHost = false;
    
    // Update UI to show no party
    if (partiesView) partiesView.style.display = 'block';
    if (partyView) partyView.style.display = 'none';
    
    // Reset player controls
    updatePlayerControls(true);
    updatePlayerStatus('solo');
    
    // Clear sync interval
    if (hostSyncInterval) {
        clearInterval(hostSyncInterval);
        hostSyncInterval = null;
    }
    
    // Update party list to refresh state
    sendMessage('get_parties', {});
    
    showNotification('Você saiu da festa', 'success');
}

// --- Event Listeners ---

let eventListenersSetup = false; // Flag para evitar múltiplas inicializações

function setupEventListeners() {
    // Prevenir múltiplas inicializações
    if (eventListenersSetup) {
        console.log('⚠️ Event listeners já configurados, pulando...');
        return;
    }
    
    console.log('🎮 Configurando event listeners...');
    
    // Player Events - Apenas visual, sem sincronização automática
    if (player) {
        player.addEventListener('play', () => {
            if (playPauseIcon) playPauseIcon.className = 'fas fa-pause';
            console.log('▶️ Play event - apenas atualização visual');
        });
        
        player.addEventListener('pause', () => {
            if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
            console.log('⏸️ Pause event - apenas atualização visual');
        });
        
        player.addEventListener('timeupdate', updateProgress);
        
        // Remover seeking event listener automático para evitar loops
        player.addEventListener('loadedmetadata', () => {
            updateProgress();
        });
        
        // Re-habilitar a barra de progresso quando o áudio estiver pronto para reprodução
        player.addEventListener('canplay', () => {
            if (progressBar) {
                progressBar.parentElement.classList.remove('loading');
                console.log('✅ Progress bar re-habilitada após carregamento do áudio');
            }
            
            // SOLUÇÃO DEFINITIVA: Reprodução automática só quando o áudio está completamente carregado
            if (shouldAutoPlay) {
                console.log('🎵 Iniciando reprodução automática após carregamento completo');
                player.play().catch(e => {
                    console.warn("Autoplay failed:", e);
                    showNotification('Clique para iniciar reprodução', 'warning');
                });
                shouldAutoPlay = false;
            }
        });
    }

    // Player Control Buttons
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            console.log('🎮 Play/Pause button clicked');
            console.log('🎮 Current state:', { currentPartyId, isHost, currentPartyMode });
            
            // Sempre aplicar ação localmente primeiro para responsividade
            lastPlayerAction = Date.now();
            const action = player.paused ? 'play' : 'pause';
            
            if (player.paused) {
                player.play().catch(e => console.warn("Play failed:", e));
            } else {
                player.pause();
            }
            
            if (!currentPartyId) {
                // MODO SOLO - Apenas controle local
                console.log('🎧 SOLO: Play/Pause aplicado localmente');
                showNotification(`${action === 'play' ? 'Reproduzindo' : 'Pausado'}`, 'success');
                return;
            }
            
            if (currentPartyMode === 'host') {
                if (isHost) {
                    // HOST EM MODO HOST - Controle total, não envia para servidor
                    console.log('👑 HOST: Play/Pause aplicado com controle total');
                    showNotification(`${action === 'play' ? 'Reproduzindo' : 'Pausado'} (host)`, 'success');
                } else {
                    // MEMBRO EM MODO HOST - Não pode controlar, reverter ação
                    console.log('🚫 MEMBRO: Não pode controlar em modo host');
                    showNotification('Apenas o host pode controlar o player', 'warning');
                    // Reverter a ação
                    if (action === 'play') {
                        player.pause();
                    } else {
                        player.play().catch(e => console.warn("Play failed:", e));
                    }
                }
            } else if (currentPartyMode === 'democratic') {
                // MODO DEMOCRÁTICO - Todos podem controlar e sincronizam
                console.log('�️ DEMOCRÁTICO: Enviando play/pause para sincronização');
                
                sendMessage('player_action', { 
                    action: action,
                    currentTime: player.currentTime 
                });
                
                showNotification(`${action === 'play' ? 'Reproduzindo' : 'Pausado'} (democrático)`, 'success');
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            console.log('🎮 Previous button clicked');
            
            // Sempre aplicar ação localmente primeiro
            lastPlayerAction = Date.now();
            player.currentTime = 0;
            
            if (!currentPartyId) {
                // MODO SOLO - Apenas controle local
                console.log('🎧 SOLO: Previous aplicado localmente');
                showNotification('Voltou ao início', 'success');
                return;
            }
            
            if (currentPartyMode === 'host') {
                if (isHost) {
                    // HOST EM MODO HOST - Controle total
                    console.log('👑 HOST: Previous aplicado com controle total');
                    showNotification('Voltou ao início (host)', 'success');
                } else {
                    // MEMBRO EM MODO HOST - Não pode controlar
                    console.log('🚫 MEMBRO: Não pode usar previous em modo host');
                    showNotification('Apenas o host pode controlar o player', 'warning');
                }
            } else if (currentPartyMode === 'democratic') {
                // MODO DEMOCRÁTICO - Enviar para sincronização
                console.log('🗳️ DEMOCRÁTICO: Enviando previous para sincronização');
                
                sendMessage('player_action', { 
                    action: 'seek', 
                    currentTime: 0 
                });
                
                showNotification('Voltou ao início (democrático)', 'success');
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            console.log('🎮 Next button clicked');
            
            const newTime = player.duration ? player.duration - 1 : 0;
            
            // Sempre aplicar ação localmente primeiro
            lastPlayerAction = Date.now();
            if (player.duration) {
                player.currentTime = newTime;
            }
            
            if (!currentPartyId) {
                // MODO SOLO - Apenas controle local
                console.log('🎧 SOLO: Next aplicado localmente');
                if (player.duration) {
                    showNotification('Avançou para o final', 'success');
                } else {
                    showNotification('Próxima música não implementada ainda', 'info');
                }
                return;
            }
            
            if (currentPartyMode === 'host') {
                if (isHost) {
                    // HOST EM MODO HOST - Controle total
                    console.log('👑 HOST: Next aplicado com controle total');
                    showNotification('Avançou para o final (host)', 'success');
                } else {
                    // MEMBRO EM MODO HOST - Não pode controlar
                    console.log('🚫 MEMBRO: Não pode usar next em modo host');
                    showNotification('Apenas o host pode controlar o player', 'warning');
                }
            } else if (currentPartyMode === 'democratic') {
                // MODO DEMOCRÁTICO - Enviar para sincronização
                console.log('🗳️ DEMOCRÁTICO: Enviando next para sincronização');
                
                sendMessage('player_action', { 
                    action: 'seek', 
                    currentTime: newTime 
                });
                
                showNotification('Avançou para o final (democrático)', 'success');
            }
        });
    }

    // Progress Bar - Enhanced seek controls
    if (progressBar) {
        let isDragging = false;
        let isHovering = false;
        
        // Add hover effects
        progressBar.addEventListener('mouseenter', () => {
            isHovering = true;
            progressBar.classList.add('hover');
        });
        
        progressBar.addEventListener('mouseleave', () => {
            isHovering = false;
            if (!isDragging) {
                progressBar.classList.remove('hover');
                // Clear tooltip
                const container = progressBar.closest('.progress-bar-container');
                if (container) container.removeAttribute('data-time');
            }
        });
        
        // Show time tooltip on hover
        progressBar.addEventListener('mousemove', (e) => {
            if (!player.duration || isDragging) return;
            
            const rect = progressBar.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const previewTime = percentage * player.duration;
            
            const container = progressBar.closest('.progress-bar-container');
            if (container) {
                container.setAttribute('data-time', formatTime(previewTime));
            }
        });
        
        // Handle click to seek anywhere on the progress bar
        progressBar.addEventListener('click', (e) => {
            if (!player.duration || isDragging) {
                console.log('🚫 Click seek blocked:', { duration: player.duration, isDragging });
                return;
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            const rect = progressBar.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const newTime = percentage * player.duration;
            
            console.log(`🎯 Click seek: ${formatTime(newTime)} (${(percentage * 100).toFixed(1)}%) - Event listener executado`);
            console.log('🎯 Current party state:', { currentPartyId, isHost, currentPartyMode });
            
            // Add loading state to button
            const container = progressBar.closest('.progress-bar-container');
            if (container) container.classList.add('seeking');
            
            setTimeout(() => {
                if (container) container.classList.remove('seeking');
            }, 500);
            
            seekToTime(newTime);
        });
        
        // Enhanced mouse drag handling
        progressBar.addEventListener('mousedown', (e) => {
            if (!player.duration) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            isDragging = true;
            progressBar.classList.add('dragging');
            document.body.style.userSelect = 'none';
            
            const startDrag = (event) => {
                if (!isDragging || !player.duration) return;
                
                const rect = progressBar.getBoundingClientRect();
                const percentage = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                const newTime = percentage * player.duration;
                
                // Update visual progress while dragging
                updateProgressVisual(percentage);
                
                // Update time display with preview
                if (currentTimeDisplay) {
                    currentTimeDisplay.textContent = formatTime(newTime);
                    currentTimeDisplay.classList.add('seeking');
                }
                
                // Update tooltip
                const container = progressBar.closest('.progress-bar-container');
                if (container) {
                    container.setAttribute('data-time', formatTime(newTime));
                }
            };
            
            const endDrag = (event) => {
                if (!isDragging || !player.duration) return;
                
                const rect = progressBar.getBoundingClientRect();
                const percentage = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                const newTime = percentage * player.duration;
                
                isDragging = false;
                progressBar.classList.remove('dragging', 'hover');
                document.body.style.userSelect = '';
                
                if (currentTimeDisplay) {
                    currentTimeDisplay.classList.remove('seeking');
                }
                
                // Clear tooltip
                const container = progressBar.closest('.progress-bar-container');
                if (container) container.removeAttribute('data-time');
                
                document.removeEventListener('mousemove', startDrag);
                document.removeEventListener('mouseup', endDrag);
                
                console.log(`🎯 Drag seek: ${formatTime(newTime)} (${(percentage * 100).toFixed(1)}%)`);
                seekToTime(newTime);
            };
            
            document.addEventListener('mousemove', startDrag);
            document.addEventListener('mouseup', endDrag);
            
            // Handle the initial click position
            startDrag(e);
        });
        
        // Enhanced touch events for mobile
        progressBar.addEventListener('touchstart', (e) => {
            if (!player.duration) return;
            
            e.preventDefault();
            isDragging = true;
            progressBar.classList.add('dragging');
            
            const touch = e.touches[0];
            const rect = progressBar.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            const newTime = percentage * player.duration;
            
            updateProgressVisual(percentage);
            if (currentTimeDisplay) {
                currentTimeDisplay.textContent = formatTime(newTime);
                currentTimeDisplay.classList.add('seeking');
            }
        }, { passive: false });
        
        progressBar.addEventListener('touchmove', (e) => {
            if (!isDragging || !player.duration) return;
            e.preventDefault();
            
            const touch = e.touches[0];
            const rect = progressBar.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            const newTime = percentage * player.duration;
            
            updateProgressVisual(percentage);
            if (currentTimeDisplay) {
                currentTimeDisplay.textContent = formatTime(newTime);
            }
        }, { passive: false });
        
        progressBar.addEventListener('touchend', (e) => {
            if (!isDragging || !player.duration) return;
            e.preventDefault();
            
            const touch = e.changedTouches[0];
            const rect = progressBar.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            const newTime = percentage * player.duration;
            
            isDragging = false;
            progressBar.classList.remove('dragging');
            
            if (currentTimeDisplay) {
                currentTimeDisplay.classList.remove('seeking');
            }
            
            console.log(`🎯 Touch seek: ${formatTime(newTime)} (${(percentage * 100).toFixed(1)}%)`);
            seekToTime(newTime);
        }, { passive: false });
        
        // Keyboard accessibility
        progressBar.addEventListener('keydown', (e) => {
            if (!player.duration) return;
            
            let seekAmount = 0;
            switch(e.key) {
                case 'ArrowLeft':
                    seekAmount = -10; // 10 seconds back
                    break;
                case 'ArrowRight':
                    seekAmount = 10; // 10 seconds forward
                    break;
                case 'Home':
                    seekToTime(0);
                    e.preventDefault();
                    return;
                case 'End':
                    seekToTime(player.duration - 1);
                    e.preventDefault();
                    return;
                default:
                    return;
            }
            
            if (seekAmount !== 0) {
                e.preventDefault();
                const newTime = Math.max(0, Math.min(player.duration, player.currentTime + seekAmount));
                seekToTime(newTime);
            }
        });
        
        // Make progress bar focusable for keyboard navigation
        progressBar.setAttribute('tabindex', '0');
        progressBar.setAttribute('role', 'slider');
        progressBar.setAttribute('aria-label', 'Seek track position');
    }

    // Volume Control
    if (volumeRange) {
        volumeRange.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            currentVolume = volume;
            player.volume = volume / 100;
            
            updateVolumeIcon(volume);
        });
    }

    if (volumeBtn) {
        volumeBtn.addEventListener('click', () => {
            if (isMuted) {
                player.volume = currentVolume / 100;
                volumeRange.value = currentVolume;
                isMuted = false;
            } else {
                player.volume = 0;
                volumeRange.value = 0;
                isMuted = true;
            }
            updateVolumeIcon(isMuted ? 0 : currentVolume);
        });
    }

    // Library Search
    if (librarySearch) {
        librarySearch.addEventListener('input', (e) => {
            filterLibrary(e.target.value);
        });
    }

    // Enhanced Party Controls
    if (createPartyBtn) {
        createPartyBtn.addEventListener('click', () => {
            if (!currentPartyId) {
                sendMessage('create_party', {});
                showNotification('Criando festa...', 'info');
                
                // Disable button temporarily to prevent double clicks
                createPartyBtn.disabled = true;
                setTimeout(() => {
                    if (createPartyBtn) createPartyBtn.disabled = false;
                }, 2000);
            } else {
                showNotification('Você já está em uma festa', 'warning');
            }
        });
    }

    if (leavePartyBtn) {
        leavePartyBtn.addEventListener('click', () => {
            console.log('🚪 Leave party button clicked, currentPartyId:', currentPartyId);
            
            if (currentPartyId) {
                if (confirm('Tem certeza que deseja sair da festa?')) {
                    console.log('🚪 User confirmed leaving party');
                    
                    // Send leave message with party ID
                    sendMessage('leave_party', { party_id: currentPartyId });
                    showNotification('Saindo da festa...', 'info');
                    
                    // Force UI update in case WebSocket response is delayed
                    setTimeout(() => {
                        if (currentPartyId) {
                            console.log('🚪 Forçando saída da festa na UI devido a timeout');
                            forceLeaveParty();
                        }
                    }, 3000); // Reduzido para 3 segundos para resposta mais rápida
                    
                    // Disable button temporarily with loading state
                    leavePartyBtn.disabled = true;
                    leavePartyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saindo...';
                    
                    setTimeout(() => {
                        if (leavePartyBtn && leavePartyBtn.disabled) {
                            leavePartyBtn.disabled = false;
                            leavePartyBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sair';
                        }
                    }, 3000);
                } else {
                    console.log('🚪 User cancelled leaving party');
                }
            } else {
                console.log('🚪 Not in a party, cannot leave');
                showNotification('Você não está em uma festa', 'warning');
            }
        });
    }

    if (democraticModeToggle) {
        democraticModeToggle.addEventListener('change', (e) => {
            if (isHost) {
                sendMessage('set_mode', { mode: e.target.checked ? 'democratic' : 'host' });
                showNotification(
                    e.target.checked ? 'Modo democrático ativado!' : 'Modo host ativado!', 
                    'success'
                );
            }
        });
    }

    // Chat
    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', sendChatMessage);
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }

    // Upload Form
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (!audioFile.files.length) {
                showNotification('Selecione um arquivo de áudio', 'warning');
                return;
            }

            const file = audioFile.files[0];
            const maxSize = 50 * 1024 * 1024; // 50MB
            if (file.size > maxSize) {
                showNotification('Arquivo muito grande. Máximo: 50MB', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            
            if (uploadStatus) {
                uploadStatus.className = 'upload-status';
                uploadStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fazendo upload...';
            }

            try {
                const baseUrl = getBaseURL();
                const res = await fetch(`${baseUrl}/upload`, { 
                    method: 'POST', 
                    body: formData 
                });
                
                if (res.ok) {
                    const result = await res.json();
                    if (uploadStatus) {
                        uploadStatus.innerHTML = `<i class="fas fa-check"></i> Upload realizado com sucesso! <strong>${result.title}</strong>`;
                    }
                    audioFile.value = '';
                    fetchLibrary();
                    showNotification('Música adicionada à biblioteca!', 'success');
                    
                    setTimeout(() => {
                        if (uploadStatus) uploadStatus.innerHTML = '';
                    }, 5000);
                } else {
                    const err = await res.json();
                    throw new Error(err.detail || 'Erro no upload');
                }
            } catch (error) {
                console.error('Upload error:', error);
                if (uploadStatus) {
                    uploadStatus.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Erro: ${error.message}`;
                }
                showNotification('Erro no upload', 'error');
            }
        });
    }

    // Queue Controls
    const clearQueueBtn = document.querySelector('.clear-queue-btn');
    if (clearQueueBtn) {
        clearQueueBtn.addEventListener('click', clearQueue);
    }
    
    // YouTube Import Controls
    const importUrlBtn = document.getElementById('importUrlBtn');
    const youtubeUrlInput = document.getElementById('youtubeUrlInput');
    const importUrlStatus = document.getElementById('importUrlStatus');

    if (importUrlBtn) {
        importUrlBtn.addEventListener('click', async () => {
            const url = youtubeUrlInput.value.trim();
            if (!url) {
                showNotification('Por favor, cole uma URL do YouTube.', 'warning');
                return;
            }

            // UI Feedback
            importUrlBtn.disabled = true;
            importUrlBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...';
            importUrlStatus.textContent = `Importando track do YouTube...`;

            try {
                const response = await fetch(`${getBaseURL()}/import_from_url`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || 'Falha na importação da track.');
                }

                const newTrack = await response.json();
                showNotification(`Importada com sucesso: ${newTrack.title}`, 'success');
                youtubeUrlInput.value = ''; // Clear input
                fetchLibrary(); // Refresh library list

            } catch (error) {
                showNotification(error.message, 'error');
            } finally {
                // Reset UI
                importUrlBtn.disabled = false;
                importUrlBtn.innerHTML = '<i class="fas fa-download"></i> Importar';
                importUrlStatus.textContent = '';
            }
        });
    }
    
    // Marcar como configurado para evitar múltiplas inicializações
    eventListenersSetup = true;
    console.log('✅ Event listeners configurados com sucesso!');
}

function updateVolumeIcon(volume) {
    if (!volumeIcon) return;
    
    if (volume === 0) {
        volumeIcon.className = 'fas fa-volume-mute';
    } else if (volume < 50) {
        volumeIcon.className = 'fas fa-volume-down';
    } else {
        volumeIcon.className = 'fas fa-volume-up';
    }
}
