/**
 * 多渠道序列引擎
 * - 定义跨渠道触达序列（Email → LinkedIn → WhatsApp → Email跟进）
 * - 自动按时间间隔执行下一步
 * - 客户回复自动暂停序列
 * - 意图检测集成（报价意图→暂停→创建待办）
 * - 支持模板变量替换
 * 
 * 序列示例：
 *   Day 0: Email 首次触达
 *   Day 3: LinkedIn 连接请求
 *   Day 5: Email 跟进1
 *   Day 8: WhatsApp 产品介绍
 *   Day 12: Email 跟进2（最终）
 */

class MultichannelSequence {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    // 序列模板
    this.db.prepare(`CREATE TABLE IF NOT EXISTS sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();

    // 序列执行实例（每个客户一个）
    this.db.prepare(`CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence_id INTEGER NOT NULL,
      customer_id INTEGER,
      customer_email TEXT,
      customer_name TEXT,
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      pause_reason TEXT,
      variables TEXT,
      next_execute_at TEXT,
      last_executed_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();

    // 步骤执行日志
    this.db.prepare(`CREATE TABLE IF NOT EXISTS sequence_step_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      channel TEXT NOT NULL,
      action TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      error TEXT,
      executed_at TEXT DEFAULT (datetime('now'))
    )`).run();

    try {
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_se_status ON sequence_enrollments(status)').run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_se_next ON sequence_enrollments(next_execute_at)').run();
    } catch(e) {}

