# WebSocket 資安威脅與應對措施 - 實施報告

## 概述

本文檔記錄了 WebRTC 語音聊天系統實施的 WebSocket 安全措施,基於 WebSocket 資安威脅評估報告的建議。

## 已實施的安全措施

### 一、傳輸層安全 (Transport Layer Security)

#### 1. WSS (WebSocket Secure) 配置

**實施狀態**: ✅ 已實施

**實施內容**:
- Socket.IO 配置支援 WSS 連線
- 生產環境強制檢查 HTTPS/WSS 配置
- 啟動時顯示安全檢查清單

**配置位置**:
- `src/socket/index.js` - Socket.IO 初始化
- `server.js` - 生產環境安全檢查

**使用方式**:
```bash
# 生產環境必須使用 HTTPS 反向代理 (如 Nginx)
# 示例 Nginx 配置:
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### 2. Origin 驗證

**實施狀態**: ✅ 已實施

**實施內容**:
- 嚴格的 Origin 白名單驗證
- 生產環境拒絕未配置的 Origin
- 支援萬用字元子域名 (如 `*.example.com`)

**配置位置**:
- `src/config/security.js` - 允許的 Origin 列表
- `src/middleware/websocketSecurity.js` - Origin 驗證邏輯
- `src/socket/index.js` - CORS 配置

**環境變數**:
```bash
# .env
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

---

### 二、連線層安全 (Connection Layer Security)

#### 1. IP 黑名單與自動封鎖

**實施狀態**: ✅ 已實施

**實施內容**:
- IP 黑名單管理系統
- 自動封鎖違規 IP
- 可設定封鎖時長
- 管理員手動封鎖功能

**配置位置**:
- `src/middleware/websocketSecurity.js` - IP 封鎖邏輯
- `src/routes/security.js` - 管理 API

**API 端點**:
```bash
# 查看被封鎖的 IP
GET /admin/security/blocked-ips

# 手動封鎖 IP
POST /admin/security/block-ip
{
  "ip": "192.168.1.100",
  "reason": "Suspicious activity",
  "duration": 3600000  // 毫秒
}
```

#### 2. 連線速率限制

**實施狀態**: ✅ 已實施

**實施內容**:
- 每個 IP 的連線數限制 (預設: 5 個連線/分鐘)
- 每個用戶的同時連線數限制 (預設: 3 個)
- 快速連線/斷線偵測 (異常行為)

**配置位置**:
- `src/config/security.js` - 速率限制配置
- `src/middleware/websocketSecurity.js` - 速率限制邏輯

**預設配置**:
```javascript
rateLimit: {
  maxConnectionsPerIP: 5,
  connectionWindowMs: 60000,
  maxConnectionsPerUser: 3
}
```

---

### 三、訊息層安全 (Message Layer Security)

#### 1. 訊息速率限制

**實施狀態**: ✅ 已實施

**實施內容**:
- 全域訊息頻率限制 (60 訊息/分鐘)
- 每秒突發限制 (5 訊息/秒)
- 事件特定速率限制
- 超過限制自動拒絕並記錄

**事件特定限制**:
```javascript
events: {
  'send-offer': { max: 10, windowMs: 60000 },
  'send-answer': { max: 10, windowMs: 60000 },
  'send-ice-candidate': { max: 100, windowMs: 60000 },
  'send-message': { max: 30, windowMs: 60000 },
  'create-room': { max: 5, windowMs: 300000 },
  'join-room': { max: 10, windowMs: 60000 }
}
```

#### 2. 載荷大小驗證

**實施狀態**: ✅ 已實施

**實施內容**:
- 訊息大小上限檢查
- 事件特定大小限制
- 異常大型載荷偵測
- Socket.IO maxHttpBufferSize 限制

**大小限制**:
```javascript
validation: {
  maxMessageSize: 10240,    // 10KB
  maxOfferSize: 51200,      // 50KB (SDP 可能較大)
  maxAnswerSize: 51200,     // 50KB
  maxCandidateSize: 2048,   // 2KB
  maxMessageTextLength: 2100
}
```

#### 3. 輸入驗證與消毒

**實施狀態**: ✅ 已實施 (既有功能增強)

