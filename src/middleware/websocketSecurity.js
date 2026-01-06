/**
 * WebSocket Security Middleware
 *
 * Implements comprehensive security measures for WebSocket connections:
 * - Origin validation
 * - Connection rate limiting
 * - Message rate limiting
 * - IP blocking/blacklisting
 * - Security event logging
 * - Anomaly detection
 */

const securityConfig = require('../config/security');

// ===== State Management =====
// Connection tracking per IP
const connectionsByIP = new Map(); // IP -> { count, resetTime, connections: Set<socketId> }

// Connection tracking per user
const connectionsByUser = new Map(); // userId -> Set<socketId>

// Message rate limiting per socket
const messageRates = new Map(); // socketId -> { event -> { count, resetTime, timestamps: [] } }

// IP blacklist
const blockedIPs = new Map(); // IP -> { blockedUntil, reason, violations }

// Security event log (in-memory, for recent events)
const securityEvents = [];
const MAX_SECURITY_EVENTS = 1000;

// Anomaly detection tracking
const anomalyTracking = new Map(); // IP -> { connections: [], rooms: [], authFailures: [] }

// ===== Helper Functions =====

/**
 * Get client IP address from socket
 */
function getClientIP(socket) {
  return socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() ||
         socket.handshake.address ||
         socket.conn.remoteAddress;
}

/**
 * Log security event
 */
function logSecurityEvent(event) {
  if (!securityConfig.monitoring.enableSecurityLog) return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    ...event
  };

  securityEvents.push(logEntry);

  // Keep only recent events
  if (securityEvents.length > MAX_SECURITY_EVENTS) {
    securityEvents.shift();
  }

  // Log to console if suspicious
  if (securityConfig.monitoring.logSuspiciousActivities && event.severity >= 3) {
    console.warn('🚨 Security Event:', logEntry);
  }
}

/**
 * Check if IP is blocked
 */
function isIPBlocked(ip) {
  const blockInfo = blockedIPs.get(ip);
  if (!blockInfo) return false;

  if (Date.now() < blockInfo.blockedUntil) {
    return true;
  }

  // Block expired, remove from blacklist
  blockedIPs.delete(ip);
  logSecurityEvent({
    type: 'ip_unblocked',
    ip,
    severity: 2,
    details: 'Block duration expired'
  });
  return false;
}

/**
 * Block an IP address
 */
function blockIP(ip, reason, duration = securityConfig.blocking.blockDurationMs) {
  const blockInfo = {
    blockedUntil: Date.now() + duration,
    reason,
    violations: (blockedIPs.get(ip)?.violations || 0) + 1,
    blockedAt: new Date().toISOString()
  };

  blockedIPs.set(ip, blockInfo);

  logSecurityEvent({
    type: 'ip_blocked',
    ip,
    reason,
    severity: 4,
    details: blockInfo
  });

  console.error(`🚫 Blocked IP ${ip}: ${reason}`);
}

/**
 * Track anomaly for IP
 */
function trackAnomaly(ip, type, data) {
  if (!anomalyTracking.has(ip)) {
    anomalyTracking.set(ip, {
      connections: [],
      rooms: [],
      authFailures: []
    });
  }

  const tracking = anomalyTracking.get(ip);
  const now = Date.now();

  if (type === 'connection') {
    tracking.connections.push(now);
    // Keep only last hour
    tracking.connections = tracking.connections.filter(t => now - t < 3600000);

    // Check rapid connections
    const recentConnections = tracking.connections.filter(
      t => now - t < 60000
    );
    if (recentConnections.length > securityConfig.monitoring.anomalyDetection.maxConnectionsPerMinute) {
      logSecurityEvent({
        type: 'anomaly_rapid_connections',
        ip,
        severity: 3,
        details: { count: recentConnections.length, timeWindow: '1 minute' }
      });
      return 'rapid_connections';
    }
  }

  if (type === 'room_creation') {
    tracking.rooms.push(now);
    tracking.rooms = tracking.rooms.filter(t => now - t < 3600000);

    const recentRooms = tracking.rooms.length;
    if (recentRooms > securityConfig.monitoring.anomalyDetection.maxRoomCreationsPerHour) {
      logSecurityEvent({
        type: 'anomaly_rapid_room_creation',
        ip,
        severity: 3,
        details: { count: recentRooms, timeWindow: '1 hour' }
      });
      return 'rapid_room_creation';
    }
  }

  if (type === 'auth_failure') {
    tracking.authFailures.push(now);
    tracking.authFailures = tracking.authFailures.filter(
      t => now - t < securityConfig.monitoring.anomalyDetection.failedAuthWindowMs
    );

    const recentFailures = tracking.authFailures.length;
    if (recentFailures >= securityConfig.monitoring.anomalyDetection.maxFailedAuthAttempts) {
      logSecurityEvent({
        type: 'anomaly_auth_failures',
        ip,
        severity: 4,
        details: { count: recentFailures, timeWindow: '5 minutes' }
      });
      blockIP(ip, 'Too many authentication failures', 3600000); // Block for 1 hour
      return 'auth_failures';
    }
  }

  return null;
}

