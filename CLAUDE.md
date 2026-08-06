# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Express.js-based WebRTC voice chat application (語音系統 - Voice System) that enables multi-user audio conferencing using peer-to-peer connections. The application uses PostgreSQL for data persistence, Socket.IO for real-time WebRTC signaling, and implements a mesh network topology where each peer connects directly to every other peer in the room.

## Architecture

### Technology Stack

- **Backend**: Express.js 5.1.0
- **Database**: PostgreSQL with Sequelize ORM
- **Real-time Communication**: Socket.IO (WebSocket)
- **Frontend**: Vanilla JavaScript with Material Design Components
- **WebRTC**: Peer-to-peer audio streaming with STUN servers

### Core Components

- **Backend** (`server.js`, `src/`):
  - Express.js HTTP server with Socket.IO integration
  - RESTful API for room management
  - WebSocket server for real-time signaling
  - PostgreSQL database with Sequelize models
  - **Security middleware** for WebSocket protection

- **Frontend** (`public/`):
  - `app.js`: WebRTC client logic with Socket.IO integration
  - `index.html`: UI structure with Material Design Components
  - `main.css`: Styling

- **Database Models** (`src/models/`):
  - `Room`: Room information and metadata
  - `User`: User connections and status
  - `Message`: Chat message history
  - `IceCandidate`: WebRTC ICE candidates for connection establishment
  - `SdpSignal`: WebRTC SDP offers and answers

- **Security Components** (`src/config/`, `src/middleware/`):
  - `security.js`: Centralized security configuration
  - `websocketSecurity.js`: WebSocket security middleware
  - Rate limiting, IP blocking, anomaly detection
  - Security event logging and monitoring

### Database Schema

PostgreSQL tables structure:

```
rooms
├── id (UUID, PK)
├── room_id (String, unique)
├── name (String, nullable)
├── max_users (Integer, default: 10)
├── is_active (Boolean, default: true)
├── created_by (String)
└── timestamps

users
├── id (UUID, PK)
├── user_id (String, e.g., "user1", "user2")
├── room_id (UUID, FK -> rooms.id)
├── socket_id (String)
├── is_connected (Boolean)
├── joined_at (DateTime)
└── left_at (DateTime, nullable)

messages
├── id (UUID, PK)
├── room_id (UUID, FK -> rooms.id)
├── sender_id (String)
├── text (Text)
└── timestamp (DateTime)

ice_candidates
├── id (UUID, PK)
├── room_id (UUID, FK -> rooms.id)
├── from_user (String)
├── to_user (String)
├── candidate (JSONB)
└── created_at (DateTime)

sdp_signals
├── id (UUID, PK)
├── room_id (UUID, FK -> rooms.id)
├── from_user (String)
├── to_user (String)
├── type (Enum: 'offer', 'answer')
├── sdp (JSONB)
└── created_at (DateTime)
```

### WebRTC Signaling Flow

The application uses Socket.IO for WebRTC signaling with the following event flow:

**Room Management:**
1. Client emits `create-room` or `join-room`
2. Server creates/updates database records
3. Server emits `room-created` or `joined-room` with user list
4. Existing users receive `user-joined` event

**Peer Connection Establishment:**
1. New user receives list of existing users
2. New user creates peer connections and sends offers to all existing users
3. Existing users receive `receive-offer` event
4. Existing users create peer connections and send answers
5. Both sides exchange ICE candidates via `send-ice-candidate`/`receive-ice-candidate`

**Disconnection:**
1. User closes connection or browser
2. Server detects disconnect event
3. Server updates database (is_connected = false)
4. Server emits `user-left` to remaining users
5. Remaining users clean up peer connections

## Development Commands

### Setup and Migration

```bash
# Install dependencies
npm install

# Copy environment variables template
cp .env.example .env

# Create PostgreSQL database
createdb webrtc_voice

# Run database migration
npm run migrate
```

### Running the Server

```bash
# Development mode (with nodemon)
npm run dev

# Production mode
npm start
```

### Linting

```bash
npm run lint
```

### Testing

The application is tested manually by:
1. Opening multiple browser windows/tabs
2. Creating a room in one window
3. Joining the room from other windows
4. Testing audio, chat, and connection stability

## API Endpoints

### REST API

- `GET /api/health` - Health check endpoint
- `GET /api/rooms` - List all active rooms with user counts
- `GET /api/rooms/:roomId` - Get specific room details
- `GET /api/rooms/:roomId/messages` - Get message history (paginated)
- `POST /api/rooms` - Create a new room (optional, can use WebSocket)
- `DELETE /api/rooms/:roomId` - Close/deactivate a room

