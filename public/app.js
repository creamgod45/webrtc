// Initialize Socket.IO connection
const socket = io();

// Material Design Components initialization
mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

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
});

socket.on('user-left', (data) => {
  console.log(`👋 User left: ${data.userId}`);
  handlePeerDisconnect(data.userId);
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
  }
});

socket.on('receive-ice-candidate', async (data) => {
  console.log(`🧊 Received ICE candidate from ${data.fromUser}`);
  const pc = peerConnections[data.fromUser];
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('receive-message', (data) => {
  displayMessage(data);
});

socket.on('room-closed', () => {
  alert('房間已被關閉');
  hangUp();
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
  alert(error.message || '發生錯誤');
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
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      handlePeerDisconnect(peerId);
    }
  });

  // Handle ICE connection state
  pc.addEventListener('iceconnectionstatechange', async () => {
    if (pc.iceConnectionState === 'failed') {
      console.log('ICE connection failed, restarting...');
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
    numberOfDisplayedStreams = Math.min(numberOfDisplayedStreams + 1, 3);
    numberOfConnectedPeers += 1;

    document.getElementById('videos').style.columns = numberOfDisplayedStreams;

    const peerNode = document.getElementsByClassName('video-box')[0].cloneNode();
    const clonedVideo = document.getElementById('localVideo').cloneNode();
    clonedVideo.id = peerId;
    clonedVideo.muted = false;

    peerNode.appendChild(clonedVideo);
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

  // Remove video element
  const videoElement = document.getElementById(peerId);
  if (videoElement) {
    if (videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
    videoElement.remove();

    numberOfConnectedPeers = Math.max(0, numberOfConnectedPeers - 1);
    numberOfDisplayedStreams = numberOfConnectedPeers < 2 ? numberOfDisplayedStreams - 1 : 3;
    document.getElementById('videos').style.columns = numberOfDisplayedStreams;
  }

  users[peerId] = false;
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
}

// Room Management Functions
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;

  const generatedRoomId = Math.random().toString(36).substring(2, 8);

  socket.emit('create-room', {
    roomId: generatedRoomId,
    userId: null // Server will assign user1
  });

  document.querySelector('#shareButton').onclick = () => {
    const shareUrl = `${window.location.href.split('?')[0]}?roomId=${roomId}`;
    window.open(`https://api.whatsapp.com/send?text=${shareUrl}`, '_blank');
  };

  backgroundRun();
}

function joinRoom() {
  document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
    const inputRoomId = document.querySelector('#room-id').value;
    await joinRoomById(inputRoomId);
  }, { once: true });
  roomDialog.open();
}

async function joinRoomById(rid) {
  roomId = rid;

  // Check if room exists
  try {
    const response = await fetch(`/api/rooms/${rid}`);
    const data = await response.json();

    if (response.ok) {
      socket.emit('join-room', {
        roomId: rid,
        userId: null // Server will assign sequential user ID
      });

      document.querySelector('#shareButton').onclick = () => {
        const shareUrl = `${window.location.href.split('?')[0]}?roomId=${rid}`;
        window.open(`https://api.whatsapp.com/send?text=${shareUrl}`, '_blank');
      };

      backgroundRun();
    } else {
      document.querySelector('#currentRoom').innerText = `房間: ${rid} - 不存在的聊天室!`;
    }
  } catch (error) {
    console.error('Error checking room:', error);
    document.querySelector('#currentRoom').innerText = `房間: ${rid} - 連接失敗!`;
  }
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
function sendMessage() {
  const messageInput = document.querySelector('#newMessage');
  const messageText = messageInput.value;
  if (messageText.trim() === '') return;

  socket.emit('send-message', {
    roomId,
    text: htmlencode(messageText)
  });

  messageInput.value = '';
}

function displayMessage(message) {
  const messagesContainer = document.querySelector('#messages');
  const messageElement = document.createElement('div');
  messageElement.textContent = htmldecode(message.senderId + ': ' + message.text);
  messagesContainer.appendChild(messageElement);
  scrollToBottom();
}

function scrollToBottom() {
  const messagesContainer = document.querySelector('#messages');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Utility Functions
function htmlencode(txt) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(txt));
  return div.innerHTML;
}

function htmldecode(txt) {
  const div = document.createElement('div');
  div.innerHTML = txt;
  return div.innerText || div.textContent;
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
    }, 3000);
  }
}

// Initialization
function init() {
  const params = new URLSearchParams(location.search);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

  if (params.get('roomId')) {
    console.log('Auto-joining room from URL');
    document.querySelector('#room-id').value = params.get('roomId');
    openUserMedia();
    joinRoom();
  }

  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#sendButton').addEventListener('click', sendMessage);

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
