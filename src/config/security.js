/**
 * WebSocket Security Configuration
 *
 * Centralized security settings for WebSocket connections
 * Based on WebSocket security threat assessment recommendations
 */

module.exports = {
  // ===== Transport Layer Security =====
  websocket: {
    // Force WSS (WebSocket Secure) in production
    forceSecure: process.env.NODE_ENV === 'production',

    // Allowed origins (strict Origin validation)
    // In production, this should be set to specific domains
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000']),

    // Connection timeouts
    pingTimeout: 30000,   // 30 seconds
    pingInterval: 10000,  // 10 seconds
    connectTimeout: 45000, // 45 seconds

    // Heartbeat/idle timeout
    heartbeatTimeout: 30000, // 30 seconds of inactivity
  },

  // ===== Connection Rate Limiting =====
  rateLimit: {
    // Connection limits per IP
    maxConnectionsPerIP: 5,
    connectionWindowMs: 60000, // 1 minute

    // Connection limits per user
    maxConnectionsPerUser: 3,

    // Message rate limits
    maxMessagesPerMinute: 60,
    maxMessagesPerSecond: 5,

    // Event-specific rate limits
    events: {
      'send-offer': { max: 10, windowMs: 60000 },
      'send-answer': { max: 10, windowMs: 60000 },
      'send-ice-candidate': { max: 100, windowMs: 60000 },
      'send-message': { max: 30, windowMs: 60000 },
      'create-room': { max: 5, windowMs: 300000 }, // 5 per 5 minutes
      'join-room': { max: 10, windowMs: 60000 },
    }
  },

  // ===== Input Validation & Data Limits =====
  validation: {
    // Message size limits (bytes)
    maxMessageSize: 10240, // 10KB
    maxOfferSize: 51200,   // 50KB (SDP can be large)
    maxAnswerSize: 51200,  // 50KB
    maxCandidateSize: 2048, // 2KB

    // String length limits
    maxRoomIdLength: 50,
    maxUserIdLength: 50,
    maxMessageTextLength: 2100, // Text message length limit

    // Room limits
    maxRoomsPerUser: 3,
    absoluteMaxUsers: 50,
  },

  // ===== Authentication & Authorization =====
  auth: {
    // Require authentication for WebSocket connections
    requireAuth: process.env.WS_REQUIRE_AUTH === 'true',

    // Token expiration (for future JWT implementation)
    tokenExpirationMs: 24 * 60 * 60 * 1000, // 24 hours

    // Session validation
    validateSession: true,
  },

  // ===== Monitoring & Logging =====
  monitoring: {
    // Enable security event logging
    enableSecurityLog: true,

    // Log suspicious activities
    logSuspiciousActivities: true,

    // Anomaly detection thresholds
    anomalyDetection: {
      // Rapid connection/disconnection
      maxConnectionsPerMinute: 10,

      // Rapid room creation
      maxRoomCreationsPerHour: 20,

      // Large payload detection
      largePayloadThreshold: 50000, // 50KB

      // Failed authentication attempts
      maxFailedAuthAttempts: 5,
      failedAuthWindowMs: 300000, // 5 minutes
    }
  },

  // ===== Blacklist & IP Blocking =====
  blocking: {
    // Enable automatic IP blocking
    enableAutoBlock: true,

    // Block duration (milliseconds)
    blockDurationMs: 60 * 60 * 1000, // 1 hour

    // Triggers for auto-blocking
    autoBlockThreshold: {
      rateLimitViolations: 10,
      validationErrors: 20,
      authFailures: 5,
    }
  }
};
