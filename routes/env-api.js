/**
 * 账号环境管理 API — 含 NekoBox 风格代理/订阅管理
 */
const router = require('express').Router();
const net = require('net');
const http = require('http');
const { URL } = require('url');
const { parseShareLink, parseSubscription } = require('../src/proxy-parser');
const { injectProxyFetch } = require('../src/outbound-proxy');

// ========== 数据库迁移（启动时执行） ==========
function migrateProxyTables(db) {
  // 新建 proxy_subscriptions 表
  db.exec(`CREATE TABLE IF NOT EXISTS proxy_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    url TEXT NOT NULL,
    type TEXT DEFAULT 'auto',
    node_count INTEGER DEFAULT 0,
    last_updated DATETIME,
    auto_update INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT (datetime('now'))
  )`);

  // ALTER TABLE proxies — 逐个加字段，已存在则忽略
  const cols = [
    "subscription_id INTEGER DEFAULT NULL",
    "share_link TEXT DEFAULT ''",
    "extra_config TEXT DEFAULT '{}'",
    "latency_ms INTEGER DEFAULT NULL",
    "last_latency_test DATETIME DEFAULT NULL",
    "group_name TEXT DEFAULT ''",
    "sort_order INTEGER DEFAULT 0"
  ];
  for (const col of cols) {
    try { db.exec(`ALTER TABLE proxies ADD COLUMN ${col}`); } catch (_) { /* exists */ }
  }

  // subscription-userinfo 字段
  const subCols = [
    "upload_bytes INTEGER DEFAULT 0",
    "download_bytes INTEGER DEFAULT 0",
    "total_bytes INTEGER DEFAULT 0",
    "expire_time INTEGER DEFAULT 0"
  ];
  for (const col of subCols) {
    try { db.exec(`ALTER TABLE proxy_subscriptions ADD COLUMN ${col}`); } catch (_) { /* exists */ }
  }
}

// 延迟执行迁移的标志
let _migrated = false;
function ensureMigration(db) {
  if (!_migrated) { migrateProxyTables(db); _migrated = true; }
}

// ========== 解析 subscription-userinfo 响应头 ==========
function parseSubscriptionUserInfo(headerValue) {
  if (!headerValue) return null;
  const info = {};
  const parts = headerValue.split(';');
  for (const part of parts) {
    const [key, val] = part.trim().split('=');
    if (key && val) {
      const k = key.trim().toLowerCase();
      const v = parseInt(val.trim(), 10);
      if (k === 'upload') info.upload_bytes = v || 0;
      else if (k === 'download') info.download_bytes = v || 0;
      else if (k === 'total') info.total_bytes = v || 0;
      else if (k === 'expire') info.expire_time = v || 0;
    }
  }
  return info;
}

function saveSubscriptionUserInfo(db, subId, info) {
  if (!info) return;
  db.prepare(`UPDATE proxy_subscriptions SET upload_bytes=?, download_bytes=?, total_bytes=?, expire_time=? WHERE id=?`)
    .run(info.upload_bytes || 0, info.download_bytes || 0, info.total_bytes || 0, info.expire_time || 0, subId);
}

