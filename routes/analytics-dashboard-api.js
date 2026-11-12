/**
 * 渠道分析仪表盘 API
 * 汇总5渠道的关键指标，提供数据分析
 * 只加不改 — 新路由
 */
const router = require('express').Router();

module.exports = function(db) {

  // 综合仪表盘数据
  router.get('/dashboard', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const since = `datetime('now', '-${days} days', 'localtime')`;

      // 邮件统计
      const emailStats = {
        sent: db.prepare(`SELECT COUNT(*) as c FROM emails WHERE sent_at >= ${since}`).get()?.c || 0,
        opened: db.prepare(`SELECT COUNT(*) as c FROM email_tracking_events WHERE event_type='open' AND created_at >= ${since}`).get()?.c || 0,
        clicked: db.prepare(`SELECT COUNT(*) as c FROM email_tracking_events WHERE event_type='click' AND created_at >= ${since}`).get()?.c || 0,
        replied: db.prepare(`SELECT COUNT(*) as c FROM received_emails WHERE created_at >= ${since}`).get()?.c || 0,
        bounced: db.prepare(`SELECT COUNT(*) as c FROM emails WHERE status='bounced' AND sent_at >= ${since}`).get()?.c || 0,
        blocked: db.prepare(`SELECT COUNT(*) as c FROM emails WHERE status='spam_blocked' AND created_at >= ${since}`).get()?.c || 0
      };
      emailStats.openRate = emailStats.sent > 0 ? ((emailStats.opened / emailStats.sent) * 100).toFixed(1) : '0';
      emailStats.clickRate = emailStats.opened > 0 ? ((emailStats.clicked / emailStats.opened) * 100).toFixed(1) : '0';
      emailStats.replyRate = emailStats.sent > 0 ? ((emailStats.replied / emailStats.sent) * 100).toFixed(1) : '0';

      // WhatsApp统计
      const waStats = {
        sent: db.prepare(`SELECT COUNT(*) as c FROM wa_messages WHERE direction='outgoing' AND created_at >= ${since}`).get()?.c || 0,
        received: db.prepare(`SELECT COUNT(*) as c FROM wa_messages WHERE direction='incoming' AND created_at >= ${since}`).get()?.c || 0,
        conversations: db.prepare(`SELECT COUNT(DISTINCT chat_id) as c FROM wa_messages WHERE created_at >= ${since}`).get()?.c || 0
      };

      // 社媒统计
      const socialStats = {
        posts: db.prepare(`SELECT COUNT(*) as c FROM social_posts WHERE created_at >= ${since}`).get()?.c || 0,
        leads: db.prepare(`SELECT COUNT(*) as c FROM social_leads WHERE created_at >= ${since}`).get()?.c || 0,
        byPlatform: db.prepare(`SELECT platform, COUNT(*) as c FROM social_posts WHERE created_at >= ${since} GROUP BY platform`).all()
      };

      // 意图检测统计
      const intentStats = {
        total: db.prepare(`SELECT COUNT(*) as c FROM intent_detections WHERE created_at >= ${since}`).get()?.c || 0,
        pricing: db.prepare(`SELECT COUNT(*) as c FROM intent_detections WHERE intent='pricing' AND created_at >= ${since}`).get()?.c || 0,
        blocked: db.prepare(`SELECT COUNT(*) as c FROM intent_detections WHERE handled=0 AND created_at >= ${since}`).get()?.c || 0
      };

      // 报价统计
      let quoteStats = {};
      try {
        quoteStats = {
          total: db.prepare(`SELECT COUNT(*) as c FROM quotes WHERE created_at >= ${since}`).get()?.c || 0,
          won: db.prepare(`SELECT COUNT(*) as c FROM quotes WHERE status='won' AND created_at >= ${since}`).get()?.c || 0,
          lost: db.prepare(`SELECT COUNT(*) as c FROM quotes WHERE status='lost' AND created_at >= ${since}`).get()?.c || 0,
          totalAmount: db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM quotes WHERE status='won' AND created_at >= ${since}`).get()?.t || 0
        };
        quoteStats.winRate = quoteStats.total > 0 ? ((quoteStats.won / quoteStats.total) * 100).toFixed(1) : '0';
      } catch(e) {}

      // 每日趋势（最近7天邮件发送量）
      const dailyTrend = db.prepare(`
        SELECT date(sent_at) as day, COUNT(*) as count 
        FROM emails 
        WHERE sent_at >= datetime('now', '-7 days', 'localtime')
        GROUP BY date(sent_at) ORDER BY day
      `).all();

      res.json({
        success: true,
        data: {
          period: days + 'd',
          email: emailStats,
          whatsapp: waStats,
          social: socialStats,
          intent: intentStats,
          quotes: quoteStats,
          dailyTrend
        }
      });
    } catch(e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 意图检测日志
  router.get('/intent-logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const logs = db.prepare(`SELECT * FROM intent_detections ORDER BY created_at DESC LIMIT ?`).all(limit);
      res.json({ success: true, data: logs });
    } catch(e) { res.json({ success: true, data: [] }); }
  });

  return router;
};
