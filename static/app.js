// --- Torbware Records - Modern UI JavaScript ---

// --- Authentication Variables ---
let authenticatedUser = null; // {id: number, nickname: string}
let authToken = null; // Para futuras implementações de token

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

// Unified Player State
let playerState = {
    queue: [],
    original_queue: [], // For unshuffling
    current_index: -1,
    current_track_id: null,
    current_time: 0.0,
    is_playing: false,
    repeat_mode: 'off', // 'off', 'all', 'one'
    is_shuffled: false,
};

// Deprecated global state (to be removed or refactored)
// let currentQueue = []; // Replaced by playerState.queue
// let soloQueue = []; // Replaced by playerState.queue when solo
// let repeatMode = 'off'; // Replaced by playerState.repeat_mode
// let isShuffleActive = false; // Replaced by playerState.is_shuffled
// let currentTrackId = null; // Replaced by playerState.current_track_id

let libraryData = [];
let filteredLibrary = [];
// let currentTrackData = null; // Can be derived from playerState.current_track_id and libraryData
let eventListenersSetup = false; // Flag para evitar múltiplas inicializações

// Playlist variables
let userPlaylists = [];
let currentTrackToAdd = null;

// --- DOM Elements ---

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

// Account Management Elements - will be initialized in initializeApp()
let userDropdown;
let userNicknameDisplay;
let manageAccountBtn;
let logoutBtn;
let manageAccountModal;
let nicknameUpdateInput;
let nicknameUpdateError;
let updateNicknameBtn;
let initiateDeleteBtn;
let deleteConfirmModal;
let nicknameConfirmText;
let deleteNicknameConfirmInput;
let confirmDeleteBtn;

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
        // 'queue_update' is effectively replaced by 'party_sync' or 'solo_state_update'
        // as these will contain the full player state including the queue.
        // If a specific 'queue_update' message is still sent by backend for parties for some reason,
        // ensure it updates playerState.queue and re-renders.
        // case 'queue_update':
        //     console.log('🎵 Party Queue update received (legacy?):', message.payload);
        //     if (currentPartyId && message.payload && message.payload.queue) {
        //         playerState.queue = message.payload.queue;
        //         // If current_index is out of bounds due to queue change, backend should handle it.
        //         // Client should primarily rely on current_index from sync.
        //         renderQueue(playerState.queue, playerState.current_index);
        //     }
        //     break;
        case 'solo_state_update':
            handleSoloStateUpdate(message.payload);
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

// --- Account Management Functions ---

function openAccountModal() {
    console.log('🔧 openAccountModal chamado');
    
    if (!manageAccountModal) {
        console.error('❌ manageAccountModal não está inicializado!');
        return;
    }
    
    if (!nicknameUpdateInput) {
        console.error('❌ nicknameUpdateInput não encontrado!');
        return;
    }
    
    nicknameUpdateInput.value = userName;
    
    if (nicknameUpdateError) {
        nicknameUpdateError.style.display = 'none';
    }
    
    console.log('✅ Abrindo modal de gerenciar conta');
    manageAccountModal.show();
}

async function updateNickname() {
    const newNickname = nicknameUpdateInput.value.trim();
    if (newNickname === userName) {
        manageAccountModal.hide();
        return;
    }

    if (newNickname.length < 2 || newNickname.length > 20) {
        nicknameUpdateError.textContent = 'O apelido deve ter entre 2 e 20 caracteres.';
        nicknameUpdateError.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: newNickname })
        });

        if (response.ok) {
            const updatedUser = await response.json();
            authenticatedUser.nickname = updatedUser.nickname;
            userName = updatedUser.nickname;
            localStorage.setItem('authenticatedUser', JSON.stringify(authenticatedUser));
            userNicknameDisplay.textContent = userName;
            showNotification('Apelido atualizado com sucesso!', 'success');
            manageAccountModal.hide();
        } else if (response.status === 409) {
            nicknameUpdateError.textContent = 'Este apelido já está em uso.';
            nicknameUpdateError.style.display = 'block';
        } else {
            throw new Error('Failed to update nickname');
        }
    } catch (error) {
        console.error('Error updating nickname:', error);
        showNotification('Erro ao atualizar o apelido.', 'error');
    }
}

function initiateDeleteAccount() {
    manageAccountModal.hide();
    nicknameConfirmText.textContent = userName;
    deleteNicknameConfirmInput.value = '';
    confirmDeleteBtn.disabled = true;
    deleteConfirmModal.show();
}

