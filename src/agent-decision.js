/**
 * Agent Decision Engine — 决策引擎
 * 
 * 5档自主权等级：
 * 1. 仅通知 — 扫到机会只通知，不做任何操作
 * 2. 草稿模式 — 生成邮件草稿，等人工审核
 * 3. 低风险自动 — 老客户跟进自动发，新客户需审核
 * 4. 高风险自动 — 新客户首触也自动，询盘回复需审核
 * 5. 完全自主 — 全部自动执行，事后通知
 * 
 * 含升级申请机制：达到条件后向用户推荐升级
 */

const { getAgentMemory } = require('./agent-memory');
const { getCostController } = require('./cost-controller');

// 自主权等级定义
const AUTONOMY_LEVELS = {
  1: { name: '仅通知', canDraft: false, canAutoOld: false, canAutoNew: false, canAutoInquiry: false },
  2: { name: '草稿模式', canDraft: true, canAutoOld: false, canAutoNew: false, canAutoInquiry: false },
  3: { name: '低风险自动', canDraft: true, canAutoOld: true, canAutoNew: false, canAutoInquiry: false },
  4: { name: '高风险自动', canDraft: true, canAutoOld: true, canAutoNew: true, canAutoInquiry: false },
  5: { name: '完全自主', canDraft: true, canAutoOld: true, canAutoNew: true, canAutoInquiry: true },
};

