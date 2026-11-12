/**
 * 页面路由 — 8大模块
 */
const router = require('express').Router();

// 🎯 指挥中心
router.get('/', (req, res) => {
  res.redirect('/dashboard');
});

router.get('/dashboard', (req, res) => {
  const db = req.app.locals.db;
  const stats = {
    customers: db.prepare('SELECT COUNT(*) as c FROM customers').get().c,
    inquiries: db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE status='new'").get().c,
    activeDeals: db.prepare("SELECT COUNT(*) as c FROM deals WHERE stage NOT IN ('completed','cancelled')").get().c,
    totalRevenue: db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deals WHERE stage='completed'").get().t,
    emailsSent: db.prepare("SELECT COUNT(*) as c FROM emails WHERE date(sent_at)=date('now')").get().c,
    aiCostToday: db.prepare("SELECT COALESCE(SUM(cost),0) as t FROM ai_logs WHERE date(created_at)=date('now')").get().t,
    recentInquiries: db.prepare("SELECT i.*, c.company FROM inquiries i LEFT JOIN customers c ON i.customer_id=c.id ORDER BY i.created_at DESC LIMIT 5").all(),
    recentDeals: db.prepare("SELECT d.*, c.company FROM deals d LEFT JOIN customers c ON d.customer_id=c.id ORDER BY d.updated_at DESC LIMIT 5").all(),
    recentActivity: db.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10").all()
  };
  res.render('dashboard', { page: 'dashboard', stats });
});

// 📋 CRM
router.get('/crm', (req, res) => {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const totalCustomers = db.prepare('SELECT COUNT(*) as c FROM customers').get().c;
  const customers = db.prepare('SELECT * FROM customers ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const totalInquiries = db.prepare('SELECT COUNT(*) as c FROM inquiries').get().c;
  const inquiries = db.prepare('SELECT i.*, c.company FROM inquiries i LEFT JOIN customers c ON i.customer_id=c.id ORDER BY i.created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.render('crm', { 
    page: 'crm', customers, inquiries,
    pagination: {
      customerPage: page, customerTotal: totalCustomers, customerTotalPages: Math.ceil(totalCustomers / limit),
      inquiryTotal: totalInquiries, inquiryTotalPages: Math.ceil(totalInquiries / limit),
      limit
    }
  });
});

// 💰 交易中心
router.get('/trade', (req, res) => {
  const db = req.app.locals.db;
  const stages = ['ai_pending','inquiry','quote','negotiation','pi_confirmed','production','inspection','shipping','payment','completed'];
  const deals = {};
  stages.forEach(s => {
    deals[s] = db.prepare('SELECT d.*, c.company FROM deals d LEFT JOIN customers c ON d.customer_id=c.id WHERE d.stage=? ORDER BY d.updated_at DESC').all(s);
  });
  const customers = db.prepare('SELECT id, company, contact_name FROM customers ORDER BY company').all();
  res.render('trade', { page: 'trade', deals, stages, customers });
});