async function confirmDeleteAccount() {
    if (deleteNicknameConfirmInput.value !== userName) {
        showNotification('O apelido digitado não corresponde.', 'error');
        return;
    }

    try {
        const response = await fetch(`/users/${userId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Conta deletada com sucesso. Você será desconectado.', 'success');
            setTimeout(logout, 2000);
        } else {
            throw new Error('Failed to delete account');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showNotification('Erro ao deletar a conta.', 'error');
    }
}

function logout() {
    console.log('🚪 Logout iniciado');
    
    if (ws) {
        console.log('🔌 Fechando WebSocket');
        ws.close();
    }
    
    authenticatedUser = null;
    userId = null;
    userName = null;
    
    console.log('🧹 Limpando localStorage');
    localStorage.clear();
    
    console.log('🔄 Recarregando página');
    document.location.reload();
}

// --- State Handlers ---

function handleStateUpdate(payload) {
    renderUserList(payload.users);
    renderPartyList(payload.parties);
    
    // Update party host name if currently in a party and host info changed
    if (currentPartyId && payload.parties) {
        const currentPartyData = payload.parties.find(p => p.party_id === currentPartyId);
        if (currentPartyData && partyHostName) { // Ensure partyHostName element exists
            const hostUser = payload.users.find(u => u.id === currentPartyData.host_id);
            if (hostUser) {
                partyHostName.textContent = hostUser.name;
            }
        }
    }
}

function handleSoloStateUpdate(soloStatePayload) {
    console.log('👤 Solo state update received:', soloStatePayload);
    if (currentPartyId) {
        console.warn("Received solo_state_update while in a party. Ignoring.");
        return; // Should not happen if backend logic is correct
    }

    // Update global playerState
    playerState.queue = soloStatePayload.queue || [];
    playerState.original_queue = soloStatePayload.original_queue || [];
    playerState.current_index = soloStatePayload.current_index !== undefined ? soloStatePayload.current_index : -1;
    playerState.current_track_id = soloStatePayload.current_track_id || null;
    playerState.current_time = soloStatePayload.current_time || 0;
    playerState.is_playing = soloStatePayload.is_playing || false;
    playerState.repeat_mode = soloStatePayload.repeat_mode || 'off';
    playerState.is_shuffled = soloStatePayload.is_shuffled || false;
    
    // Update UI
    renderQueue(playerState.queue, playerState.current_index);
    updateShuffleRepeatButtonsUI(); // Reflects playerState.is_shuffled and playerState.repeat_mode

    // Load track if changed and not already loaded
    // getCurrentTrackId() now refers to player.src, not the old global currentTrackId
    const audioPlayerCurrentTrackId = player.src ? parseInt(player.src.split('/').pop()) : null;

    if (playerState.current_track_id && playerState.current_track_id !== audioPlayerCurrentTrackId) {
        console.log('👤 Solo: Loading track from solo_state_update', playerState.current_track_id);
        loadTrack(playerState.current_track_id); // This will set player.src
    } else if (!playerState.current_track_id && audioPlayerCurrentTrackId) {
        // No track in state, but player has one - stop player
        player.pause();
        player.src = '';
        updateTrackDisplay(null); // Clear player bar display
    }


    // Sync player time and play/pause state (gently, as this is authoritative for solo)
    if (playerState.current_track_id) {
        if (Math.abs(player.currentTime - playerState.current_time) > 1.5) { // Sync if more than 1.5s diff
            player.currentTime = playerState.current_time;
        }
        if (playerState.is_playing && player.paused) {
            player.play().catch(e => console.warn("Solo state update play failed:", e));
        } else if (!playerState.is_playing && !player.paused) {
            player.pause();
        }
    }
    updatePlayerStatus('solo'); // Ensure status is 'solo'
}


function handlePartySync(partyPayload) {
    console.log('🔄 Party sync recebido:', partyPayload);

    if (!currentPartyId || partyPayload.party_id !== currentPartyId) {
         // This could happen if the user just joined the party, and this is the first sync.
        if (partyPayload.party_id && partyPayload.members.some(m => m.id === userId)) {
            console.log(`Joining party ${partyPayload.party_id} via sync.`);
            currentPartyId = partyPayload.party_id;
             // Clear solo state variables as we are now in a party
            playerState = { ...playerState, queue: [], original_queue: [], current_index: -1, current_track_id: null, current_time: 0.0, is_playing: false, is_shuffled: false, repeat_mode: 'off' };

        } else {
            console.warn('⚠️ Recebido sync de festa diferente ou não sou membro! Forçando saída se necessário...');
            if (currentPartyId) forceLeaveParty(); // Only force leave if we thought we were in a party
            return;
        }
    }
    
    lastSyncReceived = Date.now();

    // Update global playerState from partyPayload
    playerState.queue = partyPayload.queue || [];
    playerState.original_queue = partyPayload.original_queue || [];
    playerState.current_index = partyPayload.current_index !== undefined ? partyPayload.current_index : -1;
    playerState.current_track_id = partyPayload.current_track_id || null;
    playerState.current_time = partyPayload.current_time || 0;
    playerState.is_playing = partyPayload.is_playing || false;
    playerState.repeat_mode = partyPayload.repeat_mode || 'off';
    playerState.is_shuffled = partyPayload.is_shuffled || false;
    
    currentPartyMode = partyPayload.mode; // Keep this for party-specific UI logic
    isHost = partyPayload.host_id === userId; // Keep this

    // Render generic party UI (members, host name, etc.)
    renderCurrentParty(partyPayload); // This function now uses partyPayload directly

    // Render queue based on new playerState
    renderQueue(playerState.queue, playerState.current_index);
    updateShuffleRepeatButtonsUI();


    // Sync logic (similar to applySyncUpdate, but adapted for unified playerState)
    const audioPlayerCurrentTrackId = player.src ? parseInt(player.src.split('/').pop()) : null;

    if (partyPayload.host_id === userId && partyPayload.mode === 'host') {
        console.log('👑 HOST MODE: Você é o host. Client state is authoritative.');
        // Host only sends updates, doesn't apply them strictly from server unless track ID changes externally.
        if (playerState.current_track_id && playerState.current_track_id !== audioPlayerCurrentTrackId) {
            const timeSinceAction = Date.now() - lastPlayerAction;
            if (timeSinceAction > 2000) { // If action wasn't recent by host
                 console.log('🎵 Host: External track change detected in sync, loading:', playerState.current_track_id);
                loadTrack(playerState.current_track_id);
            } else {
                console.log('👑 Host: Ignorando mudança de música do sync - ação recente própria');
            }
        }
        if (!hostSyncInterval) {
            hostSyncInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN && player && currentPartyId) {
                    sendMessage('sync_update', { // Host sends its current state
                        currentTime: player.currentTime,
                        is_playing: !player.paused,
                        // track_id: playerState.current_track_id // Not needed, server knows party's track
                    });
                }
            }, 1500);
        }
        return; // Host doesn't apply detailed sync for time/play state from server
    }

    // For members or democratic mode participants:
    isSyncing = true; // Use a global isSyncing flag if needed for other parts of UI

    if (playerState.current_track_id && playerState.current_track_id !== audioPlayerCurrentTrackId) {
        console.log('🎵 Sync: Mudando música (party):', playerState.current_track_id);
        loadTrack(playerState.current_track_id); // This will set player.src
    } else if (!playerState.current_track_id && audioPlayerCurrentTrackId) {
        player.pause();
        player.src = '';
        updateTrackDisplay(null);
    }

    const timeSinceAction = Date.now() - lastPlayerAction;
    const gentleSync = partyPayload.mode === 'democratic' && timeSinceAction < 2000; // More gentle if user acted recently in democratic
    const timeTolerance = gentleSync ? 4.0 : 1.5;

    if (playerState.current_track_id) { // Only sync time/play if a track is supposed to be active
        const timeDifference = Math.abs(player.currentTime - playerState.current_time);
        if (timeDifference > timeTolerance) {
            if (timeSinceAction < 2000 && timeDifference < 8.0 && partyPayload.mode === 'democratic') { // User made recent action
                 console.log(`⏰ SKIP democratic seek: Ação recente (${timeSinceAction}ms) e diferença pequena (${timeDifference.toFixed(2)}s)`);
            } else {
                console.log(`⏰ Ajustando tempo (party): ${player.currentTime.toFixed(2)}s -> ${playerState.current_time.toFixed(2)}s`);
                player.currentTime = playerState.current_time;
            }
        }

        const playStateDifferent = (playerState.is_playing && player.paused) || (!playerState.is_playing && !player.paused);
        if (playStateDifferent) {
             if (timeSinceAction < 2000 && partyPayload.mode === 'democratic') {
                 console.log(`▶️⏸️ SKIP democratic play/pause: Ação recente (${timeSinceAction}ms)`);
             } else {
                if (playerState.is_playing && player.paused) {
                    console.log('▶️ Iniciando reprodução (party sync)');
                    player.play().catch(e => console.warn("Party sync autoplay prevented:", e));
                } else if (!playerState.is_playing && !player.paused) {
                    console.log('⏸️ Pausando reprodução (party sync)');
                    player.pause();
                }
            }
        }
    }

    if (hostSyncInterval && partyPayload.mode === 'democratic') { // Stop host-specific interval if mode changes
        clearInterval(hostSyncInterval);
        hostSyncInterval = null;
    }

    setTimeout(() => { isSyncing = false; }, 300);
}

// --- UI Helper Functions ---

function updateConnectionStatus(connected) {
    if (!connectionStatus) return;
    
    if (connected) {
        connectionStatus.className = 'connection-indicator connected';
    } else {
        connectionStatus.className = 'connection-indicator disconnected';
        // Mostrar toast de reconexão apenas quando desconecta
        showNotification('Conexão perdida. Tentando reconectar...', 'warning');
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
    
    // Mostrar/esconder botão de Play Playlist
    const playPlaylistBtn = document.getElementById('playPlaylistBtn');
    if (playPlaylistBtn) {
        playPlaylistBtn.style.display = canControl ? 'inline-block' : 'none';
    }
    
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

// function getCurrentTrackId() { // Now use playerState.current_track_id
//     return playerState.current_track_id;
// }

// function getCurrentTrackData() { // Derive from playerState.current_track_id and libraryData
//     if (!playerState.current_track_id) return null;
//     return libraryData.find(t => t.id === playerState.current_track_id);
// }

async function loadTrack(trackId, playWhenReady = false) {
    if (!trackId) {
        console.log('❌ Track ID is null/undefined for loadTrack');
        // If there's no track, ensure player is reset
        player.pause();
        player.src = '';
        updateTrackDisplay(null); // Clear display
        if(playerState.is_playing) playerState.is_playing = false; // Reflect in state
        if(playerState.current_track_id) playerState.current_track_id = null;
        if(playerState.current_index !== -1) playerState.current_index = -1;
        return;
    }
    
    console.log('🎵 Loading track:', trackId, "Play when ready:", playWhenReady);
    
    try {
        const track = libraryData.find(t => t.id === trackId);
        if (!track) {
            console.error('❌ Track not found in library:', trackId);
            showNotification('Música não encontrada na biblioteca', 'error');
            // If track not found, and it was the current track in state, clear it.
            if (playerState.current_track_id === trackId) {
                playerState.current_track_id = null;
                playerState.is_playing = false;
                playerState.current_index = -1; // Or find next valid? For now, just clear.
                 if (!currentPartyId) await sendMessage('player_action', { action: 'stop_if_invalid_track' }); // Inform backend if solo
            }
            return;
        }
        
        if (progressBar) progressBar.parentElement.classList.add('loading');
        
        // playerState.current_track_id = trackId; // This should be set by the source of truth (backend)
                                                // or by user action that then informs backend.
                                                // loadTrack is more of a reaction to state change.
        // currentTrackData = track; // Replaced by deriving from playerState.current_track_id

        const baseUrl = getBaseURL();
        const streamUrl = `${baseUrl}/stream/${trackId}`;
        
        // Only change src if it's different, to avoid unnecessary reloads/flicker
        if (player.src !== streamUrl) {
            console.log('🎵 Setting player source:', streamUrl);
            player.src = streamUrl;
            shouldAutoPlay = playWhenReady || playerState.is_playing; // Play if state says so, or if explicitly requested
        } else if (playWhenReady && player.paused) { // Same track, but want to play
             player.play().catch(e => console.warn("loadTrack play failed (same track):", e));
        }


        updateTrackDisplay(track); // Update player bar title etc.
        
        // Update now playing in party view (if in party and elements exist)
        if (currentPartyId && currentTrackTitle && currentTrackArtist) {
            currentTrackTitle.textContent = track.title;
            // currentTrackArtist.textContent = `Arquivo: ${track.filename || 'Unknown'}`; // This might be too detailed
        }
        
        console.log('✅ Track load initiated for:', track.title);
        
    } catch (error) {
        console.error('❌ Error loading track:', error);
        showNotification('Erro ao carregar música', 'error');
        if (progressBar) progressBar.parentElement.classList.remove('loading');
    }
}

function updateTrackDisplay(trackData) { // trackData can be null
    if (playerTrackTitle) {
        playerTrackTitle.textContent = trackData ? trackData.title : "Nenhuma música";
    }
    // Status (solo/host/member) is updated by handlePartySync or handleSoloStateUpdate
}

// --- Player Functions ---

function playTrack(trackId) { // This function is primarily for when a user clicks a track in the library
    console.log('🎵 User requested playTrack:', trackId);
    
    // Regardless of solo/party, send a 'change_track' action.
    // The backend will handle the state update (solo or party) and sync back.
    sendMessage('player_action', {
        action: 'change_track',
        track_id: trackId
    });

    // Optimistically load and try to play for better UX, backend will confirm/correct state.
    // loadTrack(trackId, true); // true to play when ready

    if (!currentPartyId) {
        showNotification(`Carregando ${libraryData.find(t=>t.id===trackId)?.title || 'música'}...`, 'info');
    } else {
        // Party message depends on canControl, but action is sent anyway.
        // Backend debounce/permissions will handle it.
        showNotification(`Sugerindo ${libraryData.find(t=>t.id===trackId)?.title || 'música'} para a festa...`, 'info');
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
        const fullUrl = `${baseUrl}/library`;
        console.log('🌍 Base URL:', baseUrl);
        console.log('📚 Fetching library from:', fullUrl);
        console.log('📚 Full fetch URL (debug):', fullUrl);
        
        const res = await fetch(fullUrl);
        console.log('📚 Response status:', res.status);
        console.log('📚 Response URL:', res.url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
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
                <div class="dropdown">
                    <button class="btn btn-outline-secondary library-action-btn dropdown-toggle" type="button" data-bs-toggle="dropdown">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <ul class="dropdown-menu">
                        <li><button class="dropdown-item" onclick="openAddToPlaylistModal(${track.id}, '${track.title.replace(/'/g, "\\'")}')">
                            <i class="fas fa-plus"></i> Adicionar à Playlist
                        </button></li>
                    </ul>
                </div>
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
    const track = libraryData.find(t => t.id === trackId);
    if (!track) {
        showNotification('Música não encontrada na biblioteca para adicionar à fila.', 'error');
        return;
    }

    // Optimistically update local playerState for solo users for faster UI feedback
    if (!currentPartyId) {
        playerState.queue.push(trackId);
        if (playerState.is_shuffled) {
            playerState.original_queue.push(trackId);
        }
        if (playerState.current_index === -1 && playerState.queue.length === 1) { // If it's the first track
            playerState.current_index = 0;
            playerState.current_track_id = trackId;
             // loadTrack(trackId, false); // Load but don't auto-play, backend confirms play state
        }
        renderQueue(playerState.queue, playerState.current_index);
    }
    
    // Always send to server
    sendMessage('queue_action', {
        action: 'add',
        track_id: trackId
        // party_id is implicit on the backend if user is in a party
    });
    
    showNotification(`"${track.title}" adicionada à fila.`, 'success');
}


function renderQueue(queueTrackIds, currentTrackIndex) {
    if (!queueList) return; // queueList is the DOM element for the queue UI

    queueList.innerHTML = ''; // Clear previous items

    if (!queueTrackIds || queueTrackIds.length === 0) {
        queueList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list-ol"></i>
                <p>Fila vazia</p>
                <small>Adicione músicas da biblioteca.</small>
            </div>`;
        return;
    }

    queueTrackIds.forEach((trackId, index) => {
        const track = libraryData.find(t => t.id === trackId);
        if (!track) {
            console.warn(`Track ID ${trackId} not found in libraryData during queue render.`);
            return; // Skip rendering if track details aren't available
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = 'queue-item';
        if (index === currentTrackIndex) {
            itemDiv.classList.add('current-track');
        }
        // Make item clickable to play from queue (sends 'change_track' action)
        itemDiv.onclick = () => playTrackFromQueue(trackId);


        itemDiv.innerHTML = `
            <div class="queue-item-index">${index + 1}</div>
            <div class="queue-item-info">
                <div class="queue-item-title">${track.title}</div>
                <div class="queue-item-meta">ID: ${track.id}</div>
            </div>
            <div class="queue-item-actions">
                <button class="btn btn-sm btn-outline-danger remove-from-queue-btn" title="Remover da Fila">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        // Add event listener for the remove button INSIDE this loop
        const removeBtn = itemDiv.querySelector('.remove-from-queue-btn');
        removeBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent playTrackFromQueue due to event bubbling
            removeFromQueue(index);
        };

        queueList.appendChild(itemDiv);
    });
}


function playTrackFromQueue(trackId) {
    // This function will send a 'change_track' action.
    // The backend will update the current_index and current_track_id.
    // The client will then receive a party_sync or solo_state_update.
    sendMessage('player_action', {
        action: 'change_track',
        track_id: trackId
    });
}


function removeFromQueue(positionInQueue) {
    // Optimistically update UI for solo mode
    if (!currentPartyId) {
        const removedTrackId = playerState.queue[positionInQueue];
        playerState.queue.splice(positionInQueue, 1);
        if (playerState.is_shuffled && removedTrackId) {
            const originalIndex = playerState.original_queue.indexOf(removedTrackId);
            if (originalIndex > -1) {
                playerState.original_queue.splice(originalIndex, 1);
            }
        }

        // Adjust current_index if necessary
        if (positionInQueue < playerState.current_index) {
            playerState.current_index--;
        } else if (positionInQueue === playerState.current_index) {
            // If current track removed, logic to play next or stop is handled by backend state update
            // For optimistic UI, we might just re-render. Backend will send new state.
             playerState.current_index = Math.min(playerState.current_index, playerState.queue.length - 1);
             if (playerState.queue.length === 0) playerState.current_index = -1;

        }
        renderQueue(playerState.queue, playerState.current_index);
    }

    sendMessage('queue_action', {
        action: 'remove',
        position: positionInQueue
    });
}

function clearQueue() {
    if (confirm('Tem certeza que deseja limpar toda a fila?')) {
        if (!currentPartyId) { // Optimistic UI for solo
            playerState.queue = [];
            playerState.original_queue = [];
            playerState.current_index = -1;
            playerState.current_track_id = null;
            playerState.is_playing = false;
            renderQueue(playerState.queue, playerState.current_index);
            loadTrack(null); // Stop player
        }
        sendMessage('queue_action', { action: 'clear' });
    }
}

// --- Playlist Management Functions ---

async function fetchPlaylists() {
    if (!userId) return;
    
    try {
        const baseUrl = getBaseURL();
        const fullUrl = `${baseUrl}/users/${userId}/playlists`;
        console.log('🎵 Base URL:', baseUrl);
        console.log('🎵 User ID:', userId);
        console.log('🎵 Fetching playlists from:', fullUrl);
        console.log('🎵 Full fetch URL (debug):', fullUrl);
        
        const response = await fetch(fullUrl);
        console.log('🎵 Response status:', response.status);
        console.log('🎵 Response URL:', response.url);
        if (response.ok) {
            userPlaylists = await response.json();
            renderPlaylists();
        } else {
            console.error('Failed to fetch playlists');
            userPlaylists = [];
            renderPlaylists();
        }
    } catch (error) {
        console.error('Error fetching playlists:', error);
        userPlaylists = [];
        renderPlaylists();
    }
}

function renderPlaylists() {
    const playlistList = document.getElementById('playlistList');
    if (!playlistList) return;
    
    playlistList.innerHTML = '';
    
    if (userPlaylists.length === 0) {
        playlistList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list"></i>
                <p>Nenhuma playlist</p>
                <small>Crie sua primeira playlist!</small>
            </div>
        `;
        return;
    }
    
    userPlaylists.forEach(playlist => {
        const playlistItem = document.createElement('div');
        playlistItem.className = 'playlist-item';
        playlistItem.innerHTML = `
            <div class="playlist-item-icon">
                <i class="fas fa-list"></i>
            </div>
            <div class="playlist-item-info">
                <div class="playlist-item-title">${playlist.name}</div>
                <div class="playlist-item-meta">${playlist.track_count} músicas</div>
            </div>
            <div class="playlist-item-actions">
                <button class="btn btn-outline-primary playlist-action-btn" onclick="viewPlaylist(${playlist.id})" title="Ver playlist">
                    <i class="fas fa-eye"></i>
                </button>
                <div class="dropdown">
                    <button class="btn btn-outline-secondary playlist-action-btn dropdown-toggle" type="button" data-bs-toggle="dropdown">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <ul class="dropdown-menu">
                        <li><button class="dropdown-item" onclick="deletePlaylist(${playlist.id}, '${playlist.name.replace(/'/g, "\\'")}')">
                            <i class="fas fa-trash text-danger"></i> Deletar Playlist
                        </button></li>
                    </ul>
                </div>
            </div>
        `;
        playlistList.appendChild(playlistItem);
    });
}

function openCreatePlaylistModal() {
    const modal = new bootstrap.Modal(document.getElementById('createPlaylistModal'));
    document.getElementById('playlistNameInput').value = '';
    modal.show();
}

async function createPlaylist() {
    const nameInput = document.getElementById('playlistNameInput');
    const name = nameInput.value.trim();
    
    if (!name) {
        nameInput.classList.add('is-invalid');
        return;
    }
    
    if (!authenticatedUser) {
        showNotification('Você precisa estar autenticado para criar playlists', 'error');
        return;
    }
    
    nameInput.classList.remove('is-invalid');
    
    try {
        const response = await fetch(`${getBaseURL()}/playlists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: name,
                owner_user_id: authenticatedUser.id  // Usar ID inteiro do usuário autenticado
            })
        });
        
        if (response.ok) {
            showNotification(`Playlist "${name}" criada com sucesso!`, 'success');
            fetchPlaylists();
            bootstrap.Modal.getInstance(document.getElementById('createPlaylistModal')).hide();
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Erro ao criar playlist', 'error');
        }
    } catch (error) {
        console.error('Error creating playlist:', error);
        showNotification('Erro ao criar playlist', 'error');
    }
}

function openAddToPlaylistModal(trackId, trackTitle) {
    currentTrackToAdd = trackId;
    document.getElementById('trackToAddTitle').textContent = trackTitle;
    
    const modal = new bootstrap.Modal(document.getElementById('addToPlaylistModal'));
    renderPlaylistSelectList('playlistSelectList');
    modal.show();
}

function renderPlaylistSelectList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (userPlaylists.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list"></i>
                <p>Nenhuma playlist encontrada</p>
                <small>Crie uma playlist primeiro!</small>
            </div>
        `;
        return;
    }
    
    userPlaylists.forEach(playlist => {
        const playlistOption = document.createElement('div');
        playlistOption.className = 'playlist-select-item';
        playlistOption.innerHTML = `
            <div class="playlist-select-info">
                <div class="playlist-select-title">${playlist.name}</div>
                <div class="playlist-select-meta">${playlist.track_count} músicas</div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="addTrackToPlaylist(${playlist.id}, '${playlist.name.replace(/'/g, "\\'")}')">
                <i class="fas fa-plus"></i> Adicionar
            </button>
        `;
        container.appendChild(playlistOption);
    });
}

async function addTrackToPlaylist(playlistId, playlistName) {
    if (!currentTrackToAdd) return;
    
    try {
        const response = await fetch(`${getBaseURL()}/playlists/${playlistId}/tracks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: currentTrackToAdd })
        });
        
        if (response.ok) {
            showNotification(`Música adicionada à playlist "${playlistName}"!`, 'success');
            fetchPlaylists(); // Refresh to update track counts
            bootstrap.Modal.getInstance(document.getElementById('addToPlaylistModal')).hide();
        } else {
            const error = await response.json();
            if (error.detail && error.detail.includes('already in playlist')) {
                showNotification('Esta música já está na playlist', 'warning');
            } else {
                showNotification(error.detail || 'Erro ao adicionar música à playlist', 'error');
            }
        }
    } catch (error) {
        console.error('Error adding track to playlist:', error);
        showNotification('Erro ao adicionar música à playlist', 'error');
    }
}

async function deletePlaylist(playlistId, playlistName) {
    if (!confirm(`Tem certeza de que deseja deletar a playlist "${playlistName}"?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${getBaseURL()}/playlists/${playlistId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification(`Playlist "${playlistName}" deletada com sucesso!`, 'success');
            fetchPlaylists();
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Erro ao deletar playlist', 'error');
        }
    } catch (error) {
        console.error('Error deleting playlist:', error);
        showNotification('Erro ao deletar playlist', 'error');
    }
}

async function viewPlaylist(playlistId) {
    // TODO: Implementar visualização detalhada da playlist
    // Por enquanto, apenas mostra uma notificação
    showNotification('Visualização de playlist será implementada em breve', 'info');
}

function openSelectPlaylistModal() {
    const modal = new bootstrap.Modal(document.getElementById('selectPlaylistModal'));
    renderPartyPlaylistSelectList();
    modal.show();
}

function renderPartyPlaylistSelectList() {
    const container = document.getElementById('partyPlaylistSelectList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (userPlaylists.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list"></i>
                <p>Nenhuma playlist encontrada</p>
                <small>Crie uma playlist primeiro!</small>
            </div>
        `;
        return;
    }
    
    userPlaylists.forEach(playlist => {
        const playlistOption = document.createElement('div');
        playlistOption.className = 'playlist-select-item';
        playlistOption.innerHTML = `
            <div class="playlist-select-info">
                <div class="playlist-select-title">${playlist.name}</div>
                <div class="playlist-select-meta">${playlist.track_count} músicas</div>
            </div>
            <button class="btn btn-sm btn-success" onclick="setPartyPlaylist(${playlist.id}, '${playlist.name.replace(/'/g, "\\'")}')">
                <i class="fas fa-play"></i> Tocar
            </button>
        `;
        container.appendChild(playlistOption);
    });
}

function setPartyPlaylist(playlistId, playlistName) {
    if (!currentPartyId) {
        showNotification('Você precisa estar em uma festa', 'warning');
        return;
    }
    
    const canControl = isHost || currentPartyMode === 'democratic';
    if (!canControl) {
        showNotification('Você não tem permissão para controlar a festa', 'warning');
        return;
    }
    
    sendMessage('set_playlist', { playlist_id: playlistId });
    showNotification(`Playlist "${playlistName}" sendo carregada na festa...`, 'info');
    bootstrap.Modal.getInstance(document.getElementById('selectPlaylistModal')).hide();
}

// --- Updated WebSocket Message Handlers ---

function handleChatMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const timestamp = new Date(message.timestamp * 1000).toLocaleTimeString();
    messageDiv.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-author">${message.author}</span>
            <span class="chat-timestamp">${timestamp}</span>
        </div>
        <div class="chat-message-text">${message.text}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderQueue(queue) {
    const queueList = document.getElementById('queueList');
    if (!queueList) return;
    
    queueList.innerHTML = '';
    
    if (!queue || queue.length === 0) {
        queueList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-list-ol"></i>
                <p>Fila vazia</p>
                <small>Adicione músicas da biblioteca ou carregue uma playlist</small>
            </div>
        `;
        return;
    }
    
    queue.forEach((trackId, index) => {
        // Find track data from library
        const track = libraryData.find(t => t.id === trackId);
        if (!track) return;
        
        const queueItem = document.createElement('div');
        queueItem.className = 'queue-item';
        if (trackId === currentTrackId) {
            queueItem.classList.add('current-track');
        }
        
        queueItem.innerHTML = `
            <div class="queue-item-index">${index + 1}</div>
            <div class="queue-item-info">
                <div class="queue-item-title">${track.title}</div>
                <div class="queue-item-meta">ID: ${track.id}</div>
            </div>
            <div class="queue-item-actions">
                <button class="btn btn-sm btn-outline-primary" onclick="playTrackFromQueue(${trackId})">
                    <i class="fas fa-play"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="removeFromQueue(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        queueList.appendChild(queueItem);
    });
}

function playTrackFromQueue(trackId) {
    if (!currentPartyId) {
        playTrack(trackId);
        return;
    }
    
    const canControl = isHost || currentPartyMode === 'democratic';
    if (!canControl) {
        showNotification('Você não tem permissão para controlar a festa', 'warning');
        return;
    }
    
    sendMessage('player_action', {
        action: 'change_track',
        track_id: trackId
    });
}

function removeFromQueue(position) {
    if (!currentPartyId) {
        showNotification('Você precisa estar em uma festa para usar a fila', 'warning');
        return;
    }
    
    const canControl = isHost || currentPartyMode === 'democratic';
    if (!canControl) {
        showNotification('Você não tem permissão para controlar a festa', 'warning');
        return;
    }
    
    sendMessage('queue_action', {
        action: 'remove',
        position: position,
        party_id: currentPartyId
    });
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    if (!chatInput || !currentPartyId) return;
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    sendMessage('chat_message', {
        text: message,
        party_id: currentPartyId
    });
    
    chatInput.value = '';
}

// --- Updated Player Controls for Next/Previous ---

function updatePlayerControlsVisuals() { // Renamed to avoid conflict and clarify purpose
    // This function now PRIMARILY updates the visual state (disabled/enabled) of buttons.
    // The actual ability to control is determined by playerState and server responses.
    // However, for immediate UX, we can disable buttons if not in a state to use them.

    const canCurrentlyControl = !currentPartyId || isHost || currentPartyMode === 'democratic';

    if (playPauseBtn) playPauseBtn.disabled = !canCurrentlyControl && currentPartyId;
    if (prevBtn) prevBtn.disabled = (!canCurrentlyControl && currentPartyId) || playerState.queue.length === 0;
    if (nextBtn) nextBtn.disabled = (!canCurrentlyControl && currentPartyId) || playerState.queue.length === 0;
    
    // Shuffle and Repeat buttons are always enabled, their action depends on context.
    // ProgressBar is handled by its own logic in renderCurrentParty/updatePlayerControls.
}


function handleNextTrack() {
    console.log('⏭️ Next track button clicked');
    // Action is always sent to backend. Backend determines new state.
    sendMessage('player_action', { action: 'next_track' });
    // Optimistic UI updates are handled by backend sending back new playerState.
}

function handlePrevTrack() {
    console.log('⏮️ Previous track button clicked');
    // Action is always sent to backend.
    sendMessage('player_action', { action: 'prev_track' });
}

function handleToggleShuffle() {
    console.log('🔀 Toggle shuffle button clicked');
    sendMessage('toggle_shuffle', {});
    // Optimistic UI: update button state immediately, server will confirm/override
    // playerState.is_shuffled = !playerState.is_shuffled; // This might be too fast, let server confirm
    // updateShuffleRepeatButtonsUI();
}

function handleSetRepeatMode() {
    console.log('🔁 Set repeat mode button clicked');
    let newMode = 'off';
    if (playerState.repeat_mode === 'off') newMode = 'all';
    else if (playerState.repeat_mode === 'all') newMode = 'one';
    // else if (playerState.repeat_mode === 'one') newMode = 'off'; // Cycle back

    sendMessage('set_repeat_mode', { mode: newMode });
    // Optimistic UI:
    // playerState.repeat_mode = newMode; // Let server confirm
    // updateShuffleRepeatButtonsUI();
}

function updateShuffleRepeatButtonsUI() {
    const shuffleBtn = document.getElementById('shuffleBtn');
    const repeatBtn = document.getElementById('repeatBtn');

    if (shuffleBtn) {
        if (playerState.is_shuffled) {
            shuffleBtn.classList.add('active');
            shuffleBtn.innerHTML = '<i class="fas fa-random"></i>'; // Or a filled icon
        } else {
            shuffleBtn.classList.remove('active');
            shuffleBtn.innerHTML = '<i class="fas fa-random"></i>';
        }
    }

    if (repeatBtn) {
        repeatBtn.classList.remove('repeat-all', 'repeat-one'); // Clear previous states
        if (playerState.repeat_mode === 'all') {
            repeatBtn.classList.add('active', 'repeat-all');
            repeatBtn.innerHTML = '<i class="fas fa-repeat"></i>'; // Standard repeat icon
        } else if (playerState.repeat_mode === 'one') {
            repeatBtn.classList.add('active', 'repeat-one');
            repeatBtn.innerHTML = '<i class="fas fa-repeat-1-alt"></i>'; // Specific icon for repeat one
        } else { // 'off'
            repeatBtn.classList.remove('active');
            repeatBtn.innerHTML = '<i class="fas fa-repeat"></i>';
        }
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
    
    console.log('✅ Inicialização básica concluída');
});

// --- Authentication Functions ---

function showAuthScreen() {
    const authScreen = document.getElementById('authScreen');
    if (authScreen) {
        authScreen.classList.remove('hidden');
        authScreen.style.display = 'flex';
    }
}

function hideAuthScreen() {
    const authScreen = document.getElementById('authScreen');
    if (authScreen) {
        authScreen.classList.add('hidden');
        setTimeout(() => {
            authScreen.style.display = 'none';
        }, 300);
    }
}

function showAuthError(message) {
    const authError = document.getElementById('authError');
    if (authError) {
        authError.textContent = message;
        authError.style.display = 'block';
    }
}

function hideAuthError() {
    const authError = document.getElementById('authError');
    if (authError) {
        authError.textContent = '';
        authError.style.display = 'none';
    }
}

async function authenticateUser(nickname) {
    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nickname })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const userData = await response.json();
        
        // Salva dados do usuário autenticado
        authenticatedUser = {
            id: userData.id,
            nickname: userData.nickname
        };
        
        // Atualiza variáveis globais para compatibilidade
        userId = userData.id.toString();
        userName = userData.nickname;
        
        // Salva no localStorage
        localStorage.setItem('authenticatedUser', JSON.stringify(authenticatedUser));
        
        console.log('✅ Usuário autenticado:', authenticatedUser);
        return true;
        
    } catch (error) {
        console.error('❌ Erro na autenticação:', error);
        showAuthError('Erro na autenticação. Tente novamente.');
        return false;
    }
}

function checkStoredAuth() {
    const stored = localStorage.getItem('authenticatedUser');
    if (stored) {
        try {
            authenticatedUser = JSON.parse(stored);
            userId = authenticatedUser.id.toString();
            userName = authenticatedUser.nickname;
            console.log('🔄 Usuário restaurado do localStorage:', authenticatedUser);
            return true;
        } catch (error) {
            console.error('❌ Erro ao restaurar usuário:', error);
            localStorage.removeItem('authenticatedUser');
        }
    }
    return false;
}

function logout() {
    authenticatedUser = null;
    userId = null;
    userName = null;
    localStorage.removeItem('authenticatedUser');
    showAuthScreen();
}

// Name Entry Event Listeners - Configurar imediatamente
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM Content Loaded - Inicializando autenticação');
    
    // Configurar event listeners de autenticação
    const nicknameInput = document.getElementById('nicknameInput');
    const authContinueBtn = document.getElementById('authContinueBtn');
    const authScreen = document.getElementById('authScreen');
    
    // Verificar se já há usuário autenticado
    if (checkStoredAuth()) {
        console.log('✅ Usuário já autenticado, iniciando app...');
        hideAuthScreen();
        initializeApp();
    } else {
        console.log('🔐 Usuário não autenticado, mostrando tela de login...');
        showAuthScreen();
    }
    
    // Event listener para input de nickname (Enter)
    if (nicknameInput) {
        nicknameInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await handleAuthContinue();
            }
        });
        
        // Limpar erro quando usuário digita
        nicknameInput.addEventListener('input', () => {
            hideAuthError();
        });
    }
    
    // Event listener para botão continuar
    if (authContinueBtn) {
        authContinueBtn.addEventListener('click', handleAuthContinue);
    }
    
    async function handleAuthContinue() {
        const nickname = nicknameInput.value.trim();
        
        if (!nickname) {
            showAuthError('Por favor, digite um apelido válido.');
            return;
        }
        
        if (nickname.length < 2) {
            showAuthError('O apelido deve ter pelo menos 2 caracteres.');
            return;
        }
        
        if (nickname.length > 20) {
            showAuthError('O apelido deve ter no máximo 20 caracteres.');
            return;
        }
        
        // Desabilitar botão durante autenticação
        authContinueBtn.disabled = true;
        authContinueBtn.innerHTML = '<span>Entrando...</span><i class="fas fa-spinner fa-spin"></i>';
        
        const success = await authenticateUser(nickname);
        
        if (success) {
            hideAuthScreen();
            initializeApp();
        } else {
            // Reabilitar botão
            authContinueBtn.disabled = false;
            authContinueBtn.innerHTML = '<span>Continuar</span><i class="fas fa-arrow-right"></i>';
        }
    }
    
    // Função para inicializar o app após autenticação
    function initializeApp() {
        console.log('🚀 Inicializando aplicação para usuário:', authenticatedUser);
        
        // Initialize DOM elements now that DOM is ready
        userDropdown = document.getElementById('userDropdown');
        userNicknameDisplay = document.getElementById('userNicknameDisplay');
        manageAccountBtn = document.getElementById('manageAccountBtn');
        logoutBtn = document.getElementById('logoutBtn');
        nicknameUpdateInput = document.getElementById('nicknameUpdateInput');
        nicknameUpdateError = document.getElementById('nicknameUpdateError');
        updateNicknameBtn = document.getElementById('updateNicknameBtn');
        initiateDeleteBtn = document.getElementById('initiateDeleteBtn');
        nicknameConfirmText = document.getElementById('nicknameConfirmText');
        deleteNicknameConfirmInput = document.getElementById('deleteNicknameConfirmInput');
        confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        
        // Initialize Modals now that the DOM is ready
        manageAccountModal = new bootstrap.Modal(document.getElementById('manageAccountModal'));
        deleteConfirmModal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));

        // Update UI with user info
        if (userNicknameDisplay) {
            userNicknameDisplay.textContent = userName;
        }

        // Conectar WebSocket
        connectWebSocket();
        
        // Carregar dados do usuário
        fetchLibrary();
        fetchPlaylists();
        
        // Configurar controles do player
        updatePlayerControlsVisuals(); // Use the renamed function
        updatePlayerStatus('solo');
        updateShuffleRepeatButtonsUI(); // Initialize shuffle/repeat buttons
        
        // Configurar volume inicial
        if (volumeRange) {
            volumeRange.value = currentVolume;
            player.volume = currentVolume / 100;
            updateVolumeIcon(currentVolume);
        }
        
        // Configurar event listeners integrados
        setupEventListeners();
        
        console.log('✅ Torbware Records inicializado!');
        showNotification('Bem-vindo ao Torbware Records!', 'success');
    }
    
    // Event listeners setup function integrated within initializeApp scope
    function setupEventListeners() {
        console.log('🎮 Configurando event listeners...');
        
        // Account Management
        if (manageAccountBtn) {
            manageAccountBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔧 Gerenciar Conta clicado');
                openAccountModal();
            });
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🚪 Logout clicado');
                logout();
            });
        }
        
        if (updateNicknameBtn) {
            updateNicknameBtn.addEventListener('click', updateNickname);
        }
        
        if (initiateDeleteBtn) {
            initiateDeleteBtn.addEventListener('click', initiateDeleteAccount);
        }
        
        if (deleteNicknameConfirmInput) {
            deleteNicknameConfirmInput.addEventListener('input', () => {
                if (confirmDeleteBtn) {
                    confirmDeleteBtn.disabled = deleteNicknameConfirmInput.value !== userName;
                }
            });
        }
        
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', confirmDeleteAccount);
        }

        // Player Events
        if (player) {
            player.addEventListener('play', () => {
                if (playPauseIcon) playPauseIcon.className = 'fas fa-pause';
            });
            
            player.addEventListener('pause', () => {
                if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
            });
            
            player.addEventListener('timeupdate', updateProgress);
            player.addEventListener('loadedmetadata', updateProgress);
            
            player.addEventListener('canplay', () => {
                if (progressBar) {
                    progressBar.parentElement.classList.remove('loading');
                }
                
                if (shouldAutoPlay) {
                    player.play().catch(e => {
                        console.warn("Autoplay failed:", e);
                        showNotification('Clique para iniciar reprodução', 'warning');
                    });
                    shouldAutoPlay = false;
                }
            });
        }

        // Player Controls
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
            prevBtn.addEventListener('click', handlePrevTrack);
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', handleNextTrack);
        }

        // Shuffle and Repeat Button Event Listeners
        const shuffleBtn = document.getElementById('shuffleBtn');
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', handleToggleShuffle);
        }

        const repeatBtn = document.getElementById('repeatBtn');
        if (repeatBtn) {
            repeatBtn.addEventListener('click', handleSetRepeatMode);
        }
        
        if (progressBar) {
            progressBar.addEventListener('click', (e) => {
                const rect = progressBar.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const width = rect.width;
                const percentage = x / width;
                seekToTime(player.duration * percentage);
            });
        }
        
        if (volumeRange) {
            volumeRange.addEventListener('input', (e) => {
                const volume = e.target.value;
                player.volume = volume / 100;
                updateVolumeIcon(volume);
            });
        }

        // Library and Playlists
        if (librarySearch) {
            librarySearch.addEventListener('input', (e) => filterLibrary(e.target.value));
        }
        
        const createPlaylistBtn = document.getElementById('createPlaylistBtn');
        if (createPlaylistBtn) {
            createPlaylistBtn.addEventListener('click', openCreatePlaylistModal);
        }
        
        const createPlaylistConfirmBtn = document.getElementById('createPlaylistConfirmBtn');
        if (createPlaylistConfirmBtn) {
            createPlaylistConfirmBtn.addEventListener('click', createPlaylist);
        }

        // Party
        if (createPartyBtn) {
            createPartyBtn.addEventListener('click', createParty);
        }
        
        if (leavePartyBtn) {
            leavePartyBtn.addEventListener('click', () => sendMessage('leave_party', {}));
        }
        
        if (democraticModeToggle) {
            democraticModeToggle.addEventListener('change', (e) => {
                sendMessage('set_mode', { mode: e.target.checked ? 'democratic' : 'host' });
            });
        }
        
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
        
        const playPlaylistBtn = document.getElementById('playPlaylistBtn');
        if (playPlaylistBtn) {
            playPlaylistBtn.addEventListener('click', openSelectPlaylistModal);
        }

        // Upload
        if (uploadForm) {
            uploadForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData();
                formData.append('file', audioFile.files[0]);
                try {
                    const response = await fetch('/upload', {
                        method: 'POST',
                        body: formData
                    });
                    if (response.ok) {
                        showNotification('Upload concluído!', 'success');
                        fetchLibrary();
                    } else {
                        throw new Error('Upload failed');
                    }
                } catch (error) {
                    showNotification('Erro no upload.', 'error');
                }
            });
        }

        // YouTube Import
        const importUrlBtn = document.getElementById('importUrlBtn');
        if (importUrlBtn) {
            importUrlBtn.addEventListener('click', async () => {
                const url = document.getElementById('youtubeUrlInput').value;
                if (!url) return;
                try {
                    const response = await fetch('/import_from_url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url })
                    });
                    if (response.ok) {
                        showNotification('Importação do YouTube concluída!', 'success');
                        fetchLibrary();
                    } else {
                        const error = await response.json();
                        showNotification(error.detail || 'Erro na importação.', 'error');
                    }
                } catch (error) {
                    showNotification('Erro na importação.', 'error');
                }
            });
        }
        
        console.log('✅ Event listeners configurados com sucesso!');
    }
});

// --- Party Functions ---

function createParty() {
    if (!userName) {
        showNotification('Por favor, defina seu nome primeiro', 'error');
        return;
    }
    
    if (currentPartyId) {
        showNotification('Você já está em uma festa', 'warning');
        return;
    }
    
    sendMessage('create_party', {});
    showNotification('Criando festa...', 'info');
}

function joinParty(partyId) {
    if (!currentPartyId) {
        sendMessage('join_party', { party_id: partyId });
        showNotification('Entrando na festa...', 'info');
    }
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

// --- Player Handler Functions ---

function handlePrevTrack() {
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
}

function handleNextTrack() {
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
}

// --- Event Listeners ---

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
                console.log('🗳️ DEMOCRÁTICO: Enviando play/pause para sincronização');
                
                sendMessage('player_action', { 
                    action: action,
                    currentTime: player.currentTime 
                });
                
                showNotification(`${action === 'play' ? 'Reproduzindo' : 'Pausado'} (democrático)`, 'success');
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', handlePrevTrack);
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', handleNextTrack);
    }

    // --- Progress Bar and Volume Events ---
    if (progressBar) {
        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const totalWidth = rect.width;
            const clickPercentage = offsetX / totalWidth;
            
            const newTime = clickPercentage * player.duration;
            seekToTime(newTime);
        });
        
        // Adicionado para suporte a toque em dispositivos móveis
        progressBar.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            const rect = progressBar.getBoundingClientRect();
            const offsetX = touch.clientX - rect.left;
            const totalWidth = rect.width;
            const clickPercentage = offsetX / totalWidth;
            
            const newTime = clickPercentage * player.duration;
            seekToTime(newTime);
        });
    }

    if (volumeRange) {
        volumeRange.addEventListener('input', (e) => {
            const newVolume = e.target.value;
            player.volume = newVolume / 100;
            currentVolume = newVolume;
            updateVolumeIcon(newVolume);
            
            // Enviar nova configuração de volume para o servidor imediatamente
            if (currentPartyId) {
                sendMessage('player_action', { 
                    action: 'set_volume', 
                    volume: newVolume 
                });
            }
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
            console.log('🎉 Create party button clicked');
            createParty();
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

    // --- Progress Bar and Volume Events ---
    if (progressBar) {
        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const totalWidth = rect.width;
            const clickPercentage = offsetX / totalWidth;
            
            const newTime = clickPercentage * player.duration;
            seekToTime(newTime);
        });
        
        // Adicionado para suporte a toque em dispositivos móveis
        progressBar.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            const rect = progressBar.getBoundingClientRect();
            const offsetX = touch.clientX - rect.left;
            const totalWidth = rect.width;
            const clickPercentage = offsetX / totalWidth;
            
            const newTime = clickPercentage * player.duration;
            seekToTime(newTime);
        });
    }

    if (volumeRange) {
        volumeRange.addEventListener('input', (e) => {
            const newVolume = e.target.value;
            player.volume = newVolume / 100;
            currentVolume = newVolume;
            updateVolumeIcon(newVolume);
            
            // Enviar nova configuração de volume para o servidor imediatamente
            if (currentPartyId) {
                sendMessage('player_action', { 
                    action: 'set_volume', 
                    volume: newVolume 
                });
            }
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
            console.log('🎉 Create party button clicked');
            createParty();
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
