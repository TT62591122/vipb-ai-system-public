/**
 * 人工行为模拟 API
 */
const router = require('express').Router();

module.exports = function createHumanBehaviorRouter(humanBehavior) {
  // 获取引擎状态和统计
  router.get('/status', (req, res) => {
    try {
    res.json({ success: true, data: humanBehavior.getStats() });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 获取/更新全局配置
  router.get('/config', (req, res) => {
    try {
    res.json({ success: true, data: { enabled: humanBehavior.enabled, config: humanBehavior.config } });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/config', (req, res) => {
    try {
    humanBehavior.updateConfig(req.body);
    res.json({ success: true, message: '配置已更新', data: { enabled: humanBehavior.enabled, config: humanBehavior.config } });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 行为人格管理
  router.get('/personalities', (req, res) => {
    try {
    const { platform, limit } = req.query;
    const list = humanBehavior.listPersonalities({ platform, limit: parseInt(limit) || 50 });
    res.json({ success: true, data: list });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/personalities/:accountId', (req, res) => {
    try {
    const p = humanBehavior.getPersonality(req.params.accountId, req.query.platform || 'unknown');
    res.json({ success: true, data: p });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/personalities/:accountId', (req, res) => {
    try {
    const ok = humanBehavior.updatePersonality(req.params.accountId, req.body);
    if (ok) res.json({ success: true, message: '人格已更新' });
    else res.status(400).json({ success: false, error: '无更新字段' });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/personalities/:accountId', (req, res) => {
    try {
    humanBehavior.deletePersonality(req.params.accountId);
    res.json({ success: true, message: '人格已删除' });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 重新生成人格
  router.post('/personalities/:accountId/regenerate', (req, res) => {
    try {
    const platform = req.body.platform || req.query.platform || 'unknown';
    humanBehavior.deletePersonality(req.params.accountId);
    const p = humanBehavior.getPersonality(req.params.accountId, platform);
    res.json({ success: true, data: p, message: '已重新生成行为人格' });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 行为日志
  router.get('/logs', (req, res) => {
    try {
    const { account_id, platform, action_type, limit } = req.query;
    const logs = humanBehavior.getLogs({ account_id, platform, action_type, limit: parseInt(limit) || 50 });
    res.json({ success: true, data: logs });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 获取账号行为统计
  router.get('/stats/:accountId', (req, res) => {
    try {
    const stats = humanBehavior.getStats(req.params.accountId);
    res.json({ success: true, data: stats });
    } catch(e) { console.error('[HumanBehavior] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
