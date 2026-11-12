/**
 * 持久待办事项引擎
 * - 创建待办（报价请求、投诉、重要询盘等）
 * - 永不自动消失，必须人工处理
 * - 升级提醒：2h → 6h → 24h 逐级升级
 * - 支持多渠道推送（系统内 + 飞书/WA外推）
 * 
 * ⚠️ 核心原则：待办永不自动关闭，只有人工确认才能关闭
 */

class PendingActions {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      title TEXT NOT NULL,
      description TEXT,
      channel TEXT,
      customer_id INTEGER,
      customer_email TEXT,
      customer_name TEXT,
      source_message TEXT,
      source_id TEXT,
      status TEXT DEFAULT 'pending',
      escalation_level INTEGER DEFAULT 0,
      last_reminded_at TEXT,
      handled_at TEXT,
      handled_by TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();

    try {
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_pa_status ON pending_actions(status)').run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_pa_type ON pending_actions(type)').run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_pa_priority ON pending_actions(priority)').run();
    } catch(e) {}
  }

  /**
   * 创建待办
   * @param {object} action
   * @returns {number} id
   */
  create(action) {
    const result = this.db.prepare(`INSERT INTO pending_actions 
      (type, priority, title, description, channel, customer_id, customer_email, customer_name, source_message, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        action.type || 'general',
        action.priority || 'normal',
        action.title,
        action.description || null,
        action.channel || null,
        action.customerId || null,
        action.customerEmail || null,
        action.customerName || null,
        action.sourceMessage || null,
        action.sourceId || null
      );
    
    console.log(`[PendingActions] 新待办 #${result.lastInsertRowid}: ${action.title}`);
    return result.lastInsertRowid;
  }

  /**
   * 从意图检测结果创建报价待办
   */
  createFromPricingIntent(intentResult, context = {}) {
    return this.create({
      type: 'pricing_request',
      priority: 'high',
      title: `💰 报价请求 - ${context.customerName || context.customerEmail || '未知客户'}`,
      description: `客户通过${context.channel || '未知渠道'}询价\n匹配关键词: ${intentResult.matchedKeywords.join(', ')}\n置信度: ${(intentResult.confidence * 100).toFixed(0)}%`,
      channel: context.channel,
      customerId: context.customerId,
      customerEmail: context.customerEmail,
      customerName: context.customerName,
      sourceMessage: context.messageText?.substring(0, 1000),
      sourceId: context.sourceId
    });
  }

  /**
   * 获取所有待处理的待办
   */
  getPending(opts = {}) {
    let sql = "SELECT * FROM pending_actions WHERE status = 'pending'";
    const params = [];
    
    if (opts.type) {
      sql += ' AND type = ?';
      params.push(opts.type);
    }
    if (opts.priority) {
      sql += ' AND priority = ?';
      params.push(opts.priority);
    }
    if (opts.channel) {
      sql += ' AND channel = ?';
      params.push(opts.channel);
    }
    
    sql += ' ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, created_at ASC';
    
    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }
    
    return this.db.prepare(sql).all(...params);
  }

  /**
   * 获取待办统计
   */
  getStats() {
    const total = this.db.prepare("SELECT COUNT(*) as c FROM pending_actions WHERE status = 'pending'").get().c;
    const byType = this.db.prepare("SELECT type, COUNT(*) as c FROM pending_actions WHERE status = 'pending' GROUP BY type").all();
    const byPriority = this.db.prepare("SELECT priority, COUNT(*) as c FROM pending_actions WHERE status = 'pending' GROUP BY priority").all();
    const oldest = this.db.prepare("SELECT MIN(created_at) as t FROM pending_actions WHERE status = 'pending'").get().t;
    
    return { total, byType, byPriority, oldestPending: oldest };
  }

  /**
   * 标记为已处理
   */
  resolve(id, handledBy = 'admin', notes = '') {
    this.db.prepare(`UPDATE pending_actions 
      SET status = 'resolved', handled_at = datetime('now'), handled_by = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?`)
      .run(handledBy, notes, id);
    console.log(`[PendingActions] 待办 #${id} 已处理 by ${handledBy}`);
  }

  /**
   * 忽略（仍然记录，但不再提醒）
   */
  dismiss(id, reason = '') {
    this.db.prepare(`UPDATE pending_actions 
      SET status = 'dismissed', handled_at = datetime('now'), notes = ?, updated_at = datetime('now')
      WHERE id = ?`)
      .run(reason, id);
  }

  /**
   * 检查需要升级提醒的待办
   * 规则：2h未处理→第1次提醒，6h→第2次，24h→第3次（紧急）
   */
  getEscalationDue() {
    const now = Date.now();
    const pending = this.db.prepare(
      "SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at ASC"
    ).all();

    const due = [];
    for (const action of pending) {
      const createdAt = new Date(action.created_at + 'Z').getTime();
      const age = now - createdAt;
      const ageHours = age / (1000 * 60 * 60);
      
      let targetLevel = 0;
      if (ageHours >= 24) targetLevel = 3;
      else if (ageHours >= 6) targetLevel = 2;
      else if (ageHours >= 2) targetLevel = 1;

      if (targetLevel > action.escalation_level) {
        due.push({ ...action, targetLevel, ageHours: Math.round(ageHours * 10) / 10 });
      }
    }
    return due;
  }

  /**
   * 更新升级级别
   */
  updateEscalation(id, level) {
    this.db.prepare(`UPDATE pending_actions 
      SET escalation_level = ?, last_reminded_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`)
      .run(level, id);
  }
}

module.exports = { PendingActions };
