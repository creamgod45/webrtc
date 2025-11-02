# 🚀 房间管理 - 快速开始

## ✅ 确认：房间浏览功能

房间浏览（大厅）功能**已经默认只显示数据库记录的房间**，无需修改！

**显示条件**：
- ✅ 活跃的房间 (`is_active = true`)
- ✅ 公开的房间 (`is_private = false`)
- ✅ 在数据库中有记录

---

## 🗑️ 清除房间数据

### 方法 1: 安全清理（推荐）

只删除非活跃的房间：

```bash
npm run rooms:clear
```

### 方法 2: 清空所有房间

删除所有房间（包括活跃的）：

```bash
npm run rooms:clear:all
```

### 方法 3: 自动化清理

跳过确认提示，直接删除（用于自动化脚本）：

```bash
npm run rooms:clear:force
```

---

## 📋 使用示例

### 示例 1: 日常清理

```bash
$ npm run rooms:clear

🗑️  清除房间工具
✅ 数据库连接成功

📊 找到 3 个房间：
1. 房间 ID: test-room-1
   名称: 测试房间
   状态: 非活跃
   私人: 否
   用户数: 0

⚠️  警告：此操作将删除 3 个房间及相关数据
确定要继续吗？ (yes/no): yes

✅ 删除完成！
```

### 示例 2: 查看可用命令

```bash
node scripts/clear-rooms.js --help
```

---

## 📚 更多信息

- **完整指南**: [ROOM-MANAGEMENT-GUIDE.md](./ROOM-MANAGEMENT-GUIDE.md)
- **实现总结**: [ROOM-MANAGEMENT-SUMMARY.md](./ROOM-MANAGEMENT-SUMMARY.md)
- **脚本说明**: [scripts/README.md](./scripts/README.md)

---

## ⚠️ 重要提示

- ❌ 删除操作**不可恢复**
- ✅ 建议先**备份数据库**
- ✅ 默认只删除**非活跃**房间

---

**快速参考**：
```bash
npm run rooms:clear         # 安全清理
npm run rooms:clear:all     # 清空所有
npm run rooms:clear:force   # 强制清空（自动化）
```
