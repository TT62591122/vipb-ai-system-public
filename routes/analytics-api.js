/**
 * ROI 分析 & 多渠道归因 API
 * 营销效果追踪、渠道对比、转化漏斗
 */
const router = require('express').Router();

function initAnalytics(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      campaign TEXT DEFAULT '',
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      period TEXT,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      event_type TEXT NOT NULL,
      channel TEXT,
      campaign TEXT DEFAULT '',
      revenue REAL DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_spend_channel ON marketing_spend(channel);
    CREATE INDEX IF NOT EXISTS idx_spend_period ON marketing_spend(period);
    CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversion_events(channel);
    CREATE INDEX IF NOT EXISTS idx_conv_created ON conversion_events(created_at);
  `);
}

// ===== 概览仪表板 =====

router.get('/dashboard', (req, res) => {
  const db = req.app.locals.db;
  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // 渠道获客统计
    const channelLeads = db.prepare(`
      SELECT source as channel, COUNT(*) as leads, 
        SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) as won
      FROM customers WHERE created_at >= ? GROUP BY source
    `).all(since);

    // 转化漏斗
    const funnel = {
      total_leads: db.prepare("SELECT COUNT(*) as c FROM customers WHERE created_at >= ?").get(since).c,
      contacted: db.prepare("SELECT COUNT(*) as c FROM customers WHERE stage IN ('contacted','engaged','qualified','proposal','won') AND created_at >= ?").get(since).c,
      qualified: db.prepare("SELECT COUNT(*) as c FROM customers WHERE stage IN ('qualified','proposal','won') AND created_at >= ?").get(since).c,
      proposal: db.prepare("SELECT COUNT(*) as c FROM customers WHERE stage IN ('proposal','won') AND created_at >= ?").get(since).c,
      won: db.prepare("SELECT COUNT(*) as c FROM customers WHERE stage='won' AND created_at >= ?").get(since).c,
    };

    // 营销支出
    const totalSpend = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM marketing_spend WHERE created_at >= ?").get(since).total;

    // 收入（简化：从conversion_events）
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(revenue),0) as total FROM conversion_events WHERE created_at >= ?").get(since).total;

    // 渠道ROI
    const channelROI = db.prepare(`
      SELECT ms.channel, 
        COALESCE(SUM(ms.amount),0) as spend,
        COALESCE((SELECT SUM(ce.revenue) FROM conversion_events ce WHERE ce.channel=ms.channel AND ce.created_at >= ?),0) as revenue,
        COALESCE((SELECT COUNT(*) FROM customers c WHERE c.source=ms.channel AND c.created_at >= ?),0) as leads
      FROM marketing_spend ms WHERE ms.created_at >= ? GROUP BY ms.channel
    `).all(since, since, since);

    // 每日趋势
    const dailyTrend = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as leads
      FROM customers WHERE created_at >= ?
      GROUP BY date(created_at) ORDER BY date ASC
    `).all(since);

    // 评分分布
    let scoreDistribution = {};
    try {
      scoreDistribution = {
        hot: db.prepare("SELECT COUNT(*) as c FROM customers WHERE lead_score >= 100").get().c,
        sql: db.prepare("SELECT COUNT(*) as c FROM customers WHERE lead_score >= 80 AND lead_score < 100").get().c,
        mql: db.prepare("SELECT COUNT(*) as c FROM customers WHERE lead_score >= 50 AND lead_score < 80").get().c,
        warm: db.prepare("SELECT COUNT(*) as c FROM customers WHERE lead_score >= 30 AND lead_score < 50").get().c,
        cold: db.prepare("SELECT COUNT(*) as c FROM customers WHERE lead_score < 30").get().c,
      };
    } catch(e) {}

    res.json({
      period: { days, since },
      summary: {
        totalLeads: funnel.total_leads,
        totalSpend,
        totalRevenue,
        roi: totalSpend > 0 ? Math.round((totalRevenue - totalSpend) / totalSpend * 100) : 0,
        costPerLead: funnel.total_leads > 0 ? Math.round(totalSpend / funnel.total_leads * 100) / 100 : 0,
        conversionRate: funnel.total_leads > 0 ? Math.round(funnel.won / funnel.total_leads * 100) : 0,
      },
      funnel,
      channelLeads,
      channelROI: channelROI.map(c => ({
        ...c,
        roi: c.spend > 0 ? Math.round((c.revenue - c.spend) / c.spend * 100) : 0,
        cpl: c.leads > 0 ? Math.round(c.spend / c.leads * 100) / 100 : 0,
      })),
      dailyTrend,
      scoreDistribution,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 渠道对比 =====

router.get('/channels', (req, res) => {
  const db = req.app.locals.db;
  try {
    const channels = db.prepare(`
      SELECT source as channel, 
        COUNT(*) as total_leads,
        SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN stage='lost' THEN 1 ELSE 0 END) as lost,
        AVG(lead_score) as avg_score,
        MAX(created_at) as latest_lead
      FROM customers GROUP BY source ORDER BY total_leads DESC
    `).all();
    res.json(channels);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 营销支出管理 =====

router.get('/spend', (req, res) => {
  const db = req.app.locals.db;
  const { channel, period } = req.query;
  let sql = 'SELECT * FROM marketing_spend WHERE 1=1';
  const params = [];
  if (channel) { sql += ' AND channel=?'; params.push(channel); }
  if (period) { sql += ' AND period=?'; params.push(period); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/spend', (req, res) => {
  const db = req.app.locals.db;
  const { channel, campaign, amount, currency, period, notes } = req.body;
  if (!channel || !amount) return res.status(400).json({ error: '缺少渠道或金额' });
  const r = db.prepare('INSERT INTO marketing_spend (channel,campaign,amount,currency,period,notes) VALUES (?,?,?,?,?,?)')
    .run(channel, campaign || '', amount, currency || 'USD', period || new Date().toISOString().slice(0,7), notes || '');
  res.json({ success: true, id: r.lastInsertRowid });
});

router.delete('/spend/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM marketing_spend WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===== 转化事件 =====

router.post('/conversion', (req, res) => {
  const db = req.app.locals.db;
  const { customer_id, event_type, channel, campaign, revenue, metadata } = req.body;
  if (!event_type) return res.status(400).json({ error: '缺少事件类型' });
  const r = db.prepare('INSERT INTO conversion_events (customer_id,event_type,channel,campaign,revenue,metadata) VALUES (?,?,?,?,?,?)')
    .run(customer_id || null, event_type, channel || '', campaign || '', revenue || 0, JSON.stringify(metadata || {}));
  res.json({ success: true, id: r.lastInsertRowid });
});

router.get('/conversions', (req, res) => {
  const db = req.app.locals.db;
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.prepare('SELECT * FROM conversion_events ORDER BY created_at DESC LIMIT ?').all(limit));
});

// ===== 归因报告 =====

router.get('/attribution', (req, res) => {
  const db = req.app.locals.db;
  const days = parseInt(req.query.days) || 90;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // 首次触点归因
    const firstTouch = db.prepare(`
      SELECT source as channel, COUNT(*) as leads,
        SUM(CASE WHEN stage='won' THEN 1 ELSE 0 END) as conversions
      FROM customers WHERE created_at >= ? GROUP BY source ORDER BY leads DESC
    `).all(since);

    // 多触点（基于评分事件）
    let multiTouch = [];
    try {
      multiTouch = db.prepare(`
        SELECT source, COUNT(*) as touches, COUNT(DISTINCT customer_id) as unique_customers
        FROM lead_score_events WHERE created_at >= ? AND source != ''
        GROUP BY source ORDER BY touches DESC
      `).all(since);
    } catch(e) {}

    res.json({
      period: { days },
      firstTouch,
      multiTouch,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, initAnalytics };