**實施內容**:
- Room ID 格式驗證 (字母、數字、連字符、底線)
- User ID 格式驗證
- 訊息文字長度與內容驗證
- XSS 防護 (HTML 標籤移除與特殊字元轉義)

**配置位置**:
- `src/middleware/security.js` - 驗證函數

---

### 四、異常偵測與監控 (Anomaly Detection & Monitoring)

#### 1. 異常行為偵測

**實施狀態**: ✅ 已實施

**實施內容**:
- 快速連線/斷線偵測 (>10 連線/分鐘)
- 大量建立房間偵測 (>20 房間/小時)
- 大型載荷偵測 (>50KB)
- 認證失敗偵測 (>5 次失敗/5 分鐘)

**配置位置**:
- `src/config/security.js` - 異常偵測閾值
- `src/middleware/websocketSecurity.js` - 偵測邏輯

#### 2. 安全事件日誌

**實施狀態**: ✅ 已實施

**實施內容**:
- 即時安全事件記錄 (記憶體內,保留最近 1000 筆)
- 嚴重事件自動輸出到 console
- 事件分類與嚴重程度 (1-4 級)
- 完整的事件上下文 (IP、User、時間戳等)

**事件類型**:
- 連線事件: `blocked_ip_attempt`, `rate_limit_connection_rejected`, `invalid_origin`
- 訊息事件: `rate_limit_message_rejected`, `validation_rejected`
- 異常事件: `anomaly_rapid_connections`, `anomaly_auth_failures`
- IP 封鎖: `ip_blocked`, `ip_unblocked`

#### 3. 監控 API

**實施狀態**: ✅ 已實施

**實施內容**:
- 查看安全事件 (可按嚴重程度、類型過濾)
- 查看被封鎖的 IP 列表
- 連線統計資訊
- 事件類型說明文檔

**API 端點**:
```bash
# 查看安全事件
GET /admin/security/events?severity=3&limit=100

# 查看統計資訊
GET /admin/security/stats

# 查看事件類型說明
GET /admin/security/event-types

# 查看被封鎖的 IP
GET /admin/security/blocked-ips

# 手動封鎖 IP
POST /admin/security/block-ip
```

---

### 五、認證與授權 (Authentication & Authorization)

#### 1. 多層認證機制

**實施狀態**: ✅ 已實施 (既有功能)

**實施內容**:
- Session Cookie (SameSite=strict)
- CSRF Token 保護
- API Key 認證 (用於第三方 API)
- 混合認證 (Hybrid Auth)
- Admin 密碼保護

**配置位置**:
- `server.js` - Session 配置
- `src/middleware/csrfProtection.js` - CSRF Token
- `src/middleware/apiKeyAuth.js` - API Key 驗證
- `src/middleware/hybridAuth.js` - 混合認證

#### 2. WebSocket 握手驗證

**實施狀態**: ⚠️ 部分實施 (基礎檢查)

**當前實施**:
- Origin 驗證
- IP 黑名單檢查
- 連線速率限制

**未來增強** (可選):
- JWT Token 握手驗證
- 設定 `WS_REQUIRE_AUTH=true` 啟用

---

## 安全配置檔案

### 核心配置檔案

1. **`src/config/security.js`** - 集中式安全配置
   - WebSocket 傳輸層配置
   - 速率限制設定
   - 輸入驗證規則
   - 異常偵測閾值
   - IP 封鎖策略

2. **`src/middleware/websocketSecurity.js`** - 安全中間件
   - 連線管理
   - 速率限制執行
   - IP 封鎖管理
   - 異常偵測
   - 安全日誌

3. **`src/routes/security.js`** - 監控 API
   - 安全事件查詢
   - 封鎖 IP 管理
   - 統計資訊

---

## 生產環境部署檢查清單

### 必須配置項目

- [ ] **HTTPS/WSS**: 配置 SSL 憑證與反向代理
- [ ] **ALLOWED_ORIGINS**: 設定實際域名 (不可使用 `*`)
- [ ] **SESSION_SECRET**: 設定強隨機字串 (至少 32 字元)
- [ ] **NODE_ENV**: 設為 `production`

### 建議配置項目

