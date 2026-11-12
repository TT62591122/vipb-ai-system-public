/**
 * AI任务中心 API路由
 */
const express = require('express');
const router = express.Router();

module.exports = function(db) {
  const { AICommandEngine } = require('../src/ai-command-engine');
  const engine = new AICommandEngine(db);

  router.post('/chat', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ success: false, error: '请输入指令' });
      const result = await engine.processCommand(message.trim());
      res.json(result);
    } catch (e) {
      console.error('[AICommand] 处理指令失败:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get('/conversations', (req, res) => {
    try {
      res.json({ success: true, data: engine.getConversations(parseInt(req.query.limit) || 50) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/conversations', (req, res) => {
    try { engine.clearConversations(); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/tasks', (req, res) => {
    try { res.json({ success: true, data: engine.getTasks(parseInt(req.query.limit) || 20) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/tasks/:id', (req, res) => {
    try {
      const task = engine.getTaskDetail(parseInt(req.params.id));
      if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
      res.json({ success: true, data: task });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
