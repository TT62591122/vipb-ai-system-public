/**
 * P3-19 直播转播 API 路由
 */
const express = require('express');

function createRestreamRouter(restreamEngine) {
  const router = express.Router();

  // 支持的平台
  router.get('/platforms', (req, res) => {
    res.json(restreamEngine.getSupportedPlatforms());
  });

  // 列表
  router.get('/sessions', (req, res) => {
    try {
      const { limit, offset, status } = req.query;
      const sessions = restreamEngine.listSessions({
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
        status,
      });
      res.json({ success: true, data: sessions });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 创建
  router.post('/sessions', (req, res) => {
    try {
      const session = restreamEngine.createStream(req.body);
      res.json({ success: true, data: session });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 详情
  router.get('/sessions/:id', (req, res) => {
    try {
      const session = restreamEngine.getSession(parseInt(req.params.id));
      res.json({ success: true, data: session });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
  });

  // 更新
  router.put('/sessions/:id', (req, res) => {
    try {
      const session = restreamEngine.updateStream(parseInt(req.params.id), req.body);
      res.json({ success: true, data: session });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 删除
  router.delete('/sessions/:id', (req, res) => {
    try {
      restreamEngine.deleteStream(parseInt(req.params.id));
      res.json({ success: true });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 开始转播
  router.post('/sessions/:id/start', (req, res) => {
    try {
      const session = restreamEngine.startRestream(parseInt(req.params.id));
      res.json({ success: true, data: session });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 停止转播
  router.post('/sessions/:id/stop', (req, res) => {
    try {
      restreamEngine.stopRestream(parseInt(req.params.id));
      res.json({ success: true });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 状态
  router.get('/sessions/:id/status', (req, res) => {
    try {
      const status = restreamEngine.getStatus(parseInt(req.params.id));
      res.json({ success: true, data: status });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
  });

  // 添加叠加层
  router.post('/sessions/:id/overlay', (req, res) => {
    try {
      const session = restreamEngine.addOverlay(parseInt(req.params.id), req.body);
      res.json({ success: true, data: session });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 定时开播
  router.post('/sessions/:id/schedule', (req, res) => {
    try {
      const { startTime } = req.body;
      const session = restreamEngine.scheduleStream(parseInt(req.params.id), startTime);
      res.json({ success: true, data: session });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // 日志
  router.get('/sessions/:id/logs', (req, res) => {
    try {
      const { limit, offset } = req.query;
      const logs = restreamEngine.getLogs(parseInt(req.params.id), {
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
      });
      res.json({ success: true, data: logs });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  return router;
}

module.exports = createRestreamRouter;
