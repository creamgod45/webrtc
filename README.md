# WebRTC Voice System with Express & PostgreSQL

語音系統 - 基於 Express.js、PostgreSQL 和 WebSocket 的多人音頻會議應用程式

## 技術棧

- **後端**: Express.js 5.1.0
- **資料庫**: PostgreSQL
- **即時通訊**: Socket.IO (WebSocket)
- **ORM**: Sequelize
- **前端**: Vanilla JavaScript, Material Design Components
- **WebRTC**: 點對點音頻串流

## 功能特點

- ✅ 多人音頻會議（點對點網狀網路）
- ✅ 即時文字聊天
- ✅ 房間管理（創建/加入）
- ✅ 在線用戶列表
- ✅ 靜音控制（自己和對方）
- ✅ WhatsApp 分享房間連結
- ✅ PostgreSQL 資料持久化
- ✅ WebSocket 即時信令

## 先決條件

- Node.js >= 18.0.0
- PostgreSQL >= 12
- npm 或 yarn

## 安裝步驟

### 1. 安裝依賴

```bash
npm install
```

### 2. 配置資料庫

創建 PostgreSQL 資料庫：

```sql
CREATE DATABASE webrtc_voice;
```

### 3. 環境變數設置

複製 `.env.example` 到 `.env` 並配置：

```bash
cp .env.example .env
```

編輯 `.env` 文件：

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=webrtc_voice
DB_USER=postgres
DB_PASSWORD=your_password

# Optional: Database connection pool
DB_POOL_MAX=10
DB_POOL_MIN=2
DB_POOL_ACQUIRE=30000
DB_POOL_IDLE=10000
```

### 4. 執行資料庫遷移

```bash
npm run migrate
```

### 5. 啟動服務器

```bash
# 開發模式（使用 nodemon）
npm run dev

# 生產模式
npm start
```

服務器將在 http://localhost:3000 啟動

## 開發命令

```bash
# 啟動開發服務器
npm run dev

# 執行資料庫遷移
npm run migrate

# 代碼檢查
npm run lint

# 啟動生產服務器
npm start
```

## API 端點

### REST API

- `GET /api/health` - 健康檢查
- `GET /api/rooms` - 獲取所有活動房間
- `GET /api/rooms/:roomId` - 獲取特定房間信息
- `GET /api/rooms/:roomId/messages` - 獲取房間消息歷史
- `POST /api/rooms` - 創建新房間
- `DELETE /api/rooms/:roomId` - 關閉房間

### WebSocket 事件

**客戶端發送:**
- `create-room` - 創建新房間
- `join-room` - 加入房間
- `leave-room` - 離開房間
- `send-offer` - 發送 WebRTC Offer
- `send-answer` - 發送 WebRTC Answer
- `send-ice-candidate` - 發送 ICE Candidate
- `send-message` - 發送聊天消息

**服務器發送:**
- `room-created` - 房間創建成功
- `joined-room` - 加入房間成功
- `user-joined` - 新用戶加入
- `user-left` - 用戶離開
- `receive-offer` - 接收 WebRTC Offer
- `receive-answer` - 接收 WebRTC Answer
- `receive-ice-candidate` - 接收 ICE Candidate
- `receive-message` - 接收聊天消息
- `room-closed` - 房間已關閉
- `error` - 錯誤消息

## 資料庫架構

### Tables

- **rooms** - 房間信息
- **users** - 用戶和連接狀態
- **messages** - 聊天消息
- **ice_candidates** - WebRTC ICE Candidates
- **sdp_signals** - WebRTC SDP Offers/Answers

## 項目結構

```
webrtc-main/
├── public/              # 前端靜態文件
│   ├── index.html       # HTML 頁面
│   ├── app.js           # 前端 JavaScript
│   └── main.css         # 樣式
├── src/
│   ├── database/        # 資料庫配置
│   │   ├── config.js    # Sequelize 連接
│   │   └── migrate.js   # 遷移腳本
│   ├── models/          # Sequelize 模型
│   │   ├── Room.js
│   │   ├── User.js
│   │   ├── Message.js
│   │   ├── IceCandidate.js
│   │   ├── SdpSignal.js
│   │   └── index.js
│   ├── routes/          # Express 路由
│   │   └── rooms.js
│   └── socket/          # WebSocket 處理
│       └── index.js
├── server.js            # Express 服務器入口
├── package.json
├── .env.example
└── README.md
```

## WebRTC 架構

應用使用 **網狀網路（Mesh Network）** 拓撲：
- 每個用戶與房間中的其他所有用戶建立直接的點對點連接
- WebRTC 信令通過 WebSocket (Socket.IO) 進行
- ICE Candidates 和 SDP 存儲在 PostgreSQL 中以支持重連
- 音頻軌道直接在瀏覽器之間傳輸

## 疑難排解

### 無法連接資料庫

檢查 PostgreSQL 服務是否運行：
```bash
# Windows
net start postgresql-x64-14

# Linux/Mac
sudo service postgresql start
```

### WebSocket 連接失敗

確保防火牆允許 WebSocket 連接，並檢查 Content Security Policy 設置。

### 音頻無法播放

- 檢查瀏覽器麥克風權限
- 確保使用 HTTPS（生產環境）或 localhost（開發環境）
- 查看瀏覽器控制台錯誤

## 瀏覽器支持

- Chrome 74+
- Firefox 66+
- Safari 12.1+
- Edge 79+

## 授權

ISC

## 貢獻

歡迎提交 Issue 和 Pull Request！