// ========== 增量更新核心逻辑 ==========
function incrementalUpdateNodes(db, subId, newNodes, role) {
  const oldNodes = db.prepare('SELECT * FROM proxies WHERE subscription_id=?').all(subId);

  // Build key maps
  const makeKey = (n) => `${n.host}:${n.port}:${n.protocol || 'unknown'}`;
  const oldMap = new Map();
  for (const n of oldNodes) oldMap.set(makeKey(n), n);
  const newMap = new Map();
  for (const n of newNodes) newMap.set(makeKey(n), n);

  let added = 0, removed = 0, updated = 0;

  // Remove nodes no longer in subscription
  const toRemove = oldNodes.filter(n => !newMap.has(makeKey(n)));
  if (toRemove.length) {
    const delStmt = db.prepare('DELETE FROM proxies WHERE id=?');
    for (const n of toRemove) { delStmt.run(n.id); removed++; }
  }

  // Add new nodes
  const insertStmt = db.prepare(`INSERT INTO proxies (type,host,port,username,password,protocol,label,role,share_link,extra_config,subscription_id,group_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  // Update existing nodes (label, username, password, extra_config, group_name) but preserve latency_ms, is_alive etc.
  const updateStmt = db.prepare(`UPDATE proxies SET label=?, username=?, password=?, extra_config=?, group_name=?, share_link=? WHERE id=?`);

  for (const [key, n] of newMap) {
    const old = oldMap.get(key);
    if (!old) {
      insertStmt.run('proxy', n.host, n.port, n.username || '', n.password || '',
        n.protocol || 'unknown', n.label || '', role,
        n.share_link || '', n.extra_config || '{}', subId, n.group_name || '');
      added++;
    } else {
      updateStmt.run(n.label || old.label || '', n.username || old.username || '', n.password || old.password || '',
        n.extra_config || old.extra_config || '{}', n.group_name || old.group_name || '',
        n.share_link || old.share_link || '', old.id);
      updated++;
    }
  }

  const total = db.prepare('SELECT COUNT(*) as c FROM proxies WHERE subscription_id=?').get(subId).c;
  return { added, removed, updated, total };
}

// ========== 订阅刷新核心函数（供路由和定时器复用） ==========
async function refreshSubscription(db, sub, role) {
  const resp = await fetch(sub.url, injectProxyFetch(db, { headers: { 'User-Agent': 'clash' }, signal: AbortSignal.timeout(15000) }));

  // 解析 subscription-userinfo 响应头
  const userInfoHeader = resp.headers.get('subscription-userinfo');
  const userInfo = parseSubscriptionUserInfo(userInfoHeader);
  if (userInfo) saveSubscriptionUserInfo(db, sub.id, userInfo);

  const text = await resp.text();
  const nodes = parseSubscription(text);

  // 增量更新
  const result = incrementalUpdateNodes(db, sub.id, nodes, role || 'vpn');

  db.prepare(`UPDATE proxy_subscriptions SET node_count=?, last_updated=datetime('now') WHERE id=?`)
    .run(result.total, sub.id);

  return result;
}

// ========== 中间件：确保迁移已执行 ==========
router.use((req, res, next) => {
  ensureMigration(req.app.locals.db);
  next();
});

// ========== 浏览器环境 ==========
router.get('/profiles', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT * FROM browser_profiles ORDER BY id').all());
});

router.post('/profiles', (req, res) => {
  const db = req.app.locals.db;
  const { name, platform, proxy_id, fingerprint } = req.body;
  const r = db.prepare('INSERT INTO browser_profiles (name,platform,proxy_id,fingerprint) VALUES (?,?,?,?)')
    .run(name, platform, proxy_id, JSON.stringify(fingerprint || {}));
  res.json({ id: r.lastInsertRowid, success: true });
});

// ========== 代理IP ==========
router.get('/proxies', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT * FROM proxies ORDER BY sort_order, id').all());
});

router.post('/proxies', (req, res) => {
  const db = req.app.locals.db;
  const { type, host, port, username, password, country, provider, role, protocol, label, extra_config, group_name } = req.body;
  const r = db.prepare(`INSERT INTO proxies (type,host,port,username,password,country,provider,role,protocol,label,extra_config,group_name) 
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(type || 'residential', host, port, username || '', password || '', country || '', provider || '',
      role || 'landing', protocol || 'http', label || '', extra_config || '{}', group_name || '');
  res.json({ id: r.lastInsertRowid, success: true });
});

router.put('/proxies/:id', (req, res) => {
  const db = req.app.locals.db;
  const { type, host, port, username, password, country, provider, role, protocol, label, extra_config, group_name } = req.body;
  db.prepare(`UPDATE proxies SET type=?,host=?,port=?,username=?,password=?,country=?,provider=?,role=?,protocol=?,label=?,extra_config=?,group_name=? WHERE id=?`)
    .run(type || 'residential', host, port, username || '', password || '', country || '', provider || '',
      role || 'landing', protocol || 'http', label || '', extra_config || '{}', group_name || '', req.params.id);
  res.json({ success: true });
});

