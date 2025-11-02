const express = require('express');
const bcrypt = require('bcrypt');
const { Room, User, Message, BannedUser, RoomModerator } = require('../models');
const { Op } = require('sequelize');
const {
  validateRoomId,
  validateUserId,
  validateRoomName,
  validatePassword,
  validateMaxUsers,
  validateReason,
  validateDuration
} = require('../middleware/security');

const router = express.Router();
const SALT_ROUNDS = 10;

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
      isPrivate: room.is_private,
      hasPassword: !!room.password,
      createdBy: room.created_by,
      createdAt: room.created_at
    }));

    res.json({ rooms: roomList });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Get public rooms (for lobby)
router.get('/lobby/list', async (req, res) => {
  try {
    const rooms = await Room.findAll({
      where: {
        is_active: true,
        is_private: false
      },
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
      currentUsers: room.users.length,
      maxUsers: room.max_users,
      hasPassword: !!room.password,
      createdAt: room.created_at
    }));

    res.json({ rooms: roomList });
  } catch (error) {
    console.error('Error fetching lobby rooms:', error);
    res.status(500).json({ error: 'Failed to fetch lobby rooms' });
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
    const { roomId, name, maxUsers, password, isPrivate, createdBy } = req.body;

    // Generate room ID if not provided
    const generatedRoomId = roomId || Math.random().toString(36).substring(2, 8);

    // Validate and sanitize inputs
    const validatedRoomId = validateRoomId(generatedRoomId);
    const validatedName = validateRoomName(name);
    const validatedMaxUsers = validateMaxUsers(maxUsers || 10);
    const validatedPassword = validatePassword(password);

    // Check if room ID already exists
    const existing = await Room.findOne({ where: { room_id: validatedRoomId } });
    if (existing) {
      return res.status(409).json({ error: 'Room ID already exists' });
    }

    // Hash password if provided
    let passwordHash = null;
    if (validatedPassword) {
      passwordHash = await bcrypt.hash(validatedPassword, SALT_ROUNDS);
    }

    const room = await Room.create({
      room_id: validatedRoomId,
      name: validatedName,
      password: passwordHash,
      is_private: isPrivate || false,
      max_users: validatedMaxUsers,
      is_active: true,
      created_by: createdBy || null,
      owner_user_id: createdBy || null
    });

    res.status(201).json({
      roomId: room.room_id,
      name: room.name,
      maxUsers: room.max_users,
      isPrivate: room.is_private,
      hasPassword: !!room.password,
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

// Update room settings
router.put('/:roomId/settings', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, name, maxUsers, password, isPrivate } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedUserId = validateUserId(userId);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is owner
    if (room.owner_user_id !== validatedUserId) {
      return res.status(403).json({ error: 'Only room owner can change settings' });
    }

    const updates = {};

    if (name !== undefined) {
      updates.name = validateRoomName(name);
    }
    if (maxUsers !== undefined) {
      updates.max_users = validateMaxUsers(maxUsers);
    }
    if (isPrivate !== undefined) {
      updates.is_private = isPrivate;
    }

    // Update password if provided
    if (password !== undefined) {
      if (password === null || password === '') {
        updates.password = null;
      } else {
        const validatedPassword = validatePassword(password);
        updates.password = await bcrypt.hash(validatedPassword, SALT_ROUNDS);
      }
    }

    await room.update(updates);

    res.json({
      message: 'Settings updated successfully',
      room: {
        roomId: room.room_id,
        name: room.name,
        maxUsers: room.max_users,
        isPrivate: room.is_private,
        hasPassword: !!room.password
      }
    });
  } catch (error) {
    console.error('Error updating room settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update room settings' });
  }
});

// Verify room password
router.post('/:roomId/verify-password', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { password } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedPassword = validatePassword(password);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.password) {
      return res.json({ valid: true });
    }

    const isValid = await bcrypt.compare(validatedPassword || '', room.password);

    res.json({ valid: isValid });
  } catch (error) {
    console.error('Error verifying password:', error);
    res.status(500).json({ error: error.message || 'Failed to verify password' });
  }
});

// Kick user from room
router.post('/:roomId/kick', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, targetUserId } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedUserId = validateUserId(userId);
    const validatedTargetUserId = validateUserId(targetUserId);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is owner or moderator
    const isOwner = room.owner_user_id === validatedUserId;
    const isModerator = await RoomModerator.findOne({
      where: {
        room_id: room.id,
        user_identifier: validatedUserId
      }
    });

    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Only owner or moderators can kick users' });
    }

    // Disconnect the target user via WebSocket
    const io = req.app.get('io');
    const targetUser = await User.findOne({
      where: {
        room_id: room.id,
        user_id: validatedTargetUserId,
        is_connected: true
      }
    });

    if (targetUser && targetUser.socket_id) {
      io.to(targetUser.socket_id).emit('kicked', {
        roomId: validatedRoomId,
        reason: 'Kicked by room owner/moderator'
      });
    }

    // Update user status
    await User.update(
      { is_connected: false, left_at: new Date() },
      { where: { room_id: room.id, user_id: validatedTargetUserId } }
    );

    res.json({ message: 'User kicked successfully' });
  } catch (error) {
    console.error('Error kicking user:', error);
    res.status(500).json({ error: error.message || 'Failed to kick user' });
  }
});

