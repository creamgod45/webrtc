/** @typedef {import('socket.io').Server} SocketIOServer */
/** @typedef {import('socket.io').Socket} Socket */
/** @typedef {import('http').Server} HttpServer */
/** @typedef {import('../models').Room} RoomModel */
/** @typedef {import('../models').User} UserModel */

const {Server} = require('socket.io');
const {Room, User, Message, IceCandidate, SdpSignal} = require('../models');
const {Op} = require('sequelize');
const {
  validateRoomId,
  validateUserId,
  validateMessageText
} = require('../middleware/security');

// ===== Message Encryption Functions =====
/**
 * Simple shift cipher encryption for WebSocket messages
 * Format: "shift:encrypted_text"
 * IMPORTANT: Must match client-side implementation
 * @param {string} text - Plain text message to encrypt
 * @returns {string} Encrypted message in format "shift:encrypted_text"
 */
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

/**
 * Decrypt a shift cipher encrypted message
 * @param {string} encryptedData - Encrypted message in format "shift:encrypted_text"
 * @returns {string} Decrypted plain text message
 */
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

/**
 * Initialize Socket.IO server and set up event handlers
 * @param {HttpServer} httpServer - HTTP server instance
 * @returns {SocketIOServer} Configured Socket.IO server instance
 */
