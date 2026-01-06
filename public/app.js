/**
 * @file WebRTC Voice Chat Application - Client-side JavaScript
 * @description Manages WebRTC peer connections, Socket.IO communication, and UI interactions
 */

/** @typedef {import('socket.io-client').Socket} Socket */
/** @typedef {RTCPeerConnection} RTCPeerConnection */
/** @typedef {RTCSessionDescriptionInit} RTCSessionDescriptionInit */
/** @typedef {RTCIceCandidate} RTCIceCandidate */

/**
 * Initialize Socket.IO connection with reconnection settings
 * @type {Socket}
 */
const socket = io({
  reconnection: true,           // Enable reconnection
  reconnectionAttempts: 5,      // Max reconnection attempts
  reconnectionDelay: 1000,      // Initial delay (1s)
  reconnectionDelayMax: 5000,   // Max delay (5s)
  timeout: 20000,               // Connection timeout (20s)
  transports: ['websocket', 'polling'] // Try WebSocket first, fallback to polling
});

/**
 * WebRTC Configuration
 * @type {RTCConfiguration}
 */
const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global variables
/** @type {HTMLElement|null} */
let roomDialog = null;
/** @type {string|null} Current room ID */
let roomId = null;
/** @type {string|null} Current user ID */
let userId = null;
/** @type {boolean} Microphone mute state */
let muteState = false;
/** @type {Object.<string, RTCPeerConnection>} Map of peerId -> RTCPeerConnection */
let peerConnections = {};
/** @type {Object.<string, boolean>} Map of peerId -> connection status */
let users = {};
/** @type {number} Number of displayed audio streams (1-3) */
let numberOfDisplayedStreams = 1;
/** @type {number} Number of connected peers */
let numberOfConnectedPeers = 0;
/** @type {string|null} Session ID for user identification */
let sessionId = null;
/** @type {string|null} CSRF token for request protection (Phase 3) */
let csrfToken = null;
/** @type {Object.<string, number>} Map of peerId -> retry count (max 3 attempts) */
let peerRetryCount = {};

// Audio Settings Variables
/** @type {HTMLElement|null} */
let audioSettingsDialog = null;
/** @type {'native'|'webaudio'|'advanced'|'ai'} Current audio processing mode */
let currentAudioMode = 'native';
/** @type {AudioContext|null} */
let audioContext = null;
/** @type {MediaStreamAudioSourceNode|null} */
let audioSource = null;
/** @type {GainNode|null} */
let audioGainNode = null;
/** @type {DynamicsCompressorNode|null} */
let audioCompressor = null;
/** @type {BiquadFilterNode|null} */
let audioFilter = null;
/** @type {HTMLCanvasElement|null} */
let audioVisualizer = null;
/** @type {AnalyserNode|null} */
let audioAnalyser = null;
/** @type {number|null} Visualizer animation frame ID */
let visualizerAnimationId = null;
/** @type {AudioWorkletNode|null} For AI mode (RNNoise) */
let audioWorkletNode = null;

// Socket event handlers
socket.on('connect', () => {
  console.log('✅ Connected to server:', socket.id);

  // If we were in a room before disconnect, try to rejoin
  if (roomId && userId) {
    console.log(`🔄 Reconnecting to room ${roomId} as ${userId}...`);
    displaySystemMessage(`🔄 正在重新連線...`, 'info');

    // Rejoin the room
    socket.emit('join-room', {
      roomId: roomId,
      userId: userId
    });
  }
});

socket.on('disconnect', (reason) => {
  console.log('❌ Disconnected from server:', reason);
  displaySystemMessage(`⚠️ 與伺服器連線中斷`, 'error');

  // Log the reason
  if (reason === 'io server disconnect') {
    // Server disconnected us - don't auto-reconnect
    displaySystemMessage(`🚫 伺服器主動斷開連線`, 'error');
  } else if (reason === 'transport close' || reason === 'transport error') {
    // Network issue - Socket.IO will auto-reconnect
    displaySystemMessage(`🔄 網路斷線，正在嘗試重新連線...`, 'info');
  }
});

// Reconnection attempt event
socket.on('reconnect_attempt', (attemptNumber) => {
  console.log(`🔄 Reconnection attempt ${attemptNumber}`);
  displaySystemMessage(`🔄 重新連線中... (嘗試 ${attemptNumber}/5)`, 'info');
});

// Reconnection failed event
socket.on('reconnect_failed', () => {
  console.log('❌ Reconnection failed');
  displaySystemMessage(`❌ 重新連線失敗，請重新整理頁面`, 'error');
  alert('無法重新連線到伺服器，請重新整理頁面');
});

// Reconnection error event
socket.on('reconnect_error', (error) => {
  console.error('❌ Reconnection error:', error);
});

// Successfully reconnected event
socket.on('reconnect', (attemptNumber) => {
  console.log(`✅ Reconnected to server after ${attemptNumber} attempts`);
  displaySystemMessage(`✅ 已重新連線到伺服器`, 'success');
});

socket.on('room-created', (data) => {
  roomId = data.roomId;
  userId = data.userId;
  console.log(`🏠 Room created: ${roomId}, User ID: ${userId}`);
  updateRoomUI();
});

socket.on('joined-room', async (data) => {
  roomId = data.roomId;
  userId = data.userId;
  console.log(`✅ Joined room: ${roomId}, User ID: ${userId}`);
  console.log('Connected users:', data.users);
  updateRoomUI();
  roomDialog?.close();

  // Initialize connections to existing users
  for (const user of data.users) {
    if (user !== userId) {
      users[user] = false; // Mark as not yet connected
      await createPeerConnection(user, true); // true = we are the initiator
    }
  }
});

socket.on('user-joined', async (data) => {
  console.log(`👤 User joined: ${data.userId}`);
  // Don't initiate connection here - the new user will send us an offer
  users[data.userId] = false;
  displaySystemMessage(`👋 ${data.userId} 加入了房間`, 'info');
});

socket.on('user-left', (data) => {
  console.log(`👋 User left: ${data.userId}`);
  handlePeerDisconnect(data.userId);
  displaySystemMessage(`👋 ${data.userId} 離開了房間`, 'info');
});

socket.on('receive-offer', async (data) => {
  console.log(`📥 Received offer from ${data.fromUser}`);

  // Check if peer connection already exists and is in wrong state
  let pc = peerConnections[data.fromUser];
  if (pc && (pc.signalingState !== 'stable' && pc.signalingState !== 'closed')) {
    console.warn(`⚠️ Peer connection already exists in state: ${pc.signalingState}, ignoring duplicate offer`);
    return;
  }

  await createPeerConnection(data.fromUser, false); // false = we are not the initiator
  pc = peerConnections[data.fromUser];

  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('send-answer', {
        roomId,
        toUser: data.fromUser,
        answer: answer
      });
      console.log(`✅ Successfully processed offer from ${data.fromUser}`);
    } catch (error) {
      console.error(`❌ Error processing offer from ${data.fromUser}:`, error);
    }
  }
});

socket.on('receive-answer', async (data) => {
  console.log(`📥 Received answer from ${data.fromUser}`);
  const pc = peerConnections[data.fromUser];
  if (pc) {
    // Check signaling state before setting remote description
    if (pc.signalingState === 'have-local-offer') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        users[data.fromUser] = true;
        updateUserCount();
        console.log(`✅ Successfully set answer from ${data.fromUser}, state: ${pc.signalingState}`);
      } catch (error) {
        console.error(`❌ Error setting answer from ${data.fromUser}:`, error);
      }
    } else {
      console.warn(`⚠️ Ignoring answer from ${data.fromUser}, wrong state: ${pc.signalingState}`);
    }
  }
});

