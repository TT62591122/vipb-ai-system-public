/**
 * 社媒调度层 API 路由
 */
const express = require('express');
const router = express.Router();

module.exports = function(dispatcher) {
  // POST /api/dispatcher/execute — 执行操作
  router.post('/execute', async (req, res) => {
    try {
      const { accountId, action, params } = req.body;
      if (!accountId || !action) {
        return res.json({ success: false, error: '缺少 accountId 或 action' });
      }
      const result = await dispatcher.execute(accountId, action, params || {});
      res.json(result);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // POST /api/dispatcher/switch-proxy — 切换代理
  router.post('/switch-proxy', (req, res) => {
    try {
      const { accountId, proxy } = req.body;
      if (!accountId) return res.json({ success: false, error: '缺少 accountId' });
      const result = dispatcher.switchProxy(accountId, proxy || '');
      res.json(result);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // POST /api/dispatcher/switch-env — 切换环境
  router.post('/switch-env', (req, res) => {
    try {
      const { accountId, envConfig } = req.body;
      if (!accountId) return res.json({ success: false, error: '缺少 accountId' });
      const result = dispatcher.switchEnvironment(accountId, envConfig || {});
      res.json(result);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/dispatcher/log/:accountId — 执行日志
  router.get('/log/:accountId', (req, res) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const limit = parseInt(req.query.limit) || 50;
      const logs = dispatcher.getExecutionLog(accountId, limit);
      res.json(logs);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/dispatcher/log — 全部日志
  router.get('/log', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const logs = dispatcher.getExecutionLog(null, limit);
      res.json(logs);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // POST /api/dispatcher/batch — 批量操作
  router.post('/batch', async (req, res) => {
    try {
      const { accountIds, action, params } = req.body;
      if (!accountIds?.length || !action) {
        return res.json({ success: false, error: '缺少 accountIds 或 action' });
      }
      const results = await dispatcher.batchExecute(accountIds, action, params || {});
      const succeeded = results.filter(r => r.success).length;
      const failed = results.length - succeeded;
      res.json({ success: true, results, summary: { total: results.length, succeeded, failed } });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // GET /api/dispatcher/stats — 统计数据
  router.get('/stats', (req, res) => {
    try {
      const stats = dispatcher.getStats();
      res.json(stats);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  return router;
};
