/**
 * VIPB AI System V2 闁?闁稿繈鍎辫ぐ娑㈠棘閸ワ附顐介柨娑樼墕閸戯繝宕濋悩鍙夌ゼ閻庣懓顦崣蹇涙晬? * 濞戞挴鍋撻柡澶嗏偓铏殥濞寸姰鍊曢幆搴ㄥ礉? node server.js
 */
require('dotenv').config();
const { logger, hijackConsole } = require('./src/logger');
hijackConsole(); // 闁告棏鍋呯€?console.log/error/warn 闁?pino

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { initDatabase } = require('./src/database');
const { initUsers } = require('./src/init-users');
const { requireAuth, redirectIfAuth } = require('./src/auth-middleware');
const config = require('./src/config');
const cron = require('node-cron');
const { performBackup, cleanOldBackups } = require('./src/backup');
const { EmailSender } = require('./src/email-sender');
const { WhatsAppManager } = require('./src/whatsapp-client');
const { AntiBanEngine } = require('./src/antiban-engine');
const { LeadScoringEngine } = require('./src/lead-scoring');
const { LinkedInAutomation } = require('./src/linkedin-automation');
const { initCalendar } = require('./routes/calendar-api');
const { UnifiedInbox } = require('./src/unified-inbox');
const { JourneyEngine } = require('./src/journey-engine');
const { initAnalytics } = require('./routes/analytics-api');
const { SocialAccountManager } = require('./src/social-accounts');
const { WANumberChecker } = require('./src/wa-number-checker');
const { SocialDispatcher, WhatsAppAdapter, TikTokAdapter, FacebookAdapter, LinkedInAdapter } = require('./src/social-dispatcher');
const { isModuleEnabled } = require('./routes/settings-api');
const { BrowserAdapterManager } = require('./src/browser-adapters');

// ...
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set, using random value');
  return s;
})();

// ...
// 可恢复的网络错误列表 — 这些不应该导致进程退出
const RECOVERABLE_ERRORS = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND'];

process.on('uncaughtException', (err) => {
  const fs = require('fs');
  const isRecoverable = RECOVERABLE_ERRORS.includes(err.code) || 
    (err.message && (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') || err.message.includes('socket hang up') || err.message.includes('Connection not available')));
  
  if (isRecoverable) {
    // 网络波动，记录但不退出
    console.error(`[可恢复错误] ${err.code || err.message} — 已忽略，系统继续运行`);
    fs.appendFileSync('crash.log', `[${new Date().toISOString()}] RECOVERED uncaughtException (not fatal): ${err.stack || err.message}\n`);
    return; // 不退出！
  }
  
  // 真正的致命错误才退出
  console.error('致命错误: 未捕获异常:', err);
  fs.appendFileSync('crash.log', `[${new Date().toISOString()}] FATAL uncaughtException: ${err.stack}\n`);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  const fs = require('fs');
  const errMsg = reason instanceof Error ? (reason.code || reason.message) : String(reason);
  const isRecoverable = RECOVERABLE_ERRORS.some(code => errMsg.includes(code)) ||
    errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT') || errMsg.includes('socket hang up') || errMsg.includes('Connection not available');
  
  if (isRecoverable) {
    console.error(`[可恢复错误] unhandledRejection: ${errMsg} — 已忽略`);
    fs.appendFileSync('crash.log', `[${new Date().toISOString()}] RECOVERED unhandledRejection (not fatal): ${errMsg}\n`);
    return;
  }
  
  console.error('致命错误: 未处理的Promise拒绝:', reason);
  fs.appendFileSync('crash.log', `[${new Date().toISOString()}] unhandledRejection: ${reason}\n`);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ...
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// 登录限流
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: '尝试次数过多，请15分钟后再试',
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many API requests',
  max: 100,
  message: 'Too many API requests',
  standardHeaders: true,
  legacyHeaders: false,
});

// ...
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: '请求JSON格式错误' });
  }
  next(err);
});
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/product-images', express.static(path.join(__dirname, 'data', 'product-images')));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});

// ...
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // localhost用HTTP，不能设secure（否则浏览器不发cookie）
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ...
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001').split(',');
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ...
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ...
app.locals.appName = 'VIPB AI System';
app.locals.version = 'V2.0';

// ...
const db = initDatabase();
app.locals.db = db;
app.locals.io = io;

// 确保social_accounts表有TikTok OAuth所需字段
try {
  db.prepare("SELECT platform_user_id FROM social_accounts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE social_accounts ADD COLUMN platform_user_id TEXT DEFAULT ''");
}
try {
  db.prepare("SELECT refresh_token FROM social_accounts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE social_accounts ADD COLUMN refresh_token TEXT DEFAULT ''");
}
try {
  db.prepare("SELECT token_expires_at FROM social_accounts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE social_accounts ADD COLUMN token_expires_at DATETIME");
}

// 确保social_accounts表有指纹浏览器类型字段
try {
  db.prepare("SELECT browser_type FROM social_accounts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE social_accounts ADD COLUMN browser_type TEXT DEFAULT 'builtin'");
}

// 确保browser_profiles表有指纹浏览器相关字段
try {
  db.prepare("SELECT browser_type FROM browser_profiles LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE browser_profiles ADD COLUMN browser_type TEXT DEFAULT 'builtin'");
}
try {
  db.prepare("SELECT external_profile_id FROM browser_profiles LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE browser_profiles ADD COLUMN external_profile_id TEXT");
}

// AI任务中心表（如果不存在则创建）
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_input TEXT NOT NULL,
      parsed_intent TEXT,
      sub_tasks TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      total_cost REAL DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      brain_provider TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_task_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      agent TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT 'text',
      action TEXT NOT NULL,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'pending',
      provider_used TEXT,
      cost REAL DEFAULT 0,
      tokens INTEGER DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      task_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
} catch(e) { /* tables already exist */ }

// ...

// ...
const waManager = new WhatsAppManager(db, io);
app.locals.whatsapp = waManager;

// ...
const antiban = new AntiBanEngine(db);
app.locals.antiban = antiban;

// ...
const leadScoring = new LeadScoringEngine(db, io);
app.locals.leadScoring = leadScoring;

// ...
const linkedin = new LinkedInAutomation(db, io, antiban, leadScoring);
app.locals.linkedin = linkedin;

// ...

// ...
const inbox = new UnifiedInbox(db, io);
app.locals.inbox = inbox;

// ...
const journey = new JourneyEngine(db, io, leadScoring);
app.locals.journey = journey;

// ...

// ...
const socialAccounts = new SocialAccountManager(db, io);
app.locals.socialAccounts = socialAccounts;

// 初始化浏览器适配器管理器
const browserAdapterManager = new BrowserAdapterManager(db);
app.locals.browserAdapterManager = browserAdapterManager;
app.locals.browserAdapters = browserAdapterManager; // 为API提供兼容性