socket.on('receive-ice-candidate', async (data) => {
  console.log(`🧊 Received ICE candidate from ${data.fromUser}`);
  const pc = peerConnections[data.fromUser];
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('room-closed', () => {
  alert('房間已被關閉');
  hangUp();
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
  alert(error.message || '發生錯誤');
});

socket.on('kicked', (data) => {
  console.log('Kicked from room:', data);
  displaySystemMessage(`您被踢出房間：${data.reason || '未提供原因'}`, 'error');
  setTimeout(() => {
    hangUp();
  }, 2000);
});

socket.on('banned', (data) => {
  console.log('Banned from room:', data);
  const message = data.expiresAt
    ? `您已被封鎖，解封時間：${new Date(data.expiresAt).toLocaleString('zh-TW')}`
    : `您已被永久封鎖`;
  displaySystemMessage(`${message}\n原因：${data.reason || '未提供原因'}`, 'error');
  setTimeout(() => {
    hangUp();
  }, 3000);
});

// WebRTC Functions
/**
 * Create a new peer connection with another user
 * @param {string} peerId - ID of the peer to connect to
 * @param {boolean} isInitiator - Whether this peer initiates the connection
 * @returns {Promise<void>}
 */
async function createPeerConnection(peerId, isInitiator) {
  console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);

  if (peerConnections[peerId]) {
    console.log('Peer connection already exists for', peerId);
    return;
  }

  const pc = new RTCPeerConnection(configuration);
  peerConnections[peerId] = pc;

  registerPeerConnectionListeners(pc, peerId);

  // Add local stream tracks
  const localStream = document.querySelector('#localVideo').srcObject;
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Handle incoming tracks
  pc.addEventListener('track', event => {
    console.log('Got remote track from:', peerId);
    handleRemoteTrack(peerId, event.streams[0]);
  });

  // Handle ICE candidates
  pc.addEventListener('icecandidate', event => {
    if (event.candidate) {
      console.log('Sending ICE candidate to', peerId);
      socket.emit('send-ice-candidate', {
        roomId,
        toUser: peerId,
        candidate: event.candidate.toJSON()
      });
    }
  });

  // Initialize retry count for this peer
  if (!peerRetryCount[peerId]) {
    peerRetryCount[peerId] = 0;
  }

  // Handle connection state changes with auto-retry (max 3 attempts)
  pc.addEventListener('connectionstatechange', async () => {
    console.log(`Connection state with ${peerId}: ${pc.connectionState}`);

    if (pc.connectionState === 'connected') {
      users[peerId] = true;
      peerRetryCount[peerId] = 0; // Reset retry count on success
      displaySystemMessage(`✅ ${peerId} 已連結`, 'success');

      // Remove any retry button if exists
      removeRetryButton(peerId);

    } else if (pc.connectionState === 'connecting') {
      displaySystemMessage(`🔄 正在連接到 ${peerId}...`, 'info');

    } else if (pc.connectionState === 'failed') {
      const retryCount = peerRetryCount[peerId];

      if (retryCount < 3) {
        // Auto retry (up to 3 times)
        peerRetryCount[peerId]++;
        const attempt = peerRetryCount[peerId];
        displaySystemMessage(`❌ ${peerId} 連線失敗（嘗試 ${attempt}/3）`, 'error');

        setTimeout(async () => {
          console.log(`Retrying connection with ${peerId}... (attempt ${attempt}/3)`);
          await retryPeerConnection(peerId, isInitiator);
        }, 2000);
      } else {
        // Max retries reached - show manual retry button
        displaySystemMessage(`❌ ${peerId} 連線失敗（已達最大重試次數）`, 'error');
        displayRetryButton(peerId, isInitiator);
      }

    } else if (pc.connectionState === 'closed') {
      handlePeerDisconnect(peerId);
      displaySystemMessage(`${peerId} 已離開`, 'info');

    } else if (pc.connectionState === 'disconnected') {
      displaySystemMessage(`⚠️ ${peerId} 連線中斷`, 'warning');
    }
  });

  // Handle ICE connection state
  pc.addEventListener('iceconnectionstatechange', async () => {
    if (pc.iceConnectionState === 'failed') {
      console.log('ICE connection failed, restarting...');
      displaySystemMessage(`🔄 正在重新連接 ${peerId}...`, 'info');
      if (pc.restartIce) {
        pc.restartIce();
      } else if (isInitiator) {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        socket.emit('send-offer', {
          roomId,
          toUser: peerId,
          offer: offer
        });
      }
    }
  });

  // If we're the initiator, create and send offer
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('send-offer', {
      roomId,
      toUser: peerId,
      offer: offer
    });
    console.log('Sent offer to', peerId);
  }
}

/**
 * Handle incoming remote audio track from peer
 * @param {string} peerId - ID of the peer
 * @param {MediaStream} stream - Remote media stream
 * @returns {void}
 */
function handleRemoteTrack(peerId, stream) {
  // Check if video element already exists
  let videoElement = document.getElementById(peerId);

  if (!videoElement) {
    numberOfConnectedPeers += 1;

    // Create video box container
    const peerNode = document.createElement('div');
    peerNode.className = 'video-box';
    peerNode.id = `video-box-${peerId}`;

    // Add avatar background
    addAvatarToVideoBox(peerNode, peerId);

    // Create video element
    const videoEl = document.createElement('video');
    videoEl.id = peerId;
    videoEl.autoplay = true;
    videoEl.playsinline = true;
    videoEl.muted = false;

    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = peerId;

    peerNode.appendChild(videoEl);
    peerNode.appendChild(label);
    document.getElementById('videos').appendChild(peerNode);

    videoElement = document.getElementById(peerId);
    mutePeerToggleEnable(peerId);
  }

  videoElement.srcObject = stream;
}

/**
 * Handle peer disconnection and cleanup
 * @param {string} peerId - ID of the disconnected peer
 * @returns {void}
 */
function handlePeerDisconnect(peerId) {
  // Close peer connection
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }

  // Clean up retry count
  delete peerRetryCount[peerId];

  // Remove any retry button
  removeRetryButton(peerId);

  // Remove video element and its container
  const videoElement = document.getElementById(peerId);
  if (videoElement) {
    if (videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
    // Remove the parent video-box container
    const videoBox = videoElement.closest('.video-box');
    if (videoBox) {
      videoBox.remove();
    }

    numberOfConnectedPeers = Math.max(0, numberOfConnectedPeers - 1);
  }

  users[peerId] = false;
  updateUserCount();
}

/**
 * Register event listeners for peer connection state changes
 * @param {RTCPeerConnection} pc - Peer connection instance
 * @param {string} peerId - ID of the peer
 * @returns {void}
 */
