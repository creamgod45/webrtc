// Initialize Socket.IO connection
const socket = io();

// WebRTC Configuration
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
let roomDialog = null;
let roomId = null;
let userId = null;
let muteState = false;
let peerConnections = {}; // Map of peerId -> RTCPeerConnection
let users = {}; // Map of peerId -> connection status
let numberOfDisplayedStreams = 1;
let numberOfConnectedPeers = 0;

// Socket event handlers
socket.on('connect', () => {
  console.log('✅ Connected to server:', socket.id);
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from server');
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
  await createPeerConnection(data.fromUser, false); // false = we are not the initiator
  const pc = peerConnections[data.fromUser];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('send-answer', {
      roomId,
      toUser: data.fromUser,
      answer: answer
    });
  }
});

socket.on('receive-answer', async (data) => {
  console.log(`📥 Received answer from ${data.fromUser}`);
  const pc = peerConnections[data.fromUser];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    users[data.fromUser] = true;
    updateUserCount();
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

  // Handle connection state changes
  pc.addEventListener('connectionstatechange', () => {
    console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      users[peerId] = true;
      displaySystemMessage(`✅ ${peerId} 已連結`, 'success');
    } else if (pc.connectionState === 'failed') {
      displaySystemMessage(`❌ ${peerId} 連線失敗 (正在重試連線)`, 'error');
      // Auto retry connection
      setTimeout(() => {
        console.log(`Retrying connection with ${peerId}...`);
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce?.();
        }
      }, 2000);
    } else if (pc.connectionState === 'closed') {
      handlePeerDisconnect(peerId);
      displaySystemMessage(`${peerId} 已離開`, 'info');
    } else if (pc.connectionState === 'disconnected') {
      displaySystemMessage(`⚠️ ${peerId} 連線中斷`, 'error');
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

function handlePeerDisconnect(peerId) {
  // Close peer connection
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }

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
        'Content-Type': 'application/json'
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
          'Content-Type': 'application/json'
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

async function openUserMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    document.querySelector('#localVideo').srcObject = stream;

    console.log('Stream:', stream);
    document.querySelector('#cameraBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = false;
    document.querySelector('#createBtn').disabled = false;
    document.querySelector('#hangupBtn').disabled = false;
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('無法訪問麥克風，請檢查權限設置');
  }
}

async function hangUp() {
  // Stop all tracks
  const localStream = document.querySelector('#localVideo').srcObject;
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
  }

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
function htmldecode(str) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

// 發送消息函數 - 帶完整驗證
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
  
  // 6. HTML 編碼並發送
  socket.emit('send-message', {
    roomId,
    text: htmlencode(messageText)
  });
  
  // 7. 清空輸入框
  messageInput.value = '';
  
  // 8. 重新聚焦到輸入框
  messageInput.focus();
}

// 接收並顯示消息
socket.on('receive-message', (data) => {
  const { senderId, text, timestamp } = data;
  
  // 解碼 HTML（如果後端也編碼了）
  const decodedText = htmldecode(text);
  
  // 再次編碼以確保安全（縱深防禦）
  const safeText = htmlencode(decodedText);
  
  // 顯示消息
  displayMessage(senderId, safeText, timestamp);
});

// 顯示消息到聊天界面
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

// 在頁面加載時初始化
document.addEventListener('DOMContentLoaded', () => {
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

// Check if mobile device
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Generate consistent avatar URL based on userId
function getAvatarUrl(userId) {
  // Use DiceBear API with different styles
  const styles = ['avataaars', 'bottts', 'personas', 'adventurer', 'big-smile'];
  const styleIndex = Math.abs(hashCode(userId)) % styles.length;
  const style = styles[styleIndex];

  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(userId)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
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

  if (navigator.share) {
    try {
      await navigator.share({
        title: '加入語音聊天室',
        text: '一起來語音聊天吧！',
        url: shareUrl
      });
      console.log('✅ Shared successfully');
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('❌ Share failed:', err);
      }
      return false;
    }
  }
  return false;
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
    const whatsappUrl = isMobile()
      ? `whatsapp://send?text=加入我的語音聊天室！%0A${encodeURIComponent(shareUrl)}`
      : `https://api.whatsapp.com/send?text=加入我的語音聊天室！%0A${encodeURIComponent(shareUrl)}`;
    window.open(whatsappUrl, '_blank');
  });

  // LINE share
  document.querySelector('#share-line').addEventListener('click', async () => {
    // Try native share on mobile first
    if (isMobile() && await shareViaWebAPI()) {
      return;
    }

    const shareUrl = document.querySelector('#share-link-input').value;
    const lineUrl = isMobile()
      ? `https://line.me/R/msg/text/?加入我的語音聊天室！%0A${encodeURIComponent(shareUrl)}`
      : `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`;
    window.open(lineUrl, '_blank');
  });

  // Telegram share
  document.querySelector('#share-telegram').addEventListener('click', async () => {
    // Try native share on mobile first
    if (isMobile() && await shareViaWebAPI()) {
      return;
    }

    const shareUrl = document.querySelector('#share-link-input').value;
    const telegramUrl = isMobile()
      ? `tg://msg?text=加入我的語音聊天室！%0A${encodeURIComponent(shareUrl)}`
      : `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=加入我的語音聊天室！`;
    window.open(telegramUrl, '_blank');
  });
}

// Mobile chat toggle functionality
let unreadMessages = 0;
let isChatOpen = false;

function setupMobileChatToggle() {
  const chatToggle = document.getElementById('mobileChatToggle');
  const chatOverlay = document.getElementById('chatOverlay');
  const rightPanel = document.querySelector('.right-panel');
  const unreadBadge = document.getElementById('unreadBadge');

  if (!chatToggle || !chatOverlay || !rightPanel) return;

  function openChat() {
    rightPanel.classList.add('active');
    chatOverlay.classList.add('active');
    isChatOpen = true;
    unreadMessages = 0;
    unreadBadge.style.display = 'none';
    unreadBadge.textContent = '0';
  }

  function closeChat() {
    rightPanel.classList.remove('active');
    chatOverlay.classList.remove('active');
    isChatOpen = false;
  }

  chatToggle.addEventListener('click', () => {
    if (isChatOpen) {
      closeChat();
    } else {
      openChat();
    }
  });

  chatOverlay.addEventListener('click', closeChat);
}

function incrementUnreadMessages() {
  if (isMobile() && !isChatOpen) {
    unreadMessages++;
    const unreadBadge = document.getElementById('unreadBadge');
    if (unreadBadge) {
      unreadBadge.textContent = unreadMessages > 99 ? '99+' : unreadMessages.toString();
      unreadBadge.style.display = 'block';
    }
  }
}

// Initialization
function init() {
  const params = new URLSearchParams(location.search);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

  // Setup mobile chat toggle
  setupMobileChatToggle();

  // Setup share dialog
  setupShareDialog();

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

  // Handle page unload
  const iOS = ['iPad', 'iPhone', 'iPod'].indexOf(navigator.platform) >= 0;
  const eventName = iOS ? 'pagehide' : 'beforeunload';

  window.addEventListener(eventName, function (event) {
    if (roomId) {
      socket.emit('leave-room');
    }
  });

  muteToggleEnable();
}

// Start the application
init();
