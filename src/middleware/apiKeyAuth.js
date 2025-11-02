const crypto = require('crypto');
const { ApiKey } = require('../models');
const { Op } = require('sequelize');

/**
 * Middleware to verify API key from X-API-KEY header
 * Used for /api/ routes
 */
async function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Please provide X-API-KEY header.'
    });
  }

  try {
    // Hash the provided key
    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');

    // Find the key in database
    const key = await ApiKey.findOne({
      where: {
        key_hash: keyHash,
        is_active: true,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      }
    });

    if (!key) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired API key'
      });
    }

    // Update last used timestamp
    await key.update({ last_used_at: new Date() });

    // Attach key info to request
    req.apiKey = {
      id: key.id,
      name: key.name
    };

    next();
  } catch (error) {
    console.error('API key verification error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify API key'
    });
  }
}

/**
 * Optional API key verification
 * Allows requests to proceed even without a valid key
 */
async function optionalApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return next();
  }

  try {
    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');

    const key = await ApiKey.findOne({
      where: {
        key_hash: keyHash,
        is_active: true,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      }
    });

    if (key) {
      await key.update({ last_used_at: new Date() });
      req.apiKey = {
        id: key.id,
        name: key.name
      };
    }

    next();
  } catch (error) {
    console.error('API key verification error:', error);
    next();
  }
}

module.exports = {
  verifyApiKey,
  optionalApiKey
};
