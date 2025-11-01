const { sequelize, testConnection } = require('./config');
const { QueryTypes } = require('sequelize');

async function migrateRoomSettings() {
  try {
    console.log('🔄 Adding room settings columns...');

    await testConnection();

    // Check if columns already exist
    const columnsQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'rooms' AND table_schema = 'public'
    `;

    const existingColumns = await sequelize.query(columnsQuery, {
      type: QueryTypes.SELECT
    });

    const columnNames = existingColumns.map(c => c.column_name);

    // Add password column if not exists
    if (!columnNames.includes('password')) {
      await sequelize.query(`
        ALTER TABLE rooms
        ADD COLUMN password VARCHAR(255);
      `);
      console.log('✅ Added password column');
    } else {
      console.log('⏭️  password column already exists');
    }

    // Add is_private column if not exists
    if (!columnNames.includes('is_private')) {
      await sequelize.query(`
        ALTER TABLE rooms
        ADD COLUMN is_private BOOLEAN DEFAULT false;
      `);
      console.log('✅ Added is_private column');
    } else {
      console.log('⏭️  is_private column already exists');
    }

    // Add owner_user_id column if not exists
    if (!columnNames.includes('owner_user_id')) {
      await sequelize.query(`
        ALTER TABLE rooms
        ADD COLUMN owner_user_id VARCHAR(255);
      `);
      console.log('✅ Added owner_user_id column');
    } else {
      console.log('⏭️  owner_user_id column already exists');
    }

    // Create banned_users table if not exists
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS banned_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_identifier VARCHAR(255) NOT NULL,
        banned_by VARCHAR(255) NOT NULL,
        reason TEXT,
        banned_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP,
        UNIQUE(room_id, user_identifier)
      );
    `);
    console.log('✅ Created/verified banned_users table');

    // Create room_moderators table if not exists
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS room_moderators (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_identifier VARCHAR(255) NOT NULL,
        granted_by VARCHAR(255) NOT NULL,
        permissions JSONB DEFAULT '{"can_kick": true, "can_ban": true, "can_mute": false, "can_change_settings": false}'::jsonb,
        granted_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(room_id, user_identifier)
      );
    `);
    console.log('✅ Created/verified room_moderators table');

    // Create indexes
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rooms_private_active
      ON rooms(is_private, is_active);
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rooms_owner
      ON rooms(owner_user_id);
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_banned_users_room
      ON banned_users(room_id);
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_room_moderators_room
      ON room_moderators(room_id);
    `);

    console.log('✅ Created indexes');

    console.log('\n✅ Room settings migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateRoomSettings();
}

module.exports = migrateRoomSettings;
