/**
 * Agent Memory System — 记忆系统
 * 
 * 读写 agent_experiences（动态经验）
 * 读 knowledge_base（静态知识，只读不写）
 * 读写 agent_customer_profiles（客户画像）
 * 读写 agent_strategies（策略库）
 * 
 * 始终可用：主脑调用此模块读取知识，不受Agent开关影响
 */

class AgentMemory {
  constructor(db) {
    this.db = db;
  }

  // ========== 动态经验（agent_experiences）==========

  /**
   * 记录一条经验
   */
  addExperience({ category, situation, action, result, result_sentiment, lesson, confidence, source }) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_experiences (category, situation, action, result, result_sentiment, lesson, confidence, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const r = stmt.run(
      category || 'email',
      situation || '',
      action || '',
      result || '',
      result_sentiment || 'neutral',
      lesson || '',
      confidence ?? (result_sentiment === 'negative' ? 0.1 : 0.5),
      source || 'agent_auto'
    );

    // 弹性上限检查（提醒线机制，实际不自动删除）
    this._checkExperienceLimit();

    return r.lastInsertRowid;
  }

  /**
   * 查找相关经验（按分类+关键词匹配，按confidence排序）
   * @param {string} category 分类
   * @param {string} keywords 关键词（可选）
   * @param {number} limit 最多返回条数
   */
  findExperiences(category, keywords, limit = 5) {
    let sql = `SELECT * FROM agent_experiences WHERE is_valid IS NOT 0`; // 排除标记为无效的
    const params = [];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }

    if (keywords) {
      sql += ` AND (situation LIKE ? OR action LIKE ? OR lesson LIKE ?)`;
      const kw = `%${keywords}%`;
      params.push(kw, kw, kw);
    }