// ===== Connection Management =====

/**
 * Check connection rate limit for IP
 */
function checkConnectionRateLimit(ip) {
  const now = Date.now();
  const record = connectionsByIP.get(ip);

  if (!record) {
    connectionsByIP.set(ip, {
      count: 1,
      resetTime: now + securityConfig.rateLimit.connectionWindowMs,
      connections: new Set()
    });
    return { allowed: true };
  }

  // Reset if window expired
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + securityConfig.rateLimit.connectionWindowMs;
    record.connections.clear();
    return { allowed: true };
  }

  // Check limit
  if (record.count >= securityConfig.rateLimit.maxConnectionsPerIP) {
    logSecurityEvent({
      type: 'rate_limit_connection',
      ip,
      severity: 3,
      details: { count: record.count, limit: securityConfig.rateLimit.maxConnectionsPerIP }
    });
    return {
      allowed: false,
      reason: 'Too many connections from this IP',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    };
  }

  record.count++;
  return { allowed: true };
}

/**
 * Register new connection
 */
function registerConnection(ip, socketId, userId = null) {
  // Track by IP
  const ipRecord = connectionsByIP.get(ip);
  if (ipRecord) {
    ipRecord.connections.add(socketId);
  }

  // Track by user
  if (userId) {
    if (!connectionsByUser.has(userId)) {
      connectionsByUser.set(userId, new Set());
    }
    const userConnections = connectionsByUser.get(userId);

    if (userConnections.size >= securityConfig.rateLimit.maxConnectionsPerUser) {
      logSecurityEvent({
        type: 'rate_limit_user_connections',
        userId,
        severity: 2,
        details: { count: userConnections.size, limit: securityConfig.rateLimit.maxConnectionsPerUser }
      });
      return {
        allowed: false,
        reason: 'Too many connections for this user'
      };
    }

    userConnections.add(socketId);
  }

  // Track anomaly
  trackAnomaly(ip, 'connection');

  return { allowed: true };
}

/**
 * Unregister connection
 */
function unregisterConnection(ip, socketId, userId = null) {
  // Remove from IP tracking
  const ipRecord = connectionsByIP.get(ip);
  if (ipRecord) {
    ipRecord.connections.delete(socketId);
    if (ipRecord.connections.size === 0 && Date.now() > ipRecord.resetTime) {
      connectionsByIP.delete(ip);
    }
  }

  // Remove from user tracking
  if (userId) {
    const userConnections = connectionsByUser.get(userId);
    if (userConnections) {
      userConnections.delete(socketId);
      if (userConnections.size === 0) {
        connectionsByUser.delete(userId);
      }
    }
  }

  // Clean up message rates
  messageRates.delete(socketId);
}

// ===== Message Rate Limiting =====

/**
 * Check message rate limit for socket
 */
function checkMessageRateLimit(socketId, eventName) {
  const now = Date.now();

  if (!messageRates.has(socketId)) {
    messageRates.set(socketId, new Map());
  }

  const socketRates = messageRates.get(socketId);

  if (!socketRates.has(eventName)) {
    socketRates.set(eventName, {
      count: 1,
      resetTime: now + (securityConfig.rateLimit.events[eventName]?.windowMs || 60000),
      timestamps: [now]
    });
    return { allowed: true };
  }

  const eventRate = socketRates.get(eventName);

  // Reset if window expired
  if (now > eventRate.resetTime) {
    eventRate.count = 1;
    eventRate.resetTime = now + (securityConfig.rateLimit.events[eventName]?.windowMs || 60000);
    eventRate.timestamps = [now];
    return { allowed: true };
  }

  // Check per-second rate
  eventRate.timestamps.push(now);
  eventRate.timestamps = eventRate.timestamps.filter(t => now - t < 1000);

  if (eventRate.timestamps.length > securityConfig.rateLimit.maxMessagesPerSecond) {
    logSecurityEvent({
      type: 'rate_limit_message_burst',
      socketId,
      eventName,
      severity: 3,
      details: { count: eventRate.timestamps.length, limit: securityConfig.rateLimit.maxMessagesPerSecond }
    });
    return {
      allowed: false,
      reason: 'Message rate too high (per second limit)',
      retryAfter: 1
    };
  }

  // Check event-specific limit
  const eventConfig = securityConfig.rateLimit.events[eventName];
  const limit = eventConfig?.max || securityConfig.rateLimit.maxMessagesPerMinute;

  if (eventRate.count >= limit) {
    logSecurityEvent({
      type: 'rate_limit_message',
      socketId,
      eventName,
      severity: 2,
      details: { count: eventRate.count, limit }
    });
    return {
      allowed: false,
      reason: `Too many ${eventName} events`,
      retryAfter: Math.ceil((eventRate.resetTime - now) / 1000)
    };
  }

  eventRate.count++;
  return { allowed: true };
}

