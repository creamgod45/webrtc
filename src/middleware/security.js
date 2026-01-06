/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').NextFunction} NextFunction */

/**
 * Security Middleware and Utilities
 *
 * Provides XSS protection, input validation, and sanitization
 */

/**
 * Sanitize user input to prevent XSS attacks
 * Removes potentially dangerous characters and tags
 * @param {any} input - Input to sanitize
 * @returns {any} Sanitized input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  // Remove HTML tags
  let sanitized = input.replace(/<[^>]*>/g, '');

  // Escape special characters
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  sanitized = sanitized.replace(/[&<>"'/]/g, char => escapeMap[char]);

  return sanitized;
}

/**
 * Validate and sanitize room ID
 * Only allows alphanumeric, dashes, and underscores
 * @param {string} roomId - Room ID to validate
 * @returns {string} Validated room ID
 * @throws {Error} If room ID is invalid
 */
function validateRoomId(roomId) {
  if (typeof roomId !== 'string') {
    throw new Error('Room ID must be a string');
  }

  if (roomId.length < 3 || roomId.length > 50) {
    throw new Error('Room ID must be between 3 and 50 characters');
  }

  // Only allow alphanumeric, dashes, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) {
    throw new Error('Room ID can only contain letters, numbers, dashes, and underscores');
  }

  return roomId;
}

/**
 * Validate and sanitize user ID
 * @param {string} userId - User ID to validate
 * @returns {string} Validated user ID
 * @throws {Error} If user ID is invalid
 */
function validateUserId(userId) {
  if (typeof userId !== 'string') {
    throw new Error('User ID must be a string');
  }

  if (userId.length < 1 || userId.length > 50) {
    throw new Error('User ID must be between 1 and 50 characters');
  }

  // Only allow alphanumeric and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(userId)) {
    throw new Error('User ID can only contain letters, numbers, and underscores');
  }

  return userId;
}

/**
 * Validate room name
 * @param {string|null|undefined} name - Room name to validate
 * @returns {string|null} Validated and sanitized room name
 * @throws {Error} If room name is invalid
 */
function validateRoomName(name) {
  if (name === null || name === undefined || name === '') {
    return null;
  }

  if (typeof name !== 'string') {
    throw new Error('Room name must be a string');
  }

  if (name.length > 100) {
    throw new Error('Room name must be 100 characters or less');
  }

  return sanitizeInput(name.trim());
}

/**
 * Validate password
 * @param {string|null|undefined} password - Password to validate
 * @returns {string|null} Validated password
 * @throws {Error} If password is invalid
 */
function validatePassword(password) {
  if (password === null || password === undefined || password === '') {
    return null;
  }

  if (typeof password !== 'string') {
    throw new Error('Password must be a string');
  }

  if (password.length > 100) {
    throw new Error('Password must be 100 characters or less');
  }

  return password; // Don't sanitize passwords, just validate length
}

/**
 * Validate max users
 * @param {number|string} maxUsers - Maximum number of users
 * @returns {number} Validated max users value
 * @throws {Error} If max users is invalid
 */
function validateMaxUsers(maxUsers) {
  const parsed = parseInt(maxUsers);

  if (isNaN(parsed) || parsed < 2 || parsed > 50) {
    throw new Error('Max users must be between 2 and 50');
  }

  return parsed;
}

/**
 * Validate message text
 * @param {string} text - Message text to validate (may be encrypted)
 * @returns {string} Validated message text
 * @throws {Error} If message text is invalid
 */
function validateMessageText(text) {
  if (typeof text !== 'string') {
    throw new Error('Message text must be a string');
  }

  if (text.length === 0) {
    throw new Error('Message cannot be empty');
  }

  // Note: Message might be encrypted, so max length is higher
  if (text.length > 2100) {
    throw new Error('Message is too long');
  }

  return text;
}

/**
 * Validate ban/kick reason
 * @param {string|null|undefined} reason - Reason text
 * @returns {string|null} Validated and sanitized reason
 * @throws {Error} If reason is invalid
 */
function validateReason(reason) {
  if (reason === null || reason === undefined || reason === '') {
    return null;
  }

  if (typeof reason !== 'string') {
    throw new Error('Reason must be a string');
  }

  if (reason.length > 500) {
    throw new Error('Reason must be 500 characters or less');
  }

  return sanitizeInput(reason.trim());
}

/**
 * Validate duration (in hours)
 * @param {number|string|null|undefined} duration - Duration in hours
 * @returns {number|null} Validated duration
 * @throws {Error} If duration is invalid
 */
function validateDuration(duration) {
  if (duration === null || duration === undefined) {
    return null;
  }

  const parsed = parseInt(duration);

  if (isNaN(parsed) || parsed < 1 || parsed > 8760) { // Max 1 year
    throw new Error('Duration must be between 1 hour and 1 year (8760 hours)');
  }

  return parsed;
}

/**
 * Middleware to sanitize request body
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {NextFunction} next - Next middleware function
 * @returns {void}
 */
function sanitizeRequestBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string' && key !== 'password') {
        // Don't sanitize passwords, but sanitize other string fields
        req.body[key] = req.body[key].trim();
      }
    });
  }
  next();
}

/**
 * Rate limiting helper - track requests per IP
 * @typedef {{count: number, resetTime: number}} RateLimitRecord
 * @type {Map<string, RateLimitRecord>}
 */
const requestCounts = new Map();

/**
 * Check if request is within rate limit
 * @param {string} identifier - Unique identifier (usually IP address)
 * @param {number} maxRequests - Maximum number of requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} True if within rate limit, false otherwise
 */
function rateLimitCheck(identifier, maxRequests = 100, windowMs = 60000) {
  const now = Date.now();
  const record = requestCounts.get(identifier);

  if (!record) {
    requestCounts.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (now > record.resetTime) {
    requestCounts.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Clean up old rate limit records periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [identifier, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(identifier);
    }
  }
}, 60000); // Clean up every minute

module.exports = {
  sanitizeInput,
  validateRoomId,
  validateUserId,
  validateRoomName,
  validatePassword,
  validateMaxUsers,
  validateMessageText,
  validateReason,
  validateDuration,
  sanitizeRequestBody,
  rateLimitCheck
};
