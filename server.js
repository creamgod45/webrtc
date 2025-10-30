const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

const { testConnection } = require('./src/database/config');
const initializeSocket = require('./src/socket');
const roomRoutes = require('./src/routes/rooms');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize Socket.IO
const io = initializeSocket(server);

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Room management routes
app.use('/api/rooms', roomRoutes);

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
