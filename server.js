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
const { verifyApiKey } = require('./src/middleware/apiKeyAuth');
const { ensureToken, verifyToken, optionalVerifyToken } = require('./src/middleware/csrfProtection');
const { verifyHybridAuth, optionalHybridAuth } = require('./src/middleware/hybridAuth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Generate admin password on startup (random 32 characters)
const ADMIN_PASSWORD = crypto.randomBytes(16).toString('base64');
setAdminPassword(ADMIN_PASSWORD);
console.log('\n' + '='.repeat(80));
console.log('🔐 ADMIN PASSWORD (save this - it will not be shown again):');
console.log('   ' + ADMIN_PASSWORD);
console.log('='.repeat(80) + '\n');

// Initialize Socket.IO
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
      connectSrc: [
        "'self'",
        "https://unpkg.com",
        "https://cdn.socket.io",
        `ws://localhost:${PORT}`,
        `wss://localhost:${PORT}`,
        "ws:",
        "wss:"
      ],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "blob:"]
    }
  }
}));

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
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Session info endpoint (for user identification)
app.get('/api/session', (req, res) => {
  res.json({
    sessionId: req.sessionID,
    userId: req.session.userId || null
  });
});

// CSRF token endpoint (Phase 3: CSRF protection)
app.get('/api/csrf-token', (req, res) => {
  res.json({
    csrfToken: req.session.csrfToken,
    message: 'Include this token in X-CSRF-Token header for POST/PUT/DELETE requests'
  });
});

// Admin routes (require admin password via X-Admin-Password header + CSRF token)
app.use('/admin', adminRoutes);

// Room management routes
// Authentication Strategy:
// - Frontend web UI: Uses X-CSRF-Token (from /api/csrf-token)
// - Third-party API: Uses X-API-Key (from admin panel)
// Either authentication method is accepted
app.use('/api/rooms', verifyHybridAuth, roomRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Local: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
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
