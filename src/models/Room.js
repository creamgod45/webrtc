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
  max_users: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
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
  }
}, {
  tableName: 'rooms',
  indexes: [
    {
      unique: true,
      fields: ['room_id']
    }
  ]
});

module.exports = Room;