// ===== Origin Validation =====

/**
 * Validate WebSocket origin
 */
function validateOrigin(origin) {
  // Allow undefined origin in development
  if (!origin && process.env.NODE_ENV !== 'production') {
    return true;
  }

  // In production, origin is required
  if (!origin && process.env.NODE_ENV === 'production') {
    return false;
  }

  const allowedOrigins = securityConfig.websocket.allowedOrigins;

  // If no origins configured in production, reject all
  if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
    console.error('⚠️  No allowed origins configured for production!');
    return false;
  }

  // Check against allowed origins
  return allowedOrigins.some(allowed => {
    if (allowed === '*') return true;
    if (allowed === origin) return true;
    // Support wildcard subdomains (e.g., *.example.com)
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2);
      return origin.endsWith(domain);
    }
    return false;
  });
}

// ===== Payload Validation =====

/**
 * Validate message payload size
 */
function validatePayloadSize(data, eventName) {
  const jsonSize = JSON.stringify(data).length;
  let maxSize;

  switch (eventName) {
    case 'send-offer':
      maxSize = securityConfig.validation.maxOfferSize;
      break;
    case 'send-answer':
      maxSize = securityConfig.validation.maxAnswerSize;
      break;
    case 'send-ice-candidate':
      maxSize = securityConfig.validation.maxCandidateSize;
      break;
    case 'send-message':
      maxSize = securityConfig.validation.maxMessageSize;
      break;
    default:
      maxSize = securityConfig.validation.maxMessageSize;
  }

  if (jsonSize > maxSize) {
    logSecurityEvent({
      type: 'validation_payload_size',
      eventName,
      severity: 2,
      details: { size: jsonSize, limit: maxSize }
    });

    // Detect anomaly for very large payloads
    if (jsonSize > securityConfig.monitoring.anomalyDetection.largePayloadThreshold) {
      logSecurityEvent({
        type: 'anomaly_large_payload',
        eventName,
        severity: 3,
        details: { size: jsonSize }
      });
    }

    return {
      valid: false,
      reason: 'Payload too large'
    };
  }

  return { valid: true };
}

// ===== Cleanup Tasks =====

/**
 * Periodic cleanup of expired data
 */
setInterval(() => {
  const now = Date.now();

  // Clean up connection tracking
  for (const [ip, record] of connectionsByIP.entries()) {
    if (now > record.resetTime && record.connections.size === 0) {
      connectionsByIP.delete(ip);
    }
  }

  // Clean up message rates
  for (const [socketId, rates] of messageRates.entries()) {
    for (const [eventName, eventRate] of rates.entries()) {
      if (now > eventRate.resetTime) {
        rates.delete(eventName);
      }
    }
    if (rates.size === 0) {
      messageRates.delete(socketId);
    }
  }

  // Clean up anomaly tracking
  for (const [ip, tracking] of anomalyTracking.entries()) {
    tracking.connections = tracking.connections.filter(t => now - t < 3600000);
    tracking.rooms = tracking.rooms.filter(t => now - t < 3600000);
    tracking.authFailures = tracking.authFailures.filter(
      t => now - t < securityConfig.monitoring.anomalyDetection.failedAuthWindowMs
    );

    if (tracking.connections.length === 0 && tracking.rooms.length === 0 && tracking.authFailures.length === 0) {
      anomalyTracking.delete(ip);
    }
  }
}, 60000); // Run every minute

// ===== Export =====

module.exports = {
  getClientIP,
  logSecurityEvent,
  isIPBlocked,
  blockIP,
  trackAnomaly,
  checkConnectionRateLimit,
  registerConnection,
  unregisterConnection,
  checkMessageRateLimit,
  validateOrigin,
  validatePayloadSize,

  // Expose for monitoring/admin purposes
  getSecurityEvents: () => [...securityEvents],
  getBlockedIPs: () => new Map(blockedIPs),
  getConnectionStats: () => ({
    byIP: connectionsByIP.size,
    byUser: connectionsByUser.size,
    totalConnections: Array.from(connectionsByIP.values()).reduce((sum, r) => sum + r.connections.size, 0)
  })
};
