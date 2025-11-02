const crypto = require('crypto');
const { ApiKey } = require('../models');
const { Op } = require('sequelize');
const { getTokenFromRequest } = require('./csrfProtection');

/**
 * Hybrid Authentication Middleware
 *
 * Accepts either:
 * 1. CSRF Token (for frontend web UI)
 * 2. API Key (for third-party API access)
 *
 * This allows both authenticated web users and API clients to access endpoints
 */

/**
 * Helper to get CSRF token from request
 */
function getCsrfTokenFromRequest(req) {
  return (
    req.headers['x-csrf-token'] ||
    req.body?.csrfToken ||
    req.query?.csrfToken
  );
}

/**
 * Verify either CSRF token OR API key
 * At least one must be valid for the request to proceed
 */
async function verifyHybridAuth(req, res, next) {
  // Skip verification for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Try API Key first
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
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

      if (key) {
        // API key is valid
        await key.update({ last_used_at: new Date() });
        req.apiKey = {
          id: key.id,
          name: key.name
        };
        req.authMethod = 'api-key';
        return next();
      }
    } catch (error) {
      console.error('API key verification error:', error);
      // Continue to try CSRF token
    }
  }

  // Try CSRF Token
  const sessionToken = req.session?.csrfToken;
  const requestToken = getCsrfTokenFromRequest(req);

  if (sessionToken && requestToken) {
    try {
      if (crypto.timingSafeEqual(
        Buffer.from(sessionToken),
        Buffer.from(requestToken)
      )) {
        // CSRF token is valid
        req.csrfVerified = true;
        req.authMethod = 'csrf-token';
        return next();
      }
    } catch (error) {
      // Length mismatch or other error - token invalid
    }
  }

  // Neither authentication method succeeded
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Authentication required. Please provide either X-API-Key or X-CSRF-Token header.',
    hint: 'Frontend users: Include X-CSRF-Token from /api/csrf-token. API users: Include X-API-Key header.'
  });
}

/**
 * Optional hybrid auth - doesn't block if neither is present
 * Useful for endpoints that are public but track authenticated users
 */
async function optionalHybridAuth(req, res, next) {
  // Try API Key
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
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
        req.authMethod = 'api-key';
        return next();
      }
    } catch (error) {
      console.error('API key verification error:', error);
    }
  }

  // Try CSRF Token
  const sessionToken = req.session?.csrfToken;
  const requestToken = getCsrfTokenFromRequest(req);

  if (sessionToken && requestToken) {
    try {
      if (crypto.timingSafeEqual(
        Buffer.from(sessionToken),
        Buffer.from(requestToken)
      )) {
        req.csrfVerified = true;
        req.authMethod = 'csrf-token';
      }
    } catch (error) {
      // Ignore
    }
  }

  // Always proceed
  next();
}

module.exports = {
  verifyHybridAuth,
  optionalHybridAuth
};
