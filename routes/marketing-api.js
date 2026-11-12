/**
 * 营销中心 API（增强版 — 真实邮件发送）
 */
const router = require('express').Router();
const { EmailSender } = require('../src/email-sender');
const { encrypt } = require('../src/crypto-utils');
const { AIBrain } = require('../src/ai-brain');

function parseEmailDraft(aiText, fallbackSubject) {
  const text = String(aiText || '').trim();
  const subjectMatch = text.match(/^\s*Subject\s*:\s*(.+)$/im);
  let subject = subjectMatch ? subjectMatch[1].trim() : fallbackSubject;
  let body = subjectMatch ? text.replace(subjectMatch[0], '').trim() : text;
  body = body.replace(/^[-\s]*(Email body|Body|正文)\s*[:：]\s*/i, '').trim();
  if (!subject) subject = 'Product information from VIPB';
  return { subject, body };
}

// 邮件列表
router.get('/emails', (req, res) => {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const paginate = req.query.page !== undefined;

  if (paginate) {
    const total = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
    const data = db.prepare('SELECT e.*, c.company FROM emails e LEFT JOIN customers c ON e.customer_id=c.id ORDER BY e.created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } else {
    res.json(db.prepare('SELECT e.*, c.company FROM emails e LEFT JOIN customers c ON e.customer_id=c.id ORDER BY e.created_at DESC LIMIT 50').all());
  }
});

// 创建邮件（草稿）
router.post('/emails', (req, res) => {
  const db = req.app.locals.db;
  const { customer_id, account_id, to_addr, subject, body, status } = req.body;
  
  if (!to_addr) {
    return res.json({ success: false, error: '收件人地址不能为空' });
  }
  
  const r = db.prepare('INSERT INTO emails (customer_id,account_id,to_addr,subject,body,status) VALUES (?,?,?,?,?,?)')
    .run(customer_id || null, account_id || null, to_addr, subject || '', body || '', status || 'draft');
  res.json({ id: r.lastInsertRowid, success: true });
});

// 发送单封邮件（真实SMTP发送）
router.post('/emails/:id/send', async (req, res) => {
  const db = req.app.locals.db;
  const emailId = parseInt(req.params.id);
  
  const email = db.prepare('SELECT * FROM emails WHERE id=?').get(emailId);
  if (!email) {
    return res.json({ success: false, error: '邮件不存在' });
  }
  
  if (!email.to_addr) {
    return res.json({ success: false, error: '收件人地址为空' });
  }
  if (!email.subject && !email.body) {
    return res.json({ success: false, error: '邮件主题和正文不能同时为空' });
  }
  
  try {
    const sender = new EmailSender(db);
    const result = await sender.sendEmail(emailId);
    sender.closeAll();
    if (result.success) {
      req.app.locals.notify('email_sent', { to: email.to_addr, subject: email.subject });
    } else {
      req.app.locals.notify('email_failed', { to: email.to_addr, error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('[Email Send Error]', err);
    res.json({ success: false, error: '发送失败: ' + err.message });
  }
});

// 批量发送
router.post('/emails/batch-send', async (req, res) => {
  const db = req.app.locals.db;
  const { ids } = req.body;
  
  if (!Array.isArray(ids) || !ids.length) {
    return res.json({ success: false, error: '请选择要发送的邮件' });
  }
  
  try {
    const sender = new EmailSender(db);
    const result = await sender.batchSend(ids);
    
    // 立即开始处理队列（发送第一封）
    if (result.queued > 0) {
      // 异步处理，不阻塞响应
      setImmediate(async () => {
        try {
          await sender.processQueue();
        } catch (err) {
          console.error('[Queue Process Error]', err);
        }
        sender.closeAll();
      });
    }
    
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: '批量发送失败: ' + err.message });
  }
});

// 创建并立即发送邮件（一步到位）
router.post('/emails/send-now', async (req, res) => {
  const db = req.app.locals.db;
  const { customer_id, account_id, to_addr, subject, body } = req.body;
  
  if (!to_addr) {
    return res.json({ success: false, error: '收件人地址不能为空' });
  }
  if (!subject && !body) {
    return res.json({ success: false, error: '主题和正文不能同时为空' });
  }
  
  // 先创建邮件记录
  const r = db.prepare('INSERT INTO emails (customer_id,account_id,to_addr,subject,body,status) VALUES (?,?,?,?,?,?)')
    .run(customer_id || null, account_id || null, to_addr, subject || '', body || '', 'draft');
  
  // 然后发送
  try {
    const sender = new EmailSender(db);
    const result = await sender.sendEmail(r.lastInsertRowid);
    sender.closeAll();
    res.json({ ...result, emailId: r.lastInsertRowid });
  } catch (err) {
    res.json({ success: false, error: '发送失败: ' + err.message, emailId: r.lastInsertRowid });
  }
});

// 邮件序列
router.get('/sequences', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT * FROM email_sequences ORDER BY id').all());
});

router.post('/sequences', (req, res) => {
  const db = req.app.locals.db;
  const { name, description, steps, target_industry } = req.body;
  const r = db.prepare('INSERT INTO email_sequences (name,description,steps,target_industry) VALUES (?,?,?,?)')
    .run(name, description, JSON.stringify(steps || []), target_industry);
  res.json({ id: r.lastInsertRowid, success: true });
});

// 邮件账号
router.get('/accounts', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT id,email,display_name,warmup_stage,daily_sent,daily_limit,health_score,is_active FROM email_accounts ORDER BY id').all());
});

