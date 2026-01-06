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

/**
 * GET /admin/security/events
 * Get recent security events
 */
router.get('/events', (req, res) => {
  try {
    const { severity, type, limit = 100 } = req.query;
    let events = getSecurityEvents();

    // Filter by severity if specified
    if (severity) {
      const severityNum = parseInt(severity);
      events = events.filter(e => e.severity >= severityNum);
    }

    // Filter by type if specified
    if (type) {
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
 */
router.get('/blocked-ips', (req, res) => {
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
 */
router.get('/stats', (req, res) => {
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
 */
router.post('/block-ip', (req, res) => {
  try {
    const { ip, reason, duration } = req.body;

    if (!ip) {
      return res.status(400).json({
        success: false,
        error: 'IP address is required'
      });
    }

    // Validate IP format (basic check)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([a-f0-9:]+:+)+[a-f0-9]+$/;
    if (!ipRegex.test(ip)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid IP address format'
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
 */
router.get('/event-types', (req, res) => {
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