// ...
const waChecker = new WANumberChecker(db, waManager);
app.locals.waChecker = waChecker;
waManager.setNumberChecker(waChecker);

// ...
const dispatcher = new SocialDispatcher(db, io);
dispatcher.registerAdapter('whatsapp', new WhatsAppAdapter(waManager));
dispatcher.registerAdapter('tiktok', new TikTokAdapter());
dispatcher.registerAdapter('facebook', new FacebookAdapter());
dispatcher.registerAdapter('linkedin', new LinkedInAdapter(linkedin));
app.locals.dispatcher = dispatcher;

// ...
io.on('connection', (socket) => {
  console.log('[WS] 客户端连接:', socket.id);
  socket.on('disconnect', () => {
  console.log('[WS] 客户端断开:', socket.id);
  });
});

// ...
app.locals.notify = function(type, data) {
  io.emit('notification', { type, data, timestamp: new Date().toISOString() });
};

// ...
app.locals.auditLog = function(action, entityTypeOrReq, entityId, details) {
  try {
    // ...
    // ...
    let entityType, userId, ipAddress;
    if (typeof entityTypeOrReq === 'object' && entityTypeOrReq.session) {
      // ...
      const req = entityTypeOrReq;
      const actualAction = action; // ...
      // ...
      // ...
      userId = req.session?.userId || 'anonymous';
      ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
      entityType = '';
      entityId = 0;
      action = entityTypeOrReq; // won't happen, keep old logic
    }
    // ...
    userId = 'system';
    ipAddress = 'server';
    
    db.prepare(`INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(entityType, entityId || 0, action, JSON.stringify(details || {}), userId, ipAddress);
  } catch (err) {
    console.error('[AUDIT] 日志记录失败:', err.message);
  }
};

// ...
app.locals.auditLogReq = function(req, action, details) {
  try {
    const userId = req.session?.userId || 'anonymous';
    const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
    db.prepare(`INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run('', 0, action, typeof details === 'string' ? details : JSON.stringify(details || {}), userId, ipAddress);
  } catch (err) {
    console.error('[AUDIT] 日志记录失败:', err.message);
  }
};

// ...
app.locals.validateBody = require('./src/input-validator').validateBody;


// DAL - 统一数据访问层 (Data Access Layer)
// const dal = require('./src/dal')(db);

// Enhanced Audit Logger - 增强审计日志
const AuditLogger = require('./src/audit-logger');
const auditLogger = new AuditLogger(db);
app.locals.auditLogger = auditLogger;
// ...
const AlertEngine = require('./src/alert-engine');
app.locals.alert = new AlertEngine(db, { webhookUrl: process.env.ALERT_WEBHOOK_URL });

// ...
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: { httpOnly: true, sameSite: 'lax' } });

// ...
app.get('/login', redirectIfAuth, csrfProtection, (req, res) => {
  const totpEnabled = db.prepare("SELECT value FROM settings WHERE key = 'totp_enabled'").get();
  res.render('login', { error: null, csrfToken: req.csrfToken(), totpEnabled: totpEnabled?.value === '1' });
});

app.post('/login', loginLimiter, csrfProtection, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.render('login', { error: '请输入用户名和密码', csrfToken: req.csrfToken() });
  }
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
    
    if (!user) {
    return res.render('login', { error: '用户名或密码错误', csrfToken: req.csrfToken() });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
    return res.render('login', { error: '用户名或密码错误', csrfToken: req.csrfToken() });
    }
    
    // 检查TOTP
    const totpEnabledRow = db.prepare("SELECT value FROM settings WHERE key = 'totp_enabled'").get();
    const totpEnabled = totpEnabledRow?.value === '1';
    if (totpEnabled) {
      const totpCode = req.body.totpCode;
      if (!totpCode) {
        return res.render('login', { error: '请输入TOTP验证码', csrfToken: req.csrfToken(), totpEnabled: true });
      }
      const speakeasy = require('speakeasy');
      const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'totp_secret'").get();
      if (secretRow) {
        const isValid = speakeasy.totp.verify({ secret: secretRow.value, encoding: 'base32', token: totpCode, window: 1 });
        if (!isValid) {
          return res.render('login', { error: 'TOTP验证码错误', csrfToken: req.csrfToken(), totpEnabled: true });
        }
      }
    }
    
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    
    // (comment)
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    
    // (comment)
    app.locals.auditLog('login', 'user', user.id, { username: user.username });
    app.locals.notify('system', { message: `User ${user.username} logged in` });
    
    // 登录成功后跳转到原始请求页面（如/tiktok），没有则跳dashboard
    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error('登录失败:', err);
    res.render('login', { error: '鐧诲綍澶辫触锛岃绋嶅悗閲嶈瘯' });
  }
});

app.get('/logout', (req, res) => {
  const username = req.session.username;
  const userId = req.session.userId;
  if (userId) {
    app.locals.auditLog('logout', 'user', userId, { username });
  }
  req.session.destroy();
  res.redirect('/login');
});


// ========== Public routes ==========
app.use('/api/track', require('./routes/tracking-api')(db));

const startTime = Date.now();
app.get('/api/health', (req, res) => {
  try {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const customers = db.prepare('SELECT COUNT(*) as c FROM customers').get().c;
    const recentErrors = db.prepare(
      "SELECT COUNT(*) as c FROM activity_log WHERE action='error' AND created_at > datetime('now', '-24 hours')"
    ).get()?.c || 0;

    const basic = {
      status: 'ok',
      uptime: `${Math.floor(uptimeSec/3600)}h${Math.floor((uptimeSec%3600)/60)}m${uptimeSec%60}s`,
      database: { customers },
      errors24h: recentErrors
    };

        // detail mode
    if (req.query.detail === 'true' && req.session && req.session.userId) {
      const mem = process.memoryUsage();
      const dbSize = require('fs').statSync(require('./src/config').dbPath || './data/vipb.db').size;
      const emails = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
      basic.uptimeSec = uptimeSec;
      basic.memory = {
        rss: `${(mem.rss / 1048576).toFixed(1)}MB`,
        heap: `${(mem.heapUsed / 1048576).toFixed(1)}/${(mem.heapTotal / 1048576).toFixed(1)}MB`
      };
      basic.database.sizeMB = (dbSize / 1048576).toFixed(2);
      basic.database.emails = emails;
      basic.pid = process.pid;
      basic.nodeVersion = process.version;
    }

    res.json(basic);
  } catch (e) {
    res.json({ status: 'degraded', error: e.message });
  }
});

