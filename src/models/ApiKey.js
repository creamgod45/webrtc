const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

const ApiKey = sequelize.define('ApiKey', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  key_hash: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false,
    comment: 'SHA-256 hash of the API key'
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Friendly name for the API key'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: 'When the key was created'
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the key expires (null = never)'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether the key is currently active'
  },
  last_used_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time this key was used'
  }
}, {
  tableName: 'api_keys',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['key_hash']
    },
    {
      fields: ['is_active']
    },
    {
      fields: ['expires_at']
    }
  ]
});

module.exports = ApiKey;
