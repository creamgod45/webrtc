# Docker 部署說明

## 快速啟動

### 方式 1：使用 Docker Compose（推薦）

```bash
# 1. 構建並啟動所有服務
docker-compose up -d

# 2. 查看日誌
docker-compose logs -f

# 3. 停止服務
docker-compose down

# 4. 停止並刪除數據卷
docker-compose down -v
```

### 方式 2：單獨使用 Docker

```bash
# 1. 構建鏡像
docker build -t webrtc-voice-app .

# 2. 啟動 PostgreSQL
docker run -d \
  --name webrtc-postgres \
  -e POSTGRES_DB=webrtc_voice \
  -e POSTGRES_USER=webrtc_voice \
  -e POSTGRES_PASSWORD=your_secure_password_here \
  -p 5432:5432 \
  postgres:15-alpine

# 3. 等待數據庫啟動（約10秒）

# 4. 啟動應用
docker run -d \
  --name webrtc-app \
  --link webrtc-postgres:postgres \
  -e DB_HOST=postgres \
  -e DB_PORT=5432 \
  -e DB_NAME=webrtc_voice \
  -e DB_USER=webrtc_voice \
  -e DB_PASSWORD=your_secure_password_here \
  -p 4433:4433 \
  -p 3000:3000 \
  webrtc-voice-app
```

## 訪問應用

- **主應用**：http://localhost:4433
- **直接訪問 Node.js**：http://localhost:3000

## 配置說明

### 端口配置

- `4433`：Nginx 前端服務器端口
- `3000`：Node.js 後端服務器端口
- `5432`：PostgreSQL 數據庫端口

### 環境變量

在 `docker-compose.yml` 中修改以下環境變量：

```yaml
environment:
  POSTGRES_PASSWORD: your_secure_password_here  # 修改數據庫密碼
  DB_PASSWORD: your_secure_password_here        # 與上面保持一致
```

## 數據持久化

PostgreSQL 數據存儲在 Docker 卷中：

```bash
# 查看數據卷
docker volume ls

# 備份數據庫
docker exec webrtc-postgres pg_dump -U webrtc_voice webrtc_voice > backup.sql

# 恢復數據庫
docker exec -i webrtc-postgres psql -U webrtc_voice webrtc_voice < backup.sql
```

## 常用命令

```bash
# 查看運行中的容器
docker-compose ps

# 查看應用日誌
docker-compose logs -f app

# 查看數據庫日誌
docker-compose logs -f postgres

# 進入應用容器
docker-compose exec app sh

# 進入數據庫容器
docker-compose exec postgres psql -U webrtc_voice

# 重啟服務
docker-compose restart

# 重新構建鏡像
docker-compose build --no-cache

# 查看資源使用情況
docker stats
```

## 生產環境部署

### 1. 修改密碼

在 `docker-compose.yml` 中將 `your_secure_password_here` 替換為強密碼。

### 2. 使用 HTTPS

添加 SSL 證書並修改 `nginx.conf`：

```nginx
server {
    listen 4433 ssl http2;
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    # ... 其他配置
}
```

### 3. 環境變量管理

創建 `.env` 文件替代在 `docker-compose.yml` 中硬編碼：

```bash
# .env
POSTGRES_PASSWORD=your_secure_password_here
DB_PASSWORD=your_secure_password_here
```

然後在 `docker-compose.yml` 中使用：

```yaml
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  DB_PASSWORD: ${DB_PASSWORD}
```

### 4. 資源限制

添加資源限制到 `docker-compose.yml`：

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

## 故障排查

### 應用無法連接數據庫

```bash
# 檢查數據庫是否啟動
docker-compose ps postgres

# 檢查網絡連接
docker-compose exec app ping postgres

# 查看數據庫日誌
docker-compose logs postgres
```

### Nginx 無法啟動

```bash
# 檢查配置文件語法
docker-compose exec app nginx -t

# 查看 nginx 日誌
docker-compose exec app cat /var/log/nginx/error.log
```

### 端口被占用

```bash
# Windows
netstat -ano | findstr :4433

# 修改 docker-compose.yml 中的端口映射
ports:
  - "8080:4433"  # 將主機端口改為 8080
```

## 清理環境

```bash
# 停止並刪除所有容器和網絡
docker-compose down

# 同時刪除數據卷（會丟失數據！）
docker-compose down -v

# 刪除未使用的鏡像
docker image prune -a

# 完全清理 Docker 環境
docker system prune -a --volumes
```

## 性能優化

### 1. 使用多階段構建

在 Dockerfile 中添加構建階段以減小鏡像大小。

### 2. 啟用 Nginx 緩存

在 `nginx.conf` 中添加：

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m use_temp_path=off;

location /api {
    proxy_cache my_cache;
    proxy_cache_valid 200 60m;
    # ... 其他配置
}
```

### 3. 數據庫優化

連接到數據庫並調整配置：

```bash
docker-compose exec postgres psql -U webrtc_voice -c "ALTER SYSTEM SET max_connections = 200;"
docker-compose exec postgres psql -U webrtc_voice -c "ALTER SYSTEM SET shared_buffers = '256MB';"
docker-compose restart postgres
```