// ...
// ==================== TikTok OAuth 回调（公开路由，不需要登录） ====================
app.get('/oauth/tiktok/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      console.error('[TikTok OAuth] 授权被拒绝:', error);
      return res.send('<script>alert("TikTok授权被拒绝: ' + error + '");window.close();</script>');
    }
    if (!code) {
      return res.send('<script>alert("缺少授权码");window.close();</script>');
    }
    
    // 读取TikTok API配置
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'tiktok_api'").get();
    if (!configRow) {
      return res.send('<script>alert("请先配置TikTok API密钥");window.close();</script>');
    }
    const config = JSON.parse(configRow.value);
    const { decrypt } = require('./src/crypto-utils');
    const tkConfig = {
      clientKey: config.clientKey,
      clientSecret: decrypt(config.clientSecret),
      redirectUri: config.redirectUri || 'http://localhost:3001/oauth/tiktok/callback'
    };
    
    // 交换token
    const OAuthManager = require('./src/oauth-manager');
    const oauthMgr = new OAuthManager(db);
    const result = await oauthMgr.handleTikTokCallback(code, tkConfig);
    
    if (result.success) {
      // 保存到social_accounts表
      const existing = db.prepare("SELECT id FROM social_accounts WHERE platform = 'tiktok' AND platform_user_id = ?").get(result.openId);
      if (existing) {
        db.prepare(`UPDATE social_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`)
          .run(result.accessToken, result.refreshToken, result.expiresAt, existing.id);
      } else {
        db.prepare(`INSERT INTO social_accounts (platform, platform_user_id, access_token, refresh_token, token_expires_at, status, created_at, updated_at) VALUES ('tiktok', ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`)
          .run(result.openId, result.accessToken, result.refreshToken, result.expiresAt);
      }
      console.log('[TikTok OAuth] 授权成功, openId:', result.openId);
      res.send('<script>alert("TikTok授权成功！");window.close();</script>');
    } else {
      console.error('[TikTok OAuth] 授权失败:', result.error);
      res.send('<script>alert("TikTok授权失败: ' + (result.error || '未知错误') + '");window.close();</script>');
    }
  } catch (e) {
    console.error('[TikTok OAuth] 回调异常:', e.message);
    res.send('<script>alert("授权异常: ' + e.message + '");window.close();</script>');
  }
});

