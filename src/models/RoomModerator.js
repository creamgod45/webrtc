const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const RoomModerator = sequelize.define('RoomModerator', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  room_id: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'Room UUID reference'
  },
  user_identifier: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID or session identifier'
  },
  granted_by: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID who granted moderator privileges'
  },
  permissions: {
    type: DataTypes.JSON,
    defaultValue: {
      can_kick: true,
      can_ban: true,
      can_mute: false,
      can_change_settings: false
    },
    comment: 'Moderator permissions object'
  },
  granted_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: 'When moderator privileges were granted'
  }
}, {
  tableName: 'room_moderators',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['room_id', 'user_identifier']
    },
    {
      fields: ['room_id']
    }
  ]
});

module.exports = RoomModerator;