router.delete('/proxies/:id', (req, res) => {
  req.app.locals.db.prepare('DELETE FROM proxies WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/proxies/batch', (req, res) => {
  const db = req.app.locals.db;
  const { proxies } = req.body;
  const stmt = db.prepare('INSERT INTO proxies (type,host,port,username,password,country,provider) VALUES (?,?,?,?,?,?,?)');
  const insert = db.transaction((list) => { list.forEach(p => stmt.run(p.type||'residential', p.host, p.port, p.username, p.password, p.country, p.provider)); });
  insert(proxies || []);
  res.json({ success: true, count: (proxies || []).length });
});

// ========== 节点导入 ==========
router.post('/proxies/import', async (req, res) => {
  const db = req.app.locals.db;
  const { mode, data, role } = req.body;
  if (!data) return res.status(400).json({ success: false, error: '缺少data' });

  let nodes = [];
  let subscriptionId = null;

  if (mode === 'subscription') {
    // data = 订阅URL
    try {
      const db = req.app.locals.db;
      const resp = await fetch(data, injectProxyFetch(db, { headers: { 'User-Agent': 'clash' }, signal: AbortSignal.timeout(15000) }));

      // 解析 subscription-userinfo
      const userInfoHeader = resp.headers.get('subscription-userinfo');
      const userInfo = parseSubscriptionUserInfo(userInfoHeader);

      const text = await resp.text();
      nodes = parseSubscription(text);

      // 如果有 userInfo 且后续创建了订阅记录，可以保存
      // 这里 import 模式不自动创建订阅记录，userInfo 仅在已有订阅时保存
      if (userInfo && subscriptionId) {
        saveSubscriptionUserInfo(db, subscriptionId, userInfo);
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: '订阅拉取失败: ' + e.message });
    }
  } else {
    // mode === 'links' — 多行分享链接
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseShareLink(line.trim());
      if (parsed) nodes.push(parsed);
    }
  }

  if (!nodes.length) return res.json({ success: true, count: 0, message: '未解析到有效节点' });

  const stmt = db.prepare(`INSERT INTO proxies (type,host,port,username,password,protocol,label,role,share_link,extra_config,subscription_id,group_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insert = db.transaction((list) => {
    for (const n of list) {
      stmt.run('proxy', n.host, n.port, n.username || '', n.password || '',
        n.protocol || 'unknown', n.label || '', role || 'vpn',
        n.share_link || '', n.extra_config || '{}', subscriptionId, n.group_name || '');
    }
  });
  insert(nodes);

  res.json({ success: true, count: nodes.length });
});

// ========== 节点测速 ==========
function testLatency(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.connect(port, host, () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve(latency);
    });
    socket.on('error', () => { socket.destroy(); resolve(-1); });
    socket.on('timeout', () => { socket.destroy(); resolve(-1); });
  });
}

// 通过 HTTP 代理测试 URL 延迟
function testUrlViaHttpProxy(proxyHost, proxyPort, targetUrl, timeout = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const target = new URL(targetUrl);
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'GET',
      path: targetUrl,
      headers: { Host: target.host },
      timeout: timeout
    });
    req.on('response', (res) => {
      const latency = Date.now() - start;
      res.resume();
      resolve({ latency, statusCode: res.statusCode, success: true });
    });
    req.on('error', () => resolve({ latency: -1, success: false }));
    req.on('timeout', () => { req.destroy(); resolve({ latency: -1, success: false }); });
    req.end();
  });
}

// 通过 HTTP CONNECT 测试延迟
function testViaHttpConnect(proxyHost, proxyPort, targetHost, targetPort, timeout = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      timeout: timeout
    });
    req.on('connect', (res, socket) => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ latency, success: res.statusCode === 200 });
    });
    req.on('error', () => resolve({ latency: -1, success: false }));
    req.on('timeout', () => { req.destroy(); resolve({ latency: -1, success: false }); });
    req.end();
  });
}

router.post('/proxies/:id/test', async (req, res) => {
  const db = req.app.locals.db;
  const proxy = db.prepare('SELECT * FROM proxies WHERE id=?').get(req.params.id);
  if (!proxy) return res.status(404).json({ success: false, error: '代理不存在' });

  const latency = await testLatency(proxy.host, proxy.port);
  db.prepare(`UPDATE proxies SET latency_ms=?, last_latency_test=datetime('now'), is_alive=? WHERE id=?`)
    .run(latency > 0 ? latency : null, latency > 0 ? 1 : 0, proxy.id);

  res.json({ success: true, id: proxy.id, latency_ms: latency > 0 ? latency : null, is_alive: latency > 0 });
});

router.post('/proxies/test-batch', async (req, res) => {
  const db = req.app.locals.db;
  const { ids } = req.body; // optional: specific IDs
  const proxies = ids && ids.length
    ? db.prepare(`SELECT * FROM proxies WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare('SELECT * FROM proxies').all();

  const results = [];
  // Test in batches of 10
  for (let i = 0; i < proxies.length; i += 10) {
    const batch = proxies.slice(i, i + 10);
    const batchResults = await Promise.all(batch.map(async (p) => {
      const latency = await testLatency(p.host, p.port, 5000);
      db.prepare(`UPDATE proxies SET latency_ms=?, last_latency_test=datetime('now'), is_alive=? WHERE id=?`)
        .run(latency > 0 ? latency : null, latency > 0 ? 1 : 0, p.id);
      return { id: p.id, latency_ms: latency > 0 ? latency : null, is_alive: latency > 0 };
    }));
    results.push(...batchResults);
  }

  res.json({ success: true, results });
});

// ========== 真实代理连通性测试（#7） ==========
router.post('/proxies/:id/test-real', async (req, res) => {
  const db = req.app.locals.db;
  const proxy = db.prepare('SELECT * FROM proxies WHERE id=?').get(req.params.id);
  if (!proxy) return res.status(404).json({ success: false, error: '代理不存在' });

  const testUrl = req.body.url || 'http://www.gstatic.com/generate_204';
  const protocol = (proxy.protocol || '').toLowerCase();
  let result;

  if (protocol === 'http' || protocol === 'https') {
    // HTTP 代理：直接通过代理访问 URL
    result = await testUrlViaHttpProxy(proxy.host, proxy.port, testUrl);
  } else if (protocol === 'socks5' || protocol === 'socks') {
    // SOCKS5：用 HTTP CONNECT 方式测试
    const target = new URL(testUrl);
    result = await testViaHttpConnect(proxy.host, proxy.port, target.hostname, parseInt(target.port) || 80);
  } else {
    // ss/vmess/trojan 等：退回 TCP 连接测试
    const latency = await testLatency(proxy.host, proxy.port);
    result = { latency, success: latency > 0, method: 'tcp' };
  }

  const latency = result.success ? result.latency : -1;
  db.prepare(`UPDATE proxies SET latency_ms=?, last_latency_test=datetime('now'), is_alive=? WHERE id=?`)
    .run(latency > 0 ? latency : null, latency > 0 ? 1 : 0, proxy.id);

  res.json({
    success: true,
    id: proxy.id,
    protocol,
    method: result.method || (protocol === 'http' || protocol === 'https' ? 'http-proxy' : protocol === 'socks5' || protocol === 'socks' ? 'connect' : 'tcp'),
    latency_ms: latency > 0 ? latency : null,
    is_alive: latency > 0,
    status_code: result.statusCode || null
  });
});

// ========== URL延迟测试接口 ==========
router.post('/proxies/:id/test-url', async (req, res) => {
  const db = req.app.locals.db;
  const proxy = db.prepare('SELECT * FROM proxies WHERE id=?').get(req.params.id);
  if (!proxy) return res.status(404).json({ success: false, error: '代理不存在' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '缺少url参数' });

  const protocol = (proxy.protocol || '').toLowerCase();
  let result;

  if (protocol === 'http' || protocol === 'https') {
    result = await testUrlViaHttpProxy(proxy.host, proxy.port, url);
  } else if (protocol === 'socks5' || protocol === 'socks') {
    const target = new URL(url);
    result = await testViaHttpConnect(proxy.host, proxy.port, target.hostname, parseInt(target.port) || 80);
  } else {
    // 无法通过代理访问URL，退回TCP测试
    const latency = await testLatency(proxy.host, proxy.port);
    result = { latency, success: latency > 0, method: 'tcp-fallback' };
  }

  const latency = result.success ? result.latency : -1;
  db.prepare(`UPDATE proxies SET latency_ms=?, last_latency_test=datetime('now'), is_alive=? WHERE id=?`)
    .run(latency > 0 ? latency : null, latency > 0 ? 1 : 0, proxy.id);

  res.json({
    success: true,
    id: proxy.id,
    url,
    latency_ms: latency > 0 ? latency : null,
    is_alive: latency > 0,
    status_code: result.statusCode || null,
    method: result.method || (protocol === 'http' ? 'http-proxy' : 'connect')
  });
});

// ========== 订阅管理 ==========
router.get('/subscriptions', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT * FROM proxy_subscriptions ORDER BY id DESC').all());
});

