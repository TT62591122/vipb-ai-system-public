/**
 * Workflow API 路由 (P2-12)
 */
const express = require('express');
const { validateBody } = require('../src/input-validator');

function createWorkflowRouter(workflowEngine) {
  const router = express.Router();

  // GET /api/workflows — 列出所有工作流
  router.get('/', (req, res) => {
    try {
      res.json({ success: true, data: workflowEngine.listWorkflows() });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/workflows — 创建工作流
  router.post('/', validateBody({
    name: { required: true, type: 'string', maxLength: 200 }
  }), (req, res) => {
    try {
      const wf = workflowEngine.createWorkflow(req.body);
      res.json({ success: true, data: wf });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // GET /api/workflows/:id — 获取单个工作流
  router.get('/:id', (req, res) => {
    try {
      const wf = workflowEngine.getWorkflow(+req.params.id);
      if (!wf) return res.status(404).json({ success: false, error: '工作流不存在' });
      res.json({ success: true, data: wf });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PUT /api/workflows/:id — 更新工作流
  router.put('/:id', (req, res) => {
    try {
      const wf = workflowEngine.updateWorkflow(+req.params.id, req.body);
      if (!wf) return res.status(404).json({ success: false, error: '工作流不存在' });
      res.json({ success: true, data: wf });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // DELETE /api/workflows/:id — 删除工作流
  router.delete('/:id', (req, res) => {
    try {
      workflowEngine.deleteWorkflow(+req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/workflows/:id/run — 执行工作流
  router.post('/:id/run', async (req, res) => {
    try {
      const result = await workflowEngine.runWorkflow(+req.params.id);
      res.json({ success: true, data: result });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // GET /api/workflows/runs/:runId — 获取运行状态
  router.get('/runs/:runId', (req, res) => {
    try {
      const run = workflowEngine.getWorkflowStatus(+req.params.runId);
      if (!run) return res.status(404).json({ success: false, error: '运行记录不存在' });
      res.json({ success: true, data: run });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST /api/workflows/runs/:runId/pause — 暂停
  router.post('/runs/:runId/pause', (req, res) => {
    try {
      res.json({ success: true, data: workflowEngine.pauseWorkflow(+req.params.runId) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  // POST /api/workflows/runs/:runId/resume — 恢复
  router.post('/runs/:runId/resume', (req, res) => {
    try {
      res.json({ success: true, data: workflowEngine.resumeWorkflow(+req.params.runId) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
  });

  return router;
}

module.exports = createWorkflowRouter;
