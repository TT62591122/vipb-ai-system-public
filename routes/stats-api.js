/**
 * 统计面板 API
 */
const router = require('express').Router();

module.exports = function(db) {
  // 总览
  router.get('/overview', (req, res) => {
    try {
      const totalCustomers = db.prepare('SELECT COUNT(*) as c FROM customers').get().c;
      const todayNew = db.prepare("SELECT COUNT(*) as c FROM customers WHERE created_at >= date('now')").get().c;
      const emailsSent = db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='sent'").get().c;
      const emailsReplied = db.prepare("SELECT COUNT(*) as c FROM emails WHERE direction='inbound'").get().c;
      const emailsOpened = db.prepare("SELECT COUNT(*) as c FROM emails WHERE opened > 0").get().c;
      const openRate = emailsSent > 0 ? (emailsOpened / emailsSent * 100).toFixed(1) : 0;
      res.json({ success: true, data: { totalCustomers, todayNew, emailsSent, emailsReplied, emailsOpened, openRate: parseFloat(openRate) } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 邮件统计
  router.get('/email', (req, res) => {
    try {
      const sent = db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='sent'").get().c;
      const delivered = sent; // simplified: sent ≈ delivered
      const bounced = db.prepare("SELECT COUNT(*) as c FROM emails WHERE bounced=1").get().c;
      const opened = db.prepare("SELECT COUNT(*) as c FROM emails WHERE opened > 0").get().c;
      const replied = db.prepare("SELECT COUNT(*) as c FROM emails WHERE direction='inbound'").get().c;
      const queued = db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='queued'").get().c;
      const failed = db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='failed'").get().c;
      res.json({ success: true, data: { sent, delivered, bounced, opened, replied, queued, failed } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 客户漏斗
  router.get('/customers', (req, res) => {
    try {
      const stages = db.prepare("SELECT stage, COUNT(*) as count FROM customers GROUP BY stage ORDER BY count DESC").all();
      res.json({ success: true, data: stages });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 最近30天趋势
  router.get('/timeline', (req, res) => {
    try {
      const customers = db.prepare(`SELECT date(created_at) as date, COUNT(*) as count FROM customers WHERE created_at >= date('now', '-30 days') GROUP BY date(created_at) ORDER BY date`).all();
      const emails = db.prepare(`SELECT date(sent_at) as date, COUNT(*) as count FROM emails WHERE status='sent' AND sent_at >= date('now', '-30 days') GROUP BY date(sent_at) ORDER BY date`).all();
      res.json({ success: true, data: { customers, emails } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
