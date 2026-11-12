/**
 * Agent API Routes
 * 知识库管理 + Agent控制面板 API
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();
  const { getAgentMemory } = require('../src/agent-memory');
  const { getCostController } = require('../src/cost-controller');

  // ========== 经验管理 ==========

  // 获取经验列表
  router.get('/experiences', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      const { category, sentiment, is_valid, page, limit } = req.query;
      const result = memory.listExperiences({
        category: category || undefined,
        sentiment: sentiment || undefined,
        is_valid: is_valid !== undefined ? parseInt(is_valid) : undefined,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 标记经验有效/无效
  router.put('/experiences/:id/validate', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      const { is_valid } = req.body;
      memory.markExperience(parseInt(req.params.id), is_valid ? 1 : 0);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 删除经验
  router.delete('/experiences/:id', (req, res) => {
    try {
      db.prepare("DELETE FROM agent_experiences WHERE id = ?").run(parseInt(req.params.id));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== 策略管理 ==========

  router.get('/strategies', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      res.json({ success: true, data: memory.listStrategies() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/strategies', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      const id = memory.addStrategy(req.body);
      res.json({ success: true, id });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.put('/strategies/:id', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      memory.updateStrategy(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== 静态知识库（只读）==========

  router.get('/knowledge', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      res.json({ success: true, data: memory.getAllKnowledge() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== 操作日志 ==========

  router.get('/action-log', (req, res) => {
    try {
      const memory = getAgentMemory(db);
      const limit = parseInt(req.query.limit) || 50;
      res.json({ success: true, data: memory.getRecentActions(limit) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== Agent控制 ==========

  // 获取Agent状态
  router.get('/status', (req, res) => {
    try {
      const costCtrl = getCostController(db);
      const costOverview = costCtrl.getAgentCostOverview();

      // 读取模块开关
      const switchRow = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
      const switches = switchRow ? JSON.parse(switchRow.value) : {};
      const agentEnabled = switches.agent === true;

      // 读取巡检间隔
      const intervalRow = db.prepare("SELECT value FROM settings WHERE key='agent_scan_interval'").get();
      const scanInterval = intervalRow ? parseInt(intervalRow.value) : 2;

      // 经验数量
      const memory = getAgentMemory(db);
      const expCount = memory.getExperienceCount();

      res.json({
        success: true,
        enabled: agentEnabled,
        scanInterval,
        cost: costOverview,
        experienceCount: expCount
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 保存巡检间隔
  router.put('/scan-interval', (req, res) => {
    try {
      const { interval } = req.body;
      db.prepare("UPDATE settings SET value = ? WHERE key = 'agent_scan_interval'").run(String(interval));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 保存成本上限
  router.put('/cost-limits', (req, res) => {
    try {
      const { per_scan, daily, monthly } = req.body;
      const limits = { per_scan: parseFloat(per_scan) || 0.50, daily: parseFloat(daily) || 2.00, monthly: parseFloat(monthly) || 30.00 };
      db.prepare("UPDATE settings SET value = ? WHERE key = 'agent_cost_limits'").run(JSON.stringify(limits));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== Phase 2: 自主权等级 ==========

  const { AgentDecision, AUTONOMY_LEVELS } = require('../src/agent-decision');

  // 获取自主权状态
  router.get('/autonomy', (req, res) => {
    try {
      const decision = new AgentDecision(db, req.app.locals.io);
      const autonomy = decision.getAutonomyLevel();
      const levels = Object.entries(AUTONOMY_LEVELS).map(([k, v]) => ({ level: parseInt(k), ...v }));
      res.json({ success: true, ...autonomy, levels });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 手动设置自主权等级
  router.put('/autonomy', (req, res) => {
    try {
      const decision = new AgentDecision(db, req.app.locals.io);
      const level = decision.setAutonomyLevel(parseInt(req.body.level));
      res.json({ success: true, level });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 获取升级申请列表
  router.get('/upgrade-requests', (req, res) => {
    try {
      const requests = db.prepare("SELECT * FROM agent_upgrade_requests ORDER BY created_at DESC LIMIT 20").all();
      res.json({ success: true, data: requests });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 响应升级申请
  router.put('/upgrade-requests/:id', (req, res) => {
    try {
      const decision = new AgentDecision(db, req.app.locals.io);
      const result = decision.respondToUpgrade(parseInt(req.params.id), req.body.approved === true);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== Phase 2: 巡检控制 ==========

  // 手动触发一次巡检
  router.post('/scan', async (req, res) => {
    try {
      const scanner = req.app.locals.agentScanner;
      if (!scanner) return res.status(500).json({ success: false, error: 'Scanner未初始化' });
      const result = await scanner.runScan();
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 获取巡检结果
  router.get('/scan-results', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const results = db.prepare("SELECT * FROM agent_scan_results ORDER BY created_at DESC LIMIT ?").all(limit);
      res.json({ success: true, data: results });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 获取/更新巡检规则
  router.get('/scan-rules', (req, res) => {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key='agent_scan_rules'").get();
      res.json({ success: true, data: row ? JSON.parse(row.value) : {} });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.put('/scan-rules', (req, res) => {
    try {
      db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'agent_scan_rules'").run(JSON.stringify(req.body));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Agent模块开关变更时启停巡检引擎
  router.put('/toggle', (req, res) => {
    try {
      const { enabled } = req.body;
      const scanner = req.app.locals.agentScanner;
      if (enabled && scanner) {
        scanner.start();
      } else if (!enabled && scanner) {
        scanner.stop();
      }
      res.json({ success: true, running: !!enabled });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
