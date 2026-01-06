/** @typedef {import('sequelize').Model} Model */
/** @typedef {import('sequelize').DataTypes} DataTypes */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

/**
 * Message model representing a chat message
 * @typedef {Object} MessageAttributes
 * @property {string} id - UUID primary key
 * @property {string} room_id - UUID foreign key to rooms table
 * @property {string} sender_id - User ID who sent the message
 * @property {string} text - Message text (may be encrypted)
 * @property {Date} timestamp - When message was sent
 */

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
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
  sender_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID who sent the message'
  },
  text: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'messages',
  indexes: [
    {
      fields: ['room_id', 'timestamp']
    }
  ]
});

module.exports = Message;
