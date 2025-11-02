const express = require('express');
const crypto = require('crypto');
const { ApiKey } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// Global admin password (set on server startup)
let ADMIN_PASSWORD = null;

function setAdminPassword(password) {
  ADMIN_PASSWORD = password;
}

function getAdminPassword() {
  return ADMIN_PASSWORD;
}

// Middleware to verify admin password
function verifyAdminPassword(req, res, next) {
  const providedPassword = req.headers['x-admin-password'] || req.body.adminPassword;

  if (!providedPassword || providedPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid admin password'
    });
  }

  next();
}

// Generate new API key
router.post('/api-keys', verifyAdminPassword, async (req, res) => {
  try {
    const { name, expiresInDays } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate random API key (32 bytes = 64 hex characters)
    const apiKey = crypto.randomBytes(32).toString('hex');

    // Hash the key for storage
    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');

    // Calculate expiry date if provided
    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    }

    // Create API key record
    const key = await ApiKey.create({
      key_hash: keyHash,
      name: name.trim(),
      expires_at: expiresAt,
      is_active: true
    });

    res.status(201).json({
      message: 'API key created successfully',
      apiKey: apiKey, // Only returned once!
      id: key.id,
      name: key.name,
      createdAt: key.created_at,
      expiresAt: key.expires_at,
      warning: 'Save this key now! It will not be shown again.'
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// List all API keys (without the actual keys)
router.get('/api-keys', verifyAdminPassword, async (req, res) => {
  try {
    const keys = await ApiKey.findAll({
      order: [['created_at', 'DESC']]
    });

    res.json({
      keys: keys.map(key => ({
        id: key.id,
        name: key.name,
        isActive: key.is_active,
        createdAt: key.created_at,
        expiresAt: key.expires_at,
        lastUsedAt: key.last_used_at
      }))
    });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Deactivate an API key
router.delete('/api-keys/:keyId', verifyAdminPassword, async (req, res) => {
  try {
    const { keyId } = req.params;

    const key = await ApiKey.findByPk(keyId);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await key.update({ is_active: false });

    res.json({ message: 'API key deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating API key:', error);
    res.status(500).json({ error: 'Failed to deactivate API key' });
  }
});

// Reactivate an API key
router.patch('/api-keys/:keyId/activate', verifyAdminPassword, async (req, res) => {
  try {
    const { keyId } = req.params;

    const key = await ApiKey.findByPk(keyId);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // Check if expired
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Cannot reactivate expired key' });
    }

    await key.update({ is_active: true });

    res.json({ message: 'API key reactivated successfully' });
  } catch (error) {
    console.error('Error reactivating API key:', error);
    res.status(500).json({ error: 'Failed to reactivate API key' });
  }
});

// Verify admin password (for login)
router.post('/verify-password', (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

module.exports = { router, setAdminPassword, getAdminPassword };
