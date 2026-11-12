/**
 * 邮件接收 API 路由
 * - 启动/停止IMAP轮询
 * - 查看接收状态
 * - 手动检查
 * - 查看收到的邮件
 * - AI自动回复设置
 */
const express = require('express');

module.exports = function createEmailReceiverRouter(emailReceiver, autoReplier) {
  const router = express.Router();

  // 启动邮件接收
  router.post('/start', (req, res) => {
    try {
      const result = emailReceiver.start();
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 停止邮件接收
  router.post('/stop', (req, res) => {
    try {
      const result = emailReceiver.stop();
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 接收状态
  router.get('/status', (req, res) => {
    try {
      const status = emailReceiver.getStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 手动检查单个账号
  router.post('/check/:accountId', async (req, res) => {
    try {
      const result = await emailReceiver.checkAccount(parseInt(req.params.accountId));
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 手动检查所有账号
  router.post('/check-all', async (req, res) => {
    try {
      const accounts = emailReceiver._getActiveAccounts();
      const results = [];
      for (const acc of accounts) {
        if (acc.imap_host || acc.auth_type === 'gmail_api') {
          const r = await emailReceiver.checkAccount(acc.id);
          results.push(r);
        }
      }
      res.json({ ok: true, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 获取收到的邮件列表
  router.get('/emails', (req, res) => {
    try {
      const db = req.app.locals.db;
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = (page - 1) * limit;
      const accountId = req.query.account_id;
      const customerId = req.query.customer_id;
      const unreadOnly = req.query.unread === 'true';

      let where = '1=1';
      const params = [];
      if (accountId) { where += ' AND r.account_id = ?'; params.push(accountId); }
      if (customerId) { where += ' AND r.customer_id = ?'; params.push(customerId); }
      if (unreadOnly) { where += ' AND r.is_read = 0'; }

      const total = db.prepare(`SELECT COUNT(*) as c FROM received_emails r WHERE ${where}`).get(...params).c;
      const emails = db.prepare(`
        SELECT r.*, c.company as customer_company, c.contact_name as customer_name, ea.email as account_email
        FROM received_emails r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN email_accounts ea ON r.account_id = ea.id
        WHERE ${where}
        ORDER BY r.received_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      res.json({ ok: true, emails, total, page, limit });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 获取单封邮件详情
  router.get('/emails/:id', (req, res) => {
    try {
      const db = req.app.locals.db;
      const email = db.prepare(`
        SELECT r.*, c.company as customer_company, c.contact_name as customer_name
        FROM received_emails r
        LEFT JOIN customers c ON r.customer_id = c.id
        WHERE r.id = ?
      `).get(req.params.id);
      if (!email) return res.status(404).json({ ok: false, error: '邮件不存在' });
      
      // 标记已读
      db.prepare('UPDATE received_emails SET is_read = 1 WHERE id = ?').run(req.params.id);
      
      res.json({ ok: true, email });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // AI自动回复设置
  router.get('/auto-reply/settings', (req, res) => {
    try {
      res.json({ ok: true, settings: autoReplier.getSettings() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/auto-reply/settings', (req, res) => {
    try {
      const result = autoReplier.updateSettings(req.body);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 未读邮件数
  router.get('/unread-count', (req, res) => {
    try {
      const db = req.app.locals.db;
      const count = db.prepare('SELECT COUNT(*) as c FROM received_emails WHERE is_read = 0').get().c;
      res.json({ ok: true, count });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};