function initializeSocket(httpServer) {
    /** @type {SocketIOServer} */
    const io = new Server(httpServer, {
        path: '/socket.io',
        cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET','POST'] },
        pingTimeout: 30000,  // 30 seconds timeout
        pingInterval: 10000, // Send ping every 10 seconds
        connectTimeout: 45000 // Connection timeout: 45 seconds
    });

    io.on('connection', (socket) => {
        console.log(`✅ User connected: ${socket.id}`);

        /** @type {string|null} */
        let currentUserId = null;
        /** @type {string|null} */
        let currentRoomId = null;
        /** @type {NodeJS.Timeout|null} */
        let heartbeatTimer = null;

        /**
         * Heartbeat mechanism - reset timer on any activity
         * Disconnects user after 30 seconds of inactivity
         * @returns {void}
         */
        function resetHeartbeat() {
            if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
            }

            heartbeatTimer = setTimeout(async () => {
                console.log(`⏰ User ${currentUserId} timed out (no activity for 30s)`);

                // Disconnect user and free up space
                if (currentRoomId && currentUserId) {
                    try {
                        // Update user status
                        await User.update(
                            { is_connected: false, left_at: new Date() },
                            { where: { user_id: currentUserId, room_id: currentRoomId } }
                        );

                        // Get room info
                        const room = await Room.findByPk(currentRoomId);
                        if (room) {
                            // Notify other users
                            socket.to(room.room_id).emit('user-left', {
                                userId: currentUserId,
                                reason: 'timeout'
                            });

                            console.log(`🚫 Removed ${currentUserId} from ${room.room_id} due to timeout`);
                        }
                    } catch (error) {
                        console.error('Error handling timeout:', error);
                    }
                }

                // Disconnect socket
                socket.disconnect(true);
            }, 30000); // 30 seconds timeout
        }

        // Start heartbeat timer on connection
        resetHeartbeat();

        /**
         * Handle join-room event
         * @param {{roomId: string, userId?: string}} data - Room and user information
         * @returns {Promise<void>}
         */
        socket.on('join-room', async (data) => {
            resetHeartbeat(); // Reset timeout on activity
            try {
                const {roomId, userId} = data;

                // Validate inputs using security functions
                let validatedRoomId, validatedUserId;

                try {
                    validatedRoomId = validateRoomId(roomId);
                } catch (error) {
                    return socket.emit('error', {message: '無效的房間ID: ' + error.message});
                }

                if (userId) {
                    try {
                        validatedUserId = validateUserId(userId);
                    } catch (error) {
                        return socket.emit('error', {message: '無效的用戶ID: ' + error.message});
                    }
                } else {
                    validatedUserId = null;
                }

                // Find or create room
                let room = await Room.findOne({where: {room_id: validatedRoomId}});

                if (!room) {
                    return socket.emit('error', {message: '房間不存在'});
                }

                // Check max users
                const userCount = await User.count({
                    where: {room_id: room.id, is_connected: true}
                });

                if (userCount >= room.max_users) {
                    return socket.emit('error', {message: '房間已滿'});
                }

                // Generate user ID if not provided
                const newUserId = validatedUserId || `user${userCount + 1}`;

                // Create or update user
                const [user, created] = await User.findOrCreate({
                    where: {user_id: newUserId, room_id: room.id}, defaults: {
                        socket_id: socket.id, is_connected: true
                    }
                });

                if (!created) {
                    await user.update({
                        socket_id: socket.id, is_connected: true, left_at: null
                    });
                }

                currentUserId = newUserId;
                currentRoomId = room.id;

                // Join socket room
                socket.join(validatedRoomId);

                // Get all connected users
                const connectedUsers = await User.findAll({
                    where: {room_id: room.id, is_connected: true}
                });

                const userList = connectedUsers.map(u => u.user_id);

                // Notify user
                socket.emit('joined-room', {
                    roomId: validatedRoomId, userId: newUserId, users: userList
                });

                // Notify others in room
                socket.to(validatedRoomId).emit('user-joined', {
                    userId: newUserId, users: userList
                });

                console.log(`👤 User ${newUserId} joined room ${validatedRoomId}`);
            } catch (error) {
                console.error('Error joining room:', error);
                socket.emit('error', {message: '加入房間失敗'});
            }
        });

        /**
         * Handle create-room event
         * @param {{roomId?: string, userId?: string}} data - Room and user information
         * @returns {Promise<void>}
         */
        socket.on('create-room', async (data) => {
            resetHeartbeat(); // Reset timeout on activity
            try {
                const {roomId, userId} = data;

                // Validate roomId if provided
                let validatedRoomId;
                if (roomId) {
                    try {
                        validatedRoomId = validateRoomId(roomId);
                    } catch (error) {
                        return socket.emit('error', {message: '無效的房間ID: ' + error.message});
                    }
                } else {
                    validatedRoomId = Math.random().toString(36).substring(2, 8);
                }

                // Validate userId if provided
                let validatedUserId;
                if (userId) {
                    try {
                        validatedUserId = validateUserId(userId);
                    } catch (error) {
                        return socket.emit('error', {message: '無效的用戶ID: ' + error.message});
                    }
                } else {
                    validatedUserId = 'user1';
                }

                // Check if room already exists
                const existingRoom = await Room.findOne({where: {room_id: validatedRoomId}});
                if (existingRoom) {
                    return socket.emit('error', {message: '房間ID已存在'});
                }

                // Create room
                const room = await Room.create({
                    room_id: validatedRoomId, created_by: validatedUserId, is_active: true
                });

                // Create first user
                await User.create({
                    user_id: validatedUserId, room_id: room.id, socket_id: socket.id, is_connected: true
                });

                currentUserId = validatedUserId;
                currentRoomId = room.id;

                // Join socket room
                socket.join(validatedRoomId);

                socket.emit('room-created', {
                    roomId: validatedRoomId, userId: validatedUserId, users: [validatedUserId]
                });

                console.log(`🏠 Room ${validatedRoomId} created by ${validatedUserId}`);
            } catch (error) {
                console.error('Error creating room:', error);
                socket.emit('error', {message: '建立房間失敗'});
            }
        });

        /**
         * Handle WebRTC offer signaling
         * @param {{roomId: string, toUser: string, offer: RTCSessionDescriptionInit}} data - WebRTC offer data
         * @returns {Promise<void>}
         */
        socket.on('send-offer', async (data) => {
            resetHeartbeat(); // Reset timeout on activity
            try {
                const {roomId, toUser, offer} = data;

                // Input validation
                if (!roomId || typeof roomId !== 'string' || !toUser || typeof toUser !== 'string') {
                    return socket.emit('error', {message: '無效的參數'});
                }

                if (!offer || typeof offer !== 'object') {
                    return socket.emit('error', {message: '無效的Offer數據'});
                }

                // Sanitize inputs
                const sanitizedRoomId = roomId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                const sanitizedToUser = toUser.trim().replace(/[^a-zA-Z0-9-_]/g, '');

                if (!sanitizedRoomId || !sanitizedToUser) {
                    return socket.emit('error', {message: '參數格式無效'});
                }

                const room = await Room.findOne({where: {room_id: sanitizedRoomId}});
                if (!room) {
                    return socket.emit('error', {message: '房間不存在'});
                }

                // Verify the current user is in the room
                if (currentRoomId !== room.id) {
                    return socket.emit('error', {message: '您不在此房間中'});
                }

                // Store offer in a database
                await SdpSignal.create({
                    room_id: room.id,
                    from_user: currentUserId,
                    to_user: sanitizedToUser,
                    type: 'offer',
                    sdp: JSON.stringify(offer)
                });

                // Find target user's socket
                const targetUser = await User.findOne({
                    where: {user_id: sanitizedToUser, room_id: room.id, is_connected: true}
                });

                if (targetUser && targetUser.socket_id) {
                    io.to(targetUser.socket_id).emit('receive-offer', {
                        fromUser: currentUserId, offer: offer
                    });
                }

                console.log(`📤 Offer sent from ${currentUserId} to ${sanitizedToUser}`);
            } catch (error) {
                console.error('Error sending offer:', error);
                socket.emit('error', {message: '發送Offer失敗'});
            }
        });

        /**
         * Handle WebRTC answer signaling
         * @param {{roomId: string, toUser: string, answer: RTCSessionDescriptionInit}} data - WebRTC answer data
         * @returns {Promise<void>}
         */
        socket.on('send-answer', async (data) => {
            resetHeartbeat(); // Reset timeout on activity
            try {
                const {roomId, toUser, answer} = data;

                // Input validation
                if (!roomId || typeof roomId !== 'string' || !toUser || typeof toUser !== 'string') {
                    return socket.emit('error', {message: '無效的參數'});
                }

                if (!answer || typeof answer !== 'object') {
                    return socket.emit('error', {message: '無效的Answer數據'});
                }

                // Sanitize inputs
                const sanitizedRoomId = roomId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                const sanitizedToUser = toUser.trim().replace(/[^a-zA-Z0-9-_]/g, '');

                if (!sanitizedRoomId || !sanitizedToUser) {
                    return socket.emit('error', {message: '參數格式無效'});
                }

                const room = await Room.findOne({where: {room_id: sanitizedRoomId}});
                if (!room) {
                    return socket.emit('error', {message: '房間不存在'});
                }

                // Verify the current user is in the room
                if (currentRoomId !== room.id) {
                    return socket.emit('error', {message: '您不在此房間中'});
                }

                // Store answer in a database
                await SdpSignal.create({
                    room_id: room.id,
                    from_user: currentUserId,
                    to_user: sanitizedToUser,
                    type: 'answer',
                    sdp: JSON.stringify(answer)
                });

                // Find target user's socket
                const targetUser = await User.findOne({
                    where: {user_id: sanitizedToUser, room_id: room.id, is_connected: true}
                });

                if (targetUser && targetUser.socket_id) {
                    io.to(targetUser.socket_id).emit('receive-answer', {
                        fromUser: currentUserId, answer: answer
                    });
                }

                console.log(`📤 Answer sent from ${currentUserId} to ${sanitizedToUser}`);
            } catch (error) {
                console.error('Error sending answer:', error);
                socket.emit('error', {message: '發送Answer失敗'});
            }
        });

        /**
         * Handle WebRTC ICE candidate signaling
         * @param {{roomId: string, toUser: string, candidate: RTCIceCandidate}} data - ICE candidate data
         * @returns {Promise<void>}
         */
        socket.on('send-ice-candidate', async (data) => {
            resetHeartbeat(); // Reset timeout on activity
            try {
                const {roomId, toUser, candidate} = data;

                // Input validation
                if (!roomId || typeof roomId !== 'string' || !toUser || typeof toUser !== 'string') {
                    return socket.emit('error', {message: '無效的參數'});
                }

                if (!candidate || typeof candidate !== 'object') {
                    return socket.emit('error', {message: '無效的ICE Candidate數據'});
                }

                // Sanitize inputs
                const sanitizedRoomId = roomId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                const sanitizedToUser = toUser.trim().replace(/[^a-zA-Z0-9-_]/g, '');

                if (!sanitizedRoomId || !sanitizedToUser) {
                    return socket.emit('error', {message: '參數格式無效'});
                }

                const room = await Room.findOne({where: {room_id: sanitizedRoomId}});
                if (!room) return;

                // Verify the current user is in the room
                if (currentRoomId !== room.id) {
                    return socket.emit('error', {message: '您不在此房間中'});
                }

                // Store ICE candidate in a database
                await IceCandidate.create({
                    room_id: room.id,
                    from_user: currentUserId,
                    to_user: sanitizedToUser,
                    candidate: JSON.stringify(candidate)
                });

                // Find target user's socket
                const targetUser = await User.findOne({
                    where: {user_id: sanitizedToUser, room_id: room.id, is_connected: true}
                });

                if (targetUser && targetUser.socket_id) {
                    io.to(targetUser.socket_id).emit('receive-ice-candidate', {
                        fromUser: currentUserId, candidate: candidate
                    });
                }

                console.log(`🧊 ICE candidate sent from ${currentUserId} to ${sanitizedToUser}`);
            } catch (error) {
                console.error('Error sending ICE candidate:', error);
            }
        });

        /**
         * Handle chat message sending
         * @param {{roomId: string, text: string}} data - Message data (text is encrypted)
         * @returns {Promise<void>}
         */
        socket.on('send-message', async (data) => {
            resetHeartbeat(); // Reset timeout on activity
            try {
                const {roomId, text} = data;

                // Validate roomId
                let validatedRoomId;
                try {
                    validatedRoomId = validateRoomId(roomId);
                } catch (error) {
                    return socket.emit('error', {message: '無效的房間ID: ' + error.message});
                }

                // Validate message text (encrypted format)
                // Note: Message is encrypted by client (format: "shift:encrypted_text")
                let validatedText;
                try {
                    validatedText = validateMessageText(text);
                } catch (error) {
                    return socket.emit('error', {message: '無效的訊息內容: ' + error.message});
                }

                const room = await Room.findOne({where: {room_id: validatedRoomId}});
                if (!room) {
                    return socket.emit('error', {message: '房間不存在'});
                }

                // Verify the current user is in the room
                if (currentRoomId !== room.id) {
                    return socket.emit('error', {message: '您不在此房間中'});
                }

                // Store encrypted message in database (for security)
                const message = await Message.create({
                    room_id: room.id,
                    sender_id: currentUserId,
                    text: validatedText,
                    timestamp: new Date()
                });

                // Broadcast encrypted message to room
                // Clients will decrypt on receipt
                io.to(validatedRoomId).emit('receive-message', {
                    senderId: currentUserId,
                    text: validatedText,
                    timestamp: message.timestamp
                });

                // Log decrypted message for debugging (optional - comment out in production)
                const decryptedForLog = decryptMessage(validatedText);
                console.log(`💬 Message from ${currentUserId} in ${validatedRoomId}: ${decryptedForLog.substring(0, 50)}...`);
            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', {message: '發送訊息失敗'});
            }
        });

        /**
         * Handle user disconnect event
         * @param {string} reason - Disconnect reason
         * @returns {Promise<void>}
         */
        socket.on('disconnect', async (reason) => {
            console.log(`❌ User disconnected: ${socket.id}, reason: ${reason}`);

            // Clear heartbeat timer
            if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
                heartbeatTimer = null;
            }

            // Update user status in database
            if (currentRoomId && currentUserId) {
                try {
                    await User.update(
                        { is_connected: false, left_at: new Date() },
                        { where: { user_id: currentUserId, room_id: currentRoomId } }
                    );

                    // Get room info
                    const room = await Room.findByPk(currentRoomId);
                    if (room) {
                        // Notify other users
                        socket.to(room.room_id).emit('user-left', {
                            userId: currentUserId,
                            reason: 'disconnect'
                        });

                        console.log(`👋 User ${currentUserId} left room ${room.room_id}`);
                    }
                } catch (error) {
                    console.error('Error handling disconnect:', error);
                }
            }
        });
    });

    return io;
}

module.exports = initializeSocket;