// Ban user from room
router.post('/:roomId/ban', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, targetUserId, reason, duration } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedUserId = validateUserId(userId);
    const validatedTargetUserId = validateUserId(targetUserId);
    const validatedReason = validateReason(reason);
    const validatedDuration = validateDuration(duration);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is owner or moderator
    const isOwner = room.owner_user_id === validatedUserId;
    const isModerator = await RoomModerator.findOne({
      where: {
        room_id: room.id,
        user_identifier: validatedUserId
      }
    });

    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Only owner or moderators can ban users' });
    }

    // Calculate expiry if duration provided (in hours)
    let expiresAt = null;
    if (validatedDuration) {
      expiresAt = new Date(Date.now() + validatedDuration * 60 * 60 * 1000);
    }

    // Create ban record
    await BannedUser.create({
      room_id: room.id,
      user_identifier: validatedTargetUserId,
      banned_by: validatedUserId,
      reason: validatedReason,
      expires_at: expiresAt
    });

    // Kick the user if currently connected
    const io = req.app.get('io');
    const targetUser = await User.findOne({
      where: {
        room_id: room.id,
        user_id: validatedTargetUserId,
        is_connected: true
      }
    });

    if (targetUser && targetUser.socket_id) {
      io.to(targetUser.socket_id).emit('banned', {
        roomId: validatedRoomId,
        reason: validatedReason || 'Banned by room owner/moderator',
        expiresAt
      });
    }

    // Disconnect user
    await User.update(
      { is_connected: false, left_at: new Date() },
      { where: { room_id: room.id, user_id: validatedTargetUserId } }
    );

    res.json({
      message: 'User banned successfully',
      expiresAt
    });
  } catch (error) {
    console.error('Error banning user:', error);
    res.status(500).json({ error: error.message || 'Failed to ban user' });
  }
});

// Unban user
router.delete('/:roomId/ban/:targetUserId', async (req, res) => {
  try {
    const { roomId, targetUserId } = req.params;
    const { userId } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedTargetUserId = validateUserId(targetUserId);
    const validatedUserId = validateUserId(userId);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is owner or moderator
    const isOwner = room.owner_user_id === validatedUserId;
    if (!isOwner) {
      return res.status(403).json({ error: 'Only owner can unban users' });
    }

    await BannedUser.destroy({
      where: {
        room_id: room.id,
        user_identifier: validatedTargetUserId
      }
    });

    res.json({ message: 'User unbanned successfully' });
  } catch (error) {
    console.error('Error unbanning user:', error);
    res.status(500).json({ error: error.message || 'Failed to unban user' });
  }
});

// Get banned users list
router.get('/:roomId/bans', async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ where: { room_id: roomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const bans = await BannedUser.findAll({
      where: {
        room_id: room.id,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      },
      order: [['banned_at', 'DESC']]
    });

    res.json({
      bans: bans.map(ban => ({
        userId: ban.user_identifier,
        bannedBy: ban.banned_by,
        reason: ban.reason,
        bannedAt: ban.banned_at,
        expiresAt: ban.expires_at
      }))
    });
  } catch (error) {
    console.error('Error fetching banned users:', error);
    res.status(500).json({ error: 'Failed to fetch banned users' });
  }
});

// Add moderator
router.post('/:roomId/moderator', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, targetUserId, permissions } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedUserId = validateUserId(userId);
    const validatedTargetUserId = validateUserId(targetUserId);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Only owner can add moderators
    if (room.owner_user_id !== validatedUserId) {
      return res.status(403).json({ error: 'Only owner can add moderators' });
    }

    await RoomModerator.create({
      room_id: room.id,
      user_identifier: validatedTargetUserId,
      granted_by: validatedUserId,
      permissions: permissions || {
        can_kick: true,
        can_ban: true,
        can_mute: false,
        can_change_settings: false
      }
    });

    res.json({ message: 'Moderator added successfully' });
  } catch (error) {
    console.error('Error adding moderator:', error);
    res.status(500).json({ error: error.message || 'Failed to add moderator' });
  }
});

// Remove moderator
router.delete('/:roomId/moderator/:targetUserId', async (req, res) => {
  try {
    const { roomId, targetUserId } = req.params;
    const { userId } = req.body;

    // Validate inputs
    const validatedRoomId = validateRoomId(roomId);
    const validatedTargetUserId = validateUserId(targetUserId);
    const validatedUserId = validateUserId(userId);

    const room = await Room.findOne({ where: { room_id: validatedRoomId } });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Only owner can remove moderators
    if (room.owner_user_id !== validatedUserId) {
      return res.status(403).json({ error: 'Only owner can remove moderators' });
    }

    await RoomModerator.destroy({
      where: {
        room_id: room.id,
        user_identifier: validatedTargetUserId
      }
    });

    res.json({ message: 'Moderator removed successfully' });
  } catch (error) {
    console.error('Error removing moderator:', error);
    res.status(500).json({ error: error.message || 'Failed to remove moderator' });
  }
});

module.exports = router;
