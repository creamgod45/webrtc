const { sequelize } = require('../database/config');
const Room = require('./Room');
const User = require('./User');
const Message = require('./Message');
const IceCandidate = require('./IceCandidate');
const SdpSignal = require('./SdpSignal');
const BannedUser = require('./BannedUser');
const RoomModerator = require('./RoomModerator');

// Define relationships
Room.hasMany(User, { foreignKey: 'room_id', as: 'users', onDelete: 'CASCADE' });
User.belongsTo(Room, { foreignKey: 'room_id' });

Room.hasMany(Message, { foreignKey: 'room_id', as: 'messages', onDelete: 'CASCADE' });
Message.belongsTo(Room, { foreignKey: 'room_id' });

Room.hasMany(IceCandidate, { foreignKey: 'room_id', as: 'ice_candidates', onDelete: 'CASCADE' });
IceCandidate.belongsTo(Room, { foreignKey: 'room_id' });

Room.hasMany(SdpSignal, { foreignKey: 'room_id', as: 'sdp_signals', onDelete: 'CASCADE' });
SdpSignal.belongsTo(Room, { foreignKey: 'room_id' });

Room.hasMany(BannedUser, { foreignKey: 'room_id', as: 'banned_users', onDelete: 'CASCADE' });
BannedUser.belongsTo(Room, { foreignKey: 'room_id' });

Room.hasMany(RoomModerator, { foreignKey: 'room_id', as: 'moderators', onDelete: 'CASCADE' });
RoomModerator.belongsTo(Room, { foreignKey: 'room_id' });

module.exports = {
  sequelize,
  Room,
  User,
  Message,
  IceCandidate,
  SdpSignal,
  BannedUser,
  RoomModerator
};
