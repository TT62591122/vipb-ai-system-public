/**
 * 矩阵任务 API 路由
 * POST/GET/PUT/DELETE /api/matrix/tasks
 */

const express = require('express');
const { validateBody } = require('../src/input-validator');

function createMatrixRouter(engine) {
  const router = express.Router();

  // 获取统计
  router.get('/stats', (req, res) => {
    try {
      res.json({ success: true, data: engine.getStats() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 列出任务
  router.get('/tasks', (req, res) => {
    try {
      const tasks = engine.listTasks({
        status: req.query.status,
        platform: req.query.platform,
        task_type: req.query.task_type,
        limit: req.query.limit ? parseInt(req.query.limit) : 50
      });
      res.json({ success: true, data: tasks });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 获取单个任务
  router.get('/tasks/:id', (req, res) => {
    try {
      const task = engine.getTask(parseInt(req.params.id));
      if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
      res.json({ success: true, data: task });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 创建任务
  router.post('/tasks', validateBody({
    platform: { required: true, type: 'string' },
    action: { required: true, type: 'string' }
  }), (req, res) => {
    try {
      const taskId = engine.createTask(req.body);
      const task = engine.getTask(taskId);
      res.status(201).json({ success: true, data: task });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 更新任务
  router.put('/tasks/:id', (req, res) => {
    try {
      const updated = engine.updateTask(parseInt(req.params.id), req.body);
      if (!updated) return res.status(400).json({ success: false, error: '无有效字段' });
      res.json({ success: true, data: engine.getTask(parseInt(req.params.id)) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 删除任务
  router.delete('/tasks/:id', (req, res) => {
    try {
      engine.deleteTask(parseInt(req.params.id));
      res.json({ success: true, message: '任务已删除' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 启动任务
  router.post('/tasks/:id/start', async (req, res) => {
    try {
      await engine.startTask(parseInt(req.params.id));
      res.json({ success: true, message: '任务已加入队列' });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 暂停任务
  router.post('/tasks/:id/pause', (req, res) => {
    try {
      engine.pauseTask(parseInt(req.params.id));
      res.json({ success: true, message: '任务已暂停' });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 恢复任务
  router.post('/tasks/:id/resume', (req, res) => {
    try {
      engine.resumeTask(parseInt(req.params.id));
      res.json({ success: true, message: '任务已恢复' });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 取消任务
  router.post('/tasks/:id/cancel', (req, res) => {
    try {
      engine.cancelTask(parseInt(req.params.id));
      res.json({ success: true, message: '任务已取消' });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 获取任务执行明细
  router.get('/tasks/:id/items', (req, res) => {
    try {
      const items = engine.getTaskItems(parseInt(req.params.id), {
        status: req.query.status,
        limit: req.query.limit ? parseInt(req.query.limit) : 100
      });
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 获取采集结果
  router.get('/tasks/:id/results', (req, res) => {
    try {
      const results = engine.getTaskResults(parseInt(req.params.id));
      res.json({ success: true, data: results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = createMatrixRouter;