function registerPeerConnectionListeners(pc, peerId) {
  pc.addEventListener('icegatheringstatechange', () => {
    console.log(`ICE gathering state (${peerId}): ${pc.iceGatheringState}`);
  });

  pc.addEventListener('connectionstatechange', () => {
    console.log(`Connection state (${peerId}): ${pc.connectionState}`);
  });

  pc.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state (${peerId}): ${pc.signalingState}`);
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    console.log(`ICE connection state (${peerId}): ${pc.iceConnectionState}`);
  });
}

// UI Functions
function muteToggleEnable() {
  document.querySelector('#muteButton').addEventListener('click', () => {
    const localStream = document.getElementById('localVideo').srcObject;
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      if (!muteState) {
        console.log('Muting');
        muteState = true;
        audioTrack.enabled = false;
        document.querySelector('#muteButton span').innerText = 'Unmute';
        document.querySelector('#muteButton i').innerText = 'volume_up';
      } else {
        console.log('Unmuting');
        muteState = false;
        audioTrack.enabled = true;
        document.querySelector('#muteButton span').innerText = 'Mute';
        document.querySelector('#muteButton i').innerText = 'volume_off';
      }
    }
  });
}

function mutePeerToggleEnable(peerId) {
  document.getElementById(peerId).addEventListener('click', () => {
    const videoElement = document.getElementById(peerId);
    const state = videoElement.muted;
    if (!state) {
      console.log('Muting:', peerId);
      videoElement.classList.add('mutedPeers');
    } else {
      console.log('Unmuting:', peerId);
      videoElement.classList.remove('mutedPeers');
    }
    videoElement.muted = !state;
  }, false);
}

function updateRoomUI() {
  document.querySelector('#currentRoom').innerHTML =
    `房間ID: <input type="text" value="${roomId}"> - 你的名子 ${userId}!`;
  document.querySelector('#shareButton').disabled = false;
  document.querySelector('#muteButton').disabled = false;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  // Add avatar to local video box
  const localVideoBox = document.querySelector('#localVideo').closest('.video-box');
  if (localVideoBox && userId && !localVideoBox.querySelector('.avatar-placeholder')) {
    addAvatarToVideoBox(localVideoBox, userId);
  }
}

// Room Management Functions
let createRoomDialog = null;
let joinConfirmDialog = null;
let pendingJoinRoomId = null;

// Show create room dialog
function showCreateRoomDialog() {
  if (!createRoomDialog) {
    createRoomDialog = new mdc.dialog.MDCDialog(document.querySelector('#create-room-dialog'));

    // Update slider value display
    const slider = document.getElementById('create-max-users');
    const display = document.getElementById('max-users-display');
    slider.addEventListener('input', () => {
      display.textContent = `${slider.value} 人`;
    });
  }

  createRoomDialog.open();
}

async function createRoom() {
  showCreateRoomDialog();
}

// Handle create room confirmation
async function handleCreateRoom() {
  const name = document.getElementById('create-room-name').value.trim();
  const password = document.getElementById('create-room-password').value;
  const maxUsers = parseInt(document.getElementById('create-max-users').value);
  const isPrivate = document.getElementById('create-is-private').checked;

  document.querySelector('#createBtn').disabled = true;

  const generatedRoomId = Math.random().toString(36).substring(2, 8);

  try {
    // Create room via REST API with settings
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken // Phase 3: Include CSRF token
      },
      body: JSON.stringify({
        roomId: generatedRoomId,
        name: name || null,
        password: password || null,
        maxUsers,
        isPrivate,
        createdBy: null // Will be set when joining
      })
    });

    const data = await response.json();

    if (response.ok) {
      // Now join the room via WebSocket
      socket.emit('create-room', {
        roomId: data.roomId,
        userId: null // Server will assign user1
      });

      document.querySelector('#shareButton').onclick = () => {
        showShareDialog();
      };

      backgroundRun();
      createRoomDialog?.close();
    } else {
      alert(data.error || '建立房間失敗');
      document.querySelector('#createBtn').disabled = false;
    }
  } catch (error) {
    console.error('Error creating room:', error);
    alert('建立房間失敗，請重試');
    document.querySelector('#createBtn').disabled = false;
  }
}

function joinRoom() {
  document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
    const inputRoomId = document.querySelector('#room-id').value;
    await showJoinConfirmDialog(inputRoomId);
  }, { once: true });
  roomDialog.open();
}

// Show join confirmation dialog with room info
async function showJoinConfirmDialog(rid) {
  try {
    const response = await fetch(`/api/rooms/${rid}`);
    const data = await response.json();

    if (!response.ok) {
      alert(data.error || '房間不存在');
      return;
    }

    pendingJoinRoomId = rid;

    // Update dialog with room info
    document.getElementById('join-room-name').textContent = data.name || '未命名房間';
    document.getElementById('join-user-count').textContent = data.userCount || 0;
    document.getElementById('join-max-users').textContent = data.maxUsers;

    // Show/hide password input
    const passwordGroup = document.getElementById('password-input-group');
    const passwordError = document.getElementById('password-error');
    passwordError.style.display = 'none';

    if (data.hasPassword) {
      passwordGroup.style.display = 'block';
      document.getElementById('join-room-password').value = '';
    } else {
      passwordGroup.style.display = 'none';
    }

    if (!joinConfirmDialog) {
      joinConfirmDialog = new mdc.dialog.MDCDialog(document.querySelector('#join-confirm-dialog'));
    }

    roomDialog?.close();
    joinConfirmDialog.open();
  } catch (error) {
    console.error('Error fetching room info:', error);
    alert('無法連接到伺服器');
  }
}

// Handle join room confirmation
async function handleJoinRoom() {
  const password = document.getElementById('join-room-password').value;
  const passwordError = document.getElementById('password-error');

  try {
    // First check if room has password
    const roomResponse = await fetch(`/api/rooms/${pendingJoinRoomId}`);
    const roomData = await roomResponse.json();

    // Verify password if room has one
    if (roomData.hasPassword) {
      const verifyResponse = await fetch(`/api/rooms/${pendingJoinRoomId}/verify-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken // Phase 3: Include CSRF token
        },
        body: JSON.stringify({ password })
      });

      const verifyData = await verifyResponse.json();

      if (!verifyData.valid) {
        passwordError.style.display = 'block';
        return;
      }
    }

    // Password is valid or not required, join the room
    await joinRoomById(pendingJoinRoomId);
    joinConfirmDialog?.close();
  } catch (error) {
    console.error('Error joining room:', error);
    alert('加入房間失敗，請重試');
  }
}

async function joinRoomById(rid) {
  roomId = rid;

  socket.emit('join-room', {
    roomId: rid,
    userId: null // Server will assign sequential user ID
  });

  document.querySelector('#shareButton').onclick = () => {
    showShareDialog();
  };

  backgroundRun();
}

/**
 * Open user's microphone and create local media stream
 * @returns {Promise<void>}
 */
async function openUserMedia() {
  try {
    // Use the selected audio mode from settings (default: 'native')
    const mode = currentAudioMode || 'native';
    console.log(`🎙️ Opening microphone with mode: ${mode}`);

    const stream = await getMediaStream(mode);

    document.querySelector('#localVideo').srcObject = stream;

    console.log('Stream:', stream);
    document.querySelector('#cameraBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = false;
    document.querySelector('#createBtn').disabled = false;
    document.querySelector('#hangupBtn').disabled = false;

    displaySystemMessage(`✅ 麥克風已開啟（${getModeDisplayName(mode)}）`, 'success');
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('無法訪問麥克風，請檢查權限設置');
  }
}

/**
 * Disconnect from room and cleanup all peer connections
 * @returns {Promise<void>}
 */
async function hangUp() {
  // Stop all tracks
  const localStream = document.querySelector('#localVideo').srcObject;
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
  }

  // Clean up audio processing nodes
  cleanupAudioProcessing();

  // Close all peer connections
  Object.keys(peerConnections).forEach(peerId => {
    peerConnections[peerId].close();
  });
  peerConnections = {};

  // Emit leave-room event
  if (roomId) {
    socket.emit('leave-room');
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  location.reload();
}

// Chat Functions
// HTML 編碼函數 - 防止 XSS
/**
 * HTML encode a string to prevent XSS
 * @param {string} str - String to encode
 * @returns {string} Encoded string
 */
function htmlencode(str) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '/': '&#x2F;'
  };
  return String(str).replace(/[&<>"'/]/g, (char) => map[char]);
}

// HTML 解碼函數
/**
 * HTML decode a string
 * @param {string} str - String to decode
 * @returns {string} Decoded string
 */
function htmldecode(str) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

// 發送消息函數 - 帶完整驗證
/**
 * Send a chat message to the room
 * @returns {void}
 */
function sendMessage() {
  const messageInput = document.querySelector('#newMessage');
  const messageText = messageInput.value.trim();
  
  // 1. 空消息檢查
  if (messageText === '') {
    return;
  }
  
  // 2. 長度驗證
  if (messageText.length > 1000) {
    alert('消息長度不能超過1000字符');
    return;
  }
  
  // 3. 最小長度檢查（可選）
  if (messageText.length < 1) {
    return;
  }
  
  // 4. 檢查是否只包含空白字符
  if (!/\S/.test(messageText)) {
    alert('消息不能只包含空白字符');
    return;
  }
  
  // 5. 檢查房間ID是否存在
  if (!roomId) {
    alert('請先加入房間');
    return;
  }

  // 6. HTML 編碼
  const encodedText = htmlencode(messageText);

  // 7. 加密訊息（防止簡單封包監聽）
  const encryptedText = encryptMessage(encodedText);

  // 8. 發送加密訊息
  socket.emit('send-message', {
    roomId,
    text: encryptedText
  });

  // 9. 清空輸入框
  messageInput.value = '';

  // 10. 重新聚焦到輸入框
  messageInput.focus();
}

// 接收並顯示消息
socket.on('receive-message', (data) => {
  const { senderId, text, timestamp } = data;

  // 1. 解密訊息
  const decryptedText = decryptMessage(text);

  // 2. 解碼 HTML
  const decodedText = htmldecode(decryptedText);

  // 3. 再次編碼以確保安全（縱深防禦）
  const safeText = htmlencode(decodedText);
  
  // 顯示消息
  displayMessage(senderId, safeText, timestamp);
});

// 顯示消息到聊天界面
/**
 * Display a chat message in the UI
 * @param {string} senderId - ID of the message sender
 * @param {string} text - Message text (encrypted)
 * @param {Date|string} timestamp - Message timestamp
 * @returns {void}
 */
function displayMessage(senderId, text, timestamp) {
  const messageList = document.querySelector('#messages');
  if (!messageList) return;

  const messageItem = document.createElement('div');
  messageItem.className = 'message-item';

  const time = new Date(timestamp).toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit'
  });

  // 使用 textContent 而不是 innerHTML 來防止 XSS
  const senderSpan = document.createElement('span');
  senderSpan.className = 'message-sender';
  senderSpan.textContent = `${senderId}:`;

  const textSpan = document.createElement('span');
  textSpan.className = 'message-text';
  textSpan.textContent = text; // 使用 textContent 自動轉義

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = time;

  messageItem.appendChild(senderSpan);
  messageItem.appendChild(textSpan);
  messageItem.appendChild(timeSpan);

  messageList.appendChild(messageItem);

  // 自動滾動到最新消息
  messageList.scrollTop = messageList.scrollHeight;

  // Increment unread messages if chat is closed on mobile
  if (senderId !== userId) {
    incrementUnreadMessages();
  }
}

