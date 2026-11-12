/**
 * CostController — 统一成本控制模块
 * 从 ai-brain.js 提取为独立模块，供 ai-brain.js 和 ai-command-engine.js 共用
 * 
 * 功能：
 * - 系统级日/月预算控制
 * - Agent专用成本上限（单次巡检/日/月）
 * - 使用量记录
 * - 成本查询
 */
const config = require('./config');

class CostController {
  constructor(db) {
    this.db = db;
    this.dailyBudget = config.ai?.dailyBudget || 20;
    this.monthlyBudget = config.ai?.monthlyBudget || 500;
    this.multiplier = config.ai?.costMultiplier || 0.45;
  }

  // ========== 系统级成本查询 ==========

  getTodayCost() {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(cost),0) as total FROM ai_logs WHERE date(created_at)=date('now')"
    ).get();
    return row.total;
  }

  getMonthCost() {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(cost),0) as total FROM ai_logs WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now')"
    ).get();
    return row.total;
  }

  canSpend() {
    return this.getTodayCost() < this.dailyBudget && this.getMonthCost() < this.monthlyBudget;
  }

  logUsage(agent, model, promptTokens, completionTokens, task, result, cached = 0) {
    const costs = { 'sonnet': 0.02, 'opus': 0.10, 'haiku': 0.003 };
    const modelKey = Object.keys(costs).find(k => model.toLowerCase().includes(k)) || 'sonnet';
    const cost = cached ? 0 : costs[modelKey] * this.multiplier;
    this.db.prepare(
      'INSERT INTO ai_logs (agent,model,prompt_tokens,completion_tokens,cost,task,result,cached) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      agent, model, promptTokens, completionTokens, cost, task,
      typeof result === 'string' ? result.substring(0, 500) : JSON.stringify(result).substring(0, 500),
      cached
    );
    return cost;
  }

  // ========== Agent专用成本控制 ==========

  _getAgentLimits() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='agent_cost_limits'").get();
      if (row) return JSON.parse(row.value);
    } catch {}
    return { per_scan: 0.50, daily: 2.00, monthly: 30.00 };
  }

  getAgentTodayCost() {
    try {
      const row = this.db.prepare(
        "SELECT COALESCE(SUM(cost),0) as total FROM agent_action_log WHERE date(created_at)=date('now')"
      ).get();
      return row.total;
    } catch { return 0; }
  }

  getAgentMonthCost() {
    try {
      const row = this.db.prepare(
        "SELECT COALESCE(SUM(cost),0) as total FROM agent_action_log WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now')"
      ).get();
      return row.total;
    } catch { return 0; }
  }

  /**
   * 检查Agent是否可以花费
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canAgentSpend() {
    const limits = this._getAgentLimits();
    const todayCost = this.getAgentTodayCost();
    const monthCost = this.getAgentMonthCost();

    if (todayCost >= limits.daily) {
      return { allowed: false, reason: `Agent日成本已达上限 $${todayCost.toFixed(2)}/$${limits.daily.toFixed(2)}` };
    }
    if (monthCost >= limits.monthly) {
      return { allowed: false, reason: `Agent月成本已达上限 $${monthCost.toFixed(2)}/$${limits.monthly.toFixed(2)}` };
    }
    // 系统级预算也要检查
    if (!this.canSpend()) {
      return { allowed: false, reason: '系统AI总预算已用完' };
    }
    return { allowed: true };
  }

  /**
   * 检查单次巡检是否超限
   * @param {number} scanCost 本次巡检已花费
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canAgentScanSpend(scanCost) {
    const limits = this._getAgentLimits();
    if (scanCost >= limits.per_scan) {
      return { allowed: false, reason: `单次巡检成本已达上限 $${scanCost.toFixed(2)}/$${limits.per_scan.toFixed(2)}` };
    }
    return this.canAgentSpend();
  }

  /**
   * 获取Agent成本概览（用于UI展示）
   */
  getAgentCostOverview() {
    const limits = this._getAgentLimits();
    const todayCost = this.getAgentTodayCost();
    const monthCost = this.getAgentMonthCost();
    return {
      limits,
      today: { spent: todayCost, limit: limits.daily, percent: limits.daily > 0 ? Math.min(100, (todayCost / limits.daily * 100)) : 0 },
      month: { spent: monthCost, limit: limits.monthly, percent: limits.monthly > 0 ? Math.min(100, (monthCost / limits.monthly * 100)) : 0 }
    };
  }
}

// 单例模式：确保整个系统共用一个实例
let _instance = null;

function getCostController(db) {
  if (!_instance && db) {
    _instance = new CostController(db);
  }
  return _instance;
}

module.exports = { CostController, getCostController };
