/**
 * 线索评分引擎 (Lead Scoring Engine)
 * 基于行为+属性双维度自动评分，驱动销售优先级
 */

const DEFAULT_SCORING_RULES = {
  version: '2026.03.06',

  // 行为评分（客户做了什么）
  behavior: {
    whatsapp_inquiry:     { score: 30, label: 'WhatsApp咨询',     decay_days: 30 },
    whatsapp_reply:       { score: 15, label: 'WhatsApp回复',     decay_days: 30 },
    email_open:           { score: 5,  label: '打开邮件',         decay_days: 14 },
    email_click:          { score: 10, label: '点击邮件链接',     decay_days: 14 },
    email_reply:          { score: 25, label: '回复邮件',         decay_days: 30 },
    linkedin_connect:     { score: 20, label: 'LinkedIn连接',     decay_days: 60 },
    linkedin_reply:       { score: 25, label: 'LinkedIn回复',     decay_days: 30 },
    website_visit:        { score: 5,  label: '访问网站',         decay_days: 7 },
    catalog_download:     { score: 15, label: '下载目录',         decay_days: 30 },
    video_watch:          { score: 10, label: '观看视频',         decay_days: 14 },
    inquiry_submit:       { score: 35, label: '提交询盘',         decay_days: 60 },
    sample_request:       { score: 40, label: '请求样品',         decay_days: 90 },
    quote_request:        { score: 45, label: '请求报价',         decay_days: 60 },
    repeat_visit:         { score: 20, label: '多次互动(3+)',     decay_days: 30 },
    social_engage:        { score: 8,  label: '社媒互动',         decay_days: 14 },
  },

  // 属性评分（客户是谁）
  attributes: {
    // 行业匹配
    industry: {
      'power_utility':    { score: 25, label: '电力/公用事业' },
      'construction':     { score: 20, label: '建筑/基建' },
      'engineering':      { score: 20, label: '工程承包' },
      'government':       { score: 15, label: '政府/公共部门' },
      'distribution':     { score: 15, label: '电气分销商' },
      'real_estate':      { score: 10, label: '房地产开发' },
      'other':            { score: 0,  label: '其他' },
    },
    // 职位匹配
    job_title: {
      'c_level':          { score: 20, label: 'CEO/COO/CFO' },
      'director':         { score: 18, label: '总监/Director' },
      'manager':          { score: 15, label: '经理/Manager' },
      'procurement':      { score: 20, label: '采购/Procurement' },
      'engineer':         { score: 10, label: '工程师/Engineer' },
      'other':            { score: 0,  label: '其他' },
    },
    // 目标市场（国家/地区）
    region: {
      'africa':           { score: 15, label: '非洲' },
      'middle_east':      { score: 15, label: '中东' },
      'southeast_asia':   { score: 12, label: '东南亚' },
      'south_america':    { score: 10, label: '南美' },
      'south_asia':       { score: 10, label: '南亚' },
      'europe':           { score: 8,  label: '欧洲' },
      'other':            { score: 0,  label: '其他' },
    },
    // 公司规模
    company_size: {
      'enterprise':       { score: 15, label: '大型(1000+人)' },
      'mid':              { score: 12, label: '中型(100-999人)' },
      'small':            { score: 8,  label: '小型(10-99人)' },
      'micro':            { score: 3,  label: '微型(<10人)' },
      'unknown':          { score: 5,  label: '未知' },
    }
  },

  // 评分阈值
  thresholds: {
    cold:   { min: 0,   max: 29,  label: '冷线索',       color: '#6c757d', action: '继续培育' },
    warm:   { min: 30,  max: 49,  label: '温线索',       color: '#ffc107', action: '加强培育+定期跟进' },
    mql:    { min: 50,  max: 79,  label: 'MQL营销合格',  color: '#17a2b8', action: '重点培育+销售关注' },
    sql:    { min: 80,  max: 99,  label: 'SQL销售合格',  color: '#fd7e14', action: '销售主动跟进' },
    hot:    { min: 100, max: 999, label: '🔥热线索',     color: '#dc3545', action: '立即跟进！' },
  },

  // 衰减设置
  decay: {
    enabled: true,
    check_interval_hours: 24,     // 每24小时检查衰减
    min_score: 0,                 // 最低分
  },

  // 自动操作
  automation: {
    notify_on_mql: true,          // 达到MQL时通知
    notify_on_sql: true,          // 达到SQL时通知
    notify_on_hot: true,          // 达到Hot时通知
    auto_assign_sql: true,        // SQL自动分配给销售
    auto_stage_update: true,      // 自动更新CRM阶段
  }
};

