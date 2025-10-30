const {Server} = require('socket.io');
const {Room, User, Message, IceCandidate, SdpSignal} = require('../models');
const {Op} = require('sequelize');

function initializeSocket(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        console.log(`✅ User connected: ${socket.id}`);

        let currentUserId = null;
        let currentRoomId = null;

        // Join room
        socket.on('join-room', async (data) => {
            try {
                const {roomId, userId} = data;

                // Input validation
                if (!roomId || typeof roomId !== 'string' || roomId.length > 50) {
                    return socket.emit('error', {message: '無效的房間ID'});
                }

                if (!roomId.trim()) {
                    return socket.emit('error', {message: '房間ID不能為空'});
                }

                if (userId && (typeof userId !== 'string' || userId.length > 50)) {
                    return socket.emit('error', {message: '無效的用戶ID'});
                }

                // Sanitize inputs - only allow alphanumeric, hyphens, and underscores
                const sanitizedRoomId = roomId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                const sanitizedUserId = userId ? userId.trim().replace(/[^a-zA-Z0-9-_]/g, '') : null;

                // Additional validation after sanitization
                if (!sanitizedRoomId || sanitizedRoomId.length < 1) {
                    return socket.emit('error', {message: '房間ID格式無效'});
                }

                // Find or create room
                let room = await Room.findOne({where: {room_id: sanitizedRoomId}});

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
                const newUserId = sanitizedUserId || `user${userCount + 1}`;

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
                socket.join(sanitizedRoomId);

                // Get all connected users
                const connectedUsers = await User.findAll({
                    where: {room_id: room.id, is_connected: true}
                });

                const userList = connectedUsers.map(u => u.user_id);

                // Notify user
                socket.emit('joined-room', {
                    roomId: sanitizedRoomId, userId: newUserId, users: userList
                });

                // Notify others in room
                socket.to(sanitizedRoomId).emit('user-joined', {
                    userId: newUserId, users: userList
                });

                console.log(`👤 User ${newUserId} joined room ${sanitizedRoomId}`);
            } catch (error) {
                console.error('Error joining room:', error);
                socket.emit('error', {message: '加入房間失敗'});
            }
        });

        // Create room
        socket.on('create-room', async (data) => {
            try {
                const {roomId, userId} = data;

                // Validate and sanitize roomId if provided
                let sanitizedRoomId;
                if (roomId) {
                    if (typeof roomId !== 'string' || roomId.length > 50) {
                        return socket.emit('error', {message: '無效的房間ID'});
                    }
                    sanitizedRoomId = roomId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                    if (!sanitizedRoomId) {
                        return socket.emit('error', {message: '房間ID格式無效'});
                    }
                } else {
                    sanitizedRoomId = Math.random().toString(36).substring(2, 8);
                }

                // Validate and sanitize userId if provided
                let sanitizedUserId;
                if (userId) {
                    if (typeof userId !== 'string' || userId.length > 50) {
                        return socket.emit('error', {message: '無效的用戶ID'});
                    }
                    sanitizedUserId = userId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                    if (!sanitizedUserId) {
                        return socket.emit('error', {message: '用戶ID格式無效'});
                    }
                } else {
                    sanitizedUserId = 'user1';
                }

                // Check if room already exists
                const existingRoom = await Room.findOne({where: {room_id: sanitizedRoomId}});
                if (existingRoom) {
                    return socket.emit('error', {message: '房間ID已存在'});
                }

                // Create room
                const room = await Room.create({
                    room_id: sanitizedRoomId, created_by: sanitizedUserId, is_active: true
                });

                // Create first user
                await User.create({
                    user_id: sanitizedUserId, room_id: room.id, socket_id: socket.id, is_connected: true
                });

                currentUserId = sanitizedUserId;
                currentRoomId = room.id;

                // Join socket room
                socket.join(sanitizedRoomId);

                socket.emit('room-created', {
                    roomId: sanitizedRoomId, userId: sanitizedUserId, users: [sanitizedUserId]
                });

                console.log(`🏠 Room ${sanitizedRoomId} created by ${sanitizedUserId}`);
            } catch (error) {
                console.error('Error creating room:', error);
                socket.emit('error', {message: '建立房間失敗'});
            }
        });

        // WebRTC Signaling: Send Offer
        socket.on('send-offer', async (data) => {
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

        // WebRTC Signaling: Send Answer
        socket.on('send-answer', async (data) => {
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

        // WebRTC Signaling: Send ICE Candidate
        socket.on('send-ice-candidate', async (data) => {
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

        // Send a chat message
        socket.on('send-message', async (data) => {
            try {
                const {roomId, text} = data;

                // Input validation
                if (!roomId || typeof roomId !== 'string') {
                    return socket.emit('error', {message: '無效的房間ID'});
                }

                if (!text || typeof text !== 'string' || text.length > 1000) {
                    return socket.emit('error', {message: '無效的訊息內容'});
                }

                // Sanitize inputs
                const sanitizedRoomId = roomId.trim().replace(/[^a-zA-Z0-9-_]/g, '');
                const sanitizedText = text.trim();

                if (!sanitizedRoomId || !sanitizedText) {
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

                const message = await Message.create({
                    room_id: room.id, sender_id: currentUserId, text: sanitizedText, timestamp: new Date()
                });

                // Broadcast message to room
                io.to(sanitizedRoomId).emit('receive-message', {
                    senderId: currentUserId, text: sanitizedText, timestamp: message.timestamp
                });

                console.log(`💬 Message from ${currentUserId} in ${sanitizedRoomId}: ${sanitizedText}`);
            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', {message: '發送訊息失敗'});
            }
        });

        return io;
    });
}

module.exports = initializeSocket;
