# Database Migrations

This directory contains database migration files managed by Sequelize CLI.

## Migration Commands

### Apply all pending migrations (Up)
```bash
npm run migrate:up
```

### Revert the most recent migration (Down)
```bash
npm run migrate:down
```

### Revert all migrations
```bash
npm run migrate:down:all
```

### Check migration status
```bash
npm run migrate:status
```

### Create a new migration
```bash
npm run migrate:create -- add-new-feature
```

## Migration File Structure

Migration files follow the naming convention:
```
YYYYMMDDHHMMSS-description.js
```

Each migration file must export two functions:
- `up(queryInterface, Sequelize)`: Applies the migration
- `down(queryInterface, Sequelize)`: Reverts the migration

## Example Migration

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('rooms', 'new_field', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('rooms', 'new_field');
  }
};
```

## Important Notes

1. **Always test migrations** in development before production
2. **Never modify** existing migration files after they've been run
3. **Always provide a `down` method** to allow reverting changes
4. **Use transactions** for complex migrations to ensure atomicity
5. **Backup your database** before running migrations in production

## Migration Workflow

### Development
1. Create migration: `npm run migrate:create -- add-feature`
2. Edit the migration file in `src/database/migrations/`
3. Test up: `npm run migrate:up`
4. Test down: `npm run migrate:down`
5. Commit the migration file to version control

### Production
1. Pull latest code with migration files
2. Backup database
3. Run migrations: `npm run migrate:up`
4. Verify application works correctly
5. If issues occur, rollback: `npm run migrate:down`

## Troubleshooting

### Migration failed
If a migration fails:
1. Check error message for details
2. Fix the issue in the migration file
3. If migration partially completed, manually clean up
4. Rerun the migration

### Out of sync
If migrations are out of sync:
1. Check status: `npm run migrate:status`
2. Review migration history in database table `SequelizeMeta`
3. Manually adjust if needed (advanced)

## Database Schema

See `20250101000000-initial-schema.js` for the complete initial database structure including:
- rooms
- users
- messages
- ice_candidates
- sdp_signals
- banned_users
- room_moderators
- api_keys
