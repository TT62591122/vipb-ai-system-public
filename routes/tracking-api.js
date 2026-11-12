/**
 * 邮件追踪 API
 * - GET /api/track/open/:emailId.png — 打开追踪像素
 * - GET /api/track/click/:emailId — 点击追踪+重定向
 * - GET /api/track/stats/:emailId — 单封邮件追踪数据
 * - GET /api/track/stats — 汇总追踪统计
 */
const express = require('express');
const router = express.Router();

// 1x1 transparent PNG pixel
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

module.exports = function(db) {
  const { EmailTracker } = require('../src/email-tracker');
  const tracker = new EmailTracker(db);

  // 打开追踪 — 返回1px透明PNG
  // 不需要认证，因为是邮件客户端请求
  router.get('/open/:emailId.png', (req, res) => {
    try {
    const emailId = parseInt(req.params.emailId);
    if (emailId > 0) {
      const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '';
      const ua = req.headers['user-agent'] || '';
      tracker.recordOpen(emailId, ip, ua);
    }
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': PIXEL.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(PIXEL);
    } catch(e) { console.error('[Tracking] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 点击追踪 — 记录后重定向到原始URL
  router.get('/click/:emailId', (req, res) => {
    try {
    const emailId = parseInt(req.params.emailId);
    const url = req.query.url;
    
    if (!url) {
      return res.status(400).send('Missing URL');
    }

    if (emailId > 0) {
      const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '';
      const ua = req.headers['user-agent'] || '';
      tracker.recordClick(emailId, url, ip, ua);
    }

    res.redirect(302, url);
    } catch(e) { console.error('[Tracking] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 获取单封邮件追踪统计 (需要认证)
  router.get('/stats/:emailId', (req, res) => {
    try {
    if (!req.session?.userId) return res.status(401).json({ error: '未登录' });
    const stats = tracker.getStats(parseInt(req.params.emailId));
    res.json({ success: true, data: stats });
    } catch(e) { console.error('[Tracking] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 获取汇总追踪统计 (需要认证)
  router.get('/stats', (req, res) => {
    try {
    if (!req.session?.userId) return res.status(401).json({ error: '未登录' });
    const stats = tracker.getAggregateStats();
    res.json({ success: true, data: stats });
    } catch(e) { console.error('[Tracking] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
