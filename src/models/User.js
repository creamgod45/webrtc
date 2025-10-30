const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.STRING,
    unique: true,
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
      fields: ['room_id']
    },
    {
      fields: ['socket_id']
    },
    {
      fields: ['user_id', 'room_id']
    }
  ]
});

module.exports = User;
