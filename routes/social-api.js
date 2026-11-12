/**
 * 社媒获客 API
 */
const router = require('express').Router();

router.get('/posts', (req, res) => {
  try {
  const db = req.app.locals.db;
  const { platform } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const paginate = req.query.page !== undefined;

  let where = '1=1';
  const params = [];
  if (platform) { where += ' AND platform=?'; params.push(platform); }
  
  if (paginate) {
    const total = db.prepare(`SELECT COUNT(*) as c FROM social_posts WHERE ${where}`).get(...params).c;
    const data = db.prepare(`SELECT * FROM social_posts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } else {
    res.json(db.prepare(`SELECT * FROM social_posts WHERE ${where} ORDER BY created_at DESC`).all(...params));
  }
  } catch(e) { console.error('[Social] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/posts', (req, res) => {
  try {
  const db = req.app.locals.db;
  const { platform, content, media_urls, status, scheduled_at } = req.body;
  const r = db.prepare('INSERT INTO social_posts (platform,content,media_urls,status,scheduled_at) VALUES (?,?,?,?,?)')
    .run(platform, content, JSON.stringify(media_urls || []), status || 'draft', scheduled_at);
  res.json({ id: r.lastInsertRowid, success: true });
  } catch(e) { console.error('[Social] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.put('/posts/:id', (req, res) => {
  try {
  const db = req.app.locals.db;
  const { content, status, scheduled_at } = req.body;
  db.prepare('UPDATE social_posts SET content=COALESCE(?,content), status=COALESCE(?,status), scheduled_at=COALESCE(?,scheduled_at) WHERE id=?')
    .run(content, status, scheduled_at, req.params.id);
  res.json({ success: true });
  } catch(e) { console.error('[Social] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.get('/leads', (req, res) => {
  try {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const paginate = req.query.page !== undefined;

  if (paginate) {
    const total = db.prepare('SELECT COUNT(*) as c FROM social_leads').get().c;
    const data = db.prepare('SELECT * FROM social_leads ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } else {
    res.json(db.prepare('SELECT * FROM social_leads ORDER BY created_at DESC').all());
  }
  } catch(e) { console.error('[Social] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/leads', (req, res) => {
  try {
  const db = req.app.locals.db;
  const { platform, post_id, username, profile_url, message } = req.body;
  const r = db.prepare('INSERT INTO social_leads (platform,post_id,username,profile_url,message) VALUES (?,?,?,?,?)')
    .run(platform, post_id, username, profile_url, message);
  res.json({ id: r.lastInsertRowid, success: true });
  } catch(e) { console.error('[Social] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
