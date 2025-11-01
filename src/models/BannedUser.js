const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const BannedUser = sequelize.define('BannedUser', {
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
  banned_by: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID who banned this user'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Reason for ban'
  },
  banned_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: 'When the user was banned'
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the ban expires (null = permanent)'
  }
}, {
  tableName: 'banned_users',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['room_id', 'user_identifier']
    },
    {
      fields: ['room_id']
    },
    {
      fields: ['expires_at']
    }
  ]
});

module.exports = BannedUser;