router.post('/subscriptions', (req, res) => {
  const db = req.app.locals.db;
  const { url, name, type } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '缺少URL' });
  const r = db.prepare('INSERT INTO proxy_subscriptions (url, name, type) VALUES (?,?,?)')
    .run(url, name || '', type || 'auto');
  res.json({ id: r.lastInsertRowid, success: true });
});

// ========== 订阅编辑接口（#12） ==========
router.put('/subscriptions/:id', (req, res) => {
  const db = req.app.locals.db;
  const { name, url, type, auto_update } = req.body;
  const sub = db.prepare('SELECT * FROM proxy_subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: '订阅不存在' });

  db.prepare(`UPDATE proxy_subscriptions SET name=?, url=?, type=?, auto_update=? WHERE id=?`)
    .run(
      name !== undefined ? name : sub.name,
      url !== undefined ? url : sub.url,
      type !== undefined ? type : sub.type,
      auto_update !== undefined ? (auto_update ? 1 : 0) : sub.auto_update,
      req.params.id
    );
  res.json({ success: true });
});

router.delete('/subscriptions/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM proxies WHERE subscription_id=?').run(req.params.id);
  db.prepare('DELETE FROM proxy_subscriptions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/subscriptions/:id/refresh', async (req, res) => {
  const db = req.app.locals.db;
  const sub = db.prepare('SELECT * FROM proxy_subscriptions WHERE id=?').get(req.params.id);
  if (!sub) return res.status(404).json({ success: false, error: '订阅不存在' });

  const role = req.body.role || 'vpn';

  try {
    const result = await refreshSubscription(db, sub, role);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: '刷新失败: ' + e.message });
  }
});

