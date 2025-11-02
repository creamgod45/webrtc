const { sequelize } = require('./config');

async function addApiKeysTable() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    console.log('Starting API keys table migration...');

    // Check if api_keys table exists
    const tables = await queryInterface.showAllTables();
    const tableExists = tables.includes('api_keys');

    if (!tableExists) {
      console.log('Creating api_keys table...');

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS "api_keys" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "key_hash" VARCHAR(255) UNIQUE NOT NULL,
          "name" VARCHAR(255) NOT NULL,
          "expires_at" TIMESTAMP WITH TIME ZONE,
          "is_active" BOOLEAN DEFAULT true,
          "last_used_at" TIMESTAMP WITH TIME ZONE,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
      `);
      console.log('✅ api_keys table created');
    } else {
      console.log('api_keys table already exists, skipping...');
    }

    // Create indexes for better performance
    console.log('Creating indexes...');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys" ("key_hash");
    `);
    console.log('✅ Index on key_hash created');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "api_keys_is_active_idx" ON "api_keys" ("is_active");
    `);
    console.log('✅ Index on is_active created');

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "api_keys_expires_at_idx" ON "api_keys" ("expires_at");
    `);
    console.log('✅ Index on expires_at created');

    console.log('\n✅ API keys migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addApiKeysTable();
