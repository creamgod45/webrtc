const express = require('express');
const { Room, User, Message } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// Get all active rooms
router.get('/', async (req, res) => {
  try {
    const rooms = await Room.findAll({
      where: { is_active: true },
      include: [{
        model: User,
        as: 'users',
        where: { is_connected: true },
        required: false
      }],
      order: [['created_at', 'DESC']]
    });

    const roomList = rooms.map(room => ({
      roomId: room.room_id,
      name: room.name,
      userCount: room.users.length,
      maxUsers: room.max_users,
      createdBy: room.created_by,
      createdAt: room.created_at
    }));

    res.json({ rooms: roomList });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Get room by ID
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({
      where: { room_id: roomId },
      include: [{
        model: User,
        as: 'users',
        where: { is_connected: true },
        required: false
      }]
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      roomId: room.room_id,
      name: room.name,
      users: room.users.map(u => u.user_id),
      userCount: room.users.length,
      maxUsers: room.max_users,
      isActive: room.is_active,
      createdBy: room.created_by,
      createdAt: room.created_at
    });
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// Get room messages
router.get('/:roomId/messages', async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const room = await Room.findOne({ where: { room_id: roomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const messages = await Message.findAll({
      where: { room_id: room.id },
      order: [['timestamp', 'DESC']],
      limit,
      offset
    });

    res.json({
      messages: messages.map(m => ({
        id: m.id,
        senderId: m.sender_id,
        text: m.text,
        timestamp: m.timestamp
      })),
      total: await Message.count({ where: { room_id: room.id } })
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Create a new room (REST endpoint - can also use WebSocket)
router.post('/', async (req, res) => {
  try {
    const { roomId, name, maxUsers } = req.body;

    // Generate room ID if not provided
    const newRoomId = roomId || Math.random().toString(36).substring(2, 8);

    // Check if room ID already exists
    const existing = await Room.findOne({ where: { room_id: newRoomId } });
    if (existing) {
      return res.status(409).json({ error: 'Room ID already exists' });
    }

    const room = await Room.create({
      room_id: newRoomId,
      name: name || null,
      max_users: maxUsers || 10,
      is_active: true
    });

    res.status(201).json({
      roomId: room.room_id,
      name: room.name,
      maxUsers: room.max_users,
      createdAt: room.created_at
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Delete/deactivate a room
router.delete('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ where: { room_id: roomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Soft delete - just mark as inactive
    await room.update({ is_active: false });

    // Disconnect all users
    await User.update(
      { is_connected: false, left_at: new Date() },
      { where: { room_id: room.id } }
    );

    // Notify via WebSocket
    const io = req.app.get('io');
    io.to(roomId).emit('room-closed', { roomId });

    res.json({ message: 'Room closed successfully' });
  } catch (error) {
    console.error('Error closing room:', error);
    res.status(500).json({ error: 'Failed to close room' });
  }
});

module.exports = router;