// ========== 接码 ==========
router.get('/phones', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT * FROM phone_numbers ORDER BY id').all());
});

router.post('/phones', (req, res) => {
  const db = req.app.locals.db;
  const { number, country, platform, provider, type } = req.body;
  const r = db.prepare('INSERT INTO phone_numbers (number,country,platform,provider,type) VALUES (?,?,?,?,?)')
    .run(number, country, platform, provider, type || 'temp');
  res.json({ id: r.lastInsertRowid, success: true });
});

// ========== 代理链 ==========
router.get('/chains', (req, res) => {
  const db = req.app.locals.db;
  const chains = db.prepare(`SELECT c.*,
    fp.host as fp_host, fp.port as fp_port, fp.type as fp_type, fp.label as fp_label, fp.protocol as fp_protocol,
    vp.host as vp_host, vp.port as vp_port, vp.type as vp_type, vp.label as vp_label, vp.protocol as vp_protocol,
    lp.host as lp_host, lp.port as lp_port, lp.type as lp_type, lp.label as lp_label, lp.protocol as lp_protocol
    FROM proxy_chains c
    LEFT JOIN proxies fp ON c.frontend_proxy_id = fp.id
    LEFT JOIN proxies vp ON c.vpn_proxy_id = vp.id
    LEFT JOIN proxies lp ON c.landing_proxy_id = lp.id
    ORDER BY c.id DESC`).all();
  res.json(chains);
});

router.post('/chains', (req, res) => {
  const db = req.app.locals.db;
  const { name, frontend_proxy_id, vpn_proxy_id, landing_proxy_id, notes } = req.body;
  const r = db.prepare('INSERT INTO proxy_chains (name, frontend_proxy_id, vpn_proxy_id, landing_proxy_id, notes) VALUES (?,?,?,?,?)')
    .run(name || '', frontend_proxy_id || null, vpn_proxy_id || null, landing_proxy_id || null, notes || '');
  res.json({ id: r.lastInsertRowid, success: true });
});

router.put('/chains/:id', (req, res) => {
  const db = req.app.locals.db;
  const { name, frontend_proxy_id, vpn_proxy_id, landing_proxy_id, notes, status } = req.body;
  db.prepare(`UPDATE proxy_chains SET name=?, frontend_proxy_id=?, vpn_proxy_id=?, landing_proxy_id=?, notes=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(name || '', frontend_proxy_id || null, vpn_proxy_id || null, landing_proxy_id || null, notes || '', status || 'active', req.params.id);
  res.json({ success: true });
});

router.delete('/chains/:id', (req, res) => {
  req.app.locals.db.prepare('DELETE FROM proxy_chains WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ========== 订阅自动更新定时器（#3） ==========
function startAutoUpdateTimer(app) {
  setInterval(async () => {
    try {
      const db = app.locals.db;
      if (!db) return;
      ensureMigration(db);
      const subs = db.prepare('SELECT * FROM proxy_subscriptions WHERE auto_update = 1').all();
      for (const sub of subs) {
        try {
          const result = await refreshSubscription(db, sub, 'vpn');
          console.log(`[AutoUpdate] 订阅 "${sub.name || sub.id}" 更新完成:`, result);
        } catch (e) {
          console.error(`[AutoUpdate] 订阅 "${sub.name || sub.id}" 更新失败:`, e.message);
        }
      }
    } catch (e) {
      console.error('[AutoUpdate] 定时器错误:', e.message);
    }
  }, 30 * 60 * 1000); // 每30分钟
}

module.exports = router;
module.exports.startAutoUpdateTimer = startAutoUpdateTimer;
