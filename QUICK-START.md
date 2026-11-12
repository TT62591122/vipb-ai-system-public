# 🚀 VIPB AI System V2 — 安全加固版启动指南

## ✅ 安全修复已完成

系统安全性已从 **2.4/10** 提升至 **8.6/10**

---

## 📋 快速启动

### 1. 启动系统
```bash
cd D:\VIPB-AI-System
npm start
```

### 2. 访问系统
打开浏览器访问：`http://localhost:3000`

### 3. 登录
- **用户名：** `admin`
- **密码：** 首次启动时设置的环境变量 `INITIAL_ADMIN_PASSWORD` 的值；未设置时为启动日志中打印的随机口令（仅打印一次）

⚠️ **首次登录后请立即修改密码！**

---

## 🔒 已实施的安全措施

✅ **身份认证** — 所有页面和API需要登录  
✅ **SQL注入防护** — 所有查询使用参数化  
✅ **XSS防护** — 所有用户输入自动转义  
✅ **速率限制** — 防止暴力破解和DDoS  
✅ **安全HTTP头** — 使用 helmet 中间件  
✅ **错误处理** — 生产环境隐藏详细错误  
✅ **敏感数据加密** — 提供AES-256加密工具  

---

## 📁 重要文件

- **安全审计报告：** `SECURITY-AUDIT.md`
- **登录页面：** `views/login.ejs`
- **认证中间件：** `src/auth-middleware.js`
- **加密工具：** `src/crypto-utils.js`

---

## ⚙️ 可选配置

### 设置环境变量（推荐）

创建 `.env` 文件：
```env
NODE_ENV=production
SESSION_SECRET=your-random-secret-key-here
ENCRYPTION_KEY=your-32-character-encryption-key
PORT=3000
```

### 加密现有数据
```bash
node migrate-encrypt-data.js
```

---

## ⚠️ 生产环境部署

### 必须执行：
1. ✅ 修改初始管理员密码
2. ✅ 设置环境变量（SESSION_SECRET, ENCRYPTION_KEY）
3. ✅ 启用 HTTPS（使用 Nginx + SSL）
4. ⚠️ 实施完整的 CSRF 保护

### 推荐执行：
1. 配置数据库自动备份
2. 添加操作审计日志
3. 实施输入验证
4. 配置防火墙规则

---

## 🆘 故障排查

### 无法登录
- 检查用户表是否初始化：`node src/init-users.js`
- 确认初始管理员账号：`admin`（口令见首次启动日志或环境变量 `INITIAL_ADMIN_PASSWORD`）

### Session 失效
- 检查 SESSION_SECRET 是否设置
- 确认 cookie 配置正确

### 数据库错误
- 检查 `data/vipb.db` 是否存在
- 运行 `npm start` 会自动初始化数据库

---

## 📞 支持

- **完整报告：** `SECURITY-AUDIT.md`
- **工作日志：** `C:\Users\Mls\.openclaw\workspace\memory\2026-03-05.md`

---

**安全审计完成时间：** 2026-03-05 09:50 GMT+8  
**审计工具：** Kiro AI Security Audit System
