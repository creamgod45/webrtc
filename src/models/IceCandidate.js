/** @typedef {import('sequelize').Model} Model */
/** @typedef {import('sequelize').DataTypes} DataTypes */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/config');

/**
 * IceCandidate model for WebRTC ICE candidate signaling
 * @typedef {Object} IceCandidateAttributes
 * @property {string} id - UUID primary key
 * @property {string} room_id - UUID foreign key to rooms table
 * @property {string} from_user - User ID sending the ICE candidate
 * @property {string} to_user - User ID receiving the ICE candidate
 * @property {Object} candidate - ICE candidate data (JSONB)
 * @property {Date} created_at - When candidate was created
 */

const IceCandidate = sequelize.define('IceCandidate', {
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
    comment: 'User ID sending the ICE candidate'
  },
  to_user: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User ID receiving the ICE candidate'
  },
  candidate: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'ICE candidate data'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ice_candidates',
  timestamps: false,
  indexes: [
    {
      fields: ['room_id', 'to_user']
    },
    {
      fields: ['from_user', 'to_user']
    }
  ]
});

module.exports = IceCandidate;
