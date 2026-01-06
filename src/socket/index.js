const {Server} = require('socket.io');
const {Room, User, Message, IceCandidate, SdpSignal} = require('../models');
const {Op} = require('sequelize');
const {
  validateRoomId,
  validateUserId,
  validateMessageText
} = require('../middleware/security');
const securityConfig = require('../config/security');
const {
  getClientIP,
  logSecurityEvent,
  isIPBlocked,
  blockIP,
  trackAnomaly,
  checkConnectionRateLimit,
  registerConnection,
  unregisterConnection,
  checkMessageRateLimit,
  validateOrigin,
  validatePayloadSize
} = require('../middleware/websocketSecurity');

// ===== Message Encryption Removed =====
// Fixed: Removed insecure shift cipher (CWE-327)
// WebSocket connections are secured via WSS (TLS encryption) instead
// Client-side encryption removed as well to match this change

function initializeSocket(httpServer) {
    const io = new Server(httpServer, {
        path: '/socket.io',
        cors: {
            origin: (origin, callback) => {
                // Validate origin using security middleware
                if (validateOrigin(origin)) {
                    callback(null, true);
                } else {
                    logSecurityEvent({
                        type: 'invalid_origin',
                        origin,
                        severity: 3,
                        details: 'Origin not in allowed list'
                    });
                    callback(new Error('Origin not allowed'), false);
                }
            },
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingTimeout: securityConfig.websocket.pingTimeout,
        pingInterval: securityConfig.websocket.pingInterval,
        connectTimeout: securityConfig.websocket.connectTimeout,
        maxHttpBufferSize: securityConfig.validation.maxOfferSize, // Limit message size
        allowEIO3: false // Disable legacy protocol for security
    });

    io.on('connection', (socket) => {
        const clientIP = getClientIP(socket);
        console.log(`✅ User connected: ${socket.id} from ${clientIP}`);

        // Security Check 1: IP Blacklist
        if (isIPBlocked(clientIP)) {
            logSecurityEvent({
                type: 'blocked_ip_attempt',
                ip: clientIP,
                socketId: socket.id,
                severity: 4,
                details: 'Blocked IP attempted connection'
            });
            socket.emit('error', { message: '您的IP已被暫時封鎖，請稍後再試' });
            socket.disconnect(true);
            return;
        }

        // Security Check 2: Connection Rate Limit
        const rateLimitResult = checkConnectionRateLimit(clientIP);
        if (!rateLimitResult.allowed) {
            logSecurityEvent({
                type: 'rate_limit_connection_rejected',
                ip: clientIP,
                socketId: socket.id,
                severity: 3,
                details: rateLimitResult
            });
            socket.emit('error', {
                message: '連接過於頻繁，請稍後再試',
                retryAfter: rateLimitResult.retryAfter
            });
            socket.disconnect(true);
            return;
        }

        let currentUserId = null;
        let currentRoomId = null;
        let heartbeatTimer = null;

        // Security wrapper for event handlers
        function secureEventHandler(eventName, handler) {
            return async (data) => {
                resetHeartbeat(); // Reset timeout on activity

                // Check message rate limit
                const rateLimit = checkMessageRateLimit(socket.id, eventName);
                if (!rateLimit.allowed) {
                    logSecurityEvent({
                        type: 'rate_limit_message_rejected',
                        ip: clientIP,
                        socketId: socket.id,
                        userId: currentUserId,
                        eventName,
                        severity: 2,
                        details: rateLimit
                    });
                    return socket.emit('error', {
                        message: rateLimit.reason,
                        retryAfter: rateLimit.retryAfter
                    });
                }

                // Validate payload size
                const sizeValidation = validatePayloadSize(data, eventName);
                if (!sizeValidation.valid) {
                    logSecurityEvent({
                        type: 'validation_rejected',
                        ip: clientIP,
                        socketId: socket.id,
                        userId: currentUserId,
                        eventName,
                        severity: 2,
                        details: sizeValidation
                    });
                    return socket.emit('error', { message: sizeValidation.reason });
                }

                // Call the actual handler
                try {
                    await handler(data);
                } catch (error) {
                    console.error(`Error in ${eventName}:`, error);
                    logSecurityEvent({
                        type: 'handler_error',
                        ip: clientIP,
                        socketId: socket.id,
                        userId: currentUserId,
                        eventName,
                        severity: 2,
                        details: { error: error.message }
                    });
                    socket.emit('error', { message: '處理請求時發生錯誤' });
                }
            };
        }

        // Heartbeat mechanism - reset timer on any activity
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

        // Join room
        socket.on('join-room', secureEventHandler('join-room', async (data) => {
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

                // Register connection with security middleware
                const regResult = registerConnection(clientIP, socket.id, newUserId);
                if (!regResult.allowed) {
                    return socket.emit('error', { message: regResult.reason });
                }

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
        }));

        // Create room
        socket.on('create-room', secureEventHandler('create-room', async (data) => {
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

                // Register connection with security middleware
                const regResult = registerConnection(clientIP, socket.id, validatedUserId);
                if (!regResult.allowed) {
                    return socket.emit('error', { message: regResult.reason });
                }

                // Track room creation for anomaly detection
                trackAnomaly(clientIP, 'room_creation', { roomId: validatedRoomId });

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
        }));

        // WebRTC Signaling: Send Offer
        socket.on('send-offer', secureEventHandler('send-offer', async (data) => {
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
        }));

        // WebRTC Signaling: Send Answer
        socket.on('send-answer', secureEventHandler('send-answer', async (data) => {
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
        }));

        // WebRTC Signaling: Send ICE Candidate
        socket.on('send-ice-candidate', secureEventHandler('send-ice-candidate', async (data) => {
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
        }));

        // Send a chat message
        socket.on('send-message', secureEventHandler('send-message', async (data) => {
            try {
                const {roomId, text} = data;

                // Validate roomId
                let validatedRoomId;
                try {
                    validatedRoomId = validateRoomId(roomId);
                } catch (error) {
                    return socket.emit('error', {message: '無效的房間ID: ' + error.message});
                }

                // Validate message text
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

                // Broadcast message to room
                io.to(validatedRoomId).emit('receive-message', {
                    senderId: currentUserId,
                    text: validatedText,
                    timestamp: message.timestamp
                });

                // Log message for debugging (optional - comment out in production)
                console.log(`💬 Message from ${currentUserId} in ${validatedRoomId}: ${validatedText.substring(0, 50)}...`);
            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', {message: '發送訊息失敗'});
            }
        }));

        // Handle disconnect
        socket.on('disconnect', async (reason) => {
            console.log(`❌ User disconnected: ${socket.id}, reason: ${reason}`);

            // Clear heartbeat timer
            if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
                heartbeatTimer = null;
            }

            // Clean up security tracking
            unregisterConnection(clientIP, socket.id, currentUserId);

            logSecurityEvent({
                type: 'disconnect',
                ip: clientIP,
                socketId: socket.id,
                userId: currentUserId,
                severity: 1,
                details: { reason }
            });

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
