/**
 * 统一内容日历 API
 * 跨平台内容排期管理（TikTok/Facebook/LinkedIn/WhatsApp）
 */
const router = require('express').Router();

// 初始化日历表
function initCalendar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_calendar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      platform TEXT NOT NULL,
      content_type TEXT DEFAULT 'post',
      media_urls TEXT DEFAULT '[]',
      hashtags TEXT DEFAULT '[]',
      target_audience TEXT DEFAULT '',
      language TEXT DEFAULT 'en',
      status TEXT DEFAULT 'draft',
      scheduled_at DATETIME,
      published_at DATETIME,
      ai_generated INTEGER DEFAULT 0,
      engagement TEXT DEFAULT '{}',
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT 'admin',
      approved_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      category TEXT,
      platform TEXT,
      content TEXT,
      variables TEXT DEFAULT '[]',
      use_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_platform ON content_calendar(platform);
    CREATE INDEX IF NOT EXISTS idx_calendar_status ON content_calendar(status);
    CREATE INDEX IF NOT EXISTS idx_calendar_scheduled ON content_calendar(scheduled_at);
  `);
}

/** 获取日历事件（按日期范围） */
router.get('/events', (req, res) => {
  const db = req.app.locals.db;
  const { start, end, platform, status } = req.query;

  let where = '1=1';
  const params = [];
  if (start) { where += ' AND (scheduled_at >= ? OR created_at >= ?)'; params.push(start, start); }
  if (end) { where += ' AND (scheduled_at <= ? OR created_at <= ?)'; params.push(end, end); }
  if (platform) { where += ' AND platform=?'; params.push(platform); }
  if (status) { where += ' AND status=?'; params.push(status); }

  const events = db.prepare(`SELECT * FROM content_calendar WHERE ${where} ORDER BY COALESCE(scheduled_at, created_at) ASC`).all(...params);
  
  // 转换为日历格式
  const calendarEvents = events.map(e => ({
    ...e,
    date: e.scheduled_at || e.created_at,
    color: { tiktok:'#ff0050', facebook:'#1877f2', linkedin:'#0a66c2', whatsapp:'#25d366', instagram:'#e4405f' }[e.platform] || '#6c757d',
    media_urls: JSON.parse(e.media_urls || '[]'),
    hashtags: JSON.parse(e.hashtags || '[]'),
    engagement: JSON.parse(e.engagement || '{}'),
  }));

  res.json(calendarEvents);
});

/** 创建内容 */
router.post('/events', (req, res) => {
  const db = req.app.locals.db;
  const { title, content, platform, content_type, media_urls, hashtags, target_audience, language, status, scheduled_at, notes } = req.body;
  
  if (!title || !platform) return res.status(400).json({ error: '缺少标题或平台' });

  const r = db.prepare(`INSERT INTO content_calendar 
    (title, content, platform, content_type, media_urls, hashtags, target_audience, language, status, scheduled_at, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(title, content || '', platform, content_type || 'post',
      JSON.stringify(media_urls || []), JSON.stringify(hashtags || []),
      target_audience || '', language || 'en', status || 'draft', scheduled_at || null, notes || '');

  req.app.locals.auditLog('content_create', 'content_calendar', r.lastInsertRowid, { title, platform });
  res.json({ success: true, id: r.lastInsertRowid });
});

/** 更新内容 */
router.put('/events/:id', (req, res) => {
  const db = req.app.locals.db;
  const fields = ['title','content','platform','content_type','status','scheduled_at','notes','target_audience','language'];
  const updates = [];
  const params = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); }
  }
  if (req.body.media_urls) { updates.push('media_urls=?'); params.push(JSON.stringify(req.body.media_urls)); }
  if (req.body.hashtags) { updates.push('hashtags=?'); params.push(JSON.stringify(req.body.hashtags)); }
  if (req.body.approved_by) { updates.push('approved_by=?'); params.push(req.body.approved_by); }

  if (updates.length === 0) return res.json({ success: true });
  updates.push("updated_at=datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE content_calendar SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
});

/** 删除内容 */
router.delete('/events/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM content_calendar WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

/** AI生成多平台内容 */
router.post('/ai-generate', async (req, res) => {
  const { product, topic, platforms, language } = req.body;
  if (!topic) return res.status(400).json({ error: '缺少主题' });

  try {
    const AiBrain = require('../src/ai-brain');
    const db = req.app.locals.db;
    const aiBrain = new AiBrain(db);

    const targetPlatforms = platforms || ['tiktok', 'facebook', 'linkedin'];
    const results = {};

    for (const platform of targetPlatforms) {
      const prompt = `Generate a ${platform} post for a B2B smart meter/circuit breaker manufacturer.
Topic: ${topic}
${product ? `Product: ${product}` : ''}
Language: ${language || 'English'}
Platform guidelines:
- TikTok: Short, engaging script (15-60 sec), trending hashtags, hook in first line
- Facebook: Informative post, 1-2 paragraphs, professional tone, 1 link max
- LinkedIn: Industry thought leadership, professional, data-driven, 2-3 paragraphs
Generate ONLY the post content, no explanations.`;

      const aiRes = await aiBrain.chat(prompt, 'content');
      results[platform] = aiRes?.content || aiRes?.result || 'AI生成失败';
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 统计概览 */
router.get('/stats', (req, res) => {
  const db = req.app.locals.db;
  try {
    res.json({
      total: db.prepare('SELECT COUNT(*) as c FROM content_calendar').get().c,
      draft: db.prepare("SELECT COUNT(*) as c FROM content_calendar WHERE status='draft'").get().c,
      scheduled: db.prepare("SELECT COUNT(*) as c FROM content_calendar WHERE status='scheduled'").get().c,
      published: db.prepare("SELECT COUNT(*) as c FROM content_calendar WHERE status='published'").get().c,
      thisWeek: db.prepare("SELECT COUNT(*) as c FROM content_calendar WHERE scheduled_at >= date('now') AND scheduled_at < date('now','+7 days')").get().c,
      byPlatform: db.prepare(`SELECT platform, COUNT(*) as count FROM content_calendar GROUP BY platform`).all(),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/** 内容模板 */
router.get('/templates', (req, res) => {
  const db = req.app.locals.db;
  const category = req.query.category;
  let sql = 'SELECT * FROM content_templates';
  const params = [];
  if (category) { sql += ' WHERE category=?'; params.push(category); }
  sql += ' ORDER BY use_count DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/templates', (req, res) => {
  const db = req.app.locals.db;
  const { name, category, platform, content, variables } = req.body;
  const r = db.prepare('INSERT INTO content_templates (name,category,platform,content,variables) VALUES (?,?,?,?,?)')
    .run(name, category || 'general', platform || 'all', content || '', JSON.stringify(variables || []));
  res.json({ success: true, id: r.lastInsertRowid });
});

module.exports = { router, initCalendar };