- [ ] **TURN Server**: 配置 TURN 伺服器以支援 NAT 穿透
- [ ] **資料庫清理**: 實施舊訊號資料定期清理
- [ ] **日誌系統**: 整合外部日誌系統 (如 Winston, ELK)
- [ ] **監控告警**: 設定異常事件告警通知
- [ ] **備份策略**: 配置資料庫備份

### 環境變數範例

```bash
# .env (生產環境)
NODE_ENV=production
PORT=3000

# 資料庫
DB_HOST=your-db-host
DB_NAME=webrtc_voice_prod
DB_USER=webrtc_user
DB_PASSWORD=strong-password-here

# 安全配置
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
SESSION_SECRET=your-very-long-random-secret-string-at-least-32-chars
WS_REQUIRE_AUTH=false

# CORS (API)
CORS_ORIGIN=https://yourdomain.com
```

---

## 監控與維護

### 定期檢查事項

1. **每日**:
   - 檢查安全事件 (嚴重度 >= 3)
   - 檢視被封鎖的 IP 列表
   - 監控連線統計異常

2. **每週**:
   - 檢閱異常行為趨勢
   - 清理過期的安全日誌
   - 檢查速率限制效果

3. **每月**:
   - 審查安全配置是否需要調整
   - 更新依賴套件安全補丁
   - 檢查資料庫效能

### 查詢安全事件

```bash
# 使用管理員密碼獲取 CSRF Token
curl -H "X-Admin-Password: YOUR_ADMIN_PASSWORD" \
     http://localhost:3000/api/csrf-token

# 查看最近的高嚴重度事件
curl -H "X-CSRF-Token: YOUR_TOKEN" \
     http://localhost:3000/admin/security/events?severity=3&limit=50

# 查看連線統計
curl -H "X-CSRF-Token: YOUR_TOKEN" \
     http://localhost:3000/admin/security/stats
```

---

## 已知限制與未來增強

### 當前限制

1. **記憶體內日誌**: 安全事件儲存在記憶體中,重啟後遺失
   - **解決方案**: 整合持久化日誌系統 (如 Winston + Database)

2. **基礎 IP 封鎖**: 無法處理代理伺服器後的多用戶場景
   - **解決方案**: 結合用戶認證與行為分析

3. **無分散式支援**: 多伺服器部署時速率限制不共享
   - **解決方案**: 使用 Redis 共享速率限制狀態

### 未來增強方向

1. **JWT 認證**: WebSocket 握手階段的 Token 驗證
2. **機器學習**: 基於行為模式的異常偵測
3. **地理封鎖**: 基於 IP 地理位置的存取控制
4. **DDoS 防護**: 整合 Cloudflare 或其他 DDoS 防護服務
5. **審計日誌**: 完整的操作審計追蹤

---

## 安全事件回應流程

### 高嚴重度事件 (Severity 4)

1. **立即行動**:
   - 自動封鎖來源 IP
   - 記錄完整事件上下文
   - 發送告警通知 (如已配置)

2. **調查**:
   - 檢查事件詳情與時間線
   - 確認是否為誤判
   - 評估影響範圍

3. **應對**:
   - 延長封鎖時間 (如有必要)
   - 更新安全規則
   - 記錄事件處理結果

### 中等嚴重度事件 (Severity 2-3)

1. **監控**:
   - 定期檢視事件趨勢
   - 識別重複違規者

2. **調整**:
   - 微調速率限制閾值
   - 優化驗證規則

---

## 技術支援

### 相關檔案

- `SECURITY.md` (本文件) - 安全措施文檔
- `CLAUDE.md` - 專案技術文檔
- `README.md` - 專案說明
- `.env.example` - 環境變數範本

### 聯絡資訊

遇到安全問題或需要協助,請:
1. 檢查本文檔與 `CLAUDE.md`
2. 查看安全事件日誌
3. 檢視伺服器 console 輸出

---

## 版本歷程

- **v1.0** (2026-01-06): 初始實施
  - WebSocket 安全中間件
  - 速率限制與 IP 封鎖
  - 異常偵測與監控
  - 安全事件日誌
  - 管理監控 API

---

**最後更新**: 2026-01-06
