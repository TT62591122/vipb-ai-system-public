/**
 * 设置 API
 */
const router = require('express').Router();
const path = require('path');
const { encrypt, decrypt } = require('../src/crypto-utils');

// AI Provider apiKey 加密/解密辅助
function encryptProviders(data) {
  const result = {};
  for (const role of Object.keys(data)) {
    result[role] = (data[role] || []).map(p => ({
      ...p,
      apiKey: p.apiKey ? encrypt(p.apiKey) : ''
    }));
  }
  return result;
}
function decryptProviders(data) {
  const result = {};
  for (const role of Object.keys(data)) {
    result[role] = (data[role] || []).map(p => ({
      ...p,
      apiKey: p.apiKey ? decrypt(p.apiKey) : ''
    }));
  }
  return result;
}

// 模块开关检查工具函数（供其他模块直接调用，不走HTTP）
function isModuleEnabled(db, moduleName) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
    if (!row || !row.value) return true; // 默认开启
    const switches = JSON.parse(row.value);
    return switches[moduleName] !== false; // 未设置=开启
  } catch(e) {
    return true; // 出错默认开启
  }
}
const { performBackup, listBackups, deleteBackup, getBackupPath, cleanOldBackups } = require('../src/backup');

router.get('/', (req, res) => {
  const settings = {};
  req.app.locals.db.prepare('SELECT key, value FROM settings').all().forEach(r => {
    try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; }
  });
  res.json(settings);
});

// 出站代理配置
router.get('/outbound-proxy', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare("SELECT value FROM settings WHERE key='outbound_proxy'").get();
  res.json({ success: true, proxy: row ? JSON.parse(row.value) : { enabled: false, url: '' } });
});

router.put('/outbound-proxy', (req, res) => {
  const db = req.app.locals.db;
  const { enabled, url } = req.body;
  const config = JSON.stringify({ enabled: !!enabled, url: url || '' });
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('outbound_proxy', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(config);
  try { require('../src/outbound-proxy').clearProxyCache(); } catch(e) {}
  res.json({ success: true });
});

// 自动检测本地代理
router.get('/detect-proxy', async (req, res) => {
  const net = require('net');
  const ports = [2080, 7890, 7891, 10808, 10809, 1080, 1081, 8080, 9090, 20171];
  
  function checkPort(port) {
    return new Promise(resolve => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.connect(port, '127.0.0.1');
    });
  }
  
  // 测试哪个端口能通过代理访问Google
  const axios = require('axios');
  const { HttpsProxyAgent } = require('https-proxy-agent');
  
  for (const port of ports) {
    const alive = await checkPort(port);
    if (!alive) continue;
    
    try {
      const agent = new HttpsProxyAgent(`http://127.0.0.1:${port}`);
      await axios.get('https://www.google.com/generate_204', {
        httpAgent: agent, httpsAgent: agent, timeout: 5000
      });
      return res.json({ success: true, proxy: `http://127.0.0.1:${port}` });
    } catch(e) { /* 这个端口不行，继续 */ }
  }
  
  res.json({ success: false, error: '未检测到可用代理' });
});

// ========== 多Provider管理 ==========
router.get('/ai-providers', (req, res) => {
  const db = req.app.locals.db;
  try {
    let providers = { brain: [], video: [], vision: [], text: [] };
    const row = db.prepare("SELECT value FROM settings WHERE key='ai_providers'").get();
    if (row) {
      const providersData = JSON.parse(row.value);
      if (Array.isArray(providersData)) {
        providers = { brain: [], video: [], vision: [], text: providersData };
        db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_providers'")
          .run(JSON.stringify(providers));
      } else if (typeof providersData === 'object') {
        providers = {
          brain: Array.isArray(providersData.brain) ? providersData.brain : [],
          video: Array.isArray(providersData.video) ? providersData.video : [],
          vision: Array.isArray(providersData.vision) ? providersData.vision : [],
          text: Array.isArray(providersData.text) ? providersData.text : []
        };
      }
    } else {
      const oldRow = db.prepare("SELECT value FROM settings WHERE key='ai_provider'").get();
      if (oldRow) {
        const old = JSON.parse(oldRow.value);
        if (old.baseUrl) {
          providers = { brain: [], video: [], vision: [], text: [{ ...old, name: '默认', enabled: true, priority: 1 }] };
          db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('ai_providers',?,datetime('now'))")
            .run(JSON.stringify(providers));
        }
      }
    }
    // 解密 apiKey 后返回给前端
    res.json({ success: true, providers: decryptProviders(providers) });
  } catch(e) { res.json({ success: false, error: e.message, providers: { brain: [], video: [], vision: [], text: [] } }); }
});