    // 插入默认序列模板
    this._seedDefaults();
  }

  _seedDefaults() {
    const existing = this.db.prepare("SELECT COUNT(*) as c FROM sequences").get().c;
    if (existing > 0) return;

    const defaultSequences = [
      {
        name: '外贸新客户开发序列',
        description: '5步跨渠道触达：Email→LinkedIn→Email跟进→WhatsApp→最终Email',
        steps: JSON.stringify([
          { day: 0, channel: 'email', action: 'send', template: 'intro', subject: 'Partnership Opportunity - Smart Meters & Circuit Breakers', description: '首次邮件介绍' },
          { day: 3, channel: 'linkedin', action: 'connect', message: 'Hi {name}, I noticed your work in the energy sector. We manufacture smart meters and circuit breakers with IEC/CE certifications. Would love to connect!', description: 'LinkedIn连接请求' },
          { day: 5, channel: 'email', action: 'send', template: 'followup1', subject: 'Following up - Smart Meter Solutions', description: '邮件跟进1' },
          { day: 8, channel: 'whatsapp', action: 'send', message: 'Hi {name}, this is {company}. We sent you an email about our smart meters and circuit breakers. Would you like to see our product catalog?', description: 'WhatsApp产品介绍' },
          { day: 12, channel: 'email', action: 'send', template: 'followup_final', subject: 'Last follow-up - Exclusive offer for {company_name}', description: '最终跟进邮件' }
        ])
      },
      {
        name: '询盘跟进序列',
        description: '客户询盘后的自动跟进：确认→报价提醒→跟进',
        steps: JSON.stringify([
          { day: 0, channel: 'email', action: 'send', template: 'inquiry_ack', subject: 'Thank you for your inquiry - {product}', description: '询盘确认' },
          { day: 2, channel: 'email', action: 'send', template: 'quote_reminder', subject: 'Your quotation is ready - {product}', description: '报价已发提醒（需人工先报价）' },
          { day: 5, channel: 'whatsapp', action: 'send', message: 'Hi {name}, did you receive our quotation for {product}? Let me know if you have any questions.', description: 'WhatsApp跟进' },
          { day: 10, channel: 'email', action: 'send', template: 'followup_gentle', subject: 'Checking in - {product} quotation', description: '温和跟进' }
        ])
      }
    ];

    for (const seq of defaultSequences) {
      this.db.prepare("INSERT INTO sequences (name, description, steps) VALUES (?, ?, ?)")
        .run(seq.name, seq.description, seq.steps);
    }
  }

  /**
   * 创建序列模板
   */
  createSequence(name, description, steps) {
    const result = this.db.prepare("INSERT INTO sequences (name, description, steps) VALUES (?, ?, ?)")
      .run(name, description, JSON.stringify(steps));
    return result.lastInsertRowid;
  }

  /**
   * 将客户加入序列
   */
  enroll(sequenceId, customer, variables = {}) {
    // 检查是否已在同一序列中
    const existing = this.db.prepare(
      "SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND customer_email = ? AND status = 'active'"
    ).get(sequenceId, customer.email);
    if (existing) {
      return { success: false, error: '客户已在此序列中', enrollmentId: existing.id };
    }

    const sequence = this.db.prepare("SELECT * FROM sequences WHERE id = ?").get(sequenceId);
    if (!sequence) return { success: false, error: '序列不存在' };

    const steps = JSON.parse(sequence.steps);
    const firstStep = steps[0];
    const nextExecuteAt = this._calculateNextTime(firstStep.day);

    const result = this.db.prepare(`INSERT INTO sequence_enrollments 
      (sequence_id, customer_id, customer_email, customer_name, current_step, status, variables, next_execute_at)
      VALUES (?, ?, ?, ?, 0, 'active', ?, ?)`)
      .run(sequenceId, customer.id || null, customer.email, customer.name || null, JSON.stringify(variables), nextExecuteAt);

    return { success: true, enrollmentId: result.lastInsertRowid };
  }

  /**
   * 获取到期需要执行的步骤
   */
  getDueSteps() {
    const enrollments = this.db.prepare(`
      SELECT se.*, s.steps as sequence_steps, s.name as sequence_name
      FROM sequence_enrollments se
      JOIN sequences s ON se.sequence_id = s.id
      WHERE se.status = 'active' AND se.next_execute_at <= datetime('now')
      ORDER BY se.next_execute_at ASC
    `).all();

    return enrollments.map(e => {
      const steps = JSON.parse(e.sequence_steps);
      const currentStep = steps[e.current_step];
      const variables = e.variables ? JSON.parse(e.variables) : {};
      return { enrollment: e, step: currentStep, stepIndex: e.current_step, totalSteps: steps.length, variables };
    });
  }

  /**
   * 执行一个步骤（由调度器调用）
   * 注意：实际发送由各渠道执行器完成，这里只负责调度和记录
   */
  async executeStep(enrollmentId, result = {}) {
    const enrollment = this.db.prepare(`
      SELECT se.*, s.steps as sequence_steps
      FROM sequence_enrollments se JOIN sequences s ON se.sequence_id = s.id
      WHERE se.id = ?
    `).get(enrollmentId);
    
    if (!enrollment || enrollment.status !== 'active') return;

    const steps = JSON.parse(enrollment.sequence_steps);
    const stepIndex = enrollment.current_step;

    // 记录执行日志
    this.db.prepare(`INSERT INTO sequence_step_log 
      (enrollment_id, step_index, channel, action, status, result)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(enrollmentId, stepIndex, steps[stepIndex]?.channel || 'unknown', steps[stepIndex]?.action || 'send', result.success ? 'sent' : 'failed', JSON.stringify(result));

    // 推进到下一步
    const nextStep = stepIndex + 1;
    if (nextStep >= steps.length) {
      // 序列完成
      this.db.prepare(`UPDATE sequence_enrollments SET status = 'completed', current_step = ?, completed_at = datetime('now'), last_executed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(nextStep, enrollmentId);
    } else {
      const nextExecuteAt = this._calculateNextTime(steps[nextStep].day, enrollment.created_at);
      this.db.prepare(`UPDATE sequence_enrollments SET current_step = ?, next_execute_at = ?, last_executed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(nextStep, nextExecuteAt, enrollmentId);
    }
  }

  /**
   * 暂停序列（客户回复时调用）
   */
  pause(enrollmentId, reason = '客户已回复') {
    this.db.prepare(`UPDATE sequence_enrollments SET status = 'paused', pause_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(reason, enrollmentId);
  }

  /**
   * 恢复序列
   */
  resume(enrollmentId) {
    const enrollment = this.db.prepare("SELECT * FROM sequence_enrollments WHERE id = ?").get(enrollmentId);
    if (!enrollment) return;
    this.db.prepare(`UPDATE sequence_enrollments SET status = 'active', pause_reason = NULL, next_execute_at = datetime('now', '+1 hours'), updated_at = datetime('now') WHERE id = ?`)
      .run(enrollmentId);
  }

  /**
   * 取消序列
   */
  cancel(enrollmentId) {
    this.db.prepare(`UPDATE sequence_enrollments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`)
      .run(enrollmentId);
  }

  /**
   * 客户回复时自动暂停相关序列
   */
  onCustomerReply(customerEmail) {
    const active = this.db.prepare(
      "SELECT id FROM sequence_enrollments WHERE customer_email = ? AND status = 'active'"
    ).all(customerEmail);
    for (const e of active) {
      this.pause(e.id, '客户已回复');
    }
    return active.length;
  }

  /**
   * 列出序列模板
   */
  listSequences() {
    return this.db.prepare("SELECT id, name, description, is_active, created_at FROM sequences ORDER BY id").all();
  }

  /**
   * 列出执行中的enrollment
   */
  listEnrollments(opts = {}) {
    let sql = 'SELECT se.*, s.name as sequence_name FROM sequence_enrollments se JOIN sequences s ON se.sequence_id = s.id WHERE 1=1';
    const params = [];
    if (opts.status) { sql += ' AND se.status = ?'; params.push(opts.status); }
    if (opts.sequenceId) { sql += ' AND se.sequence_id = ?'; params.push(opts.sequenceId); }
    sql += ' ORDER BY se.created_at DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return this.db.prepare(sql).all(...params);
  }

  /**
   * 统计
   */
  getStats() {
    const active = this.db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'active'").get().c;
    const completed = this.db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'completed'").get().c;
    const paused = this.db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'paused'").get().c;
    const dueNow = this.db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'active' AND next_execute_at <= datetime('now')").get().c;
    return { active, completed, paused, dueNow };
  }

  _calculateNextTime(dayOffset, baseTime = null) {
    const base = baseTime ? new Date(baseTime + 'Z') : new Date();
    base.setDate(base.getDate() + dayOffset);
    // 随机化时间（工作时间 9:00-17:00）
    base.setHours(9 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);
    return base.toISOString().replace('T', ' ').substring(0, 19);
  }
}

module.exports = { MultichannelSequence };