// 顯示系統訊息（連線狀態等）
/**
 * Display a system message in the UI
 * @param {string} text - Message text
 * @param {'info'|'error'|'success'} type - Message type
 * @returns {void}
 */
function displaySystemMessage(text, type = 'info') {
  const messageList = document.querySelector('#messages');
  if (!messageList) return;

  const messageItem = document.createElement('div');
  messageItem.className = `message-item system-message ${type}`;

  const textSpan = document.createElement('span');
  textSpan.className = 'message-text';
  textSpan.textContent = text;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  const time = new Date().toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit'
  });
  timeSpan.textContent = time;

  messageItem.appendChild(textSpan);
  messageItem.appendChild(timeSpan);

  messageList.appendChild(messageItem);

  // 自動滾動到最新消息
  messageList.scrollTop = messageList.scrollHeight;
}

// Retry peer connection
async function retryPeerConnection(peerId, isInitiator) {
  console.log(`Retrying connection with ${peerId}...`);

  try {
    const pc = peerConnections[peerId];
    if (!pc) {
      console.error(`No peer connection found for ${peerId}`);
      return;
    }

    // Try ICE restart
    if (pc.restartIce) {
      pc.restartIce();
    } else if (isInitiator) {
      // Manually restart ICE by creating new offer
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      socket.emit('send-offer', {
        roomId,
        toUser: peerId,
        offer: offer
      });
    }
  } catch (error) {
    console.error(`Failed to retry connection with ${peerId}:`, error);
  }
}

// Display manual retry button in chat
function displayRetryButton(peerId, isInitiator) {
  const messageList = document.querySelector('#messages');
  if (!messageList) return;

  // Check if retry button already exists
  const existingButton = document.querySelector(`#retry-${peerId}`);
  if (existingButton) return;

  const messageItem = document.createElement('div');
  messageItem.className = 'message-item system-message error';
  messageItem.id = `retry-container-${peerId}`;

  const textSpan = document.createElement('span');
  textSpan.className = 'message-text';
  textSpan.textContent = `${peerId} 連線失敗`;

  const retryButton = document.createElement('button');
  retryButton.id = `retry-${peerId}`;
  retryButton.className = 'retry-button';
  retryButton.textContent = '重試連線';
  retryButton.style.marginLeft = '10px';
  retryButton.style.padding = '5px 10px';
  retryButton.style.backgroundColor = '#3b82f6';
  retryButton.style.color = 'white';
  retryButton.style.border = 'none';
  retryButton.style.borderRadius = '4px';
  retryButton.style.cursor = 'pointer';

  retryButton.addEventListener('click', async () => {
    // Reset retry count and try again
    peerRetryCount[peerId] = 0;
    retryButton.disabled = true;
    retryButton.textContent = '重試中...';

    await retryPeerConnection(peerId, isInitiator);

    // Remove button after clicking
    setTimeout(() => {
      removeRetryButton(peerId);
    }, 1000);
  });

  messageItem.appendChild(textSpan);
  messageItem.appendChild(retryButton);
  messageList.appendChild(messageItem);

  // Auto scroll to latest message
  messageList.scrollTop = messageList.scrollHeight;
}

// Remove retry button from chat
function removeRetryButton(peerId) {
  const retryContainer = document.querySelector(`#retry-container-${peerId}`);
  if (retryContainer) {
    retryContainer.remove();
  }
}

// 添加實時字符計數器（提升用戶體驗）
function setupMessageInput() {
  const messageInput = document.querySelector('#newMessage');
  const charCounter = document.querySelector('#charCounter');
  
  if (messageInput && charCounter) {
    messageInput.addEventListener('input', () => {
      const length = messageInput.value.length;
      charCounter.textContent = `${length}/1000`;
      
      // 超過限制時改變顏色
      if (length > 1000) {
        charCounter.style.color = 'red';
      } else if (length > 900) {
        charCounter.style.color = 'orange';
      } else {
        charCounter.style.color = '#666';
      }
    });
  }
}

