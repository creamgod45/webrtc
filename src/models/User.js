/** @typedef {import('sequelize').Model} Model */
/** @typedef {import('sequelize').DataTypes} DataTypes */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

/**
 * User model representing a user in a room
 * @typedef {Object} UserAttributes
 * @property {string} id - UUID primary key
 * @property {string} user_id - User identifier (e.g., "user1", "user2")
 * @property {string} room_id - UUID foreign key to rooms table
 * @property {string|null} socket_id - Current WebSocket connection ID
 * @property {boolean} is_connected - Whether user is currently connected
 * @property {Date} joined_at - When user joined the room
 * @property {Date|null} left_at - When user left the room
 */

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User identifier (e.g., user1, user2)'
  },
  room_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'rooms',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  socket_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Current WebSocket connection ID'
  },
  is_connected: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether user is currently connected'
  },
  joined_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  left_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'users',
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'room_id'],
      name: 'unique_user_per_room'
    },
    {
      fields: ['room_id']
    },
    {
      fields: ['socket_id']
    }
  ]
});

module.exports = User;
