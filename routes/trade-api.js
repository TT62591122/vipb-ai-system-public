/**
 * 交易中心 API — 看板CRUD
 */
const router = require('express').Router();

router.get('/deals', (req, res) => {
  const db = req.app.locals.db;
  res.json(db.prepare('SELECT d.*, c.company, c.country FROM deals d LEFT JOIN customers c ON d.customer_id=c.id ORDER BY d.updated_at DESC').all());
});

router.get('/deals/:id', (req, res) => {
  const db = req.app.locals.db;
  const deal = db.prepare('SELECT d.*, c.company, c.country, c.contact_name FROM deals d LEFT JOIN customers c ON d.customer_id=c.id WHERE d.id=?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: '交易不存在' });
  res.json({ success: true, data: deal });
});

router.post('/deals', (req, res) => {
  const db = req.app.locals.db;
  const { customer_id, inquiry_id, title, amount, currency, stage, products, notes } = req.body;
  const r = db.prepare('INSERT INTO deals (customer_id,inquiry_id,title,amount,currency,stage,products,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(customer_id, inquiry_id, title, amount || 0, currency || 'USD', stage || 'inquiry', JSON.stringify(products || []), notes || '');
  req.app.locals.notify('deal_created', { title, stage: stage || 'inquiry', amount: amount || 0 });
  req.app.locals.auditLog('created', 'deal', r.lastInsertRowid, { title, amount, stage });
  res.json({ id: r.lastInsertRowid, success: true });
});

router.put('/deals/:id', (req, res) => {
  const db = req.app.locals.db;
  const fields = ['title','amount','currency','stage','products','quote_data','pi_number','shipping_info','payment_info','notes'];
  const updates = []; const params = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]); }});
  updates.push("updated_at=datetime('now')");
  params.push(req.params.id);
  db.prepare(`UPDATE deals SET ${updates.join(',')} WHERE id=?`).run(...params);
  db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('deal',?,?,?)")
    .run(req.params.id, 'updated', JSON.stringify({ stage: req.body.stage }));
  req.app.locals.notify('deal_updated', { id: parseInt(req.params.id), stage: req.body.stage, title: req.body.title });
  res.json({ success: true });
});

router.put('/deals/:id/stage', (req, res) => {
  const db = req.app.locals.db;
  db.prepare("UPDATE deals SET stage=?, updated_at=datetime('now') WHERE id=?").run(req.body.stage, req.params.id);
  db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('deal',?,'stage_change',?)")
    .run(req.params.id, JSON.stringify({ stage: req.body.stage }));
  req.app.locals.notify('deal_updated', { id: parseInt(req.params.id), stage: req.body.stage });
  res.json({ success: true });
});

router.delete('/deals/:id', (req, res) => {
  req.app.locals.db.prepare('DELETE FROM deals WHERE id=?').run(req.params.id);
  req.app.locals.notify('deal_deleted', { id: parseInt(req.params.id) });
  req.app.locals.auditLog('deleted', 'deal', parseInt(req.params.id), {});
  res.json({ success: true });
});

// 审核通过AI生成的交易
router.post('/deals/:id/approve', (req, res) => {
  const db = req.app.locals.db;
  const deal = db.prepare('SELECT * FROM deals WHERE id=?').get(req.params.id);
  
  if (!deal) {
    return res.json({ success: false, error: '交易不存在' });
  }
  
  if (deal.stage !== 'ai_pending') {
    return res.json({ success: false, error: '此交易不需要审核' });
  }
  
  // 审核通过，移到询盘阶段
  db.prepare("UPDATE deals SET stage='inquiry', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('deal',?,'approved',?)")
    .run(req.params.id, JSON.stringify({ approved_at: new Date().toISOString() }));
  
  res.json({ success: true });
});

// 驳回AI生成的交易
router.post('/deals/:id/reject', (req, res) => {
  const db = req.app.locals.db;
  const { reason } = req.body;
  const deal = db.prepare('SELECT * FROM deals WHERE id=?').get(req.params.id);
  
  if (!deal) {
    return res.json({ success: false, error: '交易不存在' });
  }
  
  if (deal.stage !== 'ai_pending') {
    return res.json({ success: false, error: '此交易不需要审核' });
  }
  
  // 驳回，删除交易并记录日志
  db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('deal',?,'rejected',?)")
    .run(req.params.id, JSON.stringify({ reason, rejected_at: new Date().toISOString() }));
  db.prepare('DELETE FROM deals WHERE id=?').run(req.params.id);
  
  res.json({ success: true });
});

module.exports = router;
