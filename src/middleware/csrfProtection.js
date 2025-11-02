const crypto = require('crypto');

/**
 * CSRF Protection Middleware
 *
 * This middleware provides CSRF (Cross-Site Request Forgery) protection using tokens.
 * It works in conjunction with session middleware to validate requests.
 *
 * Strategy:
 * - Tokens are stored in session (server-side)
 * - Tokens are sent to client via /api/csrf-token endpoint
 * - Client includes token in requests via X-CSRF-Token header
 * - Double submit cookie pattern as fallback
 */

/**
 * Generate a new CSRF token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to ensure CSRF token exists in session
 * Generates a new token if one doesn't exist
 */
function ensureToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  next();
}

/**
 * Get CSRF token from request
 * Checks multiple sources: header, body, query
 */
function getTokenFromRequest(req) {
  return (
    req.headers['x-csrf-token'] ||
    req.body?.csrfToken ||
    req.query?.csrfToken
  );
}

/**
 * Verify CSRF token
 * Compares token from request with token in session
 */
function verifyToken(req, res, next) {
  // Skip CSRF check for GET, HEAD, OPTIONS requests (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const sessionToken = req.session.csrfToken;
  const requestToken = getTokenFromRequest(req);

  // Check if session has a token
  if (!sessionToken) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CSRF token not found in session'
    });
  }

  // Check if request has a token
  if (!requestToken) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CSRF token required. Please include X-CSRF-Token header.'
    });
  }

  // Verify tokens match using timing-safe comparison
  if (!crypto.timingSafeEqual(
    Buffer.from(sessionToken),
    Buffer.from(requestToken)
  )) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid CSRF token'
    });
  }

  next();
}

/**
 * Optional CSRF verification
 * Allows requests to proceed even without valid CSRF token
 * (useful for gradual migration)
 */
function optionalVerifyToken(req, res, next) {
  // Skip CSRF check for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const sessionToken = req.session.csrfToken;
  const requestToken = getTokenFromRequest(req);

  // If both tokens exist, verify them
  if (sessionToken && requestToken) {
    try {
      if (crypto.timingSafeEqual(
        Buffer.from(sessionToken),
        Buffer.from(requestToken)
      )) {
        req.csrfVerified = true;
      }
    } catch (error) {
      // Length mismatch or other error - token invalid
      req.csrfVerified = false;
    }
  }

  // Always proceed, but mark verification status
  next();
}

/**
 * Regenerate CSRF token
 * Useful after login or other security-critical operations
 */
function regenerateToken(req, res, next) {
  req.session.csrfToken = generateToken();
  next();
}

module.exports = {
  ensureToken,
  verifyToken,
  optionalVerifyToken,
  regenerateToken,
  generateToken
};