**Security Monitoring (Admin Only):**
- `GET /admin/security/events` - Get security events (filterable by severity, type)
- `GET /admin/security/blocked-ips` - List blocked IP addresses
- `GET /admin/security/stats` - Connection and security statistics
- `POST /admin/security/block-ip` - Manually block an IP address
- `GET /admin/security/event-types` - List all security event types

### WebSocket Events

**Client → Server:**
- `create-room { roomId?, userId? }` - Create new room
- `join-room { roomId, userId? }` - Join existing room
- `leave-room` - Leave current room
- `send-offer { roomId, toUser, offer }` - Send WebRTC offer
- `send-answer { roomId, toUser, answer }` - Send WebRTC answer
- `send-ice-candidate { roomId, toUser, candidate }` - Send ICE candidate
- `send-message { roomId, text }` - Send chat message

**Server → Client:**
- `room-created { roomId, userId, users }` - Room creation confirmation
- `joined-room { roomId, userId, users }` - Join confirmation with user list
- `user-joined { userId, users }` - New user joined notification
- `user-left { userId, users }` - User disconnection notification
- `receive-offer { fromUser, offer }` - WebRTC offer from peer
- `receive-answer { fromUser, answer }` - WebRTC answer from peer
- `receive-ice-candidate { fromUser, candidate }` - ICE candidate from peer
- `receive-message { senderId, text, timestamp }` - Chat message
- `room-closed { roomId }` - Room has been closed
- `error { message }` - Error notification

## Key Implementation Details

### Audio-Only Configuration

The application is configured for audio-only communication:
```javascript
navigator.mediaDevices.getUserMedia({
  video: false,
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
})
```

### Mesh Network Topology

Each peer maintains a map of peer connections:
```javascript
let peerConnections = {}; // peerId -> RTCPeerConnection
```

When joining a room:
1. Receive list of existing users
2. Iterate through existing users
3. Create peer connection for each user
4. If initiator: create and send offer
5. If responder: wait for offer, then send answer

### User Identification

- Users are assigned sequential IDs: "user1", "user2", etc.
- Assignment happens server-side when joining a room
- User ID is stored in global variable `userId`
- Room ID is stored in global variable `roomId`

### Chinese UI

The UI uses Traditional Chinese (繁體中文):
- 開起麥克風 (Open microphone)
- 建立房間 (Create room)
- 加入房間 (Join room)
- 斷線 (Disconnect)
- 發送 (Send)

### Features

- **Voice chat**: Peer-to-peer audio streaming
- **Text chat**: Real-time messaging via WebSocket
- **Mute controls**: Mute self or individual peers
- **Online users list**: Shows connected participants (updates every 3 seconds)
- **WhatsApp sharing**: Share room invite links
- **Room persistence**: Rooms and messages persist in PostgreSQL
- **Connection recovery**: ICE restart on connection failure

## Code Conventions

### Peer Connection Management

When working with peer connections:
- Store connections in `peerConnections` object keyed by peer ID
- Each peer connection has event listeners for tracks, ICE candidates, and state changes
- Clean up connections on disconnect by calling `handlePeerDisconnect(peerId)`
- Track connection status in `users` object (boolean map)

### Socket.IO Integration

Server-side socket handling in `src/socket/index.js`:
- Store `currentUserId` and `currentRoomId` in socket closure scope
- Use `socket.join(roomId)` to join Socket.IO rooms
- Use `socket.to(roomId).emit()` to broadcast to room
- Use `io.to(socketId).emit()` to send to specific user

Frontend socket handling in `public/app.js`:
- Initialize socket connection on page load
- Set up event listeners before emitting events
- Always check for null/undefined before accessing DOM elements
- Use `async/await` for peer connection operations

### Database Operations

When modifying database logic:
- Use Sequelize models from `src/models/`
- Always include error handling with try/catch
- Use transactions for multi-step operations
- Set `is_connected = false` instead of deleting user records
- Clean up old ICE candidates and SDP signals periodically (not currently implemented)

### Frontend State Management

Global variables in `public/app.js`:
- `roomId` - Current room ID
- `userId` - Current user ID
- `peerConnections` - Map of peer ID to RTCPeerConnection
- `users` - Map of peer ID to connection status (boolean)
- `numberOfDisplayedStreams` - Video grid column count (1-3)
- `numberOfConnectedPeers` - Count of active peer connections

## Common Gotchas

1. **Async Peer Connections**: Always use `await` when setting local/remote descriptions and creating offers/answers
2. **ICE Candidate Timing**: ICE candidates may arrive before peer connection is created - handle gracefully
3. **Socket.IO Rooms**: Don't confuse Socket.IO rooms with application rooms - they're the same in this app
4. **Sequelize Associations**: Models are associated in `src/models/index.js` - always import from there
5. **HTML Encoding**: Chat messages use `htmlencode()`/`htmldecode()` for XSS protection
6. **Connection State**: Monitor both `connectionState` and `iceConnectionState` for reliability
7. **CORS**: WebSocket connections require proper CORS configuration in production
8. **Database Cleanup**: Old ICE candidates and SDP signals should be cleaned up periodically

