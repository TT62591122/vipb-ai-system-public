/**
 * 核心API — CRM (客户+询盘)
 */
const router = require('express').Router();
const { AIBrain } = require('../src/ai-brain');
const { validateBody } = require('../src/input-validator');

// --- 客户 CRUD ---
router.get('/customers', (req, res) => {
  const db = req.app.locals.db;
  const { search, country, stage } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const paginate = req.query.page !== undefined; // 是否分页模式

  let sql = 'SELECT * FROM customers WHERE 1=1';
  let countSql = 'SELECT COUNT(*) as c FROM customers WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (company LIKE ? OR contact_name LIKE ? OR email LIKE ?)'; countSql += ' AND (company LIKE ? OR contact_name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (country) { sql += ' AND country=?'; countSql += ' AND country=?'; params.push(country); }
  if (stage) { sql += ' AND stage=?'; countSql += ' AND stage=?'; params.push(stage); }
  sql += ' ORDER BY updated_at DESC';
  
  if (paginate) {
    const total = db.prepare(countSql).get(...params).c;
    const data = db.prepare(sql + ' LIMIT ? OFFSET ?').all(...params, limit, offset);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } else {
    res.json(db.prepare(sql).all(...params));
  }
});

router.get('/customers/:id', (req, res) => {
  const db = req.app.locals.db;
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  customer.inquiries = db.prepare('SELECT * FROM inquiries WHERE customer_id=? ORDER BY created_at DESC').all(req.params.id);
  customer.deals = db.prepare('SELECT * FROM deals WHERE customer_id=? ORDER BY created_at DESC').all(req.params.id);
  customer.emails = db.prepare('SELECT * FROM emails WHERE customer_id=? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  customer.activities = db.prepare("SELECT * FROM activity_log WHERE entity_type='customer' AND entity_id=? ORDER BY created_at DESC LIMIT 20").all(req.params.id);
  res.json(customer);
});

router.post('/customers', validateBody({
  email: { type: 'string', maxLength: 255 },
  contact_name: { type: 'string', maxLength: 200 },
  company: { type: 'string', maxLength: 200 }
}), (req, res) => {
  const db = req.app.locals.db;
  // 字段映射兼容：name→contact_name, company_name→company
  const company = req.body.company || req.body.company_name || '';
  const contact_name = req.body.contact_name || req.body.name || '';
  const { email, phone, country, source, tags, notes } = req.body;
  
  if (!email && !company && !contact_name) {
    return res.status(400).json({ error: '至少需要email、company或contact_name其中一个' });
  }
  
  try {
    const r = db.prepare('INSERT INTO customers (company,contact_name,email,phone,country,source,tags,notes) VALUES (?,?,?,?,?,?,?,?)')
      .run(company, contact_name, email || null, phone, country, source || 'manual', JSON.stringify(tags || []), notes || '');
    db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('customer',?,'created','{}')").run(r.lastInsertRowid);
    req.app.locals.notify('customer_created', { company: company || contact_name || email });
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '该邮箱已存在', field: 'email' });
    }
    throw err;
  }
});

router.put('/customers/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = parseInt(req.params.id);
  const fields = ['company','contact_name','email','phone','country','source','lead_score','stage','tags','notes','preferred_email_account_id'];
  const updates = []; const params = []; const changes = {};
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); const val = typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]; params.push(val); changes[f] = val; }});
  if (updates.length === 0) return res.json({ success: true });
  updates.push("updated_at=datetime('now')");
  params.push(id);
  db.prepare(`UPDATE customers SET ${updates.join(',')} WHERE id=?`).run(...params);
  req.app.locals.auditLog('update_customer', 'customer', id, { changes });
  res.json({ success: true });
});

router.delete('/customers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const customer = req.app.locals.db.prepare('SELECT company, email FROM customers WHERE id=?').get(id);
  req.app.locals.db.prepare('DELETE FROM customers WHERE id=?').run(id);
  req.app.locals.auditLog('delete_customer', 'customer', id, { deleted: customer || {} });
  res.json({ success: true });
});

// --- 询盘 CRUD ---
router.get('/inquiries', (req, res) => {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const paginate = req.query.page !== undefined;

  if (paginate) {
    const total = db.prepare('SELECT COUNT(*) as c FROM inquiries').get().c;
    const data = db.prepare('SELECT i.*, c.company, c.country FROM inquiries i LEFT JOIN customers c ON i.customer_id=c.id ORDER BY i.created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } else {
    res.json(db.prepare('SELECT i.*, c.company, c.country FROM inquiries i LEFT JOIN customers c ON i.customer_id=c.id ORDER BY i.created_at DESC').all());
  }
});

router.post('/inquiries', (req, res) => {
  const db = req.app.locals.db;
  const { customer_id, subject, content, product, quantity, priority } = req.body;
  const r = db.prepare('INSERT INTO inquiries (customer_id,subject,content,product,quantity,priority) VALUES (?,?,?,?,?,?)')
    .run(customer_id, subject, content, product, quantity, priority || 'normal');
  db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('inquiry',?,'created','{}')").run(r.lastInsertRowid);
  req.app.locals.notify('inquiry_created', { subject, product });
  res.json({ id: r.lastInsertRowid, success: true });
});

router.put('/inquiries/:id', (req, res) => {
  const db = req.app.locals.db;
  const fields = ['subject','content','product','quantity','priority','status','ai_score','ai_analysis'];
  const updates = []; const params = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); }});
  updates.push("updated_at=datetime('now')");
  params.push(req.params.id);
  db.prepare(`UPDATE inquiries SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
});

// --- AI ---
router.post('/ai/chat', async (req, res) => {
  const db = req.app.locals.db;
  const brain = new AIBrain(db);
  const { agent, message, context } = req.body;
  const result = await brain.callAgent(agent || 'sales', message, context);
  res.json(result);
});

router.post('/ai/analyze-inquiry', async (req, res) => {
  const db = req.app.locals.db;
  const brain = new AIBrain(db);
  const { inquiry_id } = req.body;
  const inquiry = db.prepare('SELECT * FROM inquiries WHERE id=?').get(inquiry_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(inquiry?.customer_id);
  if (!inquiry || !customer) return res.status(404).json({ error: 'Not found' });
  const result = await brain.analyzeInquiry(inquiry, customer);
  if (result.success) {
    db.prepare("UPDATE inquiries SET ai_analysis=?, updated_at=datetime('now') WHERE id=?").run(result.result, inquiry_id);
  }
  res.json(result);
});

router.get('/ai/stats', (req, res) => {
  const db = req.app.locals.db;
  const brain = new AIBrain(db);
  res.json({
    stats: brain.getQuickStats(),
    agents: Object.entries(brain.getAgents()).map(([k,v]) => ({ key: k, ...v })),
    todayCost: brain.costController.getTodayCost(),
    monthCost: brain.costController.getMonthCost()
  });
});

module.exports = router;
