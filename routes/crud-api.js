// CRUD API路由
const nodemailer = require('nodemailer');
const { validateBody } = require('../src/input-validator');
const { injectProxy } = require('../src/outbound-proxy');

module.exports = function(app, db) {

  // ========== 客户 ==========
  app.get('/api/customers/list', (req, res) => {
    try { res.json({ success: true, customers: db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all() }); }
    catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/customers/add', validateBody({
    company_name: { required: true, type: 'string', maxLength: 200 },
    email: { required: true, type: 'string', maxLength: 255 }
  }), (req, res) => {
    try {
      const { company_name, contact_person, email, phone, country, level } = req.body;
      if (!company_name || !email) return res.json({ success: false, message: '公司名称和邮箱必填' });
      // 检查重复email
      const existing = db.prepare('SELECT id FROM customers WHERE email=?').get(email);
      if (existing) {
        return res.status(409).json({ success: false, message: '该邮箱已存在', existingId: existing.id });
      }
      db.prepare('INSERT INTO customers (company_name, contact_person, email, phone, country, level) VALUES (?,?,?,?,?,?)').run(company_name, contact_person || '', email, phone || '', country || '', level || 'warm');
      res.json({ success: true, message: '客户添加成功' });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(409).json({ success: false, message: '该邮箱已存在' });
      }
      res.json({ success: false, message: e.message });
    }
  });

  app.post('/api/test/add-customer', (req, res) => {
    try {
      db.prepare('INSERT INTO customers (company_name, contact_person, email, country, level) VALUES (?,?,?,?,?)').run('Test Company ' + Date.now(), 'John Doe', 'test@example.com', 'US', 'warm');
      res.json({ success: true, message: '测试客户添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 邮件 ==========
  app.post('/api/email/add-account', validateBody({
    email: { required: true, type: 'string', maxLength: 255 },
    smtp_host: { required: true, type: 'string', maxLength: 255 },
    smtp_port: { required: true },
    password: { required: true, type: 'string', maxLength: 500 }
  }), (req, res) => {
    try {
      const { email, smtp_host, smtp_port, password } = req.body;
      if (!email || !smtp_host || !smtp_port || !password) return res.json({ success: false, message: '所有字段必填' });
      db.prepare('INSERT INTO email_accounts (email, smtp_host, smtp_port, password) VALUES (?,?,?,?)').run(email, smtp_host, smtp_port, password);
      res.json({ success: true, message: '邮箱账号添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/email/create-campaign', validateBody({
    name: { required: true, type: 'string', maxLength: 200 },
    subject: { required: true, type: 'string', maxLength: 500 }
  }), (req, res) => {
    try {
      const { name, subject, body } = req.body;
      if (!name || !subject) return res.json({ success: false, message: '名称和主题必填' });
      db.prepare('INSERT INTO email_campaigns (name, subject, body) VALUES (?,?,?)').run(name, subject, body || '');
      res.json({ success: true, message: '营销活动创建成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/email/template/create', validateBody({
    name: { required: true, type: 'string', maxLength: 200 }
  }), (req, res) => {
    try {
      const { name, subject, body } = req.body;
      if (!name) return res.json({ success: false, message: '模板名称不能为空' });
      try {
        db.prepare('INSERT INTO email_templates (template_name, subject, body, created_at) VALUES (?,?,?,datetime("now"))').run(name, subject || '', body || '');
      } catch(err) {
        db.exec('CREATE TABLE IF NOT EXISTS email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, template_name TEXT, subject TEXT, body TEXT, created_at TEXT)');
        db.prepare('INSERT INTO email_templates (template_name, subject, body, created_at) VALUES (?,?,?,datetime("now"))').run(name, subject || '', body || '');
      }
      res.json({ success: true, message: '模板创建成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/email/send', async (req, res) => {
    try {
      const { campaign_id, customer_ids } = req.body;
      if (!campaign_id || !customer_ids?.length) return res.json({ success: false, message: '请选择活动和客户' });
      const campaign = db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(campaign_id);
      if (!campaign) return res.json({ success: false, message: '活动不存在' });
      const account = db.prepare('SELECT * FROM email_accounts WHERE is_active = 1 LIMIT 1').get();
      if (!account) return res.json({ success: false, message: '请先配置邮箱' });
      const transporter = nodemailer.createTransport({
        host: account.smtp_host, port: account.smtp_port, secure: account.smtp_port === 465,
        auth: { user: account.email, pass: account.password }
      });
      const ph = customer_ids.map(() => '?').join(',');
      const customers = db.prepare(`SELECT * FROM customers WHERE id IN (${ph})`).all(...customer_ids);
      let sent = 0, failed = 0;
      for (const c of customers) {
        try {
          const body = campaign.body.replace(/\{company_name\}/g, c.company_name).replace(/\{contact_person\}/g, c.contact_person || c.company_name);
          await transporter.sendMail({ from: account.email, to: c.email, subject: campaign.subject, text: body, html: `<pre>${body}</pre>` });
          sent++;
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) { failed++; console.error('发送失败:', c.email, e.message); }
      }
      db.prepare('UPDATE email_campaigns SET sent_count = sent_count + ?, status = ? WHERE id = ?').run(sent, 'completed', campaign_id);
      res.json({ success: true, message: `发送完成！成功: ${sent}, 失败: ${failed}`, sent, failed });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 公司信息 ==========
  app.post('/api/company/save', validateBody({
    company_name: { required: true, type: 'string', maxLength: 200 }
  }), (req, res) => {
    try {
      const { company_name, website, slogan, description } = req.body;
      if (!company_name) return res.json({ success: false, message: '公司名称必填' });
      const existing = db.prepare('SELECT id FROM company_info LIMIT 1').get();
      if (existing) {
        db.prepare('UPDATE company_info SET company_name=?, website=?, slogan=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(company_name, website||'', slogan||'', description||'', existing.id);
      } else {
        db.prepare('INSERT INTO company_info (company_name, website, slogan, description) VALUES (?,?,?,?)').run(company_name, website||'', slogan||'', description||'');
      }
      res.json({ success: true, message: '公司信息保存成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 视频 ==========
  app.post('/api/video/create', validateBody({
    title: { required: true, type: 'string', maxLength: 200 }
  }), (req, res) => {
    try {
      const { title, product_name, script, video_duration } = req.body;
      if (!title) return res.json({ success: false, message: '标题必填' });
      const r = db.prepare('INSERT INTO videos (title, product_name, script, status, duration) VALUES (?,?,?,?,?)').run(title, product_name, script || '', 'draft', parseInt(video_duration) || 15);
      res.json({ success: true, message: '视频项目创建成功', videoId: r.lastInsertRowid });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // 生成视频（模拟）
  app.post('/api/video/generate/:id', (req, res) => {
    try {
      const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
      if (!video) return res.json({ success: false, message: '视频不存在' });
      db.prepare("UPDATE videos SET status = 'generating' WHERE id = ?").run(req.params.id);
      setTimeout(() => {
        try { db.prepare("UPDATE videos SET status = 'completed' WHERE id = ?").run(req.params.id); } catch(e) {}
      }, 2000);
      res.json({ success: true, message: '视频生成已开始，请稍候刷新页面' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // 删除视频
  app.post('/api/video/delete', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.json({ success: false, message: '缺少视频ID' });
      const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
      if (!video) return res.json({ success: false, message: '视频不存在' });
      db.prepare('DELETE FROM videos WHERE id = ?').run(id);
      res.json({ success: true, message: '视频已删除' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // 更新视频脚本
  app.post('/api/video/update-script', (req, res) => {
    try {
      const { id, script } = req.body;
      if (!id) return res.json({ success: false, message: '缺少视频ID' });
      db.prepare('UPDATE videos SET script = ? WHERE id = ?').run(script || '', id);
      res.json({ success: true, message: '脚本已更新' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 询盘 ==========
  app.post('/api/inquiries/create', (req, res) => {
    try {
      const b = req.body;
      if (!b.company_name || !b.email) return res.json({ success: false, message: '公司名称和邮箱必填' });
      let score = 0;
      if (b.budget && b.budget !== 'unknown') score += 25;
      if (b.timeline && b.timeline !== 'unknown') score += 25;
      if (b.quantity && b.quantity !== 'unknown') score += 20;
      if (b.message && b.message.length > 50) score += 15;
      if (b.email && b.email.includes('@')) score += 15;
      const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
      const r = db.prepare('INSERT INTO inquiries (company_name, contact_person, email, phone, country, product_interest, quantity, budget, timeline, message, source, grade, score, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b.company_name, b.contact_person, b.email, b.phone, b.country, b.product_interest, b.quantity, b.budget, b.timeline, b.message, b.source || 'manual', grade, score, 'new');
      db.prepare('INSERT INTO inquiry_timeline (inquiry_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(r.lastInsertRowid, 'created', '询盘创建', `新询盘来自 ${b.company_name}`);
      res.json({ success: true, message: '询盘创建成功', inquiryId: r.lastInsertRowid, grade, score });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.get('/api/inquiries/stats', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*) as c FROM inquiries').get().c;
      const byStatus = {}; db.prepare('SELECT status, COUNT(*) as count FROM inquiries GROUP BY status').all().forEach(r => byStatus[r.status] = r.count);
      const byGrade = {}; db.prepare('SELECT grade, COUNT(*) as count FROM inquiries GROUP BY grade').all().forEach(r => byGrade[r.grade] = r.count);
      const today = db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE DATE(created_at) = DATE('now')").get().c;
      const pending = db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE status IN ('new','contacted') AND (next_followup_at IS NULL OR next_followup_at <= CURRENT_TIMESTAMP)").get().c;
      res.json({ success: true, stats: { total, byStatus, byGrade, today, pending } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.get('/api/inquiries/:id', (req, res) => {
    try {
      const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(req.params.id);
      if (!inquiry) return res.status(404).json({ success: false, message: '询盘不存在' });
      const followups = db.prepare('SELECT * FROM inquiry_followups WHERE inquiry_id = ? ORDER BY created_at DESC').all(req.params.id);
      const notes = db.prepare('SELECT * FROM inquiry_notes WHERE inquiry_id = ? ORDER BY created_at DESC').all(req.params.id);
      const quotations = db.prepare('SELECT * FROM quotations WHERE inquiry_id = ? ORDER BY created_at DESC').all(req.params.id);
      const samples = db.prepare('SELECT * FROM samples WHERE inquiry_id = ? ORDER BY created_at DESC').all(req.params.id);
      const timeline = db.prepare('SELECT * FROM inquiry_timeline WHERE inquiry_id = ? ORDER BY created_at DESC').all(req.params.id);
      res.json({ success: true, inquiry, followups, notes, quotations, samples, timeline });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.put('/api/inquiries/:id/status', (req, res) => {
    try {
      db.prepare('UPDATE inquiries SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
      db.prepare('INSERT INTO inquiry_timeline (inquiry_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(req.params.id, 'status_change', '状态变更', `状态更新为: ${req.body.status}`);
      res.json({ success: true, message: '状态更新成功' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.post('/api/inquiries/:id/followup', (req, res) => {
    try {
      const { followup_type, content, method, scheduled_at } = req.body;
      db.prepare('INSERT INTO inquiry_followups (inquiry_id, followup_type, content, method, scheduled_at) VALUES (?,?,?,?,?)').run(req.params.id, followup_type, content, method, scheduled_at);
      db.prepare('UPDATE inquiries SET last_followup_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
      db.prepare('INSERT INTO inquiry_timeline (inquiry_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(req.params.id, 'followup', '添加跟进', `跟进方式: ${method}`);
      res.json({ success: true, message: '跟进记录添加成功' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.post('/api/inquiries/:id/note', (req, res) => {
    try {
      db.prepare('INSERT INTO inquiry_notes (inquiry_id, note_type, content) VALUES (?,?,?)').run(req.params.id, req.body.note_type || 'general', req.body.content);
      res.json({ success: true, message: '备注添加成功' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.post('/api/inquiries/:id/quotation', (req, res) => {
    try {
      const b = req.body;
      const d = new Date();
      const qn = `QT${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-4)}`;
      const r = db.prepare('INSERT INTO quotations (inquiry_id, quote_number, product_name, quantity, unit_price, total_price, currency, incoterm, payment_terms, delivery_time, validity_days, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(req.params.id, qn, b.product_name, b.quantity, b.unit_price, b.total_price, b.currency||'USD', b.incoterm||'FOB', b.payment_terms, b.delivery_time, b.validity_days||30, 'draft');
      db.prepare('INSERT INTO inquiry_timeline (inquiry_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(req.params.id, 'quotation', '创建报价单', `报价单号: ${qn}`);
      res.json({ success: true, message: '报价单创建成功', quotationId: r.lastInsertRowid, quoteNumber: qn });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.post('/api/quotations/:id/send', (req, res) => {
    try {
      db.prepare("UPDATE quotations SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
      const q = db.prepare('SELECT inquiry_id FROM quotations WHERE id=?').get(req.params.id);
      if (q) {
        db.prepare('UPDATE inquiries SET first_response_at=COALESCE(first_response_at,CURRENT_TIMESTAMP) WHERE id=?').run(q.inquiry_id);
        db.prepare('INSERT INTO inquiry_timeline (inquiry_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(q.inquiry_id, 'quotation_sent', '报价单已发送', '已发送');
      }
      res.json({ success: true, message: '报价单已发送' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  app.post('/api/inquiries/:id/sample', (req, res) => {
    try {
      const { sample_type, tracking_number, courier } = req.body;
      db.prepare("INSERT INTO samples (inquiry_id, sample_type, tracking_number, courier, sent_at, status) VALUES (?,?,?,?,CURRENT_TIMESTAMP,'sent')").run(req.params.id, sample_type, tracking_number, courier);
      db.prepare('INSERT INTO inquiry_timeline (inquiry_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(req.params.id, 'sample', '样品寄出', `快递单号: ${tracking_number}`);
      res.json({ success: true, message: '样品记录添加成功' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ========== 产品 ==========
  app.post('/api/products/create', (req, res) => {
    try {
      const b = req.body;
      if (!b.product_name) return res.json({ success: false, message: '产品名称必填' });
      const r = db.prepare('INSERT INTO products (product_name, product_code, category_id, brand, description, specifications, cost_price, fob_price, cif_price, exw_price, moq, lead_time, packaging, weight, dimensions, stock_quantity, safety_stock, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b.product_name, b.product_code, b.category_id, b.brand, b.description, b.specifications, b.cost_price, b.fob_price, b.cif_price, b.exw_price, b.moq, b.lead_time, b.packaging, b.weight, b.dimensions, b.stock_quantity, b.safety_stock, 'active');
      res.json({ success: true, message: '产品创建成功', productId: r.lastInsertRowid });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ========== 订单 ==========
  app.post('/api/orders/create', (req, res) => {
    try {
      const b = req.body;
      if (!b.customer_name || !b.items?.length) return res.json({ success: false, message: '客户名称和订单明细必填' });
      const d = new Date();
      const on = `ORD${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-4)}`;
      let subtotal = 0; b.items.forEach(i => subtotal += parseFloat(i.total_price || 0));
      const total = subtotal + parseFloat(b.shipping_cost || 0) + parseFloat(b.tax || 0);
      const r = db.prepare('INSERT INTO orders (order_number, customer_name, customer_company, customer_email, customer_phone, customer_address, incoterm, payment_method, payment_terms, delivery_date, shipping_method, shipping_cost, tax, subtotal, total_amount, notes, order_status, payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(on, b.customer_name, b.customer_company, b.customer_email, b.customer_phone, b.customer_address, b.incoterm, b.payment_method, b.payment_terms, b.delivery_date, b.shipping_method, b.shipping_cost, b.tax, subtotal, total, b.notes, 'pending', 'unpaid');
      const stmt = db.prepare('INSERT INTO order_items (order_id, product_name, quantity, unit_price, total_price) VALUES (?,?,?,?,?)');
      b.items.forEach(i => stmt.run(r.lastInsertRowid, i.product_name, i.quantity, i.unit_price, i.total_price));
      db.prepare('INSERT INTO order_timeline (order_id, event_type, event_title, event_description) VALUES (?,?,?,?)').run(r.lastInsertRowid, 'created', '订单创建', `订单 ${on} 已创建`);
      res.json({ success: true, message: '订单创建成功', orderId: r.lastInsertRowid, orderNumber: on });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ========== 报价转订单 ==========
  app.post('/api/quote/convert-to-order', (req, res) => {
    try {
      const { quote_id } = req.body;
      if (!quote_id) return res.json({ success: false, message: '报价单ID必填' });
      const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quote_id);
      if (!quote) return res.status(404).json({ success: false, message: '报价单不存在' });
      const orderNumber = 'PO' + Date.now();
      db.prepare('INSERT INTO orders (order_number, customer_id, total_amount, order_status) VALUES (?,?,?,?)').run(orderNumber, quote.customer_id, quote.total_amount, 'pending');
      db.prepare("UPDATE quotes SET status='converted' WHERE id=?").run(quote_id);
      res.json({ success: true, message: '订单创建成功', order_number: orderNumber });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ========== AI设置 ==========

  // 多Provider管理（新版 - settings表存储）
  app.get('/api/settings/ai-providers', (req, res) => {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key='ai_providers'").get();
      if (row) {
        const providersData = JSON.parse(row.value);
        
        // 兼容旧格式：如果是数组，自动转换为新格式（全部归入text角色）
        if (Array.isArray(providersData)) {
          const migratedData = {
            brain: [],
            video: [],
            vision: [],
            text: providersData
          };
          
          // 如果还没有存储为新格式，更新数据库
          db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_providers'")
            .run(JSON.stringify(migratedData));
          
          return res.json({ success: true, providers: migratedData });
        } else if (typeof providersData === 'object') {
          // 已经是新格式，确保所有角色都存在
          const formattedData = {
            brain: Array.isArray(providersData.brain) ? providersData.brain : [],
            video: Array.isArray(providersData.video) ? providersData.video : [],
            vision: Array.isArray(providersData.vision) ? providersData.vision : [],
            text: Array.isArray(providersData.text) ? providersData.text : []
          };
          return res.json({ success: true, providers: formattedData });
        } else {
          // 未知格式，返回空
          return res.json({ success: true, providers: { brain: [], video: [], vision: [], text: [] } });
        }
      } else {
        // 没有数据，检查旧格式的ai_provider
        const oldRow = db.prepare("SELECT value FROM settings WHERE key='ai_provider'").get();
        if (oldRow) {
          const old = JSON.parse(oldRow.value);
          if (old.baseUrl) {
            const migratedData = {
              brain: [],
              video: [],
              vision: [],
              text: [{ ...old, name: '默认', enabled: true, priority: 1 }]
            };
            // 存储为新格式
            db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('ai_providers',?,datetime('now'))")
              .run(JSON.stringify(migratedData));
            return res.json({ success: true, providers: migratedData });
          }
        }
        // 完全为空，返回新格式的空对象
        res.json({ success: true, providers: { brain: [], video: [], vision: [], text: [] } });
      }
    } catch(e) { res.json({ success: false, error: e.message, providers: { brain: [], video: [], vision: [], text: [] } }); }
  });

  app.put('/api/settings/ai-providers', (req, res) => {
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
      
      // 存储为新格式
      db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('ai_providers',?,datetime('now'))")
        .run(JSON.stringify(providersToSave));
      
      // 同时更新旧的ai_provider兼容字段（取text中第一个enabled的）
      const enabledTextProviders = providersToSave.text.filter(p => p.enabled !== false && p.baseUrl && p.apiKey);
      if (enabledTextProviders.length > 0) {
        db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('ai_provider',?,datetime('now'))")
          .run(JSON.stringify(enabledTextProviders[0]));
      }
      
      app.locals.auditLog('ai_providers_update', 'settings', null, { 
        format: 'new_format',
        brain_count: providersToSave.brain.length,
        video_count: providersToSave.video.length,
        vision_count: providersToSave.vision.length,
        text_count: providersToSave.text.length
      });
      
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  app.put('/api/settings', (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: '缺少key' });
      db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))")
        .run(key, typeof value === 'string' ? value : JSON.stringify(value));
      res.json({ success: true });
    } catch(e) { res.json({ success: false, error: e.message }); }
  });

  app.post('/api/settings/test-ai-provider', async (req, res) => {
    const { baseUrl, apiKey, model } = req.body;
    if (!baseUrl || !apiKey) return res.status(400).json({ success: false, error: '缺少URL或Key' });
    
    const axios = require('axios');
    let url = baseUrl.replace(/\/+$/, '');
    if (!url.includes('/v1/chat/completions')) {
      url = url.includes('/v1') ? url + '/chat/completions' : url + '/v1/chat/completions';
    }

    const start = Date.now();
    try {
      const resp = await axios.post(url, {
        model: model || 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi, reply with just "OK" to confirm connection.' }],
        max_tokens: 10
      }, injectProxy(db, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
      }));
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

  app.post('/api/settings/ai-config', (req, res) => {
    try {
      const { module_name, api_base_url, api_key, model_name } = req.body;
      if (!module_name || !api_base_url || !api_key || !model_name) return res.json({ success: false, message: '所有字段必填' });
      const existing = db.prepare('SELECT id FROM ai_configs WHERE module_name = ?').get(module_name);
      if (existing) {
        db.prepare('UPDATE ai_configs SET api_base_url=?, api_key=?, model_name=?, updated_at=CURRENT_TIMESTAMP WHERE module_name=?').run(api_base_url, api_key, model_name, module_name);
      } else {
        db.prepare('INSERT INTO ai_configs (module_name, api_base_url, api_key, model_name) VALUES (?,?,?,?)').run(module_name, api_base_url, api_key, model_name);
      }
      res.json({ success: true, message: 'AI配置保存成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/settings/ai-config/:module', (req, res) => {
    try {
      const config = db.prepare('SELECT * FROM ai_configs WHERE module_name = ? AND is_active = 1').get(req.params.module);
      if (config) {
        res.json({ success: true, config: { api_base_url: config.api_base_url, api_key: config.api_key, model_name: config.model_name } });
      } else {
        res.json({ success: false, message: '未配置AI' });
      }
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== AI提供商管理 ==========
  app.post('/api/ai-router/providers/add', (req, res) => {
    try {
      const b = req.body;
      if (!b.provider_name || !b.api_base_url || !b.api_key) return res.json({ success: false, message: '名称、API地址和密钥必填' });
      db.prepare('INSERT INTO ai_providers (provider_name, group_name, display_name, provider_type, api_base_url, api_key, available_models, rate_limit, cost_per_1k_input, cost_per_1k_output, priority, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)').run(b.provider_name, b.group_name||null, b.display_name||b.provider_name, b.provider_type, b.api_base_url, b.api_key, JSON.stringify(b.available_models||[]), b.rate_limit||10000, b.cost_per_1k_input||0, b.cost_per_1k_output||0, b.priority||0);
      res.json({ success: true, message: 'AI提供商添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/providers/update', (req, res) => {
    try {
      const b = req.body;
      db.prepare('UPDATE ai_providers SET provider_name=?, group_name=?, display_name=?, provider_type=?, api_base_url=?, api_key=?, available_models=?, rate_limit=?, cost_per_1k_input=?, cost_per_1k_output=?, priority=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(b.provider_name, b.group_name||null, b.display_name||b.provider_name, b.provider_type, b.api_base_url, b.api_key, JSON.stringify(b.available_models||[]), b.rate_limit, b.cost_per_1k_input, b.cost_per_1k_output, b.priority, b.is_active?1:0, b.id);
      res.json({ success: true, message: 'AI提供商更新成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/providers/delete', (req, res) => {
    try { db.prepare('DELETE FROM ai_providers WHERE id=?').run(req.body.id); res.json({ success: true, message: '已删除' }); }
    catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/providers/test', async (req, res) => {
    try {
      const provider = db.prepare('SELECT * FROM ai_providers WHERE id=?').get(req.body.id);
      if (!provider) return res.json({ success: false, message: '提供商不存在' });
      const axios = require('axios');
      const start = Date.now();
      await axios.post(`${provider.api_base_url}/chat/completions`, {
        model: JSON.parse(provider.available_models || '[]')[0] || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5
      }, injectProxy(db, { headers: { 'Authorization': `Bearer ${provider.api_key}` }, timeout: 15000 }));
      const latency = Date.now() - start;
      db.prepare("UPDATE ai_providers SET health_status='healthy', last_check_at=CURRENT_TIMESTAMP, avg_response_time=? WHERE id=?").run(latency, req.body.id);
      res.json({ success: true, result: { latency, status: 'healthy' } });
    } catch (e) {
      db.prepare("UPDATE ai_providers SET health_status='unhealthy', last_check_at=CURRENT_TIMESTAMP WHERE id=?").run(req.body.id);
      res.json({ success: false, message: e.message });
    }
  });

  // ========== AI能力管理 ==========
  app.post('/api/ai-router/capabilities/add', (req, res) => {
    try {
      const b = req.body;
      db.prepare('INSERT INTO ai_capabilities (capability_name, capability_type, description, primary_provider_id, fallback_providers, quality_mode, max_cost_per_call, daily_budget, is_active) VALUES (?,?,?,?,?,?,?,?,1)').run(b.capability_name, b.capability_type, b.description, b.primary_provider_id, JSON.stringify(b.fallback_providers||[]), b.quality_mode||'standard', b.max_cost_per_call||0.10, b.daily_budget||50.00);
      res.json({ success: true, message: 'AI能力添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/capabilities/update', (req, res) => {
    try {
      const b = req.body;
      db.prepare('UPDATE ai_capabilities SET capability_name=?, capability_type=?, description=?, primary_provider_id=?, fallback_providers=?, quality_mode=?, max_cost_per_call=?, daily_budget=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(b.capability_name, b.capability_type, b.description, b.primary_provider_id, JSON.stringify(b.fallback_providers||[]), b.quality_mode, b.max_cost_per_call, b.daily_budget, b.is_active?1:0, b.id);
      res.json({ success: true, message: 'AI能力更新成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/capabilities/delete', (req, res) => {
    try { db.prepare('DELETE FROM ai_capabilities WHERE id=?').run(req.body.id); res.json({ success: true, message: '已删除' }); }
    catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== AI映射管理 ==========
  app.post('/api/ai-router/mappings/add', (req, res) => {
    try {
      const b = req.body;
      db.prepare('INSERT INTO module_task_mappings (module_name, task_name, task_description, capability_id, quality_mode, custom_prompt, available_variables, is_active) VALUES (?,?,?,?,?,?,?,1)').run(b.module_name, b.task_name, b.task_description, b.capability_id, b.quality_mode||'standard', b.custom_prompt, JSON.stringify(b.available_variables||[]));
      res.json({ success: true, message: '任务映射添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/mappings/update', (req, res) => {
    try {
      const b = req.body;
      db.prepare('UPDATE module_task_mappings SET module_name=?, task_name=?, task_description=?, capability_id=?, quality_mode=?, custom_prompt=?, available_variables=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(b.module_name, b.task_name, b.task_description, b.capability_id, b.quality_mode, b.custom_prompt, JSON.stringify(b.available_variables||[]), b.is_active?1:0, b.id);
      res.json({ success: true, message: '任务映射更新成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/ai-router/mappings/delete', (req, res) => {
    try { db.prepare('DELETE FROM module_task_mappings WHERE id=?').run(req.body.id); res.json({ success: true, message: '已删除' }); }
    catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== AI Router日志和统计 ==========
  app.get('/api/ai-router/logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      const logs = db.prepare('SELECT * FROM ai_call_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
      res.json({ success: true, logs });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/ai-router/stats', (req, res) => {
    try {
      const period = req.query.period || 'today';
      // 使用白名单防止SQL注入
      const allowedPeriods = {
        'today': "DATE(created_at) = DATE('now')",
        'week': "DATE(created_at) >= DATE('now', '-7 days')",
        'month': "DATE(created_at) >= DATE('now', '-30 days')"
      };
      const dateFilter = allowedPeriods[period] || allowedPeriods['today'];
      const overall = db.prepare(`SELECT COUNT(*) as total_calls, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(cost),0) as total_cost, COALESCE(AVG(response_time_ms),0) as avg_response_time, CASE WHEN COUNT(*)>0 THEN SUM(CASE WHEN success=1 THEN 1 ELSE 0 END)*100.0/COUNT(*) ELSE 0 END as success_rate FROM ai_call_logs WHERE ${dateFilter}`).get();
      res.json({ success: true, overall });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 占位API ==========
  app.get('/api/tasks/status', (req, res) => res.json({ success: true, tasks: [] }));
  app.get('/api/ai/versions', (req, res) => res.json({ success: true, versions: {} }));
  app.get('/api/fraud/blacklist', (req, res) => {
    try { res.json(db.prepare('SELECT * FROM fraud_blacklist ORDER BY created_at DESC').all()); }
    catch (e) { res.json([]); }
  });
  app.get('/api/stats', (req, res) => {
    try {
      const r = db.prepare("SELECT COUNT(*) as total FROM customers").get();
      res.json({ email: { sent: 0, opened: 0, openRate: 0 }, video: { generated: 0 }, customer: { total: r?.total || 0, hot: 0 }, order: { total: 0 } });
    } catch (e) { res.json({ email: { sent: 0, opened: 0, openRate: 0 }, video: { generated: 0 }, customer: { total: 0, hot: 0 }, order: { total: 0 } }); }
  });

  // ========== 营销自动化 ==========
  
  // Ensure automation_settings table exists
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS automation_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      config TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch(e) {}

  // Get workflows
  app.get('/api/automation/workflows', (req, res) => {
    try { res.json({ success: true, workflows: db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all() }); }
    catch (e) { res.json({ success: true, workflows: [] }); }
  });

  // Create workflow
  app.post('/api/automation/workflows/create', (req, res) => {
    try {
      const { workflow_name, workflow_type, trigger_type, trigger_config, steps } = req.body;
      if (!workflow_name) return res.json({ success: false, message: '工作流名称必填' });
      const r = db.prepare('INSERT INTO workflows (workflow_name, workflow_type, trigger_type, trigger_config) VALUES (?,?,?,?)').run(workflow_name, workflow_type || 'sequence', trigger_type || 'manual', JSON.stringify(trigger_config || {}));
      if (steps && steps.length) {
        const stmt = db.prepare('INSERT INTO workflow_steps (workflow_id, step_type, step_config, step_order) VALUES (?,?,?,?)');
        steps.forEach((s, i) => stmt.run(r.lastInsertRowid, s.step_type || 'email', JSON.stringify(s), i + 1));
      }
      res.json({ success: true, message: '工作流创建成功', workflowId: r.lastInsertRowid });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Toggle workflow
  app.post('/api/automation/workflows/toggle', (req, res) => {
    try {
      db.prepare('UPDATE workflows SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.is_active ? 1 : 0, req.body.id);
      res.json({ success: true, message: '已更新' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Delete workflow
  app.post('/api/automation/workflows/delete', (req, res) => {
    try {
      db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(req.body.id);
      db.prepare('DELETE FROM workflows WHERE id = ?').run(req.body.id);
      res.json({ success: true, message: '已删除' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Use template to create workflow
  app.post('/api/automation/use-template', (req, res) => {
    try {
      const { template_id } = req.body;
      if (!template_id) return res.json({ success: false, message: '模板ID必填' });
      // Template names mapping
      const tplNames = {
        new_inquiry_nurture: '新询盘7天培育序列',
        cold_outreach: '冷客户外拓序列',
        quote_followup: '报价跟进序列',
        vip_maintenance: 'VIP客户维护',
        tender_followup: '项目投标跟进',
        exhibition_followup: '展会后跟进',
        abandoned_quote_recovery: '废弃报价挽回',
        order_automation: '订单流程自动化',
        after_sales_care: '售后关怀序列',
        customer_reactivation: '客户唤醒序列'
      };
      const name = tplNames[template_id] || template_id;
      const r = db.prepare('INSERT INTO workflows (workflow_name, workflow_type, trigger_type, trigger_config) VALUES (?,?,?,?)').run(name, 'sequence', 'template', JSON.stringify({ template_id }));
      res.json({ success: true, message: `模板 "${name}" 已启用`, workflowId: r.lastInsertRowid });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Save scoring rules
  app.post('/api/automation/scoring/save', (req, res) => {
    try {
      const config = JSON.stringify(req.body);
      const existing = db.prepare("SELECT id FROM automation_settings WHERE key = 'scoring_rules'").get();
      if (existing) {
        db.prepare("UPDATE automation_settings SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'scoring_rules'").run(config);
      } else {
        db.prepare("INSERT INTO automation_settings (key, config) VALUES ('scoring_rules', ?)").run(config);
      }
      res.json({ success: true, message: '评分规则已保存' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Get scoring rules + scored customers
  app.get('/api/automation/scoring/rules', (req, res) => {
    try {
      let rules = {};
      try {
        const row = db.prepare("SELECT config FROM automation_settings WHERE key = 'scoring_rules'").get();
        if (row) rules = JSON.parse(row.config);
      } catch(e) {}
      let scores = [];
      try {
        scores = db.prepare(`SELECT ls.*, c.company_name FROM lead_scores ls LEFT JOIN customers c ON ls.customer_id = c.id ORDER BY ls.total_score DESC LIMIT 50`).all();
      } catch(e) {}
      res.json({ success: true, rules, scores });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Get funnel data
  app.get('/api/automation/funnel', (req, res) => {
    try {
      // Build funnel from customers + inquiries + quotations + orders
      let potential = 0, contacted = 0, interested = 0, quoted = 0, negotiating = 0, closed = 0;
      try { potential = db.prepare('SELECT COUNT(*) as c FROM customers').get().c; } catch(e) {}
      try { contacted = db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE status != 'new'").get().c; } catch(e) {}
      try { interested = db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE status IN ('interested','qualified','contacted')").get().c; } catch(e) {}
      try { quoted = db.prepare("SELECT COUNT(*) as c FROM quotations").get().c; } catch(e) {}
      try { negotiating = db.prepare("SELECT COUNT(*) as c FROM quotations WHERE status IN ('sent','negotiating')").get().c; } catch(e) {}
      try { closed = db.prepare("SELECT COUNT(*) as c FROM orders").get().c; } catch(e) {}
      const funnel = [
        { label: '潜在客户', count: potential, rate: 100 },
        { label: '初次联系', count: contacted, rate: potential ? Math.round(contacted/potential*100) : 0 },
        { label: '意向确认', count: interested, rate: potential ? Math.round(interested/potential*100) : 0 },
        { label: '报价阶段', count: quoted, rate: potential ? Math.round(quoted/potential*100) : 0 },
        { label: '谈判阶段', count: negotiating, rate: potential ? Math.round(negotiating/potential*100) : 0 },
        { label: '成交', count: closed, rate: potential ? Math.round(closed/potential*100) : 0 }
      ];
      res.json({ success: true, funnel });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // Save automation settings
  app.post('/api/automation/settings/save', (req, res) => {
    try {
      const config = JSON.stringify(req.body);
      const existing = db.prepare("SELECT id FROM automation_settings WHERE key = 'general_settings'").get();
      if (existing) {
        db.prepare("UPDATE automation_settings SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'general_settings'").run(config);
      } else {
        db.prepare("INSERT INTO automation_settings (key, config) VALUES ('general_settings', ?)").run(config);
      }
      res.json({ success: true, message: '设置已保存' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });
};