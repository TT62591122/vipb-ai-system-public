/**
 * 自动跟进计划 API
 */
const router = require('express').Router();

module.exports = function(db) {
  // 创建跟进计划
  router.post('/', (req, res) => {
    try {
      const { customer_id, step, delay_days, template_id, status } = req.body;
      if (!customer_id) return res.status(400).json({ success: false, error: 'customer_id必填' });
      const result = db.prepare(`INSERT INTO followup_plans (customer_id, step, delay_days, template_id, status) VALUES (?,?,?,?,?)`)
        .run(customer_id, step || 1, delay_days || 3, template_id || null, status || 'active');
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 列表
  router.get('/', (req, res) => {
    try {
      const { customer_id, status, page = 1, limit = 50 } = req.query;
      let where = '1=1';
      const params = [];
      if (customer_id) { where += ' AND fp.customer_id=?'; params.push(customer_id); }
      if (status) { where += ' AND fp.status=?'; params.push(status); }
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const total = db.prepare(`SELECT COUNT(*) as c FROM followup_plans fp WHERE ${where}`).get(...params).c;
      const data = db.prepare(`SELECT fp.*, c.contact_name, c.email, c.company FROM followup_plans fp LEFT JOIN customers c ON fp.customer_id=c.id WHERE ${where} ORDER BY fp.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
      res.json({ success: true, data, total });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 更新
  router.put('/:id', (req, res) => {
    try {
      const { step, delay_days, template_id, status } = req.body;
      const fields = [];
      const values = [];
      if (step !== undefined) { fields.push('step=?'); values.push(step); }
      if (delay_days !== undefined) { fields.push('delay_days=?'); values.push(delay_days); }
      if (template_id !== undefined) { fields.push('template_id=?'); values.push(template_id); }
      if (status !== undefined) { fields.push('status=?'); values.push(status); }
      if (!fields.length) return res.status(400).json({ success: false, error: '无更新字段' });
      fields.push("updated_at=datetime('now')");
      values.push(req.params.id);
      db.prepare(`UPDATE followup_plans SET ${fields.join(',')} WHERE id=?`).run(...values);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 删除
  router.delete('/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM followup_plans WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 跟进日志
  router.get('/logs', (req, res) => {
    try {
      const { plan_id, customer_id, limit = 50 } = req.query;
      let where = '1=1';
      const params = [];
      if (plan_id) { where += ' AND fl.plan_id=?'; params.push(plan_id); }
      if (customer_id) { where += ' AND fl.customer_id=?'; params.push(customer_id); }
      const data = db.prepare(`SELECT fl.* FROM followup_logs fl WHERE ${where} ORDER BY fl.created_at DESC LIMIT ?`).all(...params, parseInt(limit));
      res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
