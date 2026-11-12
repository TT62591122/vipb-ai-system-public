/**
 * LinkedIn 自动化外展引擎
 * 自动化序列：浏览 → 连接 → 消息 → 跟进
 * 集成防封引擎 + CRM + 线索评分
 */

class LinkedInAutomation {
  constructor(db, io, antiban, leadScoring) {
    this.db = db;
    this.io = io;
    this.antiban = antiban;
    this.leadScoring = leadScoring;
    this._initTables();
  }

  _initTables() {
    this.db.exec(`
      -- LinkedIn 目标客户
      CREATE TABLE IF NOT EXISTS li_prospects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        linkedin_url TEXT UNIQUE,
        full_name TEXT,
        headline TEXT,
        company TEXT,
        location TEXT,
        industry TEXT,
        connection_status TEXT DEFAULT 'none',
        tags TEXT DEFAULT '[]',
        sequence_id INTEGER,
        sequence_step INTEGER DEFAULT 0,
        last_action TEXT,
        last_action_at DATETIME,
        next_action TEXT,
        next_action_at DATETIME,
        reply_received INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- LinkedIn 外展序列模板
      CREATE TABLE IF NOT EXISTS li_sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        target_industry TEXT,
        target_region TEXT,
        steps TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        total_enrolled INTEGER DEFAULT 0,
        total_replied INTEGER DEFAULT 0,
        total_connected INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- LinkedIn 操作日志
      CREATE TABLE IF NOT EXISTS li_action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prospect_id INTEGER,
        sequence_id INTEGER,
        step_index INTEGER,
        action_type TEXT,
        content TEXT,
        status TEXT DEFAULT 'completed',
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_li_prospects_status ON li_prospects(connection_status);
      CREATE INDEX IF NOT EXISTS idx_li_prospects_sequence ON li_prospects(sequence_id);
      CREATE INDEX IF NOT EXISTS idx_li_prospects_next ON li_prospects(next_action_at);
      CREATE INDEX IF NOT EXISTS idx_li_logs_prospect ON li_action_logs(prospect_id);
    `);
  }

  // ========== 序列管理 ==========

  /** 创建外展序列 */
  createSequence(data) {
    const steps = data.steps || this._getDefaultSteps(data.target_industry);
    const r = this.db.prepare(`INSERT INTO li_sequences (name,description,target_industry,target_region,steps)
      VALUES (?,?,?,?,?)`)
      .run(data.name, data.description || '', data.target_industry || '', data.target_region || '', JSON.stringify(steps));
    return { id: r.lastInsertRowid, ...data, steps };
  }

  /** 获取所有序列 */
  getSequences() {
    const seqs = this.db.prepare('SELECT * FROM li_sequences ORDER BY created_at DESC').all();
    return seqs.map(s => ({ ...s, steps: JSON.parse(s.steps || '[]') }));
  }

