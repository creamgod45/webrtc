/** @typedef {import('sequelize').Model} Model */
/** @typedef {import('sequelize').DataTypes} DataTypes */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

/**
 * SdpSignal model for WebRTC SDP signaling (offers and answers)
 * @typedef {Object} SdpSignalAttributes
 * @property {string} id - UUID primary key
 * @property {string} room_id - UUID foreign key to rooms table
 * @property {string} from_user - User ID sending the SDP
 * @property {string} to_user - User ID receiving the SDP
 * @property {'offer'|'answer'} type - Type of SDP message
 * @property {Object} sdp - SDP data (JSONB)
 * @property {Date} created_at - When signal was created
 */

const SdpSignal = sequelize.define('SdpSignal', {
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
  from_user: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID sending the SDP'
  },
  to_user: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID receiving the SDP'
  },
  type: {
    type: DataTypes.ENUM('offer', 'answer'),
    allowNull: false,
    comment: 'Type of SDP message'
  },
  sdp: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'SDP data (type and sdp fields)'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'sdp_signals',
  timestamps: false,
  indexes: [
    {
      fields: ['room_id', 'to_user', 'type']
    },
    {
      fields: ['from_user', 'to_user']
    }
  ]
});

module.exports = SdpSignal;
