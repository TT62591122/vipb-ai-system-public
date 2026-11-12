/**
 * Agent Dashboard API — 效果仪表盘
 * 纯只读统计，不影响任何现有功能
 */

const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // 综合概览
  router.get('/overview', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      // 操作统计
      const actionStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status='executed' THEN 1 ELSE 0 END) as executed,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN action_type='scan' THEN 1 ELSE 0 END) as scans
        FROM agent_action_log
        WHERE created_at > datetime('now', '-${days} days')
      `).get();

      // 巡检统计
      const scanStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(DISTINCT scan_id) as scan_count,
          SUM(CASE WHEN status='executed' THEN 1 ELSE 0 END) as executed,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as skipped
        FROM agent_scan_results
        WHERE created_at > datetime('now', '-${days} days')
      `).get();

      // 按触发类型分布
      const triggerDist = db.prepare(`
        SELECT trigger_type, COUNT(*) as count
        FROM agent_scan_results
        WHERE created_at > datetime('now', '-${days} days')
        GROUP BY trigger_type
        ORDER BY count DESC
      `).all();

      // 经验统计
      const expStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN result_sentiment='positive' THEN 1 ELSE 0 END) as positive,
          SUM(CASE WHEN result_sentiment='negative' THEN 1 ELSE 0 END) as negative,
          SUM(CASE WHEN result_sentiment='neutral' THEN 1 ELSE 0 END) as neutral
        FROM agent_experiences WHERE is_valid IS NOT 0
      `).get();

      // 客户画像数
      const profileCount = db.prepare("SELECT COUNT(*) as c FROM agent_customer_profiles").get()?.c || 0;

      // 策略数
      const strategyStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN is_active=0 THEN 1 ELSE 0 END) as draft
        FROM agent_strategies
      `).get();

      // 自主权等级
      const autonomy = db.prepare("SELECT current_level FROM agent_autonomy LIMIT 1").get();

      // Agent发的邮件 vs 手动发的邮件回复率对比
      const agentEmailStats = db.prepare(`
        SELECT 
          COUNT(*) as sent,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at) THEN 1 ELSE 0 END) as replied
        FROM emails e
        WHERE e.direction='outbound' AND e.status='sent' AND e.source='agent_auto'
      `).get();

      const manualEmailStats = db.prepare(`
        SELECT 
          COUNT(*) as sent,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at) THEN 1 ELSE 0 END) as replied
        FROM emails e
        WHERE e.direction='outbound' AND e.status='sent' AND (e.source IS NULL OR e.source != 'agent_auto')
      `).get();

      res.json({
        success: true,
        period: days + '天',
        actions: actionStats,
        scans: scanStats,
        triggerDistribution: triggerDist,
        experiences: expStats,
        profiles: profileCount,
        strategies: strategyStats,
        autonomyLevel: autonomy?.current_level || 1,
        emailComparison: {
          agent: { sent: agentEmailStats?.sent || 0, replied: agentEmailStats?.replied || 0, rate: agentEmailStats?.sent ? ((agentEmailStats.replied / agentEmailStats.sent) * 100).toFixed(1) + '%' : 'N/A' },
          manual: { sent: manualEmailStats?.sent || 0, replied: manualEmailStats?.replied || 0, rate: manualEmailStats?.sent ? ((manualEmailStats.replied / manualEmailStats.sent) * 100).toFixed(1) + '%' : 'N/A' }
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 每日趋势（最近N天每天的操作数）
  router.get('/daily-trend', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 14;
      const trend = db.prepare(`
        SELECT date(created_at) as day,
          COUNT(*) as total,
          SUM(CASE WHEN status='executed' THEN 1 ELSE 0 END) as executed,
          SUM(CASE WHEN decision='draft' THEN 1 ELSE 0 END) as drafted,
          SUM(CASE WHEN decision='notify' THEN 1 ELSE 0 END) as notified
        FROM agent_scan_results
        WHERE created_at > datetime('now', '-${days} days')
        GROUP BY day
        ORDER BY day ASC
      `).all();
      res.json({ success: true, data: trend });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Agent草稿列表（待审核）
  router.get('/drafts', (req, res) => {
    try {
      const drafts = db.prepare(`
        SELECT e.id, e.customer_id, e.to_addr, e.subject, e.body, e.created_at,
          c.company, c.contact_name, c.country
        FROM emails e
        LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.status = 'draft' AND e.source IN ('agent_auto', 'auto_reply', 'need_human', 'ai_campaign')
        ORDER BY e.created_at DESC
        LIMIT 50
      `).all();
      res.json({ success: true, data: drafts, total: drafts.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 审核草稿：编辑
  router.put('/drafts/:id', (req, res) => {
    try {
      const draft = db.prepare("SELECT id, status FROM emails WHERE id = ?").get(req.params.id);
      if (!draft) return res.status(404).json({ success: false, error: '草稿不存在' });
      if (draft.status !== 'draft') return res.status(400).json({ success: false, error: '非草稿状态，无法编辑' });

      const { subject, body } = req.body;
      if (!subject && !body) return res.status(400).json({ success: false, error: '请提供要修改的内容' });

      const updates = [];
      const params = [];
      if (subject !== undefined) { updates.push('subject = ?'); params.push(subject); }
      if (body !== undefined) { updates.push('body = ?'); params.push(body); }
      params.push(req.params.id);

      db.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      res.json({ success: true, message: '草稿已更新' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 审核草稿：发送
  router.post('/drafts/:id/send', async (req, res) => {
    try {
      const draft = db.prepare("SELECT id, status, source FROM emails WHERE id = ?").get(req.params.id);
      if (!draft) return res.status(404).json({ success: false, error: '草稿不存在' });
      if (draft.status !== 'draft') return res.status(400).json({ success: false, error: '非草稿状态' });

      db.prepare("UPDATE emails SET status = 'queued' WHERE id = ?").run(draft.id);
      res.json({ success: true, message: '已加入发送队列' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 审核草稿：删除
  router.delete('/drafts/:id', (req, res) => {
    try {
      const draft = db.prepare("SELECT id, status, source FROM emails WHERE id = ?").get(req.params.id);
      if (!draft) return res.status(404).json({ success: false, error: '草稿不存在' });
      if (draft.status !== 'draft') return res.status(400).json({ success: false, error: '非草稿状态' });

      db.prepare("DELETE FROM emails WHERE id = ?").run(draft.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
