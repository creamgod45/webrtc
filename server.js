/** @typedef {import('express').Application} Application */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').NextFunction} NextFunction */
/** @typedef {import('http').Server} HttpServer */
/** @typedef {import('socket.io').Server} SocketIOServer */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

const { testConnection } = require('./src/database/config');
const initializeSocket = require('./src/socket');
const roomRoutes = require('./src/routes/rooms');
const { router: adminRoutes, setAdminPassword } = require('./src/routes/admin');
const securityRoutes = require('./src/routes/security');
const { verifyApiKey } = require('./src/middleware/apiKeyAuth');
const { ensureToken, verifyToken, optionalVerifyToken } = require('./src/middleware/csrfProtection');
const { verifyHybridAuth, optionalHybridAuth } = require('./src/middleware/hybridAuth');

/** @type {Application} */
const app = express();
/** @type {HttpServer} */
const server = http.createServer(app);
/** @type {number} */
const PORT = process.env.PORT || 3000;

// Generate admin password on startup (random 32 characters)
/** @type {string} */
const ADMIN_PASSWORD = crypto.randomBytes(16).toString('base64');
setAdminPassword(ADMIN_PASSWORD);
console.log('\n' + '='.repeat(80));
console.log('🔐 ADMIN PASSWORD (save this - it will not be shown again):');
console.log('   ' + ADMIN_PASSWORD);
console.log('='.repeat(80) + '\n');

// Initialize Socket.IO
/** @type {SocketIOServer} */
const io = initializeSocket(server);

// Middleware
app.set('trust proxy', 1);
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session middleware
// CSRF Protection Strategy:
// - Phase 1: Session cookies with SameSite=strict (passive protection)
// - Phase 2: X-API-KEY and X-Admin-Password headers (header-based auth)
// - Phase 3: CSRF tokens for state-changing operations (active protection)
// Combined approach: Defense in depth
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict', // CSRF protection layer 1
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  },
  name: 'webrtc.sid'
}));

// Ensure CSRF token exists in session (CSRF protection layer 2)
app.use(ensureToken);
// Security middleware with CSP configuration for Material Design and WebSocket
// Fixed: Restrict WebSocket connections in production to prevent data exfiltration (CWE-346)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

// Build WebSocket CSP directives based on environment
const wsConnectSrc = [
  "'self'",
  "https://unpkg.com",
  "https://cdn.socket.io",
  `ws://localhost:${PORT}`,
  `wss://localhost:${PORT}`
];

// In production, only allow specific origins; in development, allow all for testing
if (process.env.NODE_ENV === 'production' && allowedOrigins.length > 0) {
  // Add specific WebSocket endpoints from ALLOWED_ORIGINS
  allowedOrigins.forEach(origin => {
    try {
      const url = new URL(origin);
      wsConnectSrc.push(`ws://${url.hostname}:${PORT}`);
      wsConnectSrc.push(`wss://${url.hostname}:${PORT}`);
      wsConnectSrc.push(`wss://${url.hostname}`); // For standard HTTPS port
    } catch (e) {
      console.warn(`⚠️  Invalid origin in ALLOWED_ORIGINS: ${origin}`);
    }
  });
} else {
  // Development: allow all WebSocket connections for testing
  wsConnectSrc.push("ws:");
  wsConnectSrc.push("wss:");
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://unpkg.com",
        "https://cdn.socket.io"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://unpkg.com",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      connectSrc: wsConnectSrc,
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "blob:"]
    }
  }
}));

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {NextFunction} next - Next middleware function
 */
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Internal Server Error',
        message: 'Something went wrong'
    });
});

// Make io accessible in routes
app.set('io', io);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
/**
 * Health check endpoint
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

/**
 * Session info endpoint (for user identification)
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
app.get('/api/session', (req, res) => {
  res.json({
    sessionId: req.sessionID,
    userId: req.session.userId || null
  });
});

/**
 * CSRF token endpoint (Phase 3: CSRF protection)
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
app.get('/api/csrf-token', (req, res) => {
  res.json({
    csrfToken: req.session.csrfToken,
    message: 'Include this token in X-CSRF-Token header for POST/PUT/DELETE requests'
  });
});

// Admin routes (require admin password via X-Admin-Password header + CSRF token)
app.use('/admin', adminRoutes);

// Security monitoring routes (admin only)
app.use('/admin/security', securityRoutes);

// Room management routes
// Authentication Strategy:
// - Frontend web UI: Uses X-CSRF-Token (from /api/csrf-token)
// - Third-party API: Uses X-API-Key (from admin panel)
// Either authentication method is accepted
app.use('/api/rooms', verifyHybridAuth, roomRoutes);

/**
 * Error handling middleware
 * @param {Error} err - Error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {NextFunction} next - Next middleware function
 */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

/**
 * Start the HTTP server and initialize database connection
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Security warnings
    if (process.env.NODE_ENV === 'production') {
      console.log('\n' + '='.repeat(80));
      console.log('⚠️  PRODUCTION SECURITY CHECKLIST:');
      console.log('   1. Ensure HTTPS is enabled (WSS requires HTTPS)');
      console.log('   2. Set ALLOWED_ORIGINS to your actual domain(s)');
      console.log('   3. Configure SESSION_SECRET with a strong random string');
      console.log('   4. WebRTC requires HTTPS in production (use reverse proxy)');
      console.log('   5. Consider adding TURN servers for NAT traversal');
      console.log('='.repeat(80) + '\n');

      if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === '*') {
        console.error('❌ ERROR: ALLOWED_ORIGINS not configured for production!');
        console.error('   Set ALLOWED_ORIGINS in .env to your domain(s)');
        process.exit(1);
      }

      if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        console.error('❌ ERROR: SESSION_SECRET not properly configured!');
        console.error('   Set a strong SESSION_SECRET (at least 32 characters)');
        process.exit(1);
      }
    }

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Local: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);

      if (process.env.NODE_ENV !== 'production') {
        console.log('\n💡 Development mode: Security restrictions are relaxed');
        console.log('   For production deployment, see SECURITY.md\n');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
