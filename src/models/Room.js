const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const Room = sequelize.define('Room', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  room_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'User-friendly room ID for joining'
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Optional room name'
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Password hash for protected rooms'
  },
  is_private: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether the room is private (not shown in lobby)'
  },
  max_users: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
    validate: {
      min: 2,
      max: 50
    },
    comment: 'Maximum number of users allowed in room'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether the room is currently active'
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'User ID of room creator'
  },
  owner_user_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Current owner user ID (can transfer ownership)'
  }
}, {
  tableName: 'rooms',
  indexes: [
    {
      unique: true,
      fields: ['room_id']
    },
    {
      fields: ['is_private', 'is_active']
    },
    {
      fields: ['owner_user_id']
    }
  ]
});

module.exports = Room;