// 支持 Enter 鍵發送消息
function setupMessageKeyboard() {
  const messageInput = document.querySelector('#newMessage');
  
  if (messageInput) {
    messageInput.addEventListener('keypress', (e) => {
      // Enter 發送，Shift+Enter 換行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
}

// 初始化消息功能
function initializeMessageSystem() {
  setupMessageInput();
  setupMessageKeyboard();
  
  // 綁定發送按鈕
  const sendButton = document.querySelector('#sendButton');
  if (sendButton) {
    sendButton.addEventListener('click', sendMessage);
  }
}

// Session initialization for user identification
async function initializeSession() {
  try {
    // Check if we have a stored session ID
    const storedSessionId = localStorage.getItem('webrtc_session_id');

    // Fetch current session info from server
    const response = await fetch('/api/session');
    const data = await response.json();

    sessionId = data.sessionId;

    // Store session ID in localStorage for persistence
    if (sessionId) {
      localStorage.setItem('webrtc_session_id', sessionId);
      console.log('✅ Session initialized:', sessionId);
    }

    // If we had a different session before, it means the server restarted or session expired
    if (storedSessionId && storedSessionId !== sessionId) {
      console.log('⚠️ Session changed - clearing room state');
      // Clear any stale room state
      roomId = null;
      userId = null;
    }
  } catch (error) {
    console.error('❌ Failed to initialize session:', error);
  }
}

// CSRF token initialization (Phase 3)
async function initializeCsrfToken() {
  try {
    const response = await fetch('/api/csrf-token');
    const data = await response.json();

    csrfToken = data.csrfToken;

    if (csrfToken) {
      console.log('✅ CSRF token initialized');
    }
  } catch (error) {
    console.error('❌ Failed to initialize CSRF token:', error);
  }
}

// 在頁面加載時初始化
document.addEventListener('DOMContentLoaded', async () => {
  await initializeSession();
  await initializeCsrfToken(); // Phase 3: Get CSRF token
  initializeMessageSystem();
});

function scrollToBottom() {
  const messagesContainer = document.querySelector('#messages');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Utility Functions
function updateUserCount() {
  const onlineCount = Object.values(users).filter(status => status === true).length;
  const userCountEl = document.getElementById('userCount');
  if (userCountEl) {
    userCountEl.textContent = onlineCount;
  }
}

function backgroundRun() {
  const ousers = document.querySelector('#online-users');
  if (ousers !== null) {
    setInterval(() => {
      ousers.innerHTML = '';
      for (let key in users) {
        if (users[key] === true) {
          const htmlliElement = document.createElement('li');
          htmlliElement.innerText = key;
          ousers.appendChild(htmlliElement);
        }
      }
      updateUserCount();
    }, 3000);
  }
}

// Share Dialog Functions
let shareDialog = null;

function showShareDialog() {
  if (!roomId) {
    alert('尚未加入房間');
    return;
  }

  const shareUrl = `${window.location.href.split('?')[0]}?roomId=${roomId}`;
  const shareLinkInput = document.querySelector('#share-link-input');
  shareLinkInput.value = shareUrl;

  if (!shareDialog) {
    shareDialog = new mdc.dialog.MDCDialog(document.querySelector('#share-dialog'));
  }

  shareDialog.open();
}

// ===== Message Encryption Functions =====
// Simple shift cipher encryption for WebSocket messages
// Format: "shift:encrypted_text"
function encryptMessage(text) {
  if (!text || text.length === 0) return text;

  // Random shift between 1-9 (single digit for simplicity)
  const shift = Math.floor(Math.random() * 9) + 1;

  // Apply shift cipher to each character
  const encrypted = text.split('').map(char => {
    const code = char.charCodeAt(0);
    return String.fromCharCode(code + shift);
  }).join('');

  // Return format: "shift:encrypted_text"
  return `${shift}:${encrypted}`;
}

function decryptMessage(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') return encryptedData;

  // Check if message is encrypted (contains shift prefix)
  if (!encryptedData.includes(':')) {
    return encryptedData; // Not encrypted, return as-is
  }

  const parts = encryptedData.split(':', 2);
  if (parts.length !== 2) {
    return encryptedData; // Invalid format
  }

  const shift = parseInt(parts[0]);
  const encrypted = parts[1];

  // Validate shift value
  if (isNaN(shift) || shift < 1 || shift > 9) {
    return encryptedData; // Invalid shift
  }

  // Decrypt by reversing the shift
  const decrypted = encrypted.split('').map(char => {
    const code = char.charCodeAt(0);
    return String.fromCharCode(code - shift);
  }).join('');

  return decrypted;
}

// Check if mobile device
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Check if iOS device
function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Check if Android device
function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

// Generate consistent avatar URL based on userId
function getAvatarUrl(userId) {
  // Use local avatar images (10 SVG files in /avatars folder)
  const totalAvatars = 10;
  const avatarIndex = (Math.abs(hashCode(userId)) % totalAvatars) + 1;

  return `/avatars/avatar${avatarIndex}.svg`;
}

// Simple hash function for consistent avatar selection
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// Add avatar to video box
function addAvatarToVideoBox(videoBox, userId) {
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'avatar-placeholder';
  avatarDiv.style.backgroundImage = `url('${getAvatarUrl(userId)}')`;
  videoBox.insertBefore(avatarDiv, videoBox.firstChild);
}

// Native share function for mobile
async function shareViaWebAPI() {
  const shareUrl = document.querySelector('#share-link-input').value;

  // Check if Web Share API is supported
  if (!navigator.share) {
    return false;
  }

  try {
    await navigator.share({
      title: '加入語音聊天室',
      text: '一起來語音聊天吧！',
      url: shareUrl
    });
    console.log('✅ Shared successfully');

    // Close share dialog on successful share
    if (shareDialog) {
      shareDialog.close();
    }

    return true;
  } catch (err) {
    // User cancelled the share (AbortError) - this is normal
    if (err.name === 'AbortError') {
      console.log('ℹ️ Share cancelled by user');
      return false;
    }

    // Other errors - log and return false to try fallback
    console.error('❌ Share failed:', err.name, err.message);
    return false;
  }
}

function setupShareDialog() {
  // Copy link button
  document.querySelector('#copy-link-btn').addEventListener('click', async () => {
    const shareLinkInput = document.querySelector('#share-link-input');
    const copyBtn = document.querySelector('#copy-link-btn');

    try {
      await navigator.clipboard.writeText(shareLinkInput.value);

      // Visual feedback
      const originalHTML = copyBtn.innerHTML;
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = '<i class="material-icons">check</i><span>已複製！</span>';

      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = originalHTML;
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      shareLinkInput.select();
      document.execCommand('copy');
      alert('連結已複製！');
    }
  });

  // WhatsApp share
  document.querySelector('#share-whatsapp').addEventListener('click', async () => {
    // Try native share on mobile first
    if (isMobile() && await shareViaWebAPI()) {
      return;
    }

    const shareUrl = document.querySelector('#share-link-input').value;
    const message = `加入我的語音聊天室！\n${shareUrl}`;

    // Use wa.me API (works on all platforms)
    // This is more reliable than whatsapp:// protocol
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;

    try {
      // For mobile: use location.href for better app detection
      if (isMobile()) {
        window.location.href = whatsappUrl;
      } else {
        // For desktop: open in new window
        const popup = window.open(whatsappUrl, '_blank', 'width=600,height=700');
        if (!popup) {
          alert('請允許彈出式視窗以分享到 WhatsApp');
        }
      }
    } catch (err) {
      console.error('❌ WhatsApp share failed:', err);
      alert('無法開啟 WhatsApp，請確保已安裝 WhatsApp 應用程式');
    }
  });

  // LINE share
  document.querySelector('#share-line').addEventListener('click', async () => {
    // Try native share on mobile first
    if (isMobile() && await shareViaWebAPI()) {
      return;
    }

    const shareUrl = document.querySelector('#share-link-input').value;
    const message = `加入我的語音聊天室！\n${shareUrl}`;

    // Use LINE share URL
    const lineUrl = isMobile()
      ? `https://line.me/R/msg/text/?${encodeURIComponent(message)}`
      : `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`;

    try {
      if (isMobile()) {
        window.location.href = lineUrl;
      } else {
        const popup = window.open(lineUrl, '_blank', 'width=600,height=700');
        if (!popup) {
          alert('請允許彈出式視窗以分享到 LINE');
        }
      }
    } catch (err) {
      console.error('❌ LINE share failed:', err);
      alert('無法開啟 LINE，請確保已安裝 LINE 應用程式');
    }
  });

  // Telegram share
  document.querySelector('#share-telegram').addEventListener('click', async () => {
    // Try native share on mobile first
    if (isMobile() && await shareViaWebAPI()) {
      return;
    }

    const shareUrl = document.querySelector('#share-link-input').value;
    const message = `加入我的語音聊天室！\n${shareUrl}`;

    // Use Telegram share URL
    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('加入我的語音聊天室！')}`;

    try {
      if (isMobile()) {
        // On mobile, try tg:// protocol first, fallback to https://
        window.location.href = `tg://msg?text=${encodeURIComponent(message)}`;

        // Fallback to web version after a short delay if app doesn't open
        setTimeout(() => {
          if (document.hasFocus()) {
            window.location.href = telegramUrl;
          }
        }, 1500);
      } else {
        const popup = window.open(telegramUrl, '_blank', 'width=600,height=700');
        if (!popup) {
          alert('請允許彈出式視窗以分享到 Telegram');
        }
      }
    } catch (err) {
      console.error('❌ Telegram share failed:', err);
      alert('無法開啟 Telegram，請確保已安裝 Telegram 應用程式');
    }
  });
}

// ===== Room Lobby Functions =====
let lobbyDialog = null;

function setupLobbyDialog() {
  lobbyDialog = new mdc.dialog.MDCDialog(document.querySelector('#lobby-dialog'));

  // Refresh button
  const refreshBtn = document.getElementById('refresh-lobby-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadLobbyRooms();
    });
  }

  // Create new room button (from lobby)
  const createNewRoomBtn = document.getElementById('create-new-room-btn');
  if (createNewRoomBtn) {
    createNewRoomBtn.addEventListener('click', () => {
      lobbyDialog.close();
      createRoom(); // Open create room dialog
    });
  }

  // Create room from empty state
  const createFromLobbyBtn = document.getElementById('create-room-from-lobby');
  if (createFromLobbyBtn) {
    createFromLobbyBtn.addEventListener('click', () => {
      lobbyDialog.close();
      createRoom();
    });
  }
}

function openLobby() {
  lobbyDialog.open();
  loadLobbyRooms();
}

async function loadLobbyRooms() {
  const loadingDiv = document.getElementById('lobby-loading');
  const emptyDiv = document.getElementById('lobby-empty');
  const roomListDiv = document.getElementById('lobby-room-list');

  // Show loading
  loadingDiv.style.display = 'flex';
  emptyDiv.style.display = 'none';
  roomListDiv.style.display = 'none';

  try {
    const response = await fetch('/api/rooms/lobby/list');
    const data = await response.json();

    // Hide loading
    loadingDiv.style.display = 'none';

    if (!data.rooms || data.rooms.length === 0) {
      // Show empty state
      emptyDiv.style.display = 'flex';
    } else {
      // Show room list
      roomListDiv.style.display = 'flex';
      displayLobbyRooms(data.rooms);
    }
  } catch (error) {
    console.error('Failed to load lobby rooms:', error);
    loadingDiv.style.display = 'none';
    emptyDiv.style.display = 'flex';
    emptyDiv.querySelector('p').textContent = '載入失敗，請重試';
  }
}

function displayLobbyRooms(rooms) {
  const roomListDiv = document.getElementById('lobby-room-list');
  roomListDiv.innerHTML = '';

  rooms.forEach(room => {
    const roomCard = createLobbyRoomCard(room);
    roomListDiv.appendChild(roomCard);
  });
}