class LeadScoringEngine {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this.rules = null;
    this._initTables();
    this._loadRules();
  }

  _initTables() {
    this.db.exec(`
      -- 线索评分事件表
      CREATE TABLE IF NOT EXISTS lead_score_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        score_delta INTEGER NOT NULL,
        source TEXT DEFAULT '',
        details TEXT DEFAULT '{}',
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_lse_customer ON lead_score_events(customer_id);
      CREATE INDEX IF NOT EXISTS idx_lse_created ON lead_score_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_lse_expires ON lead_score_events(expires_at);
    `);

    // 确保 customers 表有 lead_score 字段（已有）
    // 添加 lead_grade 字段（如果不存在）
    try {
      this.db.exec("ALTER TABLE customers ADD COLUMN lead_grade TEXT DEFAULT 'cold'");
    } catch(e) { /* 已存在 */ }
    try {
      this.db.exec("ALTER TABLE customers ADD COLUMN score_updated_at DATETIME");
    } catch(e) { /* 已存在 */ }
  }

  _loadRules() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='lead_scoring_rules'").get();
      if (row) {
        this.rules = JSON.parse(row.value);
        console.log('[LeadScore] 评分规则已加载 v' + this.rules.version);
      } else {
        this.rules = DEFAULT_SCORING_RULES;
        this._saveRules();
        console.log('[LeadScore] 默认评分规则已写入 v' + this.rules.version);
      }
    } catch(e) {
      this.rules = DEFAULT_SCORING_RULES;
    }
  }

  _saveRules() {
    this.db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('lead_scoring_rules',?,datetime('now'))")
      .run(JSON.stringify(this.rules));
  }

  getRules() { return this.rules; }
  updateRules(r) { this.rules = {...this.rules,...r, version: new Date().toISOString().split('T')[0].replace(/-/g,'.')}; this._saveRules(); return this.rules; }
  resetRules() { this.rules = {...DEFAULT_SCORING_RULES}; this._saveRules(); return this.rules; }

  /**
   * 记录一个评分事件
   * @param {number} customerId
   * @param {string} eventType - behavior规则中的key
   * @param {object} opts - { source, details }
   * @returns {{ newScore, grade, delta, event }}
   */
  recordEvent(customerId, eventType, opts = {}) {
    const rule = this.rules.behavior[eventType];
    if (!rule) return null;

    const delta = rule.score;
    const expiresAt = rule.decay_days
      ? new Date(Date.now() + rule.decay_days * 86400000).toISOString()
      : null;

    // 插入事件
    this.db.prepare(`INSERT INTO lead_score_events (customer_id, event_type, score_delta, source, details, expires_at)
      VALUES (?,?,?,?,?,?)`)
      .run(customerId, eventType, delta, opts.source || '', JSON.stringify(opts.details || {}), expiresAt);

    // 重新计算总分
    const result = this.recalculate(customerId);

    // 检查是否触发通知
    this._checkAutomation(customerId, result);

    return { ...result, delta, event: eventType };
  }

  /**
   * 设置属性评分
   * @param {number} customerId
   * @param {string} attrType - industry|job_title|region|company_size
   * @param {string} attrValue - 对应的值
   */
  setAttribute(customerId, attrType, attrValue) {
    const attrRules = this.rules.attributes[attrType];
    if (!attrRules) return;

    const rule = attrRules[attrValue];
    if (!rule) return;

    // 先删除同类型旧属性事件
    this.db.prepare("DELETE FROM lead_score_events WHERE customer_id=? AND event_type=?")
      .run(customerId, `attr_${attrType}`);

    // 插入新属性（不过期）
    this.db.prepare(`INSERT INTO lead_score_events (customer_id, event_type, score_delta, source, details)
      VALUES (?,?,?,?,?)`)
      .run(customerId, `attr_${attrType}`, rule.score, 'attribute', JSON.stringify({ type: attrType, value: attrValue, label: rule.label }));

    return this.recalculate(customerId);
  }

  /**
   * 重新计算客户总分
   */
  recalculate(customerId) {
    // 清理过期事件
    if (this.rules.decay.enabled) {
      this.db.prepare("DELETE FROM lead_score_events WHERE customer_id=? AND expires_at IS NOT NULL AND expires_at < datetime('now')")
        .run(customerId);
    }

    // 计算总分
    const row = this.db.prepare("SELECT COALESCE(SUM(score_delta),0) as total FROM lead_score_events WHERE customer_id=?")
      .get(customerId);
    const totalScore = Math.max(row.total, this.rules.decay.min_score);

    // 确定等级
    const grade = this._getGrade(totalScore);

    // 更新客户表
    this.db.prepare("UPDATE customers SET lead_score=?, lead_grade=?, score_updated_at=datetime('now') WHERE id=?")
      .run(totalScore, grade.key, customerId);

    return { customerId, score: totalScore, grade: grade.key, gradeLabel: grade.label, gradeColor: grade.color, action: grade.action };
  }

  /**
   * 批量重算所有客户评分
   */
  recalculateAll() {
    const customers = this.db.prepare("SELECT id FROM customers").all();
    let updated = 0;
    for (const c of customers) {
      this.recalculate(c.id);
      updated++;
    }
    return updated;
  }

  /**
   * 获取客户评分详情
   */
  getScoreDetail(customerId) {
    const events = this.db.prepare(
      "SELECT * FROM lead_score_events WHERE customer_id=? ORDER BY created_at DESC"
    ).all(customerId);

    const customer = this.db.prepare("SELECT id,company,contact_name,lead_score,lead_grade FROM customers WHERE id=?")
      .get(customerId);

    const behaviorTotal = events.filter(e => !e.event_type.startsWith('attr_'))
      .reduce((s,e) => s + e.score_delta, 0);
    const attributeTotal = events.filter(e => e.event_type.startsWith('attr_'))
      .reduce((s,e) => s + e.score_delta, 0);

    return {
      customer,
      score: customer?.lead_score || 0,
      grade: customer?.lead_grade || 'cold',
      behaviorScore: behaviorTotal,
      attributeScore: attributeTotal,
      events,
      gradeInfo: this._getGrade(customer?.lead_score || 0)
    };
  }

  /**
   * 获取线索排行榜
   */
  getLeaderboard(limit = 50) {
    return this.db.prepare(`
      SELECT c.id, c.company, c.contact_name, c.email, c.phone, c.country, c.stage, c.source,
             c.lead_score, c.lead_grade, c.score_updated_at,
             (SELECT COUNT(*) FROM lead_score_events WHERE customer_id=c.id) as event_count
      FROM customers c
      WHERE c.lead_score > 0
      ORDER BY c.lead_score DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * 获取各等级统计
   */
  getGradeStats() {
    const stats = {};
    for (const [key, t] of Object.entries(this.rules.thresholds)) {
      const count = this.db.prepare(
        "SELECT COUNT(*) as c FROM customers WHERE lead_score >= ? AND lead_score <= ?"
      ).get(t.min, t.max);
      stats[key] = { ...t, count: count.c };
    }
    return stats;
  }

  _getGrade(score) {
    for (const [key, t] of Object.entries(this.rules.thresholds)) {
      if (score >= t.min && score <= t.max) {
        return { key, ...t };
      }
    }
    return { key: 'cold', ...this.rules.thresholds.cold };
  }

  _checkAutomation(customerId, result) {
    const auto = this.rules.automation;
    if (!auto) return;

    const customer = this.db.prepare("SELECT company,contact_name FROM customers WHERE id=?").get(customerId);
    const name = customer?.contact_name || customer?.company || `#${customerId}`;

    if (result.grade === 'hot' && auto.notify_on_hot) {
      this._notify('🔥 热线索！', `${name} 评分达到 ${result.score}，立即跟进！`, customerId);
    } else if (result.grade === 'sql' && auto.notify_on_sql) {
      this._notify('🟠 SQL销售合格', `${name} 评分 ${result.score}，建议销售主动跟进`, customerId);
    } else if (result.grade === 'mql' && auto.notify_on_mql) {
      this._notify('🔵 MQL营销合格', `${name} 评分 ${result.score}，加强培育`, customerId);
    }

    // 自动更新CRM阶段
    if (auto.auto_stage_update) {
      const stageMap = { hot: 'qualified', sql: 'qualified', mql: 'engaged', warm: 'contacted' };
      if (stageMap[result.grade]) {
        this.db.prepare("UPDATE customers SET stage=? WHERE id=? AND stage='new'")
          .run(stageMap[result.grade], customerId);
      }
    }
  }

  _notify(title, message, customerId) {
    if (this.io) {
      this.io.emit('notification', {
        type: 'lead_score',
        data: { title, message, customerId },
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = { LeadScoringEngine, DEFAULT_SCORING_RULES };