class AgentDecision {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this.memory = getAgentMemory(db);
    this.costCtrl = getCostController(db);
  }

  // ========== 自主权等级管理 ==========

  getAutonomyLevel() {
    const row = this.db.prepare("SELECT * FROM agent_autonomy LIMIT 1").get();
    return row || { current_level: 1 };
  }

  getLevelInfo(level) {
    return AUTONOMY_LEVELS[level] || AUTONOMY_LEVELS[1];
  }

  /**
   * 手动设置自主权等级（用户在设置页面操作）
   */
  setAutonomyLevel(level) {
    if (level < 1 || level > 5) throw new Error('等级范围1-5');
    const current = this.getAutonomyLevel();
    const history = JSON.parse(current.upgrade_history || '[]');
    history.push({ from: current.current_level, to: level, at: new Date().toISOString(), by: 'user_manual' });

    this.db.prepare(`
      UPDATE agent_autonomy SET current_level = ?, last_upgrade_at = datetime('now'), 
      upgrade_history = ?, updated_at = datetime('now') WHERE id = ?
    `).run(level, JSON.stringify(history), current.id);

    this._notify('autonomy_changed', { from: current.current_level, to: level, levelName: AUTONOMY_LEVELS[level].name });
    return level;
  }

  // ========== 升级申请机制 ==========

  /**
   * 检查是否满足升级条件，如果满足且没有待处理的申请，创建升级申请
   * @returns {object|null} 升级申请或null
   */
  checkUpgradeEligibility() {
    const autonomy = this.getAutonomyLevel();
    const currentLevel = autonomy.current_level;
    if (currentLevel >= 5) return null; // 已满级

    const nextLevel = currentLevel + 1;
    const criteria = this._getUpgradeCriteria(nextLevel);
    if (!criteria) return null;

    // 检查是否有待处理的申请
    const pendingRequest = this.db.prepare(
      "SELECT id FROM agent_upgrade_requests WHERE status = 'pending' AND to_level = ?"
    ).get(nextLevel);
    if (pendingRequest) return null; // 已有待处理申请

    // 检查被拒后是否积累了足够新经验
    if (autonomy.last_rejected_at) {
      const positiveExpSinceReject = this.db.prepare(`
        SELECT COUNT(*) as c FROM agent_experiences 
        WHERE result_sentiment = 'positive' AND is_valid IS NOT 0
        AND created_at > ?
      `).get(autonomy.last_rejected_at)?.c || 0;

      const requiredForRetry = autonomy.experiences_required_for_retry || 50;
      if (positiveExpSinceReject < requiredForRetry) return null; // 经验不够，不能再次申请
    }

    // 检查具体条件
    const metrics = this._calculateMetrics();
    const eligible = this._meetsUpgradeCriteria(metrics, criteria);
    if (!eligible) return null;

    // 创建升级申请
    const reason = `已积累${metrics.positiveExperiences}条正面经验，回复率${(metrics.avgReplyRate * 100).toFixed(1)}%，活跃${metrics.daysActive}天`;
    const requestId = this.db.prepare(`
      INSERT INTO agent_upgrade_requests (from_level, to_level, reason, metrics, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'))
    `).run(currentLevel, nextLevel, reason, JSON.stringify(metrics)).lastInsertRowid;

    // 通知用户
    this._notify('upgrade_request', {
      requestId,
      fromLevel: currentLevel,
      fromName: AUTONOMY_LEVELS[currentLevel].name,
      toLevel: nextLevel,
      toName: AUTONOMY_LEVELS[nextLevel].name,
      reason,
      description: criteria.description
    });

    return { requestId, fromLevel: currentLevel, toLevel: nextLevel, reason };
  }

  /**
   * 用户响应升级申请
   */
  respondToUpgrade(requestId, approved) {
    const request = this.db.prepare("SELECT * FROM agent_upgrade_requests WHERE id = ?").get(requestId);
    if (!request || request.status !== 'pending') return { success: false, error: '申请不存在或已处理' };

    this.db.prepare(`
      UPDATE agent_upgrade_requests SET status = ?, user_response = ?, responded_at = datetime('now') WHERE id = ?
    `).run(approved ? 'approved' : 'rejected', approved ? 'approved' : 'rejected', requestId);

    if (approved) {
      this.setAutonomyLevel(request.to_level);
      return { success: true, newLevel: request.to_level, levelName: AUTONOMY_LEVELS[request.to_level].name };
    } else {
      // 记录拒绝，更新重试门槛
      const autonomy = this.getAutonomyLevel();
      const newRejectCount = (autonomy.reject_count || 0) + 1;
      // 每次被拒，下次需要的经验递增（50, 75, 100...）
      const newRequired = 50 + (newRejectCount - 1) * 25;
      const currentPositive = this.db.prepare(
        "SELECT COUNT(*) as c FROM agent_experiences WHERE result_sentiment = 'positive' AND is_valid IS NOT 0"
      ).get()?.c || 0;

      this.db.prepare(`
        UPDATE agent_autonomy SET last_rejected_at = datetime('now'), reject_count = ?,
        experiences_at_last_reject = ?, experiences_required_for_retry = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newRejectCount, currentPositive, newRequired, autonomy.id);

      return { success: true, rejected: true, nextRetryAfter: newRequired + ' 条新正面经验' };
    }
  }

  // ========== 决策核心 ==========

  /**
   * 对一个巡检触发项做决策
   * @param {object} trigger - { customerId, triggerType, triggerReason, priority, customerData }
   * @returns {object} { action, autoExecute, reason }
   */
  decide(trigger) {
    const level = this.getAutonomyLevel().current_level;
    const levelInfo = this.getLevelInfo(level);
    const { customerId, triggerType, customerData } = trigger;

    // 操作锁检查
    if (customerId && this.memory.hasRecentAction(customerId, 30)) {
      return { action: 'skip', autoExecute: false, reason: '30分钟内已有操作，跳过' };
    }

    // 成本检查
    const costCheck = this.costCtrl.canAgentSpend();
    if (!costCheck.allowed) {
      return { action: 'skip', autoExecute: false, reason: costCheck.reason };
    }

    // 根据触发类型和自主权等级决策
    const isOldCustomer = customerData && (customerData.stage === 'contacted' || customerData.stage === 'negotiating' || customerData.total_interactions > 0);
    const isInquiry = triggerType === 'inquiry_reply';

    let action, autoExecute, reason;

    switch (level) {
      case 1: // 仅通知
        action = 'notify';
        autoExecute = false;
        reason = '当前等级：仅通知';
        break;

      case 2: // 草稿模式
        action = 'draft';
        autoExecute = false;
        reason = '已生成草稿，等待审核';
        break;

      case 3: // 低风险自动
        if (isOldCustomer && !isInquiry) {
          action = 'auto_execute';
          autoExecute = true;
          reason = '老客户跟进，自动执行';
        } else {
          action = 'draft';
          autoExecute = false;
          reason = isInquiry ? '询盘回复需审核' : '新客户需审核';
        }
        break;

      case 4: // 高风险自动
        if (isInquiry) {
          action = 'draft';
          autoExecute = false;
          reason = '询盘回复需审核';
        } else {
          action = 'auto_execute';
          autoExecute = true;
          reason = isOldCustomer ? '老客户跟进，自动执行' : '新客户首触，自动执行';
        }
        break;

      case 5: // 完全自主
        action = 'auto_execute';
        autoExecute = true;
        reason = '完全自主模式';
        break;

      default:
        action = 'notify';
        autoExecute = false;
        reason = '未知等级，仅通知';
    }

    return { action, autoExecute, reason, level, levelName: levelInfo.name };
  }

  // ========== 内部方法 ==========

  _calculateMetrics() {
    const positiveExperiences = this.db.prepare(
      "SELECT COUNT(*) as c FROM agent_experiences WHERE result_sentiment = 'positive' AND is_valid IS NOT 0"
    ).get()?.c || 0;

    const totalExperiences = this.db.prepare(
      "SELECT COUNT(*) as c FROM agent_experiences WHERE is_valid IS NOT 0"
    ).get()?.c || 0;

    // 平均回复率（从客户画像）
    const replyRates = this.db.prepare(
      "SELECT AVG(reply_rate) as avg_rate FROM agent_customer_profiles WHERE total_interactions > 0"
    ).get();
    const avgReplyRate = replyRates?.avg_rate || 0;

    // 活跃天数（从第一条经验到现在）
    const firstExp = this.db.prepare(
      "SELECT MIN(created_at) as first_at FROM agent_experiences"
    ).get();
    let daysActive = 0;
    if (firstExp?.first_at) {
      daysActive = Math.floor((Date.now() - new Date(firstExp.first_at).getTime()) / (86400000));
    }

    // 成功执行次数
    const successActions = this.db.prepare(
      "SELECT COUNT(*) as c FROM agent_action_log WHERE status = 'executed'"
    ).get()?.c || 0;

    return { positiveExperiences, totalExperiences, avgReplyRate, daysActive, successActions };
  }

  _getUpgradeCriteria(level) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'agent_upgrade_criteria'").get();
      if (row) {
        const criteria = JSON.parse(row.value);
        return criteria[String(level)] || null;
      }
    } catch {}
    return null;
  }

  _meetsUpgradeCriteria(metrics, criteria) {
    if (criteria.min_positive_experiences && metrics.positiveExperiences < criteria.min_positive_experiences) return false;
    if (criteria.min_reply_rate && metrics.avgReplyRate < criteria.min_reply_rate) return false;
    if (criteria.min_days_active && metrics.daysActive < criteria.min_days_active) return false;
    return true;
  }

  _notify(type, data) {
    if (this.io) {
      this.io.emit('agent_event', { type, data, timestamp: new Date().toISOString() });
    }
    console.log(`[AgentDecision] ${type}:`, JSON.stringify(data).substring(0, 200));
  }
}

module.exports = { AgentDecision, AUTONOMY_LEVELS };