// 📧 营销中心
router.get('/marketing', (req, res) => {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const accounts = db.prepare('SELECT * FROM email_accounts ORDER BY id').all();
  const sequences = db.prepare('SELECT * FROM email_sequences ORDER BY id').all();
  const totalEmails = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
  const recentEmails = db.prepare('SELECT e.*, c.company FROM emails e LEFT JOIN customers c ON e.customer_id=c.id ORDER BY e.created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const customers = db.prepare('SELECT id, company, contact_name, email FROM customers ORDER BY company').all();
  
  // 邮箱发送统计
  const emailStats = accounts.map(acc => {
    const today = new Date().toISOString().split('T')[0];
    const todaySent = db.prepare("SELECT COUNT(*) as c FROM emails WHERE from_addr=? AND created_at >= ? AND status='sent'").get(acc.email, today + 'T00:00:00')?.c || 0;
    const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    const weekSent = db.prepare("SELECT COUNT(*) as c FROM emails WHERE from_addr=? AND created_at >= ? AND status='sent'").get(acc.email, weekAgo + 'T00:00:00')?.c || 0;
    const totalSent = db.prepare("SELECT COUNT(*) as c FROM emails WHERE from_addr=? AND status='sent'").get(acc.email)?.c || 0;
    const totalOpened = db.prepare("SELECT COUNT(*) as c FROM emails WHERE from_addr=? AND status='sent' AND opened=1").get(acc.email)?.c || 0;
    const totalClicked = db.prepare("SELECT COUNT(*) as c FROM emails WHERE from_addr=? AND status='sent' AND clicked=1").get(acc.email)?.c || 0;
    const totalBounced = db.prepare("SELECT COUNT(*) as c FROM emails WHERE from_addr=? AND status='failed'").get(acc.email)?.c || 0;
    const openRate = totalSent > 0 ? Math.round(totalOpened / totalSent * 100) : 0;
    const clickRate = totalSent > 0 ? Math.round(totalClicked / totalSent * 100) : 0;
    const bounceRate = totalSent > 0 ? Math.round(totalBounced / totalSent * 100) : 0;
    // 计算预热阶段（基于账号创建时间）
    const daysSinceCreated = Math.floor((Date.now() - new Date(acc.created_at || Date.now()).getTime()) / 86400000);
    let warmupStage = 'week1';
    let dailyLimit = 3;
    if (daysSinceCreated >= 28) { warmupStage = 'week5+'; dailyLimit = 40; }
    else if (daysSinceCreated >= 21) { warmupStage = 'week4'; dailyLimit = 25; }
    else if (daysSinceCreated >= 14) { warmupStage = 'week3'; dailyLimit = 15; }
    else if (daysSinceCreated >= 7) { warmupStage = 'week2'; dailyLimit = 8; }
    const health = bounceRate > 8 ? 'danger' : bounceRate > 3 ? 'warning' : 'good';
    return {
      email: acc.email, today_sent: todaySent, daily_limit: dailyLimit, week_sent: weekSent, health, warmup_stage: warmupStage, open_rate: openRate, click_rate: clickRate, bounce_rate: bounceRate
    };
  });
  
  res.render('marketing', { 
    page: 'marketing', accounts, sequences, recentEmails, customers, emailStats,
    pagination: { page, total: totalEmails, totalPages: Math.ceil(totalEmails / limit), limit }
  });
});

// 📱 社媒获客
router.get('/social', (req, res) => {
  const db = req.app.locals.db;
  const limit = 20;
  const posts = db.prepare('SELECT * FROM social_posts ORDER BY created_at DESC').all();
  const totalLeads = db.prepare('SELECT COUNT(*) as c FROM social_leads').get().c;
  const leads = db.prepare('SELECT * FROM social_leads ORDER BY created_at DESC LIMIT ?').all(limit);
  res.render('social', { 
    page: 'social', posts, leads,
    pagination: { leadTotal: totalLeads, leadTotalPages: Math.ceil(totalLeads / limit), limit }
  });
});

// 🛡️ 账号环境管理
router.get('/env', (req, res) => {
  const db = req.app.locals.db;
  const profiles = db.prepare('SELECT * FROM browser_profiles ORDER BY id').all();
  const proxies = db.prepare('SELECT * FROM proxies ORDER BY id').all();
  const phones = db.prepare('SELECT * FROM phone_numbers ORDER BY id').all();
  const esimProviders = db.prepare('SELECT * FROM esim_providers ORDER BY name').all();
  res.render('env', { page: 'env', profiles, proxies, phones, esimProviders });
});

// 📦 产品库
router.get('/products', (req, res) => {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const products = db.prepare('SELECT * FROM products ORDER BY id LIMIT ? OFFSET ?').all(limit, offset);
  res.render('products', { 
    page: 'products', products,
    pagination: { productPage: page, productTotal: totalProducts, productTotalPages: Math.ceil(totalProducts / limit), limit }
  });
});

// 🧠 AI任务中心
router.get('/ai-command', (req, res) => {
  res.render('ai-command', { page: 'ai-command' });
});

// ⚙️ 设置
router.get('/settings', (req, res) => {
  const db = req.app.locals.db;
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => {
    try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; }
  });
  const emailAccounts = db.prepare("SELECT id, email, auth_type FROM email_accounts WHERE is_active=1").all();
  const defaultEmailSetting = db.prepare("SELECT value FROM settings WHERE key='default_email_account_id'").get();
  const defaultEmailAccountId = defaultEmailSetting ? defaultEmailSetting.value : '';

  const accounts = db.prepare('SELECT * FROM email_accounts ORDER BY id').all();
  res.render('settings', { 
    page: 'settings', 
    settings, 
    accounts,
    emailAccounts, // Added for email account routing
    defaultEmailAccountId, // Added for email account routing
    username: req.session.username,
    role: req.session.role
  });
});

// 🔧 渠道工具中心
router.get('/channel-tools', (req, res) => {
  res.render('channel-tools', { page: 'channel-tools' });
});

module.exports = router;
