// --- Torbware Records - Modern UI JavaScript ---

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
let currentQueue = [];
let libraryData = [];
let filteredLibrary = [];

// --- DOM Elements ---
const nameModal = new bootstrap.Modal(document.getElementById('nameModal'));
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

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${userId}`);

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
    switch (message.type) {
        case 'state_update':
            handleStateUpdate(message.payload);
            break;
        case 'party_sync':
            handlePartySync(message.payload);
            break;
        case 'chat_message':
            handleChatMessage(message.payload);
            break;
        case 'action_rejected':
            console.log('🚫 Ação rejeitada:', message.payload);
            showNotification('Ação muito rápida, aguarde um momento', 'warning');
            break;
        case 'error':
            showNotification(`Erro: ${message.payload.message}`, 'error');
            break;
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
    
    lastSyncReceived = Date.now();
    renderCurrentParty(party);

    if (party.mode === 'host') {
        if (party.host_id === userId) {
            console.log('👑 HOST MODE: Você é o host');
            
            if (party.track_id && party.track_id !== getCurrentTrackId()) {
                console.log('🎵 Host: Mudando música:', party.track_id);
                loadTrack(party.track_id);
            }
            
            if (!hostSyncInterval) {
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
            console.log('👥 HOST MODE: Você é membro');
            applySyncUpdate(party, false);
            
            if (hostSyncInterval) {
                clearInterval(hostSyncInterval);
                hostSyncInterval = null;
            }
        }
    } else if (party.mode === 'democratic') {
        const currentDebounce = democraticDebounceTime;
        const hasRecentAction = (Date.now() - lastPlayerAction) < currentDebounce * 3;
        
        if (hasRecentAction) {
            console.log('🗳️ DEMOCRATIC MODE: Ignorando sync - debounce ativo');
            
            if (party.track_id && party.track_id !== getCurrentTrackId()) {
                console.log('🎵 Democrático: Mudando música');
                loadTrack(party.track_id);
            }
        } else {
            console.log('🗳️ DEMOCRATIC MODE: Aplicando sincronização');
            applySyncUpdate(party, true);
        }
        
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
        is_playing: party.is_playing
    });

    try {
        if (party.track_id && party.track_id !== getCurrentTrackId()) {
            loadTrack(party.track_id);
        }

        const timeTolerance = gentle ? 4.0 : 1.5;
        const timeDifference = Math.abs(player.currentTime - party.currentTime);
        
        if (party.track_id && timeDifference > timeTolerance) {
            console.log(`⏰ Ajustando tempo: ${timeDifference.toFixed(2)}s`);
            player.currentTime = party.currentTime;
        }

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
    updatePlayerControls(canControl);
    updatePlayerStatus(isHost ? 'host' : (party.mode === 'democratic' ? 'democratic' : 'member'));
}

function updateNowPlaying(party) {
    const trackTitle = party.current_track_title || 'Nenhuma música tocando';
    const trackArtist = party.current_track_title ? 'ID: ' + party.track_id : 'Selecione uma música da biblioteca';
    
    if (currentTrackTitle) currentTrackTitle.textContent = trackTitle;
    if (currentTrackArtist) currentTrackArtist.textContent = trackArtist;
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
    
    console.log('🎮 Atualizando controles:', { enabled, currentPartyId, canControl });
    
    if (canControl) {
        playerControls.classList.remove('disabled');
        
        if (playPauseBtn) playPauseBtn.disabled = false;
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (progressBar) progressBar.style.pointerEvents = 'auto';
        if (volumeRange) volumeRange.disabled = false;
        
        console.log('✅ Controles habilitados');
    } else {
        playerControls.classList.add('disabled');
        
        if (playPauseBtn) playPauseBtn.disabled = true;
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (progressBar) progressBar.style.pointerEvents = 'none';
        if (volumeRange) volumeRange.disabled = true;
        
        console.log('🚫 Controles desabilitados');
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

// --- Player Functions ---

function getCurrentTrackId() {
    if (!player.src) return null;
    const match = player.src.match(/\/stream\/(\d+)/);
    return match ? parseInt(match[1]) : null;
}

function loadTrack(trackId) {
    if (!trackId) return;
    
    const newSrc = new URL(`/stream/${trackId}`, window.API_BASE_URL).href;
    player.src = newSrc;
    player.load();
    
    // Update track info
    const track = libraryData.find(t => t.id === trackId);
    if (track) {
        if (playerTrackTitle) playerTrackTitle.textContent = track.title;
        if (currentTrackTitle) currentTrackTitle.textContent = track.title;
        if (currentTrackArtist) currentTrackArtist.textContent = `ID: ${track.id}`;
    }
}

function playTrack(trackId) {
    if (currentPartyId) {
        const canControl = isHost || currentPartyMode === 'democratic';
        if (canControl) {
            lastPlayerAction = Date.now();
            sendMessage('player_action', { action: 'change_track', track_id: trackId });
            showNotification('Alterando música da festa...', 'info');
        } else {
            showNotification('Você não pode controlar o player neste modo', 'warning');
        }
    } else {
        loadTrack(trackId);
        player.play().catch(e => {
            console.warn("Play failed:", e);
            showNotification('Erro ao reproduzir música', 'error');
        });
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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
        const res = await fetch(new URL('/library', window.API_BASE_URL));
        if (!res.ok) throw new Error('Falha ao carregar biblioteca');
        
        libraryData = await res.json();
        filteredLibrary = [...libraryData];
        renderLibrary();
        
    } catch (error) {
        console.error('Error fetching library:', error);
        showNotification('Erro ao carregar biblioteca', 'error');
        if (libraryList) {
            libraryList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Erro ao carregar biblioteca</p>
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
    
    // For now, just play the track directly
    // In a full implementation, you'd send a queue message to the server
    playTrack(trackId);
    showNotification('Música adicionada à reprodução', 'success');
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

// --- Event Listeners ---

function setupEventListeners() {
    // Player Events
    if (player) {
        player.addEventListener('play', () => {
            if (playPauseIcon) playPauseIcon.className = 'fas fa-pause';
            
            if (!isSyncing && currentPartyId) {
                const canControl = isHost || currentPartyMode === 'democratic';
                if (canControl) {
                    lastPlayerAction = Date.now();
                    sendMessage('player_action', { action: 'play' });
                }
            }
        });
        
        player.addEventListener('pause', () => {
            if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
            
            if (!isSyncing && currentPartyId) {
                const canControl = isHost || currentPartyMode === 'democratic';
                if (canControl) {
                    lastPlayerAction = Date.now();
                    sendMessage('player_action', { action: 'pause' });
                }
            }
        });
        
        player.addEventListener('timeupdate', updateProgress);
        
        player.addEventListener('seeking', () => {
            if (!isSyncing && currentPartyId) {
                const canControl = isHost || currentPartyMode === 'democratic';
                if (canControl) {
                    if (pendingSeek) clearTimeout(pendingSeek);
                    
                    const debounceTime = currentPartyMode === 'democratic' ? democraticDebounceTime : actionDebounceTime;
                    pendingSeek = setTimeout(() => {
                        lastPlayerAction = Date.now();
                        sendMessage('player_action', { 
                            action: 'seek', 
                            currentTime: player.currentTime 
                        });
                        pendingSeek = null;
                    }, debounceTime);
                }
            }
        });
        
        player.addEventListener('loadedmetadata', () => {
            updateProgress();
        });
    }

    // Player Control Buttons
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            if (player.paused) {
                player.play();
            } else {
                player.pause();
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            // Implement previous track logic
            player.currentTime = 0;
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            // Implement next track logic
            showNotification('Próxima música não implementada ainda', 'info');
        });
    }

    // Progress Bar
    if (progressBar) {
        progressBar.addEventListener('click', (e) => {
            if (!player.duration) return;
            
            const rect = progressBar.getBoundingClientRect();
            const percentage = (e.clientX - rect.left) / rect.width;
            const newTime = percentage * player.duration;
            
            player.currentTime = newTime;
        });
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

    // Party Controls
    if (createPartyBtn) {
        createPartyBtn.addEventListener('click', () => {
            if (!currentPartyId) {
                sendMessage('create_party', {});
                showNotification('Criando festa...', 'info');
            }
        });
    }

    if (leavePartyBtn) {
        leavePartyBtn.addEventListener('click', () => {
            if (currentPartyId) {
                if (confirm('Tem certeza que deseja sair da festa?')) {
                    sendMessage('leave_party', {});
                    showNotification('Saindo da festa...', 'info');
                }
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
                const res = await fetch(new URL('/upload', window.API_BASE_URL), { 
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

// --- Initialization ---

window.addEventListener('load', () => {
    console.log('🌐 Window loaded');
    console.log('📱 User Agent:', navigator.userAgent);
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log('📱 Is Mobile:', isMobile);
    
    if (isMobile) {
        document.body.classList.add('mobile-device');
    }
    
    if (isMobile && debugInfo) {
        debugInfo.style.display = 'block';
        if (debugUserAgent) debugUserAgent.textContent = navigator.userAgent.substring(0, 50) + '...';
        if (debugTimestamp) debugTimestamp.textContent = new Date().toISOString();
    }
    
    initializeNameEntry(isMobile);
});

function initializeNameEntry(isMobile) {
    console.log('🚪 Inicializando entrada de nome...');
    
    setTimeout(() => {
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
    }, 200);
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

// Name Entry Event Listeners
if (joinButton) {
    joinButton.addEventListener('click', () => {
        const name = nameInput.value.trim();
        processUserEntry(name, false);
    });
}

if (alternativeSubmitButton) {
    alternativeSubmitButton.addEventListener('click', () => {
        const name = alternativeNameInput.value.trim();
        processUserEntry(name, true);
    });
}

if (alternativeJoinButton) {
    alternativeJoinButton.addEventListener('click', () => {
        showAlternativeEntry();
    });
}

if (nameInput) {
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            joinButton.click();
        }
    });
}

if (alternativeNameInput) {
    alternativeNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            alternativeSubmitButton.click();
        }
    });
}

function showAlternativeEntry() {
    console.log('🔧 Mostrando entrada alternativa');
    
    const modalElement = document.getElementById('nameModal');
    modalElement.style.display = 'none';
    modalElement.classList.remove('show');
    
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());
    
    document.body.classList.remove('modal-open');
    document.body.classList.add('alternative-active');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    
    alternativeEntry.classList.remove('d-none');
    alternativeEntry.classList.add('show');
    alternativeEntry.style.display = 'flex';
    
    setTimeout(() => {
        if (alternativeNameInput) alternativeNameInput.focus();
    }, 100);
}

function hideAlternativeEntry() {
    document.body.classList.remove('alternative-active');
    alternativeEntry.style.display = 'none';
    alternativeEntry.classList.remove('show');
    alternativeEntry.classList.add('d-none');
}

function processUserEntry(name, isAlternative = false) {
    console.log('👤 Processando entrada:', name, 'Alternativa:', isAlternative);
    
    if (!name || name.length < 2 || name.length > 20) {
        showNotification('Nome deve ter entre 2 e 20 caracteres', 'warning');
        return false;
    }
    
    if (userName && userId) {
        console.log('⚠️ Usuário já existe');
        return false;
    }
    
    userName = name;
    userId = crypto.randomUUID();
    
    console.log('✅ Usuário criado:', {userId, userName});
    
    hideAlternativeEntry();
    
    const modalElement = document.getElementById('nameModal');
    modalElement.style.display = 'none';
    modalElement.classList.remove('show');
    
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
    setupEventListeners();
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
