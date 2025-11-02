'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create rooms table
    await queryInterface.createTable('rooms', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      room_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      password: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Bcrypt hashed password'
      },
      is_private: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      max_users: {
        type: Sequelize.INTEGER,
        defaultValue: 10
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: true
      },
      owner_user_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'User ID of room owner (for permissions)'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create users table
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rooms',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      socket_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      is_connected: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      joined_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      left_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create messages table
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rooms',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      sender_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      text: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create ice_candidates table
    await queryInterface.createTable('ice_candidates', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rooms',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      from_user: {
        type: Sequelize.STRING,
        allowNull: false
      },
      to_user: {
        type: Sequelize.STRING,
        allowNull: false
      },
      candidate: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create sdp_signals table
    await queryInterface.createTable('sdp_signals', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rooms',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      from_user: {
        type: Sequelize.STRING,
        allowNull: false
      },
      to_user: {
        type: Sequelize.STRING,
        allowNull: false
      },
      type: {
        type: Sequelize.ENUM('offer', 'answer'),
        allowNull: false
      },
      sdp: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create banned_users table
    await queryInterface.createTable('banned_users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rooms',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      user_identifier: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'User ID or session ID'
      },
      banned_by: {
        type: Sequelize.STRING,
        allowNull: false
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      banned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Null means permanent ban'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create room_moderators table
    await queryInterface.createTable('room_moderators', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      room_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rooms',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      user_identifier: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'User ID or session ID'
      },
      granted_by: {
        type: Sequelize.STRING,
        allowNull: false
      },
      permissions: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {
          can_kick: true,
          can_ban: true,
          can_mute: false,
          can_change_settings: false
        }
      },
      granted_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Create api_keys table
    await queryInterface.createTable('api_keys', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      key_hash: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        comment: 'SHA-256 hash of the API key'
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Add indexes
    await queryInterface.addIndex('users', ['room_id', 'is_connected']);
    await queryInterface.addIndex('messages', ['room_id', 'timestamp']);
    await queryInterface.addIndex('ice_candidates', ['room_id', 'from_user', 'to_user']);
    await queryInterface.addIndex('sdp_signals', ['room_id', 'from_user', 'to_user']);
    await queryInterface.addIndex('banned_users', ['room_id', 'user_identifier']);
    await queryInterface.addIndex('room_moderators', ['room_id', 'user_identifier']);
    await queryInterface.addIndex('api_keys', ['key_hash']);
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order to respect foreign key constraints
    await queryInterface.dropTable('api_keys');
    await queryInterface.dropTable('room_moderators');
    await queryInterface.dropTable('banned_users');
    await queryInterface.dropTable('sdp_signals');
    await queryInterface.dropTable('ice_candidates');
    await queryInterface.dropTable('messages');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('rooms');
  }
};
