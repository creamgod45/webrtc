/**
 * Security Monitoring API Routes
 *
 * Admin endpoints for viewing security events, blocked IPs, and connection stats
 */

const express = require('express');
const router = express.Router();
const {
  getSecurityEvents,
  getBlockedIPs,
  getConnectionStats,
  blockIP
} = require('../middleware/websocketSecurity');

// Import admin authentication middleware
// Fixed: Add explicit authentication to security routes
const { getAdminPassword } = require('./admin');

/**
 * Middleware to verify admin password
 * Required for all security monitoring endpoints
 */
function verifyAdminPassword(req, res, next) {
  const providedPassword = req.headers['x-admin-password'] || req.body.adminPassword;
  const ADMIN_PASSWORD = getAdminPassword();

  if (!providedPassword || providedPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or missing admin password. Provide via X-Admin-Password header.'
    });
  }

  next();
}

/**
 * Validate IPv4 address
 * Fixed: Proper IPv4 validation (CWE-20)
 */
function isValidIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  return parts.every(part => {
    const num = parseInt(part, 10);
    // Check for valid number, no leading zeros (except '0' itself), and range 0-255
    return /^\d+$/.test(part) &&
           num >= 0 &&
           num <= 255 &&
           (part === '0' || !part.startsWith('0'));
  });
}

/**
 * Validate IPv6 address
 * Fixed: Proper IPv6 validation (CWE-20)
 */
function isValidIPv6(ip) {
  // IPv6 can have one :: (zero compression) or be full notation
  const parts = ip.split(':');

  // Check for :: (zero compression)
  if (ip.includes('::')) {
    // Can only have one ::
    if (ip.split('::').length > 2) return false;
    // Split by :: to validate both parts
    const [left, right] = ip.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    // Total parts must be <= 8 (allowing compression)
    if (leftParts.length + rightParts.length >= 8) return false;
    // Validate each part
    return [...leftParts, ...rightParts].every(part =>
      part === '' || /^[0-9a-fA-F]{1,4}$/.test(part)
    );
  }

  // Full notation must have exactly 8 parts
  if (parts.length !== 8) return false;

  // Each part must be 1-4 hex digits
  return parts.every(part => /^[0-9a-fA-F]{1,4}$/.test(part));
}

/**
 * Validate IP address (IPv4 or IPv6)
 */
function isValidIP(ip) {
  return isValidIPv4(ip) || isValidIPv6(ip);
}

/**
 * GET /admin/security/events
 * Get recent security events
 * Requires admin authentication via X-Admin-Password header
 */
router.get('/events', verifyAdminPassword, (req, res) => {
  try {
    const { severity, type, limit = 100 } = req.query;
    let events = getSecurityEvents();

    // Filter by severity if specified
    // Fixed: Proper input validation to prevent bypass (CWE-20)
    if (severity) {
      const severityNum = parseInt(severity, 10);
      if (isNaN(severityNum) || severityNum < 1 || severityNum > 4) {
        return res.status(400).json({
          success: false,
          error: 'Invalid severity level. Must be an integer between 1 and 4.'
        });
      }
      events = events.filter(e => e.severity >= severityNum);
    }

    // Filter by type if specified
    // Fixed: Validate type parameter to prevent injection attacks (CWE-20)
    if (type) {
      // Validate type parameter against known event types
      const validEventTypes = [
        'blocked_ip_attempt', 'rate_limit_connection_rejected', 'invalid_origin', 'disconnect',
        'rate_limit_message_rejected', 'rate_limit_message_burst', 'validation_rejected',
        'validation_payload_size', 'validation_json_error', 'anomaly_rapid_connections',
        'anomaly_rapid_room_creation', 'anomaly_large_payload', 'anomaly_auth_failures',
        'ip_blocked', 'ip_unblocked', 'handler_error'
      ];

      if (!validEventTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid event type. Use /admin/security/event-types to see valid types.'
        });
      }

      events = events.filter(e => e.type === type);
    }

    // Limit results
    const limitNum = Math.min(parseInt(limit), 1000);
    events = events.slice(-limitNum);

    res.json({
      success: true,
      count: events.length,
      events: events.reverse() // Most recent first
    });
  } catch (error) {
    console.error('Error fetching security events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch security events'
    });
  }
});

/**
 * GET /admin/security/blocked-ips
 * Get list of blocked IP addresses
 * Requires admin authentication via X-Admin-Password header
 */
