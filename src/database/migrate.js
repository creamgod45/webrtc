const { sequelize, testConnection } = require('./config');
const models = require('../models');

async function migrate() {
  try {
    console.log('🔄 Starting database migration...');

    // Test connection
    await testConnection();

    // Sync all models (alter: false for safety)
    await sequelize.sync({ alter: false });

    console.log('✅ Database migration completed successfully!');
    console.log('\nCreated/Updated tables:');
    console.log('  - rooms (✨ added: password, is_private, owner_user_id)');
    console.log('  - users');
    console.log('  - messages');
    console.log('  - ice_candidates');
    console.log('  - sdp_signals');
    console.log('  - banned_users (🆕 new)');
    console.log('  - room_moderators (🆕 new)');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;
