/**
 * WhatsApp 号码检测 API
 * POST   /api/wa-checker/check         — 单号检测
 * POST   /api/wa-checker/check-batch   — 批量检测
 * GET    /api/wa-checker/stats          — 缓存统计
 * GET    /api/wa-checker/invalid        — 无效号码列表
 * POST   /api/wa-checker/clear-cache    — 清除过期缓存
 */
const router = require('express').Router();

module.exports = function(checker) {

  // 单号检测
  router.post('/check', async (req, res) => {
    try {
      const { phone, forceRefresh } = req.body;
      if (!phone) return res.status(400).json({ error: '请提供phone' });
      const result = await checker.check(phone, { forceRefresh });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 批量检测
  router.post('/check-batch', async (req, res) => {
    try {
      const { phones, delayMs } = req.body;
      if (!phones || !Array.isArray(phones)) return res.status(400).json({ error: '请提供phones数组' });
      if (phones.length > 500) return res.status(400).json({ error: '单次最多500个号码' });
      const result = await checker.checkBatch(phones, { delayMs, source: 'manual' });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 缓存统计
  router.get('/stats', (req, res) => {
    res.json({ success: true, data: checker.getStats() });
  });

  // 无效号码列表
  router.get('/invalid', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({ success: true, data: checker.getInvalidNumbers(limit) });
  });

  // 清除过期缓存
  router.post('/clear-cache', (req, res) => {
    const days = parseInt(req.body.days) || 30;
    const result = checker.clearExpiredCache(days);
    res.json({ success: true, data: result });
  });

  return router;
};
