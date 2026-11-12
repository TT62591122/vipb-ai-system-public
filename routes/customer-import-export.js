/**
 * 客户导入导出 API
 */
const router = require('express').Router();

module.exports = function(db) {
  // ========== RESTful CRUD ==========

  // POST /api/customers — 创建客户（重复email返回409）
  router.post('/', (req, res) => {
    try {
      const {
        company, contact_name, email, phone, country, source, tags, notes, stage,
        industry, customer_type, main_needs, interested_products,
        language_preference, communication_style, website, target_market
      } = req.body;
      if (!email) return res.status(400).json({ success: false, error: '邮箱必填' });

      // 检查重复
      const existing = db.prepare('SELECT id FROM customers WHERE email=?').get(email);
      if (existing) {
        return res.status(409).json({ success: false, error: '该邮箱已存在', existingId: existing.id });
      }

      const result = db.prepare(
        `INSERT INTO customers (
          company, contact_name, email, phone, country, source, tags, notes, stage,
          industry, customer_type, main_needs, interested_products,
          language_preference, communication_style, website, target_market
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        company || '', contact_name || '', email, phone || '', country || '', source || 'manual', tags || '[]', notes || '', stage || 'new',
        industry || '', customer_type || '', main_needs || '', interested_products || '',
        language_preference || '', communication_style || '', website || '', target_market || ''
      );

      if (req.app.locals.auditLog) {
        req.app.locals.auditLog('create', 'customer', result.lastInsertRowid, { email, company });
      }
      res.json({ success: true, id: result.lastInsertRowid, message: '客户创建成功' });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: '该邮箱已存在' });
      }
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/customers/:id — 获取单个客户
  router.get('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ success: false, error: '无效ID' });
      const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
      if (!customer) return res.status(404).json({ success: false, error: '客户不存在' });
      res.json(customer);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PUT /api/customers/:id — 更新客户
  router.put('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ success: false, error: '无效ID' });
      
      const existing = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
      if (!existing) return res.status(404).json({ success: false, error: '客户不存在' });

      const fields = [
        'company', 'contact_name', 'email', 'phone', 'country', 'source', 'tags', 'notes', 'stage', 'lead_score',
        'industry', 'customer_type', 'main_needs', 'interested_products',
        'language_preference', 'communication_style', 'website', 'target_market'
      ];
      const updates = [];
      const values = [];
      for (const f of fields) {
        if (req.body[f] !== undefined) {
          updates.push(`${f}=?`);
          values.push(req.body[f]);
        }
      }
      if (!updates.length) return res.status(400).json({ success: false, error: '无更新字段' });

      // 如果更新email，检查重复
      if (req.body.email && req.body.email !== existing.email) {
        const dup = db.prepare('SELECT id FROM customers WHERE email=? AND id!=?').get(req.body.email, id);
        if (dup) return res.status(409).json({ success: false, error: '该邮箱已被其他客户使用' });
      }

      values.push(id);
      db.prepare(`UPDATE customers SET ${updates.join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...values);

      if (req.app.locals.auditLog) {
        req.app.locals.auditLog('update', 'customer', id, { fields: Object.keys(req.body) });
      }
      res.json({ success: true, message: '客户更新成功' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // DELETE /api/customers/:id — 删除客户
  router.delete('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ success: false, error: '无效ID' });
      
      const existing = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
      if (!existing) return res.status(404).json({ success: false, error: '客户不存在' });

      db.prepare('DELETE FROM customers WHERE id=?').run(id);
      if (req.app.locals.auditLog) {
        req.app.locals.auditLog('delete', 'customer', id, { email: existing.email });
      }
      res.json({ success: true, message: '客户删除成功' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/customers — 客户列表（分页）
  router.get('/', (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = (page - 1) * limit;
      const search = req.query.search || '';

      let where = '';
      const params = [];
      if (search) {
        where = "WHERE company LIKE ? OR contact_name LIKE ? OR email LIKE ?";
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const total = db.prepare(`SELECT COUNT(*) as c FROM customers ${where}`).get(...params).c;
      const customers = db.prepare(`SELECT * FROM customers ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

      res.json({ success: true, data: customers, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/customers/import — 导入客户(JSON数组)
  router.post('/import', (req, res) => {
    try {
      const customers = req.body;
      if (!Array.isArray(customers) || !customers.length) {
        return res.status(400).json({ success: false, error: '请提供客户数组' });
      }

      let imported = 0, skipped = 0;
      const errors = [];

      const insertStmt = db.prepare(`INSERT INTO customers (contact_name, email, company, phone, country, source, tags, notes, stage) VALUES (?,?,?,?,?,?,?,?,?)`);
      const checkStmt = db.prepare('SELECT id FROM customers WHERE email=?');

      const tx = db.transaction(() => {
        for (let i = 0; i < customers.length; i++) {
          const c = customers[i];
          try {
            const email = c.email || c.Email || c.EMAIL || '';
            if (!email) { errors.push({ row: i + 1, error: '缺少邮箱' }); continue; }
            
            // 检查重复
            const existing = checkStmt.get(email);
            if (existing) { skipped++; continue; }

            const name = c.contact_name || c.name || c.Name || c.contact || '';
            const company = c.company || c.Company || c.COMPANY || '';
            const phone = c.phone || c.Phone || c.tel || '';
            const country = c.country || c.Country || '';
            const source = c.source || 'import';
            const tags = c.tags ? (typeof c.tags === 'string' ? c.tags : JSON.stringify(c.tags)) : '[]';
            const notes = c.notes || c.Notes || '';
            const stage = c.stage || 'new';

            insertStmt.run(name, email, company, phone, country, source, tags, notes, stage);
            imported++;
          } catch (e) {
            errors.push({ row: i + 1, error: e.message });
          }
        }
      });
      tx();

      res.json({ success: true, imported, skipped, errors });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/customers/export — 导出客户
  router.get('/export', (req, res) => {
    try {
      const format = req.query.format || 'json';
      const customers = db.prepare('SELECT id, company, contact_name, email, phone, country, source, lead_score, stage, tags, notes, created_at FROM customers ORDER BY id').all();

      if (format === 'csv') {
        const headers = ['id', 'company', 'contact_name', 'email', 'phone', 'country', 'source', 'lead_score', 'stage', 'tags', 'notes', 'created_at'];
        const csvRows = [headers.join(',')];
        for (const c of customers) {
          csvRows.push(headers.map(h => {
            let val = (c[h] ?? '').toString().replace(/"/g, '""');
            return `"${val}"`;
          }).join(','));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
        // Add BOM for Excel
        res.send('\ufeff' + csvRows.join('\n'));
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=customers.json');
        res.json({ success: true, data: customers, total: customers.length });
      }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