    sql += ` ORDER BY confidence DESC, times_applied DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params);
  }

  /**
   * 获取所有经验（分页，用于UI展示）
   */
  listExperiences({ category, sentiment, is_valid, page = 1, limit = 50 } = {}) {
    let where = '1=1';
    const params = [];

    if (category) { where += ' AND category = ?'; params.push(category); }
    if (sentiment) { where += ' AND result_sentiment = ?'; params.push(sentiment); }
    if (is_valid !== undefined && is_valid !== null) { where += ' AND is_valid = ?'; params.push(is_valid); }

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM agent_experiences WHERE ${where}`).get(...params).c;
    const rows = this.db.prepare(`SELECT * FROM agent_experiences WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);

    return { total, rows, page, limit };
  }

  /**
   * 标记经验有效/无效
   */
  markExperience(id, is_valid) {
    this.db.prepare("UPDATE agent_experiences SET is_valid = ?, updated_at = datetime('now') WHERE id = ?").run(is_valid, id);
  }

  /**
   * 增加经验被应用次数（提升置信度）
   */
  applyExperience(id) {
    this.db.prepare(`
      UPDATE agent_experiences 
      SET times_applied = times_applied + 1, 
          confidence = MIN(1.0, confidence + 0.05),
          updated_at = datetime('now') 
      WHERE id = ?
    `).run(id);
  }

  /**
   * 弹性上限检查
   * 返回需要审核的末尾经验（如果超限）
   */
  _checkExperienceLimit() {
    const total = this.db.prepare("SELECT COUNT(*) as c FROM agent_experiences").get().c;
    // 默认提醒线1000，可通过settings调整
    let threshold = 1000;
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='agent_experience_threshold'").get();
      if (row) threshold = parseInt(row.value) || 1000;
    } catch {}

    if (total >= threshold) {
      // 返回末尾10条（置信度最低），供特先生审核
      return this.db.prepare(
        "SELECT id, category, situation, lesson, confidence, is_valid FROM agent_experiences ORDER BY confidence ASC, created_at ASC LIMIT 10"
      ).all();
    }
    return null;
  }

  getExperienceCount() {
    return this.db.prepare("SELECT COUNT(*) as c FROM agent_experiences").get().c;
  }

  // ========== 静态知识库（knowledge_base，只读）==========

  /**
   * 读取静态知识（按分类）
   */
  getKnowledge(category) {
    return this.db.prepare('SELECT key, value FROM knowledge_base WHERE category = ?').all(category)
      .map(r => {
        try { return { key: r.key, value: JSON.parse(r.value) }; }
        catch { return { key: r.key, value: r.value }; }
      });
  }

  /**
   * 获取全部静态知识（用于注入prompt）
   */
  getAllKnowledge() {
    const all = this.db.prepare('SELECT category, key, value FROM knowledge_base').all();
    const ctx = {};
    all.forEach(r => {
      if (!ctx[r.category]) ctx[r.category] = {};
      try { ctx[r.category][r.key] = JSON.parse(r.value); }
      catch { ctx[r.category][r.key] = r.value; }
    });
    return ctx;
  }

  // ========== 客户画像（agent_customer_profiles）==========

  /**
   * 获取客户画像
   */
  getProfile(customerId) {
    return this.db.prepare("SELECT * FROM agent_customer_profiles WHERE customer_id = ?").get(customerId);
  }

  /**
   * 创建或更新客户画像
   */
  upsertProfile(customerId, data) {
    const existing = this.getProfile(customerId);
    if (existing) {
      const fields = [];
      const values = [];
      for (const [key, val] of Object.entries(data)) {
        if (key !== 'customer_id' && key !== 'id' && val !== undefined) {
          fields.push(`${key} = ?`);
          values.push(val);
        }
      }
      if (fields.length === 0) return existing.id;
      fields.push("updated_at = datetime('now')");
      values.push(customerId);
      this.db.prepare(`UPDATE agent_customer_profiles SET ${fields.join(', ')} WHERE customer_id = ?`).run(...values);
      return existing.id;
    } else {
      const r = this.db.prepare(`
        INSERT INTO agent_customer_profiles (customer_id, language_preference, communication_style, interests, best_contact_time, response_pattern, deal_stage, reply_rate, avg_reply_hours, total_interactions, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        customerId,
        data.language_preference || null,
        data.communication_style || null,
        data.interests || null,
        data.best_contact_time || null,
        data.response_pattern || null,
        data.deal_stage || null,
        data.reply_rate || 0,
        data.avg_reply_hours || 0,
        data.total_interactions || 0,
        data.notes || null
      );
      return r.lastInsertRowid;
    }
  }

  /**
   * 更新客户画像的硬数据指标（回复率、平均回复时长等）
   * 基于emails表的真实数据计算
   */
  updateProfileHardData(customerId) {
    try {
      // 计算回复率
      const sent = this.db.prepare(
        "SELECT COUNT(*) as c FROM emails WHERE customer_id = ? AND direction = 'outbound' AND status = 'sent'"
      ).get(customerId)?.c || 0;

      const replied = this.db.prepare(`
        SELECT COUNT(DISTINCT e1.id) as c FROM emails e1
        WHERE e1.customer_id = ? AND e1.direction = 'outbound' AND e1.status = 'sent'
        AND EXISTS (
          SELECT 1 FROM emails e2 
          WHERE e2.customer_id = ? AND e2.direction = 'inbound' 
          AND e2.created_at > e1.sent_at
        )
      `).get(customerId, customerId)?.c || 0;

      const replyRate = sent > 0 ? (replied / sent) : 0;

      // 计算总交互次数
      const totalInteractions = this.db.prepare(
        "SELECT COUNT(*) as c FROM emails WHERE customer_id = ?"
      ).get(customerId)?.c || 0;

      // 最后一次正面回复时间
      const lastPositive = this.db.prepare(`
        SELECT MAX(created_at) as t FROM emails 
        WHERE customer_id = ? AND direction = 'inbound'
      `).get(customerId)?.t || null;

      this.upsertProfile(customerId, {
        reply_rate: Math.round(replyRate * 100) / 100,
        total_interactions: totalInteractions,
        last_positive_at: lastPositive
      });

      return { replyRate, totalInteractions, lastPositive };
    } catch (e) {
      console.error(`[AgentMemory] 更新客户${customerId}画像硬数据失败:`, e.message);
      return null;
    }
  }

  // ========== 策略库（agent_strategies）==========

  getActiveStrategies() {
    return this.db.prepare("SELECT * FROM agent_strategies WHERE is_active = 1").all();
  }

  getStrategy(id) {
    return this.db.prepare("SELECT * FROM agent_strategies WHERE id = ?").get(id);
  }

  listStrategies() {
    return this.db.prepare("SELECT * FROM agent_strategies ORDER BY created_at DESC").all();
  }

  addStrategy({ name, description, target_segment, rules, is_active }) {
    const r = this.db.prepare(`
      INSERT INTO agent_strategies (name, description, target_segment, rules, performance, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', ?, datetime('now'), datetime('now'))
    `).run(name, description || '', target_segment || '', rules || '{}', is_active ?? 1);
    return r.lastInsertRowid;
  }

  updateStrategy(id, data) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(data)) {
      if (key !== 'id' && val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE agent_strategies SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  // ========== 操作日志（agent_action_log）==========

  logAction({ action_type, triggered_by, target_customer_id, decision_reason, decision_score, action_detail, result, status, cost }) {
    const r = this.db.prepare(`
      INSERT INTO agent_action_log (action_type, triggered_by, target_customer_id, decision_reason, decision_score, action_detail, result, status, cost, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      action_type || 'manual',
      triggered_by || 'user',
      target_customer_id || null,
      decision_reason || null,
      decision_score || null,
      action_detail || null,
      result || null,
      status || 'executed',
      cost || 0
    );
    return r.lastInsertRowid;
  }

  /**
   * 操作锁检查：30分钟内同客户是否有操作
   */
  hasRecentAction(customerId, minutes = 30) {
    const count = this.db.prepare(`
      SELECT COUNT(*) as c FROM agent_action_log 
      WHERE target_customer_id = ? 
        AND status IN ('planned','executing','executed')
        AND created_at > datetime('now', '-${minutes} minutes')
    `).get(customerId)?.c || 0;

    // 同时检查emails表
    const emailCount = this.db.prepare(`
      SELECT COUNT(*) as c FROM emails 
      WHERE customer_id = ? 
        AND status IN ('queued','sending','sent')
        AND created_at > datetime('now', '-${minutes} minutes')
    `).get(customerId)?.c || 0;

    return (count + emailCount) > 0;
  }

  getRecentActions(limit = 50) {
    return this.db.prepare(
      "SELECT * FROM agent_action_log ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  }

  // ========== 双层知识注入（供主脑使用）==========

  /**
   * 构建知识注入文本，用于追加到主脑的system prompt
   * @param {object} context - { taskType, customerId, keywords }
   */
  buildKnowledgeInjection(context = {}) {
    const parts = [];

    // 1. 相关动态经验（最多5条，按confidence排序）
    const category = this._mapTaskToCategory(context.taskType);
    const experiences = this.findExperiences(category, context.keywords, 5);
    if (experiences.length > 0) {
      parts.push('\n=== 实战经验（从历史操作中学到的）===');
      experiences.forEach((exp, i) => {
        parts.push(`${i + 1}. [${exp.category}] 场景: ${exp.situation} → 做法: ${exp.action} → 结果: ${exp.result} → 教训: ${exp.lesson} (置信度: ${exp.confidence})`);
      });
    }

    // 2. 客户画像（如果涉及特定客户）
    if (context.customerId) {
      const profile = this.getProfile(context.customerId);
      if (profile) {
        parts.push('\n=== 客户画像 ===');
        if (profile.language_preference) parts.push(`偏好语言: ${profile.language_preference}`);
        if (profile.communication_style) parts.push(`沟通风格: ${profile.communication_style}`);
        if (profile.interests) parts.push(`关注点: ${profile.interests}`);
        if (profile.best_contact_time) parts.push(`最佳联系时间: ${profile.best_contact_time}`);
        if (profile.response_pattern) parts.push(`回复模式: ${profile.response_pattern}`);
        if (profile.deal_stage) parts.push(`当前阶段: ${profile.deal_stage}`);
        parts.push(`回复率: ${(profile.reply_rate * 100).toFixed(0)}% | 总交互: ${profile.total_interactions}次`);
        if (profile.notes) parts.push(`备注: ${profile.notes}`);
      }
    }

    // 3. 活跃策略
    const strategies = this.getActiveStrategies();
    if (strategies.length > 0) {
      parts.push('\n=== 当前销售策略 ===');
      strategies.forEach(s => {
        parts.push(`- ${s.name}: ${s.description}`);
        if (s.target_segment) parts.push(`  适用: ${s.target_segment}`);
      });
    }

    return parts.join('\n');
  }

  /**
   * 任务类型映射到经验分类
   */
  _mapTaskToCategory(taskType) {
    const map = {
      'send_email': 'email',
      'schedule_email': 'email',
      'reply_email': 'email',
      'whatsapp': 'whatsapp',
      'linkedin': 'linkedin',
      'tiktok': 'tiktok',
      'facebook': 'facebook',
      'instagram': 'instagram',
      'youtube': 'youtube',
      'social': 'cross_channel',
      'strategy': 'strategy'
    };
    return map[taskType] || null; // null = 不按分类过滤，返回所有
  }

  // ========== 被动学习：从操作结果中提取经验 ==========

  /**
   * 从邮件发送结果中提取经验
   * @param {object} emailData - { to, subject, body, customerId, success, error }
   */
  extractEmailExperience(emailData) {
    const { to, subject, body, customerId, success, error } = emailData;
    const customer = customerId ? this.db.prepare("SELECT company, country, stage FROM customers WHERE id = ?").get(customerId) : null;

    const situation = `发邮件给 ${customer?.company || to} (${customer?.country || '未知国家'}, 阶段: ${customer?.stage || '未知'})`;
    const action = `主题: ${(subject || '').substring(0, 100)}`;
    const result = success ? '发送成功' : `发送失败: ${error || '未知错误'}`;
    const sentiment = success ? 'neutral' : 'negative'; // 发送成功只是neutral，收到回复才是positive

    return this.addExperience({
      category: 'email',
      situation,
      action,
      result,
      result_sentiment: sentiment,
      lesson: success ? '' : `邮件发送失败原因: ${error}，需检查配置`,
      confidence: success ? 0.3 : 0.1,
      source: 'agent_auto'
    });
  }

  /**
   * 从收到的回复中更新经验和画像
   * @param {object} replyData - { customerId, sentiment, content }
   */
  processIncomingReply(replyData) {
    const { customerId, sentiment, content } = replyData;
    if (!customerId) return;

    // 更新画像硬数据
    this.updateProfileHardData(customerId);

    // 如果有正面回复，提升相关经验的置信度
    if (sentiment === 'positive') {
      // 找到最近发给该客户的经验记录，提升置信度
      const recentExp = this.db.prepare(`
        SELECT id FROM agent_experiences 
        WHERE category = 'email' AND situation LIKE ? 
        ORDER BY created_at DESC LIMIT 1
      `).get(`%customer_id:${customerId}%`);

      if (recentExp) {
        this.applyExperience(recentExp.id);
      }
    }
  }
}

// 单例
let _memoryInstance = null;
function getAgentMemory(db) {
  if (!_memoryInstance && db) {
    _memoryInstance = new AgentMemory(db);
  }
  return _memoryInstance;
}

module.exports = { AgentMemory, getAgentMemory };