router.put('/ai-providers', (req, res) => {
  const db = req.app.locals.db;
  try {
    const { providers } = req.body;
    
    // 接受两种格式：新格式 { brain: [], video: [], vision: [], text: [] } 或旧格式数组
    let providersToSave;
    
    if (Array.isArray(providers)) {
      // 旧格式数组，转换为新格式存储
      providersToSave = {
        brain: [],
        video: [],
        vision: [],
        text: providers
      };
    } else if (typeof providers === 'object') {
      // 新格式，确保所有角色都存在
      providersToSave = {
        brain: Array.isArray(providers.brain) ? providers.brain : [],
        video: Array.isArray(providers.video) ? providers.video : [],
        vision: Array.isArray(providers.vision) ? providers.vision : [],
        text: Array.isArray(providers.text) ? providers.text : []
      };
    } else {
      return res.status(400).json({ error: '需要providers参数（数组或对象格式）' });
    }
    
    // 加密 apiKey 后存储
    const encryptedProviders = encryptProviders(providersToSave);
    db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('ai_providers',?,datetime('now'))")
      .run(JSON.stringify(encryptedProviders));
    
    // 同时更新旧的ai_provider兼容字段（取text中第一个enabled的，也加密）
    const enabledTextProviders = encryptedProviders.text.filter(p => p.enabled !== false && p.baseUrl && p.apiKey);
    if (enabledTextProviders.length > 0) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('ai_provider',?,datetime('now'))")
        .run(JSON.stringify(enabledTextProviders[0]));
    }
    
    req.app.locals.auditLog('ai_providers_update', 'settings', null, { 
      format: 'new_format',
      brain_count: providersToSave.brain.length,
      video_count: providersToSave.video.length,
      vision_count: providersToSave.vision.length,
      text_count: providersToSave.text.length
    });
    
    res.json({ success: true });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

router.post('/test-ai-provider', async (req, res) => {
  const { baseUrl, apiKey, model, role } = req.body;
  if (!baseUrl || !apiKey) return res.status(400).json({ success: false, error: '缺少URL或Key' });
  
  const axios = require('axios');
  let url = baseUrl.replace(/\/+$/, '');
  const start = Date.now();

  try {
    // 视觉/视频引擎：用 /v1/models 列表接口验证连通性（不实际生成图片/视频）
    if (role === 'vision' || role === 'video') {
      let modelsUrl = url.includes('/v1') ? url.replace(/\/v1.*/, '/v1/models') : url + '/v1/models';
      try {
        const resp = await axios.get(modelsUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          timeout: 15000
        });
        const latency = Date.now() - start;
        const models = resp.data?.data || [];
        const found = models.find(m => m.id === model);
        if (found) {
          res.json({ success: true, latency: latency + 'ms', reply: `模型 ${model} 可用`, model });
        } else if (models.length > 0) {
          res.json({ success: true, latency: latency + 'ms', reply: `连接成功(${models.length}个模型)，请确认模型名`, model });
        } else {
          res.json({ success: true, latency: latency + 'ms', reply: '连接成功', model });
        }
      } catch(modelsErr) {
        // /v1/models 不可用时，回退到简单chat测试
        if (!url.includes('/v1/chat/completions')) {
          url = url.includes('/v1') ? url + '/chat/completions' : url + '/v1/chat/completions';
        }
        const resp = await axios.post(url, {
          model: model || 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi, reply OK.' }],
          max_tokens: 10
        }, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        });
        const latency = Date.now() - start;
        res.json({ success: true, latency: latency + 'ms', reply: '连接成功(chat回退)', model: resp.data?.model || model });
      }
      return;
    }

    // 其他引擎：标准 chat/completions 测试
    if (!url.includes('/v1/chat/completions')) {
      url = url.includes('/v1') ? url + '/chat/completions' : url + '/v1/chat/completions';
    }
    const resp = await axios.post(url, {
      model: model || 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi, reply with just "OK" to confirm connection.' }],
      max_tokens: 10
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    const latency = Date.now() - start;
    const reply = resp.data?.choices?.[0]?.message?.content || '';
    res.json({ success: true, latency: latency + 'ms', reply: reply.substring(0, 50), model: resp.data?.model || model });
  } catch(err) {
    const latency = Date.now() - start;
    if (err.response) {
      res.json({ success: false, error: `HTTP ${err.response.status}: ${err.response.data?.error?.message || err.message}`, latency: latency + 'ms' });
    } else {
      res.json({ success: false, error: err.message, latency: latency + 'ms' });
    }
  }
});

router.post('/ai-provider', (req, res) => {
  const db = req.app.locals.db;
  const { baseUrl, apiKey, model, models } = req.body;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('ai_provider', ?, datetime('now'))")
    .run(JSON.stringify({ baseUrl, apiKey, model, models }));
  req.app.locals.auditLog('settings_change', 'settings', 0, { key: 'ai_provider', model });
  res.json({ success: true });
});

router.post('/company', (req, res) => {
  const db = req.app.locals.db;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('company_info', ?, datetime('now'))")
    .run(JSON.stringify(req.body));
  req.app.locals.auditLog('settings_change', 'settings', 0, { key: 'company_info' });
  res.json({ success: true });
});

router.get('/export', (req, res) => {
  const db = req.app.locals.db;
  const tables = ['customers','inquiries','deals','products','email_accounts','email_sequences','emails','social_posts','social_leads','settings','knowledge_base'];
  const data = {};
  tables.forEach(t => {
    try { data[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch(e) { data[t] = []; }
  });
  data._exportedAt = new Date().toISOString();
  res.json(data);
});

router.post('/import', (req, res) => {
  const db = req.app.locals.db;
  const data = req.body;
  let imported = 0;
  const tables = ['customers','inquiries','deals','products','email_accounts','settings'];
  try {
    // 获取每张表的合法字段名（防止SQL注入）
    const tableColumns = {};
    tables.forEach(t => {
      try { tableColumns[t] = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); } catch(e) { tableColumns[t] = []; }
    });

    tables.forEach(table => {
      const rows = data[table];
      if (!rows || !rows.length) return;
      const validCols = tableColumns[table] || [];
      // 只允许表中实际存在的字段名，过滤掉id和任何非法字段名
      const cols = Object.keys(rows[0]).filter(k => k !== 'id' && validCols.includes(k) && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
      if (cols.length === 0) return;
      const placeholders = cols.map(() => '?').join(',');
      const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
      rows.forEach(row => {
        try { stmt.run(...cols.map(c => typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c])); imported++; } catch(e) {}
      });
    });
    res.json({ success: true, imported });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

// 修改密码
router.post('/change-password', async (req, res) => {
  const bcrypt = require('bcrypt');
  const db = req.app.locals.db;
  const { currentPassword, newPassword } = req.body;
  
  console.log('[修改密码] 请求数据:', { currentPassword: '***', newPassword: '***', userId: req.session.userId });
  
  if (!currentPassword || !newPassword) {
    return res.json({ success: false, error: '请填写完整信息' });
  }
  
  if (newPassword.length < 6) {
    return res.json({ success: false, error: '新密码至少6个字符' });
  }
  
  try {
    // 获取当前用户
    const userId = req.session.userId;
    console.log('[修改密码] 当前用户ID:', userId);
    
    if (!userId) {
      return res.json({ success: false, error: '未登录' });
    }
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    console.log('[修改密码] 用户查询结果:', user ? '找到用户' : '未找到用户');
    
    if (!user) {
      return res.json({ success: false, error: '用户不存在' });
    }
    
    // 验证当前密码
    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    console.log('[修改密码] 密码验证:', passwordMatch ? '通过' : '失败');
    
    if (!passwordMatch) {
      return res.json({ success: false, error: '当前密码错误' });
    }
    
    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    console.log('[修改密码] 新密码已加密');
    
    // 更新密码
    db.prepare("UPDATE users SET password = ? WHERE id = ?")
      .run(hashedPassword, userId);
    
    req.app.locals.auditLog('password_change', 'user', userId, { username: user.username });
    
    console.log('[修改密码] 密码更新成功');
    res.json({ success: true });
  } catch (err) {
    console.error('[修改密码] 错误:', err);
    res.json({ success: false, error: '修改密码失败: ' + err.message });
  }
});

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// GET /settings/totp
router.get('/totp', (req, res) => {
  const db = req.app.locals.db;
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'totp_enabled'").get();
  res.json({ success: true, enabled: enabled?.value === '1' });
});

// POST /settings/totp/setup — 生成密钥+二维码
router.post('/totp/setup', async (req, res) => {
  const secretObj = speakeasy.generateSecret({ name: 'VIPB-AI-System', issuer: 'VIPB-AI-System', length: 20 });
  const secret = secretObj.base32;
  const otpauth = secretObj.otpauth_url;
  const qrCodeUrl = await QRCode.toDataURL(otpauth);
  req.session.pendingTotpSecret = secret;
  res.json({ success: true, secret, qrCodeUrl });
});

// POST /settings/totp/enable — 验证码正确则启用
router.post('/totp/enable', (req, res) => {
  const { token } = req.body;
  const secret = req.session.pendingTotpSecret;
  if (!secret) return res.json({ success: false, error: '请先生成密钥' });
  const isValid = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
  if (!isValid) return res.json({ success: false, error: '验证码错误，请重试' });
  const db = req.app.locals.db;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_secret', ?)").run(secret);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '1')").run();
  delete req.session.pendingTotpSecret;
  req.app.locals.auditLog('totp_enable', 'security', req.session.userId, {});
  res.json({ success: true });
});

// POST /settings/totp/disable — 需要验证码+密码确认
router.post('/totp/disable', async (req, res) => {
  const { token, password } = req.body;
  const db = req.app.locals.db;
  const bcrypt = require('bcrypt');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) return res.json({ success: false, error: '密码错误' });
  const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'totp_secret'").get();
  if (!secretRow) return res.json({ success: false, error: 'TOTP未配置' });
  const isValid = speakeasy.totp.verify({ secret: secretRow.value, encoding: 'base32', token, window: 1 });
  if (!isValid) return res.json({ success: false, error: '验证码错误' });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('totp_enabled', '0')").run();
  db.prepare("DELETE FROM settings WHERE key = 'totp_secret'").run();
  req.app.locals.auditLog('totp_disable', 'security', req.session.userId, {});
  res.json({ success: true });
});

// ========== 审计日志 API ==========

// 获取操作日志
router.get('/audit-logs', (req, res) => {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const action = req.query.action || '';
  const entityType = req.query.entityType || '';
  const dateFrom = req.query.dateFrom || '';
  const dateTo = req.query.dateTo || '';

  let where = '1=1';
  const params = [];

  if (action) { where += ' AND action = ?'; params.push(action); }
  if (entityType) { where += ' AND entity_type = ?'; params.push(entityType); }
  if (dateFrom) { where += ' AND created_at >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND created_at <= ?'; params.push(dateTo + ' 23:59:59'); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM activity_log WHERE ${where}`).get(...params).c;
  const logs = db.prepare(`SELECT * FROM activity_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({
    data: logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

// 清除旧日志
router.post('/audit-logs/clean', (req, res) => {
  const db = req.app.locals.db;
  const days = parseInt(req.body.days) || 30;
  const result = db.prepare(`DELETE FROM activity_log WHERE created_at < datetime('now', '-' || ? || ' days')`).run(days);
  req.app.locals.auditLog('clean_logs', 'system', 0, { days, deleted: result.changes });
  res.json({ success: true, deleted: result.changes });
});

// ========== 数据库备份 API ==========

// 手动备份
router.post('/backup', (req, res) => {
  const db = req.app.locals.db;
  const result = performBackup(db);
  if (result.success) {
    req.app.locals.auditLog('backup', 'system', 0, { filename: result.filename, manual: true });
    req.app.locals.notify('backup_completed', { filename: result.filename, size: `${(result.size/1024/1024).toFixed(2)} MB` });
  }
  res.json(result);
});

// 获取备份列表
router.get('/backups', (req, res) => {
  const backups = listBackups();
  res.json({ success: true, backups });
});

// 下载备份
router.get('/backups/:filename', (req, res) => {
  const filePath = getBackupPath(req.params.filename);
  if (!filePath) {
    return res.status(404).json({ success: false, error: '备份文件不存在' });
  }
  res.download(filePath, req.params.filename);
});

// 删除备份
router.delete('/backups/:filename', (req, res) => {
  const result = deleteBackup(req.params.filename);
  res.json(result);
});

// 清理过期备份
router.post('/backups/clean', (req, res) => {
  const result = cleanOldBackups(req.body.days || 7);
  res.json({ success: true, ...result });
});

// ========== 模块开关管理 ==========

// 获取所有模块开关状态
router.get('/modules', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
  
  const defaults = {
    facebook: true, tiktok: true, instagram: true, youtube: true,
    twitter: true, pinterest: true, threads: true,
    google_maps: true, yandex_maps: true, website: true,
    shopee: true, reddit: true, vk: true, outlook: true,
    whatsapp: true, linkedin: true, line: true,
    inbox_sync: true, email_broadcast: true, workflow: true, live_restream: true, human_behavior: true
  };
  
  let current = defaults;
  if (row && row.value) {
    try {
      const saved = JSON.parse(row.value);
      current = { ...defaults, ...saved };
    } catch(e) {}
  }
  
  res.json({ success: true, modules: current });
});

// 更新模块开关
router.put('/modules', (req, res) => {
  const db = req.app.locals.db;
  const { modules } = req.body;
  if (!modules || typeof modules !== 'object') {
    console.log('[MODULE] PUT /modules rejected: missing modules param');
    return res.status(400).json({ success: false, error: '缺少modules参数' });
  }
  
  const row = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
  let current = {};
  if (row && row.value) {
    try { current = JSON.parse(row.value); } catch(e) {}
  }
  
  const updated = { ...current, ...modules };
  
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('module_switches', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(JSON.stringify(updated));
  
  res.json({ success: true, modules: updated });
});

// 检查单个模块是否开启
router.get('/modules/:name', (req, res) => {
  const db = req.app.locals.db;
  const name = req.params.name;
  const row = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
  let enabled = true;
  if (row && row.value) {
    try {
      const switches = JSON.parse(row.value);
      if (switches[name] !== undefined) enabled = switches[name];
    } catch(e) {}
  }
  res.json({ success: true, name, enabled });
});

// ==================== TikTok API 配置 ====================
router.get('/tiktok-api', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tiktok_api'").get();
  if (!row) return res.json({ success: true, data: {} });
  try {
    const data = JSON.parse(row.value);
    // 解密 clientSecret 返回给前端（脱敏显示）
    if (data.clientSecret) {
      const decrypted = decrypt(data.clientSecret);
      data.clientSecretMasked = decrypted ? ('*'.repeat(Math.max(0, decrypted.length - 4)) + decrypted.slice(-4)) : '';
      delete data.clientSecret; // 不返回加密原文
    }
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: true, data: {} });
  }
});

router.put('/tiktok-api', (req, res) => {
  const db = req.app.locals.db;
  const { clientKey, clientSecret, redirectUri } = req.body;
  
  // 读取现有配置
  const existing = {};
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tiktok_api'").get();
  if (row) {
    try { Object.assign(existing, JSON.parse(row.value)); } catch(e) {}
  }
  
  const data = {
    clientKey: clientKey || existing.clientKey || '',
    clientSecret: clientSecret ? encrypt(clientSecret) : (existing.clientSecret || ''),
    redirectUri: redirectUri || existing.redirectUri || 'http://localhost:3001/oauth/tiktok/callback'
  };
  
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run('tiktok_api', JSON.stringify(data));
  res.json({ success: true });
});

// ==================== YouTube API 配置 ====================
router.get('/youtube-api', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'youtube_api'").get();
  if (!row) return res.json({ success: true, data: {} });
  try {
    const data = JSON.parse(row.value);
    if (data.clientSecret) {
      const decrypted = decrypt(data.clientSecret);
      data.clientSecretMasked = decrypted ? ('*'.repeat(Math.max(0, decrypted.length - 4)) + decrypted.slice(-4)) : '';
      delete data.clientSecret;
    }
    res.json({ success: true, data });
  } catch (e) { res.json({ success: true, data: {} }); }
});

router.put('/youtube-api', (req, res) => {
  const db = req.app.locals.db;
  const { clientId, clientSecret, apiKey, channelId } = req.body;
  const existing = {};
  const row = db.prepare("SELECT value FROM settings WHERE key = 'youtube_api'").get();
  if (row) { try { Object.assign(existing, JSON.parse(row.value)); } catch(e) {} }
  const data = {
    clientId: clientId || existing.clientId || '',
    clientSecret: clientSecret ? encrypt(clientSecret) : (existing.clientSecret || ''),
    redirectUri: 'http://localhost:3001/oauth/youtube/callback',
    apiKey: apiKey || existing.apiKey || '',
    channelId: channelId || existing.channelId || ''
  };
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run('youtube_api', JSON.stringify(data));
  res.json({ success: true });
});

// ==================== Instagram API 配置 ====================
router.get('/instagram-api', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'instagram_api'").get();
  if (!row) return res.json({ success: true, data: {} });
  try {
    const data = JSON.parse(row.value);
    if (data.appSecret) {
      const decrypted = decrypt(data.appSecret);
      data.appSecretMasked = decrypted ? ('*'.repeat(Math.max(0, decrypted.length - 4)) + decrypted.slice(-4)) : '';
      delete data.appSecret;
    }
    res.json({ success: true, data });
  } catch (e) { res.json({ success: true, data: {} }); }
});

router.put('/instagram-api', (req, res) => {
  const db = req.app.locals.db;
  const { appId, appSecret, accountId, pageId } = req.body;
  const existing = {};
  const row = db.prepare("SELECT value FROM settings WHERE key = 'instagram_api'").get();
  if (row) { try { Object.assign(existing, JSON.parse(row.value)); } catch(e) {} }
  const data = {
    appId: appId || existing.appId || '',
    appSecret: appSecret ? encrypt(appSecret) : (existing.appSecret || ''),
    redirectUri: 'http://localhost:3001/oauth/instagram/callback',
    accountId: accountId || existing.accountId || '',
    pageId: pageId || existing.pageId || ''
  };
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run('instagram_api', JSON.stringify(data));
  res.json({ success: true });
});

// ⚠️ 通配符路由必须放在最后！任何新增的 PUT 具体路由都要写在这上面
// 教训：/:key 会匹配所有 PUT 请求，如果放在前面会拦截 /ai-providers 等专用路由
// 白名单：只有白名单中的 key 才能通过此路由写入
const ALLOWED_SETTINGS_KEYS = ['company', 'antiban_rules', 'email_warmup', 'module_switches', 'outbound_proxy', 'ai_router'];
router.put('/:key', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED_SETTINGS_KEYS.includes(key)) {
    console.warn(`[SETTINGS] 拒绝非白名单key写入: ${key}`);
    return res.status(400).json({ success: false, error: '不允许的设置项: ' + key });
  }
  const db = req.app.locals.db;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(key, JSON.stringify(req.body.value));
  res.json({ success: true });
});

module.exports = router;
module.exports.isModuleEnabled = isModuleEnabled;