router.post('/accounts', (req, res) => {
  const db = req.app.locals.db;
  const { email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port } = req.body;
  
  const existing = db.prepare('SELECT id FROM email_accounts WHERE email=?').get(email);
  if (existing) {
    return res.json({ success: false, error: '该邮箱已存在' });
  }
  
  const r = db.prepare('INSERT INTO email_accounts (email,display_name,smtp_host,smtp_port,smtp_user,smtp_pass,imap_host,imap_port) VALUES (?,?,?,?,?,?,?,?)')
    .run(email, display_name, smtp_host, smtp_port || 587, smtp_user || email, smtp_pass ? encrypt(smtp_pass) : '', imap_host, imap_port || 993);
  res.json({ id: r.lastInsertRowid, success: true });
});

// 批量添加邮件账号
router.post('/accounts/batch', (req, res) => {
  const db = req.app.locals.db;
  const { accounts } = req.body;
  if (!Array.isArray(accounts) || !accounts.length) {
    return res.json({ success: false, error: '无效的邮箱数据' });
  }
  
  let added = 0;
  const stmt = db.prepare('INSERT INTO email_accounts (email,display_name,smtp_host,smtp_port,smtp_user,smtp_pass,imap_host,imap_port) VALUES (?,?,?,?,?,?,?,?)');
  
  accounts.forEach(acc => {
    try {
      const existing = db.prepare('SELECT id FROM email_accounts WHERE email=?').get(acc.email);
      if (!existing) {
        stmt.run(
          acc.email,
          acc.display_name || '',
          acc.smtp_host || '',
          acc.smtp_port || 587,
          acc.smtp_user || acc.email,
          acc.smtp_pass ? encrypt(acc.smtp_pass) : '',
          acc.imap_host || '',
          acc.imap_port || 993
        );
        added++;
      }
    } catch (err) {
      console.error('批量添加邮箱失败:', acc.email, err.message);
    }
  });
  
  res.json({ success: true, added });
});