## Environment Variables

Required in `.env` file:
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port (default: 5432)
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password

Optional:
- `DB_POOL_MAX` - Max pool connections (default: 10)
- `DB_POOL_MIN` - Min pool connections (default: 2)
- `CORS_ORIGIN` - Allowed CORS origins (default: *)

Security (New):
- `ALLOWED_ORIGINS` - Comma-separated list of allowed WebSocket origins (REQUIRED in production)
- `SESSION_SECRET` - Secret key for session encryption (REQUIRED in production, 32+ chars)
- `WS_REQUIRE_AUTH` - Enable JWT authentication for WebSocket (default: false)

## Security Features

### WebSocket Security (Implemented)

The application implements comprehensive WebSocket security measures based on industry best practices:

**1. Transport Layer Security:**
- ✅ Origin validation with whitelist (configured via `ALLOWED_ORIGINS`)
- ✅ Production environment enforces HTTPS/WSS configuration check
- ✅ Disabled legacy Engine.IO v3 protocol
- ✅ Connection credentials support

**2. Connection Security:**
- ✅ IP blacklist with automatic blocking system
- ✅ Connection rate limiting: 5 connections/minute per IP
- ✅ User connection limits: 3 simultaneous connections per user
- ✅ Anomaly detection for rapid connections (>10/minute triggers alert)
- ✅ Heartbeat timeout mechanism (30 seconds inactivity)

**3. Message Security:**
- ✅ Global message rate limiting: 60 messages/minute
- ✅ Burst protection: 5 messages/second maximum
- ✅ Event-specific rate limits (create-room: 5/5min, send-message: 30/min, etc.)
- ✅ Payload size validation (10KB-50KB depending on event type)
- ✅ Input sanitization and XSS protection

**4. Monitoring & Logging:**
- ✅ Real-time security event logging (in-memory, last 1000 events)
- ✅ Severity-based event classification (1-4 levels)
- ✅ Admin API for security monitoring
- ✅ Anomaly detection: rapid connections, room creation, large payloads, auth failures
- ✅ Automatic console warnings for high-severity events (level 3+)

**Configuration Files:**
- `src/config/security.js` - Centralized security configuration
- `src/middleware/websocketSecurity.js` - Security middleware implementation
- `src/routes/security.js` - Admin monitoring API
- `SECURITY.md` - Detailed security documentation and deployment guide

**Environment Variables:**
```bash
# Required in production
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
SESSION_SECRET=your-very-strong-random-secret-at-least-32-characters
NODE_ENV=production

# Optional
WS_REQUIRE_AUTH=false  # For future JWT authentication
```

**Admin Security API Usage:**
```bash
# Get CSRF token first
curl -H "X-Admin-Password: YOUR_PASSWORD" http://localhost:3000/api/csrf-token

# View recent high-severity security events
curl -H "X-CSRF-Token: TOKEN" \
     "http://localhost:3000/admin/security/events?severity=3&limit=50"

# Check connection statistics
curl -H "X-CSRF-Token: TOKEN" \
     "http://localhost:3000/admin/security/stats"

# View blocked IPs
curl -H "X-CSRF-Token: TOKEN" \
     "http://localhost:3000/admin/security/blocked-ips"

# Manually block an IP
curl -X POST -H "X-CSRF-Token: TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"ip":"192.168.1.100","reason":"Manual block","duration":3600000}' \
     "http://localhost:3000/admin/security/block-ip"
```

## Production Considerations

1. **HTTPS/WSS**: WebRTC requires HTTPS in production - **MANDATORY**
   - Configure SSL certificate and reverse proxy (Nginx/Apache)
   - Server will exit with error if `ALLOWED_ORIGINS` not configured in production
   - Server will exit with error if `SESSION_SECRET` < 32 characters in production
   - See `SECURITY.md` for Nginx configuration example

2. **TURN Servers**: Add TURN servers for connections behind symmetric NATs

3. **Database Cleanup**: Implement periodic cleanup of old signaling data

4. **Connection Limits**: Consider SFU architecture for >5-10 users per room

5. **Message History**: ✅ Already implemented with pagination

6. **Security Monitoring**: Regularly check security events via admin API
   - Review blocked IPs daily
   - Monitor anomaly detection alerts
   - Adjust rate limits based on usage patterns
   - Consider external logging service (Winston, ELK) for production

7. **Rate Limiting**: ✅ Already implemented for both WebSocket and API endpoints

8. **DDoS Protection**: Consider Cloudflare or similar service for production deployments