function createLobbyRoomCard(room) {
  const card = document.createElement('div');
  card.className = 'lobby-room-card';

  const isFull = room.currentUsers >= room.maxUsers;
  if (isFull) {
    card.classList.add('lobby-room-full');
  }

  // Header
  const header = document.createElement('div');
  header.className = 'lobby-room-card-header';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'lobby-room-name';
  nameDiv.innerHTML = `
    <i class="material-icons">meeting_room</i>
    <span>${room.name || room.roomId}</span>
  `;

  header.appendChild(nameDiv);

  // Password badge
  if (room.hasPassword) {
    const badge = document.createElement('div');
    badge.className = 'lobby-room-badge';
    badge.innerHTML = `
      <i class="material-icons">lock</i>
      <span>需要密碼</span>
    `;
    header.appendChild(badge);
  }

  card.appendChild(header);

  // Info
  const info = document.createElement('div');
  info.className = 'lobby-room-info';

  // User count
  const userCountItem = document.createElement('div');
  userCountItem.className = 'lobby-room-info-item';
  userCountItem.innerHTML = `
    <i class="material-icons">people</i>
    <span>${room.currentUsers}/${room.maxUsers} 人</span>
  `;
  info.appendChild(userCountItem);

  // Created time
  const createdAt = new Date(room.createdAt);
  const timeAgo = getTimeAgo(createdAt);
  const timeItem = document.createElement('div');
  timeItem.className = 'lobby-room-info-item';
  timeItem.innerHTML = `
    <i class="material-icons">schedule</i>
    <span>${timeAgo}</span>
  `;
  info.appendChild(timeItem);

  card.appendChild(info);

  // Click handler
  if (!isFull) {
    card.addEventListener('click', () => {
      joinLobbyRoom(room);
    });
  }

  return card;
}

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return '剛剛建立';
  if (diffMins < 60) return `${diffMins} 分鐘前`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} 小時前`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}

async function joinLobbyRoom(room) {
  lobbyDialog.close();

  // First, make sure we have media access
  if (!document.querySelector('#localVideo').srcObject) {
    try {
      await openUserMedia();
    } catch (error) {
      console.error('Failed to open media:', error);
      alert('無法開啟麥克風，請檢查權限設定');
      return;
    }
  }

  // If room has password, show password dialog
  if (room.hasPassword) {
    // Set room ID and show join dialog with password
    document.querySelector('#room-id').value = room.roomId;
    document.querySelector('#tab-join').click(); // Switch to join tab
    roomDialog.open();
  } else {
    // Join directly
    joinRoomById(room.roomId);
  }
}

// Initialization
function init() {
  const params = new URLSearchParams(location.search);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

  // Setup share dialog
  setupShareDialog();

  // Setup lobby dialog
  setupLobbyDialog();

  // Setup audio settings dialog
  initializeAudioSettingsDialog();

  // Setup create room dialog button
  const confirmCreateBtn = document.getElementById('confirmCreateBtn');
  if (confirmCreateBtn) {
    confirmCreateBtn.addEventListener('click', handleCreateRoom);
  }

  // Setup join confirm dialog button
  const confirmJoinRoomBtn = document.getElementById('confirmJoinRoomBtn');
  if (confirmJoinRoomBtn) {
    confirmJoinRoomBtn.addEventListener('click', handleJoinRoom);
  }

  if (params.get('roomId')) {
    console.log('Auto-joining room from URL');
    const urlRoomId = params.get('roomId');
    document.querySelector('#room-id').value = urlRoomId;

    // Auto-join: first open media, then join room automatically
    openUserMedia().then(() => {
      // Wait a bit for media to initialize
      setTimeout(() => {
        joinRoomById(urlRoomId);
      }, 500);
    });
  }

  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#lobbyBtn').addEventListener('click', openLobby);

  // Handle page unload
  const iOS = ['iPad', 'iPhone', 'iPod'].indexOf(navigator.platform) >= 0;
  const eventName = iOS ? 'pagehide' : 'beforeunload';

  window.addEventListener(eventName, function (event) {
    if (roomId) {
      socket.emit('leave-room');
    }
  });

  muteToggleEnable();

  // Initialize mobile chat controls
  initializeMobileChatControls();
}

// ===== Mobile Chat Sidebar Controls =====
function initializeMobileChatControls() {
  // Only initialize on mobile devices
  if (!isMobile()) {
    // Hide mobile-only elements on desktop
    const mobileToggle = document.querySelector('#mobile-chat-toggle');
    const overlay = document.querySelector('#mobile-chat-overlay');
    const closeBtn = document.querySelector('#sidebar-close-btn');

    if (mobileToggle) mobileToggle.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    return;
  }

  const rightPanel = document.querySelector('.right-panel');
  const mobileToggle = document.querySelector('#mobile-chat-toggle');
  const overlay = document.querySelector('#mobile-chat-overlay');
  const closeBtn = document.querySelector('#sidebar-close-btn');
  const unreadBadge = document.querySelector('#unread-badge');

  if (!rightPanel || !mobileToggle || !overlay || !closeBtn) {
    console.error('Mobile chat elements not found');
    return;
  }

  // Open chat sidebar
  function openMobileChatSidebar() {
    rightPanel.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent body scrolling

    // Reset unread count
    resetUnreadMessages();
  }

  // Close chat sidebar
  function closeMobileChatSidebar() {
    rightPanel.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = ''; // Restore body scrolling
  }

  // Toggle button click
  mobileToggle.addEventListener('click', () => {
    if (rightPanel.classList.contains('open')) {
      closeMobileChatSidebar();
    } else {
      openMobileChatSidebar();
    }
  });

  // Close button click
  closeBtn.addEventListener('click', () => {
    closeMobileChatSidebar();
  });

  // Overlay click (backdrop)
  overlay.addEventListener('click', () => {
    closeMobileChatSidebar();
  });

  console.log('✅ Mobile chat controls initialized');
}

// Unread message counter for mobile
let unreadCount = 0;

function incrementUnreadMessages() {
  // Only increment on mobile when chat is closed
  if (!isMobile()) return;

  const rightPanel = document.querySelector('.right-panel');
  const unreadBadge = document.querySelector('#unread-badge');

  if (!rightPanel || !unreadBadge) return;

  // Only count unread messages when sidebar is closed
  if (!rightPanel.classList.contains('open')) {
    unreadCount++;
    unreadBadge.textContent = unreadCount;
    unreadBadge.style.display = 'block';
  }
}

function resetUnreadMessages() {
  const unreadBadge = document.querySelector('#unread-badge');
  if (!unreadBadge) return;

  unreadCount = 0;
  unreadBadge.textContent = '0';
  unreadBadge.style.display = 'none';
}

// ==================== Audio Settings System ====================

/**
 * Initialize Audio Settings Dialog
 */
function initializeAudioSettingsDialog() {
  const audioSettingsBtn = document.getElementById('audioSettingsBtn');
  const dialogElement = document.getElementById('audio-settings-dialog');

  if (!audioSettingsBtn || !dialogElement) {
    console.warn('⚠️ Audio settings elements not found');
    return;
  }

  // Initialize MDC Dialog
  audioSettingsDialog = new mdc.dialog.MDCDialog(dialogElement);

  // Load saved settings from localStorage
  loadAudioSettings();

  // Open dialog button
  audioSettingsBtn.addEventListener('click', () => {
    if (audioSettingsDialog) {
      audioSettingsDialog.open();
    }
  });

  // Setup radio button change handlers
  setupAudioModeListeners();

  // Setup slider and toggle listeners
  setupAdvancedSettingsListeners();

  // Apply settings button
  const applyBtn = document.getElementById('applyAudioSettingsBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      await applyAudioSettings();
      saveAudioSettings();
      audioSettingsDialog.close();
    });
  }

  // Reset settings button
  const resetBtn = document.getElementById('resetAudioSettingsBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetAudioSettings();
    });
  }

  // Setup audio visualizer events
  setupAudioVisualizerEvents();

  console.log('✅ Audio settings dialog initialized');
}

/**
 * Setup audio mode radio button listeners
 */
function setupAudioModeListeners() {
  const radioButtons = document.querySelectorAll('input[name="echo-mode"]');

  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const selectedMode = e.target.value;
      updateAdvancedSettingsVisibility(selectedMode);
      updateStatusText(selectedMode);
    });
  });
}

/**
 * Update advanced settings visibility based on selected mode
 */
function updateAdvancedSettingsVisibility(mode) {
  const advancedSection = document.getElementById('advanced-audio-settings');
  const inputGainSetting = document.getElementById('input-gain-setting');
  const sampleRateSetting = document.getElementById('sample-rate-setting');
  const aiStrengthSetting = document.getElementById('ai-strength-setting');

  if (!advancedSection) return;

  // Hide all mode-specific settings first
  if (inputGainSetting) inputGainSetting.style.display = 'none';
  if (sampleRateSetting) sampleRateSetting.style.display = 'none';
  if (aiStrengthSetting) aiStrengthSetting.style.display = 'none';

  // Show advanced section for non-native modes
  if (mode === 'native') {
    advancedSection.style.display = 'none';
  } else {
    advancedSection.style.display = 'block';

    // Show mode-specific settings
    if (mode === 'webaudio' && inputGainSetting) {
      inputGainSetting.style.display = 'flex';
    } else if (mode === 'advanced' && sampleRateSetting) {
      sampleRateSetting.style.display = 'flex';
    } else if (mode === 'ai' && aiStrengthSetting) {
      aiStrengthSetting.style.display = 'flex';
    }
  }
}

/**
 * Update status text based on selected mode
 */
function updateStatusText(mode) {
  const statusText = document.getElementById('audio-status-text');
  const performanceText = document.getElementById('audio-performance-text');

  if (!statusText || !performanceText) return;

  const modeInfo = {
    native: {
      name: '瀏覽器原生 AEC',
      performance: '極低'
    },
    webaudio: {
      name: 'Web Audio API 增強',
      performance: '低'
    },
    advanced: {
      name: 'WebRTC 高級調優',
      performance: '極低'
    },
    ai: {
      name: 'AI 降噪 (RNNoise)',
      performance: '中等'
    }
  };

  const info = modeInfo[mode] || modeInfo.native;
  statusText.textContent = `當前方案：${info.name}`;
  performanceText.textContent = `性能影響：${info.performance}`;
}

/**
 * Setup advanced settings sliders and toggles
 */
function setupAdvancedSettingsListeners() {
  // Input gain slider
  const inputGainSlider = document.getElementById('input-gain-slider');
  const inputGainValue = document.getElementById('input-gain-value');
  if (inputGainSlider && inputGainValue) {
    inputGainSlider.addEventListener('input', (e) => {
      inputGainValue.textContent = e.target.value + '%';
    });
  }

  // AI strength slider
  const aiStrengthSlider = document.getElementById('ai-strength-slider');
  const aiStrengthValue = document.getElementById('ai-strength-value');
  if (aiStrengthSlider && aiStrengthValue) {
    aiStrengthSlider.addEventListener('input', (e) => {
      aiStrengthValue.textContent = e.target.value + '%';
    });
  }
}

/**
 * Save audio settings to localStorage
 */
function saveAudioSettings() {
  const settings = {
    mode: document.querySelector('input[name="echo-mode"]:checked')?.value || 'native',
    echoCancellation: document.getElementById('echo-cancellation-toggle')?.checked ?? true,
    noiseSuppression: document.getElementById('noise-suppression-toggle')?.checked ?? true,
    autoGainControl: document.getElementById('auto-gain-toggle')?.checked ?? true,
    inputGain: parseInt(document.getElementById('input-gain-slider')?.value || 100),
    sampleRate: parseInt(document.getElementById('sample-rate-select')?.value || 48000),
    aiStrength: parseInt(document.getElementById('ai-strength-slider')?.value || 70)
  };

  localStorage.setItem('audioSettings', JSON.stringify(settings));
  console.log('✅ Audio settings saved:', settings);
}

/**
 * Load audio settings from localStorage
 */
function loadAudioSettings() {
  const savedSettings = localStorage.getItem('audioSettings');

  if (!savedSettings) {
    console.log('ℹ️ No saved audio settings found, using defaults');
    return;
  }

  try {
    const settings = JSON.parse(savedSettings);

    // Set mode radio button
    const modeRadio = document.querySelector(`input[name="echo-mode"][value="${settings.mode}"]`);
    if (modeRadio) {
      modeRadio.checked = true;
      updateAdvancedSettingsVisibility(settings.mode);
      updateStatusText(settings.mode);
    }

    // Set toggles
    const echoCancellationToggle = document.getElementById('echo-cancellation-toggle');
    if (echoCancellationToggle) echoCancellationToggle.checked = settings.echoCancellation;

    const noiseSuppressionToggle = document.getElementById('noise-suppression-toggle');
    if (noiseSuppressionToggle) noiseSuppressionToggle.checked = settings.noiseSuppression;

    const autoGainToggle = document.getElementById('auto-gain-toggle');
    if (autoGainToggle) autoGainToggle.checked = settings.autoGainControl;

    // Set sliders
    const inputGainSlider = document.getElementById('input-gain-slider');
    const inputGainValue = document.getElementById('input-gain-value');
    if (inputGainSlider && inputGainValue) {
      inputGainSlider.value = settings.inputGain;
      inputGainValue.textContent = settings.inputGain + '%';
    }

    const sampleRateSelect = document.getElementById('sample-rate-select');
    if (sampleRateSelect) sampleRateSelect.value = settings.sampleRate;

    const aiStrengthSlider = document.getElementById('ai-strength-slider');
    const aiStrengthValue = document.getElementById('ai-strength-value');
    if (aiStrengthSlider && aiStrengthValue) {
      aiStrengthSlider.value = settings.aiStrength;
      aiStrengthValue.textContent = settings.aiStrength + '%';
    }

    currentAudioMode = settings.mode;
    console.log('✅ Audio settings loaded:', settings);
  } catch (error) {
    console.error('❌ Error loading audio settings:', error);
  }
}

/**
 * Reset audio settings to defaults
 */
function resetAudioSettings() {
  // Reset to native mode
  const nativeRadio = document.querySelector('input[name="echo-mode"][value="native"]');
  if (nativeRadio) {
    nativeRadio.checked = true;
    updateAdvancedSettingsVisibility('native');
    updateStatusText('native');
  }

  // Reset toggles to true
  const echoCancellationToggle = document.getElementById('echo-cancellation-toggle');
  if (echoCancellationToggle) echoCancellationToggle.checked = true;

  const noiseSuppressionToggle = document.getElementById('noise-suppression-toggle');
  if (noiseSuppressionToggle) noiseSuppressionToggle.checked = true;

  const autoGainToggle = document.getElementById('auto-gain-toggle');
  if (autoGainToggle) autoGainToggle.checked = true;

  // Reset sliders
  const inputGainSlider = document.getElementById('input-gain-slider');
  const inputGainValue = document.getElementById('input-gain-value');
  if (inputGainSlider && inputGainValue) {
    inputGainSlider.value = 100;
    inputGainValue.textContent = '100%';
  }

  const sampleRateSelect = document.getElementById('sample-rate-select');
  if (sampleRateSelect) sampleRateSelect.value = '48000';

  const aiStrengthSlider = document.getElementById('ai-strength-slider');
  const aiStrengthValue = document.getElementById('ai-strength-value');
  if (aiStrengthSlider && aiStrengthValue) {
    aiStrengthSlider.value = 70;
    aiStrengthValue.textContent = '70%';
  }

  // Save reset settings
  saveAudioSettings();

  displaySystemMessage('✅ 音頻設置已重置為默認值', 'success');
}

/**
 * Apply audio settings (re-initialize microphone with new settings)
 */
async function applyAudioSettings() {
  const selectedMode = document.querySelector('input[name="echo-mode"]:checked')?.value || 'native';

  displaySystemMessage(`🎙️ 正在應用音頻設置（${getModeDisplayName(selectedMode)}）...`, 'info');

  // If microphone is already active, need to re-initialize
  const localVideo = document.getElementById('localVideo');
  if (localVideo && localVideo.srcObject) {
    console.log('🔄 Re-initializing microphone with new settings...');

    // Stop current stream
    const currentStream = localVideo.srcObject;
    currentStream.getTracks().forEach(track => track.stop());

    // Clean up audio processing nodes
    cleanupAudioProcessing();

    // Re-initialize with new settings
    try {
      const newStream = await getMediaStream(selectedMode);
      localVideo.srcObject = newStream;

      // Update peer connections with new stream
      for (const peerId in peerConnections) {
        const pc = peerConnections[peerId];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender && newStream.getAudioTracks()[0]) {
          await sender.replaceTrack(newStream.getAudioTracks()[0]);
          console.log(`✅ Updated audio track for peer ${peerId}`);
        }
      }

      displaySystemMessage(`✅ 音頻設置已應用`, 'success');
    } catch (error) {
      console.error('❌ Error applying audio settings:', error);
      displaySystemMessage(`❌ 應用音頻設置失敗: ${error.message}`, 'error');
    }
  } else {
    // Just update the current mode, will be applied when microphone is activated
    currentAudioMode = selectedMode;
    displaySystemMessage(`✅ 音頻設置已保存，將在開啟麥克風時生效`, 'success');
  }
}

/**
 * Get display name for audio mode
 */
function getModeDisplayName(mode) {
  const names = {
    native: '瀏覽器原生 AEC',
    webaudio: 'Web Audio API 增強',
    advanced: 'WebRTC 高級調優',
    ai: 'AI 降噪 (RNNoise)'
  };
  return names[mode] || mode;
}

/**
 * Get media stream based on selected audio mode
 */
async function getMediaStream(mode) {
  const constraints = getAudioConstraints(mode);

  console.log('🎙️ Getting media stream with constraints:', constraints);

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Apply audio processing based on mode
    if (mode === 'webaudio') {
      return await applyWebAudioProcessing(stream);
    } else if (mode === 'ai') {
      return await applyAINoiseReduction(stream);
    }

    return stream;
  } catch (error) {
    console.error('❌ Error getting media stream:', error);
    throw error;
  }
}

/**
 * Get audio constraints based on mode
 */
function getAudioConstraints(mode) {
  const echoCancellation = document.getElementById('echo-cancellation-toggle')?.checked ?? true;
  const noiseSuppression = document.getElementById('noise-suppression-toggle')?.checked ?? true;
  const autoGainControl = document.getElementById('auto-gain-toggle')?.checked ?? true;

  switch (mode) {
    case 'native':
      // Mode 1: Browser native AEC (basic)
      return {
        video: false,
        audio: {
          echoCancellation: echoCancellation,
          noiseSuppression: noiseSuppression,
          autoGainControl: autoGainControl
        }
      };

    case 'webaudio':
      // Mode 2: Web Audio API enhanced (will be processed after getUserMedia)
      return {
        video: false,
        audio: {
          echoCancellation: echoCancellation,
          noiseSuppression: noiseSuppression,
          autoGainControl: autoGainControl
        }
      };

    case 'advanced':
      // Mode 3: WebRTC advanced tuning
      const sampleRate = parseInt(document.getElementById('sample-rate-select')?.value || 48000);
      return {
        video: false,
        audio: {
          echoCancellation: { ideal: echoCancellation },
          noiseSuppression: { ideal: noiseSuppression },
          autoGainControl: { ideal: autoGainControl },
          sampleRate: { ideal: sampleRate },
          channelCount: { ideal: 1 }, // Mono for voice
          latency: { ideal: 0.01 }, // 10ms latency
          sampleSize: { ideal: 16 }
        }
      };

    case 'ai':
      // Mode 5: AI noise reduction (RNNoise) - no browser AEC, will be processed by AI
      return {
        video: false,
        audio: {
          echoCancellation: false, // Disable browser AEC, use AI instead
          noiseSuppression: false,  // Disable browser noise suppression
          autoGainControl: autoGainControl,
          sampleRate: { ideal: 48000 }
        }
      };

    default:
      return {
        video: false,
        audio: true
      };
  }
}

/**
 * Apply Web Audio API processing (Mode 2)
 */
async function applyWebAudioProcessing(stream) {
  try {
    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create source from stream
    audioSource = audioContext.createMediaStreamSource(stream);

    // Create dynamics compressor
    audioCompressor = audioContext.createDynamicsCompressor();
    audioCompressor.threshold.setValueAtTime(-24, audioContext.currentTime);
    audioCompressor.knee.setValueAtTime(30, audioContext.currentTime);
    audioCompressor.ratio.setValueAtTime(12, audioContext.currentTime);
    audioCompressor.attack.setValueAtTime(0.003, audioContext.currentTime);
    audioCompressor.release.setValueAtTime(0.25, audioContext.currentTime);

    // Create high-pass filter (remove low frequency noise)
    audioFilter = audioContext.createBiquadFilter();
    audioFilter.type = 'highpass';
    audioFilter.frequency.setValueAtTime(80, audioContext.currentTime);
    audioFilter.Q.setValueAtTime(1, audioContext.currentTime);

    // Create gain node
    audioGainNode = audioContext.createGain();
    const gainValue = parseInt(document.getElementById('input-gain-slider')?.value || 100) / 100;
    audioGainNode.gain.setValueAtTime(gainValue, audioContext.currentTime);

    // Create destination (will be connected to peer connections)
    const destination = audioContext.createMediaStreamDestination();

    // Connect audio processing chain
    audioSource.connect(audioFilter);
    audioFilter.connect(audioCompressor);
    audioCompressor.connect(audioGainNode);
    audioGainNode.connect(destination);

    console.log('✅ Web Audio API processing applied');

    // Return the processed stream
    return destination.stream;
  } catch (error) {
    console.error('❌ Error applying Web Audio processing:', error);
    displaySystemMessage('⚠️ Web Audio API 處理失敗，使用原始音頻', 'warning');
    return stream;
  }
}

/**
 * Apply AI noise reduction (Mode 5 - RNNoise)
 * Note: This is a placeholder. Full implementation requires RNNoise WASM library
 */
async function applyAINoiseReduction(stream) {
  try {
    // TODO: Implement RNNoise WASM integration
    // For now, just return the stream with a warning
    console.warn('⚠️ AI noise reduction not yet implemented');
    displaySystemMessage('⚠️ AI 降噪功能尚未實現，使用基礎處理', 'warning');

    // Fallback to basic Web Audio processing
    return await applyWebAudioProcessing(stream);
  } catch (error) {
    console.error('❌ Error applying AI noise reduction:', error);
    return stream;
  }
}

/**
 * Cleanup audio processing nodes
 */
function cleanupAudioProcessing() {
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }
  if (audioGainNode) {
    audioGainNode.disconnect();
    audioGainNode = null;
  }
  if (audioCompressor) {
    audioCompressor.disconnect();
    audioCompressor = null;
  }
  if (audioFilter) {
    audioFilter.disconnect();
    audioFilter = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (audioAnalyser) {
    audioAnalyser.disconnect();
    audioAnalyser = null;
  }
  if (visualizerAnimationId) {
    cancelAnimationFrame(visualizerAnimationId);
    visualizerAnimationId = null;
  }
}

/**
 * Initialize audio visualizer (optional feature)
 */
function initializeAudioVisualizer(stream) {
  const canvas = document.getElementById('audio-visualizer-canvas');
  if (!canvas) return;

  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) return;

  try {
    // Create audio context if not exists
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Create analyser
    if (!audioAnalyser) {
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
    }

    // Connect stream to analyser
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioAnalyser);

    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Draw waveform
    function draw() {
      visualizerAnimationId = requestAnimationFrame(draw);

      audioAnalyser.getByteFrequencyData(dataArray);

      canvasContext.fillStyle = '#1a1a1a';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

        // Create gradient
        const gradient = canvasContext.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');

        canvasContext.fillStyle = gradient;
        canvasContext.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    }

    draw();
    console.log('✅ Audio visualizer initialized');
  } catch (error) {
    console.error('❌ Error initializing audio visualizer:', error);
  }
}

/**
 * Setup audio visualizer events (called after dialog initialization)
 */
function setupAudioVisualizerEvents() {
  const dialogElement = document.getElementById('audio-settings-dialog');
  if (!dialogElement) return;

  const dialog = new mdc.dialog.MDCDialog(dialogElement);

  dialog.listen('MDCDialog:opened', () => {
    const localVideo = document.getElementById('localVideo');
    if (localVideo && localVideo.srcObject) {
      initializeAudioVisualizer(localVideo.srcObject);
    }
  });

  dialog.listen('MDCDialog:closed', () => {
    // Stop visualizer when dialog is closed
    if (visualizerAnimationId) {
      cancelAnimationFrame(visualizerAnimationId);
      visualizerAnimationId = null;
    }
  });
}

// ==================== End of Audio Settings System ====================

// Start the application
init();