// ========== Terms of Service (public) ==========
app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - VIPB Video Publisher</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background: #f8f9fa; }
    .terms-container { max-width: 800px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 48px; }
    h1 { font-size: 2rem; font-weight: 700; color: #1a1a2e; margin-bottom: 8px; }
    h2 { font-size: 1.25rem; font-weight: 600; color: #16213e; margin-top: 32px; margin-bottom: 12px; }
    p, li { color: #444; line-height: 1.8; }
    .last-updated { color: #888; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="terms-container">
    <h1>Terms of Service</h1>
    <p class="last-updated">Last Updated: March 17, 2026</p>
    <p>Welcome to VIPB Video Publisher ("Service"), operated by Wenzhou Xingyuan Holding Co., Ltd. ("Company", "we", "us", or "our"). By accessing or using our Service at <a href="https://api.chinavipb.com">api.chinavipb.com</a>, you agree to be bound by these Terms of Service ("Terms").</p>

    <h2>1. Acceptance of Terms</h2>
    <p>By creating an account or using the Service, you confirm that you are at least 18 years old and agree to comply with these Terms. If you do not agree, please do not use the Service.</p>

    <h2>2. Description of Service</h2>
    <p>VIPB Video Publisher provides tools for publishing and managing video content across social media platforms, including but not limited to TikTok. The Service includes video uploading, scheduling, analytics, and account management features.</p>

    <h2>3. User Accounts</h2>
    <ul>
      <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
      <li>You are responsible for all activities that occur under your account.</li>
      <li>You must provide accurate and complete information when creating an account.</li>
      <li>You must notify us immediately of any unauthorized use of your account.</li>
    </ul>

    <h2>4. Acceptable Use</h2>
    <p>You agree not to:</p>
    <ul>
      <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
      <li>Upload, publish, or distribute content that is illegal, harmful, threatening, abusive, defamatory, or otherwise objectionable.</li>
      <li>Infringe upon the intellectual property rights of any third party.</li>
      <li>Attempt to gain unauthorized access to the Service or its related systems.</li>
      <li>Use automated tools to scrape, crawl, or otherwise extract data from the Service without our consent.</li>
      <li>Interfere with or disrupt the integrity or performance of the Service.</li>
    </ul>

    <h2>5. Intellectual Property</h2>
    <p>The Service, including its original content, features, and functionality, is owned by Wenzhou Xingyuan Holding Co., Ltd. and is protected by international copyright, trademark, patent, trade secret, and other intellectual property laws. You retain ownership of the content you upload through the Service.</p>

    <h2>6. Third-Party Services</h2>
    <p>The Service integrates with third-party platforms such as TikTok. Your use of such third-party services is subject to their respective terms and policies. We are not responsible for the content, privacy policies, or practices of third-party services.</p>

    <h2>7. Disclaimer of Warranties</h2>
    <p>THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted, timely, secure, or error-free.</p>

    <h2>8. Limitation of Liability</h2>
    <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WENZHOU XINGYUAN HOLDING CO., LTD. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM YOUR USE OF THE SERVICE.</p>

    <h2>9. Termination</h2>
    <p>We reserve the right to suspend or terminate your account and access to the Service at our sole discretion, without prior notice, for conduct that we determine violates these Terms or is harmful to other users, us, or third parties, or for any other reason.</p>

    <h2>10. Changes to Terms</h2>
    <p>We reserve the right to modify these Terms at any time. We will notify users of any material changes by posting the updated Terms on this page. Your continued use of the Service after such changes constitutes your acceptance of the new Terms.</p>

    <h2>11. Governing Law</h2>
    <p>These Terms shall be governed by and construed in accordance with the laws of the People's Republic of China, without regard to its conflict of law provisions.</p>

    <h2>12. Contact Us</h2>
    <p>If you have any questions about these Terms, please contact us at:</p>
    <ul>
      <li><strong>Company:</strong> Wenzhou Xingyuan Holding Co., Ltd.</li>
      <li><strong>Website:</strong> <a href="https://api.chinavipb.com">api.chinavipb.com</a></li>
      <li><strong>Email:</strong> <a href="mailto:user@example.com">user@example.com</a></li>
    </ul>
  </div>
</body>
</html>`);
});

// ========== Privacy Policy (public) ==========
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - VIPB Video Publisher</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background: #f8f9fa; }
    .privacy-container { max-width: 800px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 48px; }
    h1 { font-size: 2rem; font-weight: 700; color: #1a1a2e; margin-bottom: 8px; }
    h2 { font-size: 1.25rem; font-weight: 600; color: #16213e; margin-top: 32px; margin-bottom: 12px; }
    p, li { color: #444; line-height: 1.8; }
    .last-updated { color: #888; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="privacy-container">
    <h1>Privacy Policy</h1>
    <p class="last-updated">Last Updated: March 17, 2026</p>
    <p>Wenzhou Xingyuan Holding Co., Ltd. ("Company", "we", "us", or "our") operates the VIPB Video Publisher service ("Service") at <a href="https://api.chinavipb.com">api.chinavipb.com</a>. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service.</p>

    <h2>1. Information We Collect</h2>
    <p>We may collect the following types of information:</p>
    <ul>
      <li><strong>Account Information:</strong> Name, email address, username, and password when you create an account.</li>
      <li><strong>Social Media Data:</strong> When you connect your TikTok account via OAuth, we receive your TikTok user ID, display name, and access tokens necessary to publish content on your behalf.</li>
      <li><strong>Content Data:</strong> Videos, titles, descriptions, and other content you upload or create through the Service.</li>
      <li><strong>Usage Data:</strong> Information about how you interact with the Service, including pages visited, features used, timestamps, and device information.</li>
      <li><strong>Technical Data:</strong> IP address, browser type, operating system, and other technical identifiers.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the collected information for the following purposes:</p>
    <ul>
      <li>To provide, maintain, and improve the Service.</li>
      <li>To publish video content to TikTok and other social media platforms on your behalf.</li>
      <li>To manage your account and provide customer support.</li>
      <li>To send you technical notices, updates, and administrative messages.</li>
      <li>To detect, prevent, and address technical issues and security threats.</li>
      <li>To analyze usage patterns and improve user experience.</li>
    </ul>

    <h2>3. Third-Party Data Sharing</h2>
    <p>We share your information with third parties only in the following circumstances:</p>
    <ul>
      <li><strong>TikTok API:</strong> When you authorize the Service to connect to your TikTok account, we transmit your video content, titles, and descriptions to TikTok via their Content Posting API for publishing. This data transfer is governed by <a href="https://www.tiktok.com/legal/page/row/privacy-policy/en" target="_blank">TikTok's Privacy Policy</a>.</li>
      <li><strong>Service Providers:</strong> We may share information with third-party service providers who assist us in operating the Service (e.g., hosting, analytics).</li>
      <li><strong>Legal Requirements:</strong> We may disclose information when required by law, regulation, or legal process.</li>
      <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred.</li>
    </ul>

    <h2>4. Data Security</h2>
    <p>We implement appropriate technical and organizational security measures to protect your personal information, including:</p>
    <ul>
      <li>Encryption of sensitive data (access tokens, passwords) at rest and in transit.</li>
      <li>Regular security assessments and vulnerability monitoring.</li>
      <li>Access controls limiting employee access to personal data.</li>
      <li>Secure session management with HTTP-only cookies.</li>
    </ul>
    <p>However, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security.</p>

    <h2>5. Data Retention</h2>
    <p>We retain your personal information for as long as your account is active or as needed to provide the Service. We will delete or anonymize your information upon request, subject to any legal obligations requiring us to retain certain data.</p>

    <h2>6. Your Rights</h2>
    <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
    <ul>
      <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
      <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data.</li>
      <li><strong>Deletion:</strong> Request deletion of your personal data.</li>
      <li><strong>Portability:</strong> Request transfer of your data in a machine-readable format.</li>
      <li><strong>Withdrawal of Consent:</strong> Revoke your TikTok authorization at any time through the Service settings or your TikTok account settings.</li>
      <li><strong>Objection:</strong> Object to the processing of your personal data for certain purposes.</li>
    </ul>

    <h2>7. Children's Privacy</h2>
    <p>The Service is not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete such information promptly.</p>

    <h2>8. International Data Transfers</h2>
    <p>Your information may be transferred to and processed in countries other than your country of residence. We ensure that such transfers comply with applicable data protection laws.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page with a revised "Last Updated" date.</p>

    <h2>10. Contact Us</h2>
    <p>If you have any questions about this Privacy Policy or wish to exercise your data rights, please contact us at:</p>
    <ul>
      <li><strong>Company:</strong> Wenzhou Xingyuan Holding Co., Ltd.</li>
      <li><strong>Website:</strong> <a href="https://api.chinavipb.com">api.chinavipb.com</a></li>
      <li><strong>Email:</strong> <a href="mailto:user@example.com">user@example.com</a></li>
    </ul>
  </div>
</body>
</html>`);
});

app.use('/api', apiLimiter, requireAuth);
app.use('/', requireAuth);

// ...
app.use('/', require('./routes/pages'));
app.use('/api', require('./routes/api'));
app.use('/api/ai', require('./routes/ai-api'));
app.use('/api/trade', require('./routes/trade-api'));
app.use('/api/marketing', require('./routes/marketing-api'));
app.use('/api/social', require('./routes/social-api'));
app.use('/api/tiktok', require('./routes/tiktok-api'));
const envApi = require('./routes/env-api');
app.use('/api/env', envApi);
if (envApi.startAutoUpdateTimer) envApi.startAutoUpdateTimer(app);

// eSIM号码管理
const esimApi = require('./routes/esim-api');
// eSIM入站webhook不需要登录认证（供应商回调）
app.post('/api/esim/incoming/:phoneId', express.json(), (req, res) => {
  try {
    const { phoneId } = req.params;
    const { from, content } = req.body;
    if (!from || !content) return res.status(400).json({ success: false, error: '发件人和内容必填' });
    const smsEngine = app.locals.smsEngine;
    if (!smsEngine) return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    const result = smsEngine.handleIncoming(phoneId, from, content);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('处理入站短信失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
app.use('/api/esim', requireAuth, esimApi);
app.use('/api/browser-adapters', requireAuth, require('./routes/browser-adapters-api'));
app.use('/api/products', require('./routes/products-api'));
app.use('/api/settings', require('./routes/settings-api'));
app.use('/api/whatsapp', (req, res, next) => {
  if (!isModuleEnabled(db, 'whatsapp')) return res.status(403).json({ success: false, error: 'WhatsApp模块已关闭，请在设置→模块管理中开启' });
  next();
}, require('./routes/whatsapp-api'));

// ...
const MatrixTaskEngine = require('./src/matrix-task-engine');
const createMatrixRouter = require('./routes/matrix-api');
const matrixEngine = new MatrixTaskEngine(db);
const FacebookExecutor = require('./src/platforms/facebook/executor');
matrixEngine.registerExecutor('facebook', new FacebookExecutor(db));
matrixEngine.start();

// ...
const GoogleMapsExecutor = require('./src/platforms/google-maps/executor');
matrixEngine.registerExecutor('google_maps', new GoogleMapsExecutor(db));

const TikTokExecutor = require('./src/platforms/tiktok/executor');
matrixEngine.registerExecutor('tiktok', new TikTokExecutor(db));

const InstagramExecutor = require('./src/platforms/instagram/executor');
matrixEngine.registerExecutor('instagram', new InstagramExecutor(db));

const YouTubeExecutor = require('./src/platforms/youtube/executor');
matrixEngine.registerExecutor('youtube', new YouTubeExecutor(db));

const TwitterExecutor = require('./src/platforms/twitter/executor');
matrixEngine.registerExecutor('twitter', new TwitterExecutor(db));

const VKExecutor = require('./src/platforms/vk/executor');
matrixEngine.registerExecutor('vk', new VKExecutor(db));

const RedditExecutor = require('./src/platforms/reddit/executor');
matrixEngine.registerExecutor('reddit', new RedditExecutor(db));

// AI过滤引擎
const AIFilterEngine = require('./src/ai-filter-engine');
const aiFilter = new AIFilterEngine(db);

// Outlook执行器
const OutlookExecutor = require('./src/platforms/outlook/executor');
matrixEngine.registerExecutor('outlook', new OutlookExecutor(db));

// ...
const WebsiteContactExtractor = require('./src/platforms/website/extractor');
matrixEngine.registerExecutor('website', new WebsiteContactExtractor(db));

// ...
const PinterestExecutor = require('./src/platforms/pinterest/executor');
const ThreadsExecutor = require('./src/platforms/threads/executor');
const LineExecutor = require('./src/platforms/line/executor');
matrixEngine.registerExecutor('pinterest', new PinterestExecutor(db));
matrixEngine.registerExecutor('threads', new ThreadsExecutor(db));
matrixEngine.registerExecutor('line', new LineExecutor(db));

app.use('/api/matrix', createMatrixRouter(matrixEngine));

// 统一收件箱
const InboxSyncEngine = require('./src/inbox-sync-engine');
const inboxSync = new InboxSyncEngine(db);
app.locals.inboxSync = inboxSync;

// eSIM短信引擎
const SmsEngine = require('./src/esim/sms-engine');
const smsEngine = new SmsEngine(db);
app.locals.smsEngine = smsEngine;

// 🚨 紧急刹车系统
const EmergencyBrake = require('./src/emergency-brake');
const brake = new EmergencyBrake({ db, io, matrixEngine, inboxSync, antiban, alert: app.locals.alert });
app.locals.brake = brake;

// Human Behavior Engine (拟人行为模拟)
const HumanBehaviorEngine = require('./src/human-behavior-engine');
const humanBehavior = new HumanBehaviorEngine(db, { enabled: true });
app.locals.humanBehavior = humanBehavior;
if (isModuleEnabled(db, 'human_behavior')) {
  matrixEngine.humanBehavior = humanBehavior; // 注入到矩阵引擎
}
if (dispatcher && dispatcher.setApp) dispatcher.setApp(app); // 注入到调度器
app.use('/api/human-behavior', require('./routes/human-behavior-api')(humanBehavior));

// Inbox Sync API routes
app.post('/api/inbox/sync/start', (req, res) => {
  try {
    if (!isModuleEnabled(db, 'inbox_sync')) {
      return res.json({ ok: false, error: '收件箱同步模块已关闭' });
    }
    const platforms = req.body.platforms; // optional array
    const result = inboxSync.startSync(platforms);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/inbox/sync/stop', (req, res) => {
  try {
    const result = inboxSync.stopSync();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/inbox/unread', (req, res) => {
  try {
    res.json(inboxSync.getUnreadCount());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/inbox/sync/status', (req, res) => {
  try {
    res.json(inboxSync.getSyncStatus());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ...
app.get('/matrix', (req, res) => {
  try {
    const stats = matrixEngine.getStats();
    const tasks = matrixEngine.listTasks({ limit: 50 });
    res.render('matrix', { page: 'matrix', stats, tasks });
  } catch (error) {
    res.render('matrix', { page: 'matrix', stats: {}, tasks: [], error: error.message });
  }
});

// ...
app.get('/workflow', (req, res) => res.render('workflow', { page: 'workflow' }));
app.get('/workflows', (req, res) => res.redirect('/workflow'));
app.get('/deals', (req, res) => {
  const stages = ['lead','qualified','proposal','negotiation','won','lost'];
  const stageLabels = {lead:'线索',qualified:'合格',proposal:'报价',negotiation:'谈判',won:'成交',lost:'丢失'};
  const allDeals = db.prepare('SELECT * FROM deals').all() || [];
  const deals = {}; stages.forEach(s => deals[s] = allDeals.filter(d => d.stage === s));
  const customers = db.prepare('SELECT id, company, contact_name FROM customers').all() || [];
  res.render('trade', { page: 'deals', stages, stageLabels, deals, customers });
});
app.get('/environments', (req, res) => {
  const profiles = db.prepare("SELECT * FROM browser_profiles").all() || [];
  const phones = db.prepare("SELECT * FROM phone_numbers").all() || [];
  res.render('env', { page: 'environments', profiles, phones });
});
app.get('/inbox', (req, res) => res.render('inbox', { page: 'inbox' }));
app.get('/seo', (req, res) => res.render('seo', { page: 'seo' }));
app.get('/video', (req, res) => res.render('video', { page: 'video' }));
app.get('/tiktok', (req, res) => res.render('tiktok', { page: 'tiktok' }));

// Video API
const createVideoRouter = require('./routes/video-api');
app.use('/api/videos', createVideoRouter(db, app.locals.aiEngine || null));

// ...
const { createWidgetRouter } = require('./routes/widget-api');
app.use('/api/widget', createWidgetRouter(db, null));

// ...
const SEOEngine = require('./src/seo-engine');
const seoEngine = new SEOEngine(db);
const createSEORouter = require('./routes/seo-api');
app.use('/api/seo', createSEORouter(seoEngine));

// ...
const YandexMapsExecutor = require('./src/platforms/yandex-maps/executor');
const ShopeeExecutor = require('./src/platforms/shopee/executor');
matrixEngine.registerExecutor('yandex_maps', new YandexMapsExecutor(db));
matrixEngine.registerExecutor('shopee', new ShopeeExecutor(db));
app.use('/api/antiban', require('./routes/antiban-api'));
app.use('/api/emergency', require('./routes/emergency-api'));
app.use('/api/scoring', require('./routes/lead-scoring-api'));
app.use('/api/linkedin', (req, res, next) => {
  if (!isModuleEnabled(db, 'linkedin')) return res.status(403).json({ success: false, error: 'LinkedIn模块已关闭，请在设置→模块管理中开启' });
  next();
}, require('./routes/linkedin-api'));
app.use('/api/calendar', require('./routes/calendar-api').router);
app.use('/api/inbox', require('./routes/inbox-api'));
app.use('/api/journeys', require('./routes/journey-api'));
app.use('/api/analytics', require('./routes/analytics-api').router);
app.use('/api/social-accounts', require('./routes/social-accounts-api'));
app.use('/api/customer-merge', require('./routes/customer-api')(db));
app.use('/api', require('./routes/email-api')(db));

// 邮件接收引擎 + AI自动回复
const { EmailReceiver } = require('./src/email-receiver');
const { EmailAutoReplier } = require('./src/email-auto-replier');
const { AIBrain } = require('./src/ai-brain');
const emailReceiver = new EmailReceiver(db, io, { pollInterval: 60000 });
const emailSenderInstance = new EmailSender(db);
const aiBrainInstance = new AIBrain(db);
const autoReplier = new EmailAutoReplier(db, io, { emailReceiver, emailSender: emailSenderInstance, aiBrain: aiBrainInstance });
app.locals.emailReceiver = emailReceiver;
app.locals.autoReplier = autoReplier;
const createEmailReceiverRouter = require('./routes/email-receiver-api');
app.use('/api/email-receiver', createEmailReceiverRouter(emailReceiver, autoReplier));
// 自动启动邮件接收（如果有配置IMAP的账号）
emailReceiver.start();

app.use('/api/followups', require('./routes/followup-api')(db));
app.use('/api/stats', require('./routes/stats-api')(db));
app.use('/api/customers', require('./routes/customer-import-export')(db));
app.use('/api/wa-checker', require('./routes/wa-checker-api')(waChecker));
app.use('/api/dispatcher', require('./routes/dispatcher-api')(dispatcher));
app.use('/api/ai-command', require('./routes/ai-command-api')(db));

// Agent知识库+控制面板API
app.use('/api/agent', require('./routes/agent-api')(db));
app.use('/api/agent/dashboard', require('./routes/agent-dashboard-api')(db));

// Agent巡检引擎（受模块开关控制）
const { AgentScanner } = require('./src/agent-scanner');
const agentScanner = new AgentScanner(db, io, { aiBrain: aiBrainInstance });
app.locals.agentScanner = agentScanner;
// 检查Agent模块是否启用，启用则启动巡检
try {
  const switchRow = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
  const switches = switchRow ? JSON.parse(switchRow.value) : {};
  if (switches.agent === true) {
    agentScanner.start();
    console.log('[STARTUP] Agent巡检引擎已启动');
  } else {
    console.log('[STARTUP] Agent模块未启用，巡检引擎待命');
  }
} catch (e) { console.warn('[STARTUP] Agent启动检查失败:', e.message); }

// 渠道工具API（邮箱验证、垃圾词检测、意图识别、待办管理、报价跟踪）
app.use('/api/channel-tools', require('./routes/channel-tools-api')(db));

// 退订页面（公开访问，不需要登录）
app.use('/', require('./routes/unsubscribe')(db));

// 渠道分析仪表盘API
app.use('/api/analytics-dashboard', require('./routes/analytics-dashboard-api')(db));

// ...
require('./routes/crud-api')(app, db);
// ...
require('./routes/advanced-api')(app, db);

// ...
app.use('/api/digital-humans', require('./routes/digital-human-api')(db, io));

// ...
const WorkflowEngine = require('./src/workflow-engine');
const createWorkflowRouter = require('./routes/workflow-api');
const workflowEngine = new WorkflowEngine(db, matrixEngine);
app.locals.workflowEngine = workflowEngine;
app.use('/api/workflows', (req, res, next) => {
  if (!isModuleEnabled(db, 'workflow')) return res.status(403).json({ success: false, error: '工作流引擎已关闭，请在设置→模块管理中开启' });
  next();
}, createWorkflowRouter(workflowEngine));

// ...
const LiveRestreamEngine = require('./src/live-restream-engine');
const createRestreamRouter = require('./routes/restream-api');
const restreamEngine = new LiveRestreamEngine(db);
app.locals.restreamEngine = restreamEngine;
app.use('/api/restream', (req, res, next) => {
  if (!isModuleEnabled(db, 'live_restream')) return res.status(403).json({ success: false, error: '直播转播已关闭，请在设置→模块管理中开启' });
  next();
}, createRestreamRouter(restreamEngine));

// ...
// CSRF token失效时优雅处理：重定向到登录页重新获取token
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    if (req.path === '/login') {
      return res.redirect('/login');
    }
    return res.status(403).json({ success: false, error: '安全验证失败，请刷新页面重试' });
  }
  next(err);
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ 
      success: false,
      error: isDev ? err.message : '服务器内部错误'
    });
  } else {
    res.status(500).send(isDev ? err.message : 'Internal Server Error');
  }
});

// ...
const PORT = config.port || 3000;
server.listen(PORT, () => {
  console.log(`\nVIPB AI System V2 running at http://localhost:${PORT}`);
  console.log(`馃殌 VIPB AI System V2 | 馃寪 http://localhost:${PORT} | 馃 AI Ready`);
  console.log(`Config: check .env for environment variables\n`);

  // ========== 启动恢复：扫描并修复所有模块中断的任务 ==========
  try {
    console.log('[RECOVERY] 启动恢复检查...');
    let recovered = 0;

    // ---- AI任务模块 ----
    // 1. 修复卡在 running 的AI任务（进程重启导致的孤儿任务）
    const stuckTasks = db.prepare("SELECT id, user_input FROM ai_tasks WHERE status='running'").all();
    if (stuckTasks.length > 0) {
      db.prepare("UPDATE ai_tasks SET status='interrupted', result='系统重启，任务中断', completed_at=datetime('now') WHERE status='running'").run();
      console.log(`[RECOVERY] ${stuckTasks.length}个AI任务标记为interrupted: ${stuckTasks.map(t => '#' + t.id).join(', ')}`);
      recovered += stuckTasks.length;
    }

    // 2. 修复卡在 running 的AI步骤
    const stuckSteps = db.prepare("SELECT id, task_id FROM ai_task_steps WHERE status='running'").all();
    if (stuckSteps.length > 0) {
      db.prepare("UPDATE ai_task_steps SET status='interrupted', output='{\"error\":\"系统重启，步骤中断\"}', completed_at=datetime('now') WHERE status='running'").run();
      console.log(`[RECOVERY] ${stuckSteps.length}个AI步骤标记为interrupted`);
      recovered += stuckSteps.length;
    }

    // ---- 邮件模块 ----
    // 3. 修复卡在 sending 的邮件（发送中途进程崩溃）→ 回退为 queued 让队列重新处理
    const stuckSending = db.prepare("SELECT id, to_addr FROM emails WHERE status='sending'").all();
    if (stuckSending.length > 0) {
      db.prepare("UPDATE emails SET status='queued' WHERE status='sending'").run();
      console.log(`[RECOVERY] ${stuckSending.length}封sending邮件回退为queued: ${stuckSending.map(e => '#' + e.id).join(', ')}`);
      recovered += stuckSending.length;
    }

    // 4. 修复卡在 queued 超过30分钟的定时邮件 → 改为failed触发scheduler重试
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const stuckQueued = db.prepare(
      "SELECT id, to_addr, retry_count FROM emails WHERE status='queued' AND created_at < ? AND scheduled_at IS NOT NULL"
    ).all(thirtyMinAgo);
    if (stuckQueued.length > 0) {
      for (const email of stuckQueued) {
        if ((email.retry_count || 0) < 3) {
          db.prepare("UPDATE emails SET status='failed', last_retry_at=? WHERE id=?").run(new Date().toISOString(), email.id);
          console.log(`[RECOVERY] 邮件#${email.id}(→${email.to_addr})从queued恢复为failed，等待scheduler重试`);
        } else {
          console.warn(`[RECOVERY] 邮件#${email.id}(→${email.to_addr})已重试${email.retry_count}次，保持当前状态`);
        }
      }
      recovered += stuckQueued.length;
    }

    // ---- 工作流模块 ----
    // 5. 修复卡在 running 的 workflow_runs
    const stuckWorkflows = db.prepare("SELECT id, workflow_id FROM workflow_runs WHERE status='running'").all();
    if (stuckWorkflows.length > 0) {
      db.prepare("UPDATE workflow_runs SET status='interrupted', completed_at=datetime('now') WHERE status='running'").run();
      // 同时把对应的 workflows 状态也恢复
      db.prepare("UPDATE workflows SET status='interrupted', updated_at=datetime('now') WHERE status='running'").run();
      console.log(`[RECOVERY] ${stuckWorkflows.length}个工作流运行标记为interrupted`);
      recovered += stuckWorkflows.length;
    }

    // ---- 矩阵任务模块（MatrixTaskEngine自己有恢复，这里做兜底）----
    // 6. MatrixTaskEngine.start()会把running→interrupted，但不会自动恢复到pending
    //    这里把interrupted的任务恢复为pending，让引擎重新执行
    const interruptedMatrix = db.prepare("SELECT id FROM matrix_tasks WHERE status='interrupted'").all();
    if (interruptedMatrix.length > 0) {
      db.prepare("UPDATE matrix_tasks SET status='pending', updated_at=datetime('now') WHERE status='interrupted'").run();
      console.log(`[RECOVERY] ${interruptedMatrix.length}个矩阵任务从interrupted恢复为pending`);
      recovered += interruptedMatrix.length;
    }

    // ---- WhatsApp广播模块 ----
    // 7. 修复卡在 sending 的广播（广播中途崩溃）→ 标记为failed
    const stuckBroadcasts = db.prepare("SELECT id FROM wa_broadcast_logs WHERE status='sending'").all();
    if (stuckBroadcasts.length > 0) {
      db.prepare("UPDATE wa_broadcast_logs SET status='interrupted', completed_at=datetime('now') WHERE status='sending'").run();
      console.log(`[RECOVERY] ${stuckBroadcasts.length}个WhatsApp广播标记为interrupted`);
      recovered += stuckBroadcasts.length;
    }

    // ---- 直播转播模块 ----
    // 8. 修复卡在 live 的转播会话（进程已死但状态还是live）→ 标记为interrupted
    const stuckStreams = db.prepare("SELECT id FROM restream_sessions WHERE status='live'").all();
    if (stuckStreams.length > 0) {
      db.prepare("UPDATE restream_sessions SET status='interrupted' WHERE status='live'").run();
      console.log(`[RECOVERY] ${stuckStreams.length}个直播转播会话标记为interrupted`);
      recovered += stuckStreams.length;
    }

    // ---- A/B测试模块 ----
    // 9. 卡在 running 的A/B测试不需要中断（它们是长期运行的，靠cron定期检查）
    //    但如果超过30天还在running，标记为expired
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const expiredTests = db.prepare("SELECT id FROM ab_tests WHERE status='running' AND created_at < ?").all(thirtyDaysAgo);
      if (expiredTests.length > 0) {
        db.prepare("UPDATE ab_tests SET status='expired' WHERE status='running' AND created_at < ?").run(thirtyDaysAgo);
        console.log(`[RECOVERY] ${expiredTests.length}个过期A/B测试标记为expired`);
        recovered += expiredTests.length;
      }
    } catch(e) { /* ab_tests表可能不存在 */ }

    // ---- 收件箱同步模块 ----
    // 10. inbox_sync_state 的 running 状态需要重置（InboxSyncEngine启动时会重新设置）
    try {
      db.prepare("UPDATE inbox_sync_state SET status='idle' WHERE status='running'").run();
    } catch(e) { /* 表可能不存在 */ }

    // ---- Agent模块 ----
    // 11. 修复卡在 planned/executing 的Agent操作 → 标记为cancelled
    try {
      const stuckAgentOps = db.prepare("SELECT id FROM agent_action_log WHERE status IN ('planned','executing')").all();
      if (stuckAgentOps.length > 0) {
        db.prepare("UPDATE agent_action_log SET status='cancelled', result='系统重启，操作取消' WHERE status IN ('planned','executing')").run();
        console.log(`[RECOVERY] ${stuckAgentOps.length}个Agent操作标记为cancelled`);
        recovered += stuckAgentOps.length;
      }
    } catch(e) { /* agent_action_log表可能不存在 */ }

    if (recovered > 0) {
      console.log(`[RECOVERY] ✅ 共恢复/修复 ${recovered} 个中断项`);
    } else {
      console.log('[RECOVERY] ✅ 无需恢复，所有任务状态正常');
    }
  } catch (err) {
    console.error('[RECOVERY] 启动恢复失败:', err.message);
  }

  // Startup backup
  try {
    const backupResult = performBackup(db);
    if (backupResult.success) {
      console.log(`Backup completed: ${backupResult.filename}`);
    }
    // Clean old backups
    cleanOldBackups(90);
  } catch (err) {
    console.error('Startup backup failed:', err.message);
  }
});

// Daily backup at 3am
cron.schedule('0 3 * * *', () => {
  console.log('[CRON] Starting daily backup...');
  try {
    const result = performBackup(db);
    if (result.success) {
      console.log(`[CRON] Backup done: ${result.filename}`);
      app.locals.notify('backup_completed', { filename: result.filename, size: `${(result.size/1024/1024).toFixed(2)} MB` });
      app.locals.auditLog('backup', 'system', 0, { filename: result.filename, auto: true });
    } else {
      console.error('[CRON] Backup failed:', result.error);
    }
    cleanOldBackups(90);

    // Agent日志归档（挂在每日备份后面，不新增cron）
    try {
      // agent_action_log: 180天后归档到archive表
      const archivedRows = db.prepare(`
        INSERT INTO agent_action_log_archive SELECT * FROM agent_action_log WHERE created_at < datetime('now', '-180 days')
      `).run();
      if (archivedRows.changes > 0) {
        db.prepare("DELETE FROM agent_action_log WHERE created_at < datetime('now', '-180 days')").run();
        console.log(`[CRON] Agent操作日志归档: ${archivedRows.changes}条`);
      }
      // agent_scan_results: 3个月后删除
      const deletedScans = db.prepare("DELETE FROM agent_scan_results WHERE created_at < datetime('now', '-90 days')").run();
      if (deletedScans.changes > 0) {
        console.log(`[CRON] Agent巡检结果清理: ${deletedScans.changes}条`);
      }
    } catch (archiveErr) {
      console.error('[CRON] Agent归档失败:', archiveErr.message);
    }
  } catch (err) {
    console.error('[CRON] Backup cron error:', err.message);
  }
}, { timezone: 'Asia/Shanghai' });

// Reset daily email counters at 0:05
cron.schedule('5 0 * * *', () => {
  console.log('[CRON] Resetting daily email counters...');
  try {
    const sender = new EmailSender(db);
    sender.resetDailySent();
  } catch (err) {
    console.error('[CRON] Email counter reset failed:', err.message);
  }
}, { timezone: 'Asia/Shanghai' });

// Process email queue every minute
cron.schedule('* * * * *', async () => {
  if (app.locals.brake?.isStopped()) return;
  if (!isModuleEnabled(db, 'email_broadcast')) return;
  try {
    const queueCount = db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='queued'").get().c;
    if (queueCount > 0) {
      const sender = new EmailSender(db);
      const result = await sender.processQueue();
      if (result.sent > 0 || result.failed > 0) {
        console.log(`[QUEUE] sent:${result.sent} failed:${result.failed} remaining:${result.remaining}`);
      }
      sender.closeAll();
    }
  } catch (err) {
    console.error('[QUEUE] Email queue error:', err.message);
  }
});

// Process scheduled tasks every minute (含failed自动重试，最多重试3次，间隔5分钟)
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date().toISOString();
    
    // 1. 处理到期的scheduled邮件
    const scheduledEmails = db.prepare("SELECT * FROM emails WHERE status='scheduled' AND scheduled_at <= ?").all(now);
    
    // 2. 处理failed的定时邮件（有scheduled_at的才是定时邮件，retry_count<3，距上次失败至少5分钟）
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const failedScheduled = db.prepare(
      "SELECT * FROM emails WHERE status='failed' AND scheduled_at IS NOT NULL AND COALESCE(retry_count, 0) < 3 AND (last_retry_at IS NULL OR last_retry_at <= ?)"
    ).all(fiveMinAgo);
    
    // 3. 兜底：卡在queued超过10分钟的定时邮件（processQueue反复失败但状态没变的情况）
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const stuckQueued = db.prepare(
      "SELECT * FROM emails WHERE status='queued' AND scheduled_at IS NOT NULL AND COALESCE(retry_count, 0) < 3 AND (last_retry_at IS NULL OR last_retry_at <= ?)"
    ).all(tenMinAgo);
    if (stuckQueued.length > 0) {
      console.warn(`[SCHEDULER] 发现${stuckQueued.length}封卡在queued的定时邮件，纳入重试`);
    }
    
    const allToSend = [...scheduledEmails, ...failedScheduled, ...stuckQueued];
    
    for (const email of allToSend) {
      try {
        const retryCount = email.retry_count || 0;
        const isRetry = email.status === 'failed';
        
        db.prepare("UPDATE emails SET status='queued' WHERE id=?").run(email.id);
        const sender = new EmailSender(db);
        const result = await sender.sendEmail(email.id);
        sender.closeAll();
        
        if (result.success) {
          // 成功：清除重试计数
          db.prepare("UPDATE emails SET retry_count=0 WHERE id=?").run(email.id);
          console.log(`[SCHEDULER] ${isRetry ? '重试' : '定时'}邮件已发送: ${email.to_addr} - ${email.subject}`);
        } else {
          // 失败：增加重试计数
          db.prepare("UPDATE emails SET retry_count=COALESCE(retry_count,0)+1, last_retry_at=? WHERE id=?").run(new Date().toISOString(), email.id);
          const newCount = retryCount + 1;
          if (newCount >= 3) {
            console.error(`[SCHEDULER] 邮件${email.id}已重试${newCount}次仍失败，放弃: ${result.error}`);
          } else {
            console.warn(`[SCHEDULER] 邮件${email.id}发送失败(${newCount}/3)，${5}分钟后重试: ${result.error}`);
          }
        }
      } catch (taskErr) {
        db.prepare("UPDATE emails SET status='failed', retry_count=COALESCE(retry_count,0)+1, last_retry_at=? WHERE id=?").run(new Date().toISOString(), email.id);
        console.error(`[SCHEDULER] 邮件${email.id}异常:`, taskErr.message);
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Error:', err.message);
  }
});

cron.schedule('*/5 * * * *', () => {
  if (app.locals.brake?.isStopped()) return;
  try {
    if (isModuleEnabled(db, 'linkedin')) {
    const liResult = linkedin.processSequenceQueue();
    if (liResult.processed > 0 || liResult.errors > 0) {
      console.log(`[LinkedIn] processed:${liResult.processed} skipped:${liResult.skipped} errors:${liResult.errors}`);
    }
    }
    const jResult = journey.processQueue();
    if (jResult.processed > 0 || jResult.errors > 0) {
      console.log(`[Journey] processed:${jResult.processed} completed:${jResult.completed} errors:${jResult.errors}`);
    }
  } catch (err) {
    console.error('[Automation] Cron error:', err.message);
  }
});

// 每日0点重置短信计数定时器
const resetSmsCount = () => {
  try { 
    if (smsEngine && typeof smsEngine.resetDailyCount === 'function') {
      smsEngine.resetDailyCount();
      console.log('📱 eSIM短信每日计数已重置');
    }
  } catch(e) {
    console.error('重置短信计数失败:', e.message);
  }
};

// 计算到下一个0点的毫秒数
const msToMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
};

// 启动每日重置定时器
setTimeout(function dailyReset() {
  resetSmsCount();
  setTimeout(dailyReset, 24 * 60 * 60 * 1000);
}, msToMidnight());

module.exports = { app, io };

// ========== P1: Graceful Shutdown ==========
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  // Stop engines
  try { matrixEngine.stop(); } catch(e) { console.error('matrixEngine.stop failed:', e.message); }
  try { brake.destroy(); } catch(e) { console.error('brake.destroy failed:', e.message); }
  try { inboxSync.stopSync(); } catch(e) { console.error('inboxSync.stopSync failed:', e.message); }

  server.close(() => {
    console.log('HTTP鏈嶅姟鍣ㄥ凡鍏抽棴');
    try {
      const dbRef = require('./src/database').getDb ? require('./src/database').getDb() : null;
      if (dbRef) { dbRef.pragma('wal_checkpoint(TRUNCATE)'); dbRef.close(); }
      console.log('Database closed safely');
    } catch(e) { console.error('Database close failed:', e.message); }
    process.exit(0);
  });

  setTimeout(() => { console.error('强制退出'); process.exit(1); }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