router.get('/blocked-ips', verifyAdminPassword, (req, res) => {
  try {
    const blockedIPs = getBlockedIPs();
    const now = Date.now();

    const blockedList = Array.from(blockedIPs.entries()).map(([ip, info]) => ({
      ip,
      blockedAt: info.blockedAt,
      blockedUntil: new Date(info.blockedUntil).toISOString(),
      reason: info.reason,
      violations: info.violations,
      remainingMs: Math.max(0, info.blockedUntil - now),
      isActive: now < info.blockedUntil
    }));

    res.json({
      success: true,
      count: blockedList.length,
      activeCount: blockedList.filter(b => b.isActive).length,
      blockedIPs: blockedList
    });
  } catch (error) {
    console.error('Error fetching blocked IPs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch blocked IPs'
    });
  }
});

/**
 * GET /admin/security/stats
 * Get connection statistics
 * Requires admin authentication via X-Admin-Password header
 */
router.get('/stats', verifyAdminPassword, (req, res) => {
  try {
    const stats = getConnectionStats();
    const blockedIPs = getBlockedIPs();
    const events = getSecurityEvents();

    // Count events by severity
    const eventsBySeverity = events.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {});

    // Count events by type
    const eventsByType = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});

    // Get recent events (last hour)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recentEvents = events.filter(e => e.timestamp > oneHourAgo);

    res.json({
      success: true,
      connections: stats,
      security: {
        totalEvents: events.length,
        recentEvents: recentEvents.length,
        eventsBySeverity,
        eventsByType,
        blockedIPCount: blockedIPs.size,
        activeBlockedIPCount: Array.from(blockedIPs.values()).filter(
          info => Date.now() < info.blockedUntil
        ).length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching security stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch security stats'
    });
  }
});

/**
 * POST /admin/security/block-ip
 * Manually block an IP address
 * Requires admin authentication via X-Admin-Password header
 */
router.post('/block-ip', verifyAdminPassword, (req, res) => {
  try {
    const { ip, reason, duration } = req.body;

    if (!ip) {
      return res.status(400).json({
        success: false,
        error: 'IP address is required'
      });
    }

    // Fixed: Proper IP validation for both IPv4 and IPv6 (CWE-20)
    if (!isValidIP(ip)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid IP address format. Must be a valid IPv4 or IPv6 address.'
      });
    }

    const blockDuration = duration || 3600000; // Default 1 hour
    const blockReason = reason || 'Manually blocked by admin';

    blockIP(ip, blockReason, blockDuration);

    res.json({
      success: true,
      message: `IP ${ip} has been blocked`,
      blockedUntil: new Date(Date.now() + blockDuration).toISOString()
    });
  } catch (error) {
    console.error('Error blocking IP:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to block IP'
    });
  }
});

/**
 * GET /admin/security/event-types
 * Get list of all event types with descriptions
 * Requires admin authentication via X-Admin-Password header
 */
router.get('/event-types', verifyAdminPassword, (req, res) => {
  const eventTypes = {
    // Connection events
    'blocked_ip_attempt': {
      severity: 4,
      description: 'Blocked IP attempted to connect'
    },
    'rate_limit_connection_rejected': {
      severity: 3,
      description: 'Connection rejected due to rate limiting'
    },
    'invalid_origin': {
      severity: 3,
      description: 'Invalid origin in connection request'
    },
    'disconnect': {
      severity: 1,
      description: 'Normal client disconnection'
    },

    // Message events
    'rate_limit_message_rejected': {
      severity: 2,
      description: 'Message rejected due to rate limiting'
    },
    'rate_limit_message_burst': {
      severity: 3,
      description: 'Too many messages in short time (burst)'
    },
    'validation_rejected': {
      severity: 2,
      description: 'Message validation failed'
    },
    'validation_payload_size': {
      severity: 2,
      description: 'Payload size exceeds limit'
    },

    // Anomaly detection
    'anomaly_rapid_connections': {
      severity: 3,
      description: 'Rapid connection/disconnection pattern detected'
    },
    'anomaly_rapid_room_creation': {
      severity: 3,
      description: 'Too many rooms created in short time'
    },
    'anomaly_large_payload': {
      severity: 3,
      description: 'Unusually large payload detected'
    },
    'anomaly_auth_failures': {
      severity: 4,
      description: 'Multiple authentication failures'
    },

    // IP blocking
    'ip_blocked': {
      severity: 4,
      description: 'IP address has been blocked'
    },
    'ip_unblocked': {
      severity: 2,
      description: 'IP block has expired'
    },

    // Handler errors
    'handler_error': {
      severity: 2,
      description: 'Error occurred in event handler'
    }
  };

  res.json({
    success: true,
    eventTypes
  });
});

module.exports = router;