  /** 更新序列 */
  updateSequence(id, data) {
    const updates = [];
    const params = [];
    if (data.name) { updates.push('name=?'); params.push(data.name); }
    if (data.description !== undefined) { updates.push('description=?'); params.push(data.description); }
    if (data.steps) { updates.push('steps=?'); params.push(JSON.stringify(data.steps)); }
    if (data.is_active !== undefined) { updates.push('is_active=?'); params.push(data.is_active ? 1 : 0); }
    if (updates.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE li_sequences SET ${updates.join(',')} WHERE id=?`).run(...params);
  }

  /** 删除序列 */
  deleteSequence(id) {
    this.db.prepare('DELETE FROM li_sequences WHERE id=?').run(id);
    this.db.prepare('UPDATE li_prospects SET sequence_id=NULL, sequence_step=0 WHERE sequence_id=?').run(id);
  }

  // ========== 目标客户管理 ==========

  /** 添加目标客户 */
  addProspect(data) {
    try {
      const r = this.db.prepare(`INSERT OR IGNORE INTO li_prospects 
        (linkedin_url, full_name, headline, company, location, industry, tags)
        VALUES (?,?,?,?,?,?,?)`)
        .run(data.linkedin_url, data.full_name || '', data.headline || '', data.company || '',
          data.location || '', data.industry || '', JSON.stringify(data.tags || []));
      return { id: r.lastInsertRowid, success: r.changes > 0 };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  /** 批量添加 */
  addProspectsBatch(prospects) {
    let added = 0, skipped = 0;
    const insert = this.db.prepare(`INSERT OR IGNORE INTO li_prospects 
      (linkedin_url, full_name, headline, company, location, industry, tags)
      VALUES (?,?,?,?,?,?,?)`);
    
    const tx = this.db.transaction((list) => {
      for (const p of list) {
        const r = insert.run(p.linkedin_url, p.full_name || '', p.headline || '',
          p.company || '', p.location || '', p.industry || '', JSON.stringify(p.tags || []));
        if (r.changes > 0) added++; else skipped++;
      }
    });
    tx(prospects);
    return { added, skipped, total: prospects.length };
  }

  /** 获取目标客户列表 */
  getProspects(filters = {}) {
    let where = '1=1';
    const params = [];

    if (filters.search) {
      where += ' AND (full_name LIKE ? OR company LIKE ? OR headline LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }
    if (filters.status) { where += ' AND connection_status=?'; params.push(filters.status); }
    if (filters.sequence_id) { where += ' AND sequence_id=?'; params.push(filters.sequence_id); }
    if (filters.has_replied !== undefined) { where += ' AND reply_received=?'; params.push(filters.has_replied ? 1 : 0); }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM li_prospects WHERE ${where}`).get(...params).c;
    const data = this.db.prepare(`SELECT * FROM li_prospects WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** 删除目标客户 */
  deleteProspect(id) {
    this.db.prepare('DELETE FROM li_prospects WHERE id=?').run(id);
    this.db.prepare('DELETE FROM li_action_logs WHERE prospect_id=?').run(id);
  }

  // ========== 序列执行 ==========

  /** 将客户加入序列 */
  enrollInSequence(prospectIds, sequenceId) {
    const seq = this.db.prepare('SELECT * FROM li_sequences WHERE id=?').get(sequenceId);
    if (!seq) return { error: '序列不存在' };

    const steps = JSON.parse(seq.steps || '[]');
    if (steps.length === 0) return { error: '序列没有步骤' };

    let enrolled = 0;
    const now = new Date();
    const firstActionAt = new Date(now.getTime() + (steps[0].delay_hours || 0) * 3600000);

    for (const pid of prospectIds) {
      const r = this.db.prepare(`UPDATE li_prospects SET 
        sequence_id=?, sequence_step=0, next_action=?, next_action_at=?, updated_at=datetime('now')
        WHERE id=? AND (sequence_id IS NULL OR sequence_id=0)`)
        .run(sequenceId, steps[0].action, firstActionAt.toISOString(), pid);
      if (r.changes > 0) enrolled++;
    }

    this.db.prepare('UPDATE li_sequences SET total_enrolled=total_enrolled+? WHERE id=?')
      .run(enrolled, sequenceId);

    return { enrolled, sequenceId };
  }

  /** 从序列中移除 */
  unenrollFromSequence(prospectId) {
    this.db.prepare("UPDATE li_prospects SET sequence_id=NULL, sequence_step=0, next_action=NULL, next_action_at=NULL WHERE id=?")
      .run(prospectId);
  }

  /** 处理到期的序列动作（由cron调用） */
  processSequenceQueue() {
    const pending = this.db.prepare(`
      SELECT p.*, s.steps as seq_steps, s.name as seq_name
      FROM li_prospects p
      JOIN li_sequences s ON p.sequence_id = s.id
      WHERE p.next_action_at <= datetime('now')
        AND p.next_action IS NOT NULL
        AND s.is_active = 1
        AND p.reply_received = 0
      ORDER BY p.next_action_at ASC
      LIMIT 10
    `).all();

    const results = { processed: 0, skipped: 0, errors: 0 };

    for (const prospect of pending) {
      const steps = JSON.parse(prospect.seq_steps || '[]');
      const currentStep = steps[prospect.sequence_step];
      if (!currentStep) {
        // 序列完成
        this.db.prepare("UPDATE li_prospects SET next_action=NULL, next_action_at=NULL WHERE id=?")
          .run(prospect.id);
        continue;
      }

      // 防封检查
      if (this.antiban) {
        const check = this.antiban.check('linkedin', 'default', currentStep.action, {});
        if (!check.allowed) {
          results.skipped++;
          continue;
        }
      }

      // 执行动作（记录日志，实际发送需要用户手动或通过浏览器自动化）
      this._logAction(prospect.id, prospect.sequence_id, prospect.sequence_step, currentStep);

      // 推进到下一步
      const nextStepIdx = prospect.sequence_step + 1;
      if (nextStepIdx < steps.length) {
        const nextStep = steps[nextStepIdx];
        const nextAt = new Date(Date.now() + (nextStep.delay_hours || 24) * 3600000);
        this.db.prepare(`UPDATE li_prospects SET 
          sequence_step=?, last_action=?, last_action_at=datetime('now'),
          next_action=?, next_action_at=?, updated_at=datetime('now')
          WHERE id=?`)
          .run(nextStepIdx, currentStep.action, nextStep.action, nextAt.toISOString(), prospect.id);
      } else {
        // 序列结束
        this.db.prepare(`UPDATE li_prospects SET 
          sequence_step=?, last_action=?, last_action_at=datetime('now'),
          next_action='completed', next_action_at=NULL, updated_at=datetime('now')
          WHERE id=?`)
          .run(nextStepIdx, currentStep.action, prospect.id);
      }

      if (this.antiban) this.antiban.recordAction('linkedin', 'default', currentStep.action);
      results.processed++;
    }

    return results;
  }

  /** 标记客户已回复 */
  markReplied(prospectId) {
    this.db.prepare("UPDATE li_prospects SET reply_received=1, next_action='replied', next_action_at=NULL, updated_at=datetime('now') WHERE id=?")
      .run(prospectId);

    // 更新序列统计
    const p = this.db.prepare('SELECT sequence_id, customer_id FROM li_prospects WHERE id=?').get(prospectId);
    if (p?.sequence_id) {
      this.db.prepare('UPDATE li_sequences SET total_replied=total_replied+1 WHERE id=?').run(p.sequence_id);
    }

    // 线索评分
    if (p?.customer_id && this.leadScoring) {
      this.leadScoring.recordEvent(p.customer_id, 'linkedin_reply', { source: 'linkedin_automation' });
    }
  }

  /** 标记已连接 */
  markConnected(prospectId) {
    this.db.prepare("UPDATE li_prospects SET connection_status='connected', updated_at=datetime('now') WHERE id=?")
      .run(prospectId);

    const p = this.db.prepare('SELECT sequence_id, customer_id FROM li_prospects WHERE id=?').get(prospectId);
    if (p?.sequence_id) {
      this.db.prepare('UPDATE li_sequences SET total_connected=total_connected+1 WHERE id=?').run(p.sequence_id);
    }
    if (p?.customer_id && this.leadScoring) {
      this.leadScoring.recordEvent(p.customer_id, 'linkedin_connect', { source: 'linkedin_automation' });
    }
  }

  /** 关联CRM客户 */
  linkCustomer(prospectId, customerId) {
    this.db.prepare('UPDATE li_prospects SET customer_id=? WHERE id=?').run(customerId, prospectId);
  }

  // ========== 统计 ==========

  getStats() {
    return {
      totalProspects: this.db.prepare('SELECT COUNT(*) as c FROM li_prospects').get().c,
      connected: this.db.prepare("SELECT COUNT(*) as c FROM li_prospects WHERE connection_status='connected'").get().c,
      pending: this.db.prepare("SELECT COUNT(*) as c FROM li_prospects WHERE connection_status='pending'").get().c,
      replied: this.db.prepare('SELECT COUNT(*) as c FROM li_prospects WHERE reply_received=1').get().c,
      inSequence: this.db.prepare('SELECT COUNT(*) as c FROM li_prospects WHERE sequence_id IS NOT NULL AND next_action IS NOT NULL').get().c,
      sequenceCount: this.db.prepare('SELECT COUNT(*) as c FROM li_sequences WHERE is_active=1').get().c,
      todayActions: this.db.prepare("SELECT COUNT(*) as c FROM li_action_logs WHERE created_at >= date('now')").get().c,
    };
  }

  getActionLogs(prospectId, limit = 20) {
    return this.db.prepare('SELECT * FROM li_action_logs WHERE prospect_id=? ORDER BY created_at DESC LIMIT ?')
      .all(prospectId, limit);
  }

  // ========== 内部方法 ==========

  _logAction(prospectId, sequenceId, stepIndex, step) {
    this.db.prepare(`INSERT INTO li_action_logs (prospect_id, sequence_id, step_index, action_type, content)
      VALUES (?,?,?,?,?)`)
      .run(prospectId, sequenceId, stepIndex, step.action, step.content || '');
    
    // 通知
    if (this.io) {
      this.io.emit('notification', {
        type: 'linkedin_action',
        data: { prospectId, action: step.action, step: stepIndex },
        timestamp: new Date().toISOString()
      });
    }
  }

  _getDefaultSteps(industry) {
    return [
      {
        action: 'view_profile',
        delay_hours: 0,
        content: '',
        note: '浏览目标资料，引起注意'
      },
      {
        action: 'connect',
        delay_hours: 24,
        content: `Hi {name}, I came across your profile and was impressed by your work in the ${industry || 'energy'} sector. We specialize in smart metering solutions and circuit breakers for utilities worldwide. Would love to connect!`,
        note: '发送个性化连接请求'
      },
      {
        action: 'message',
        delay_hours: 72,
        content: `Thanks for connecting, {name}! I wanted to share that we recently completed a 50,000+ smart meter deployment in {region}. Our STS/DLMS compliant meters are certified to IEC standards.\n\nWould you be interested in learning more about our solutions for {company}?`,
        note: '连接后发感谢+价值消息'
      },
      {
        action: 'share_content',
        delay_hours: 168,
        content: `Hi {name}, I thought you might find this interesting - we just published a case study on smart prepaid metering adoption in Africa. Key findings:\n\n• 30% reduction in non-technical losses\n• 99.8% uptime over 12 months\n• Full DLMS/COSEM compliance\n\nHappy to share the full report if interested!`,
        note: '分享行业内容/白皮书'
      },
      {
        action: 'followup',
        delay_hours: 336,
        content: `Hi {name}, just circling back. Would you have 15 minutes for a quick call to discuss how our smart metering solutions could benefit {company}?\n\nWe offer:\n✅ Competitive pricing (MOQ from 100 units)\n✅ Full certification support\n✅ Customized solutions\n\nLet me know what works for you!`,
        note: '最终跟进，邀请通话'
      }
    ];
  }
}

module.exports = { LinkedInAutomation };
