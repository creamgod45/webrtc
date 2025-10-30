const { Server } = require('socket.io');
const { Room, User, Message, IceCandidate, SdpSignal } = require('../models');
const { Op } = require('sequelize');

function initializeSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    let currentUserId = null;
    let currentRoomId = null;

    // Join room
    socket.on('join-room', async (data) => {
      try {
        const { roomId, userId } = data;

        // Find or create room
        let room = await Room.findOne({ where: { room_id: roomId } });

        if (!room) {
          return socket.emit('error', { message: '房間不存在' });
        }

        // Check max users
        const userCount = await User.count({
          where: { room_id: room.id, is_connected: true }
        });

        if (userCount >= room.max_users) {
          return socket.emit('error', { message: '房間已滿' });
        }

        // Generate user ID if not provided
        const newUserId = userId || `user${userCount + 1}`;

        // Create or update user
        const [user, created] = await User.findOrCreate({
          where: { user_id: newUserId, room_id: room.id },
          defaults: {
            socket_id: socket.id,
            is_connected: true
          }
        });

        if (!created) {
          await user.update({
            socket_id: socket.id,
            is_connected: true,
            left_at: null
          });
        }

        currentUserId = newUserId;
        currentRoomId = room.id;

        // Join socket room
        socket.join(roomId);

        // Get all connected users
        const connectedUsers = await User.findAll({
          where: { room_id: room.id, is_connected: true }
        });

        const userList = connectedUsers.map(u => u.user_id);

        // Notify user
        socket.emit('joined-room', {
          roomId: roomId,
          userId: newUserId,
          users: userList
        });

        // Notify others in room
        socket.to(roomId).emit('user-joined', {
          userId: newUserId,
          users: userList
        });

        console.log(`👤 User ${newUserId} joined room ${roomId}`);
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('error', { message: '加入房間失敗' });
      }
    });

    // Create room
    socket.on('create-room', async (data) => {
      try {
        const { roomId, userId } = data;

        // Generate room ID if not provided
        const newRoomId = roomId || Math.random().toString(36).substring(2, 8);

        // Create room
        const room = await Room.create({
          room_id: newRoomId,
          created_by: userId || 'user1',
          is_active: true
        });

        // Create first user
        const newUserId = userId || 'user1';
        await User.create({
          user_id: newUserId,
          room_id: room.id,
          socket_id: socket.id,
          is_connected: true
        });

        currentUserId = newUserId;
        currentRoomId = room.id;

        // Join socket room
        socket.join(newRoomId);

        socket.emit('room-created', {
          roomId: newRoomId,
          userId: newUserId,
          users: [newUserId]
        });

        console.log(`🏠 Room ${newRoomId} created by ${newUserId}`);
      } catch (error) {
        console.error('Error creating room:', error);
        socket.emit('error', { message: '建立房間失敗' });
      }
    });

    // WebRTC Signaling: Send Offer
    socket.on('send-offer', async (data) => {
      try {
        const { roomId, toUser, offer } = data;

        const room = await Room.findOne({ where: { room_id: roomId } });
        if (!room) return;

        // Store offer in database
        await SdpSignal.create({
          room_id: room.id,
          from_user: currentUserId,
          to_user: toUser,
          type: 'offer',
          sdp: offer
        });

        // Find target user's socket
        const targetUser = await User.findOne({
          where: { user_id: toUser, room_id: room.id, is_connected: true }
        });

        if (targetUser && targetUser.socket_id) {
          io.to(targetUser.socket_id).emit('receive-offer', {
            fromUser: currentUserId,
            offer: offer
          });
        }

        console.log(`📤 Offer sent from ${currentUserId} to ${toUser}`);
      } catch (error) {
        console.error('Error sending offer:', error);
      }
    });

    // WebRTC Signaling: Send Answer
    socket.on('send-answer', async (data) => {
      try {
        const { roomId, toUser, answer } = data;

        const room = await Room.findOne({ where: { room_id: roomId } });
        if (!room) return;

        // Store answer in database
        await SdpSignal.create({
          room_id: room.id,
          from_user: currentUserId,
          to_user: toUser,
          type: 'answer',
          sdp: answer
        });

        // Find target user's socket
        const targetUser = await User.findOne({
          where: { user_id: toUser, room_id: room.id, is_connected: true }
        });

        if (targetUser && targetUser.socket_id) {
          io.to(targetUser.socket_id).emit('receive-answer', {
            fromUser: currentUserId,
            answer: answer
          });
        }

        console.log(`📤 Answer sent from ${currentUserId} to ${toUser}`);
      } catch (error) {
        console.error('Error sending answer:', error);
      }
    });

    // WebRTC Signaling: Send ICE Candidate
    socket.on('send-ice-candidate', async (data) => {
      try {
        const { roomId, toUser, candidate } = data;

        const room = await Room.findOne({ where: { room_id: roomId } });
        if (!room) return;

        // Store ICE candidate in database
        await IceCandidate.create({
          room_id: room.id,
          from_user: currentUserId,
          to_user: toUser,
          candidate: candidate
        });

        // Find target user's socket
        const targetUser = await User.findOne({
          where: { user_id: toUser, room_id: room.id, is_connected: true }
        });

        if (targetUser && targetUser.socket_id) {
          io.to(targetUser.socket_id).emit('receive-ice-candidate', {
            fromUser: currentUserId,
            candidate: candidate
          });
        }

        console.log(`🧊 ICE candidate sent from ${currentUserId} to ${toUser}`);
      } catch (error) {
        console.error('Error sending ICE candidate:', error);
      }
    });

    // Send chat message
    socket.on('send-message', async (data) => {
      try {
        const { roomId, text } = data;

        const room = await Room.findOne({ where: { room_id: roomId } });
        if (!room) return;

        const message = await Message.create({
          room_id: room.id,
          sender_id: currentUserId,
          text: text,
          timestamp: new Date()
        });

        // Broadcast message to room
        io.to(roomId).emit('receive-message', {
          senderId: currentUserId,
          text: text,
          timestamp: message.timestamp
        });

        console.log(`💬 Message from ${currentUserId} in ${roomId}: ${text}`);
      } catch (error) {
        console.error('Error sending message:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      try {
        if (currentUserId && currentRoomId) {
          // Update user status
          await User.update(
            { is_connected: false, left_at: new Date() },
            { where: { user_id: currentUserId, room_id: currentRoomId } }
          );

          // Get room
          const room = await Room.findByPk(currentRoomId);
          if (room) {
            // Get remaining connected users
            const connectedUsers = await User.findAll({
              where: { room_id: currentRoomId, is_connected: true }
            });

            const userList = connectedUsers.map(u => u.user_id);

            // Notify others
            socket.to(room.room_id).emit('user-left', {
              userId: currentUserId,
              users: userList
            });
          }

          console.log(`👋 User ${currentUserId} disconnected from room ${room?.room_id}`);
        } else {
          console.log(`❌ User disconnected: ${socket.id}`);
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    });

    // Explicit leave room
    socket.on('leave-room', async () => {
      try {
        if (currentUserId && currentRoomId) {
          await User.update(
            { is_connected: false, left_at: new Date() },
            { where: { user_id: currentUserId, room_id: currentRoomId } }
          );

          const room = await Room.findByPk(currentRoomId);
          if (room) {
            socket.leave(room.room_id);

            const connectedUsers = await User.findAll({
              where: { room_id: currentRoomId, is_connected: true }
            });

            const userList = connectedUsers.map(u => u.user_id);

            socket.to(room.room_id).emit('user-left', {
              userId: currentUserId,
              users: userList
            });
          }

          currentUserId = null;
          currentRoomId = null;

          console.log(`🚪 User left room`);
        }
      } catch (error) {
        console.error('Error leaving room:', error);
      }
    });
  });

  return io;
}

module.exports = initializeSocket;