// 删除邮件账号
router.delete('/accounts/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM email_accounts WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// 批量删除邮件账号
router.post('/accounts/batch-delete', (req, res) => {
  const db = req.app.locals.db;
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.json({ success: false, error: '无效的ID列表' });
  }
  
  const validIds = ids.filter(id => Number.isInteger(Number(id)));
  if (validIds.length === 0) {
    return res.json({ success: false, error: '无效的ID列表' });
  }
  
  const placeholders = validIds.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM email_accounts WHERE id IN (${placeholders})`).run(...validIds);
  res.json({ success: true, deleted: result.changes });
});

// SMTP连接测试
router.post('/accounts/:id/test', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const sender = new EmailSender(db);
    const result = await sender.testConnection(parseInt(req.params.id));
    sender.closeAll();
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: '测试失败: ' + err.message });
  }
});

// WhatsApp
router.get('/whatsapp', (req, res) => {
  res.json(req.app.locals.db.prepare('SELECT w.*, c.company FROM whatsapp_messages w LEFT JOIN customers c ON w.customer_id=c.id ORDER BY w.created_at DESC LIMIT 50').all());
});

router.post('/whatsapp', (req, res) => {
  const db = req.app.locals.db;
  const { customer_id, phone, content } = req.body;
  const r = db.prepare('INSERT INTO whatsapp_messages (customer_id,phone,content) VALUES (?,?,?)').run(customer_id, phone, content);
  res.json({ id: r.lastInsertRowid, success: true });
});

// 批量发送WhatsApp
router.post('/whatsapp/batch', (req, res) => {
  const db = req.app.locals.db;
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.json({ success: false, error: '无效的消息数据' });
  }
  
  let sent = 0;
  const stmt = db.prepare('INSERT INTO whatsapp_messages (phone,content,status) VALUES (?,?,?)');
  
  messages.forEach(msg => {
    try {
      if (msg.phone && msg.content) {
        stmt.run(msg.phone, msg.content, 'sent');
        sent++;
      }
    } catch (err) {
      console.error('批量发送WhatsApp失败:', msg.phone, err.message);
    }
  });
  
  res.json({ success: true, sent });
});

// ==================== AI个性化群发 ====================

// AI群发 — 为每个客户生成千人千面草稿，不自动发送
router.post('/campaign/ai-send', async (req, res) => {
  const db = req.app.locals.db;
  const { customer_ids, topic, email_type, language, account_id } = req.body;
  
  if (!Array.isArray(customer_ids) || !customer_ids.length) {
    return res.json({ success: false, error: '请选择至少一个客户' });
  }
  if (!topic) {
    return res.json({ success: false, error: '请输入邮件主题/卖点' });
  }
  
  // 获取客户信息
  const placeholders = customer_ids.map(() => '?').join(',');
  const customers = db.prepare(`SELECT * FROM customers WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != ''`).all(...customer_ids);
  
  if (!customers.length) {
    return res.json({ success: false, error: '所选客户中没有有效邮箱地址' });
  }
  
  const brain = new AIBrain(db);
  const results = { total: customers.length, generated: 0, drafts: 0, queued: 0, errors: [] };
  const insertDraft = db.prepare(`
    INSERT INTO emails (customer_id, account_id, to_addr, subject, body, status, direction, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'draft', 'outbound', 'ai_campaign', datetime('now'))
  `);

  for (const customer of customers) {
    try {
      const dup = db.prepare(`
        SELECT id FROM emails
        WHERE customer_id = ? AND source = 'ai_campaign'
          AND status IN ('draft','queued','sent')
          AND created_at > datetime('now', '-24 hours')
        ORDER BY created_at DESC LIMIT 1
      `).get(customer.id);
      if (dup) {
        results.errors.push(`${customer.email}: 24小时内已有AI草稿，跳过`);
        continue;
      }

      const aiResult = await brain.generateEmail(email_type || 'cold', customer, {
        topic,
        language,
        customPrompt: `Campaign topic: ${topic}. Generate a one-to-one draft only; do not send.`
      });

      if (!aiResult?.success || !(aiResult.result || aiResult.content)) {
        results.errors.push(`${customer.email}: AI生成失败 - ${aiResult?.error || 'empty result'}`);
        continue;
      }

      const parsed = parseEmailDraft(aiResult.result || aiResult.content, topic);
      if (!parsed.body) {
        results.errors.push(`${customer.email}: AI返回正文为空`);
        continue;
      }

      insertDraft.run(customer.id, account_id || null, customer.email, parsed.subject, parsed.body);
      results.generated++;
      results.drafts++;
    } catch(e) {
      results.errors.push(`${customer.email}: ${e.message}`);
    }
  }
  
  res.json({
    success: true,
    ...results,
    message: `已为 ${results.generated} 个客户生成千人千面草稿，未自动发送`
  });
});

// 获取可用于群发的客户列表（有邮箱的客户）
router.get('/campaign/customers', (req, res) => {
  const db = req.app.locals.db;
  const { industry, country, stage, search } = req.query;
  
  let sql = "SELECT id, company, contact_name, email, country, tags, stage, lead_score FROM customers WHERE email IS NOT NULL AND email != ''";
  const params = [];
  
  if (industry) { sql += " AND tags LIKE ?"; params.push(`%${industry}%`); }
  if (country) { sql += " AND country LIKE ?"; params.push(`%${country}%`); }
  if (stage) { sql += " AND stage = ?"; params.push(stage); }
  if (search) { sql += " AND (company LIKE ? OR contact_name LIKE ? OR email LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  
  sql += " ORDER BY lead_score DESC, company ASC LIMIT 500";
  
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
