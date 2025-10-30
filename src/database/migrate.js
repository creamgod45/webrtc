const { sequelize, testConnection } = require('./config');
const models = require('../models');

async function migrate() {
  try {
    console.log('🔄 Starting database migration...');

    // Test connection
    await testConnection();

    // Sync all models
    await sequelize.sync({ alter: true });

    console.log('✅ Database migration completed successfully!');
    console.log('\nCreated tables:');
    console.log('  - rooms');
    console.log('  - users');
    console.log('  - messages');
    console.log('  - ice_candidates');
    console.log('  - sdp_signals');

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
