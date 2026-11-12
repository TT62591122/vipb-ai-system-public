/**
 * 客户旅程自动化引擎 (Customer Journey Automation)
 * 可视化流程编排：触发器 → 条件 → 动作
 */

const { EmailSender } = require('./email-sender');
const { decrypt } = require('./crypto-utils');

class JourneyEngine {
  constructor(db, io, leadScoring) {
    this.db = db;
    this.io = io;
    this.leadScoring = leadScoring;
    this._initTables();
  }

  _initTables() {
    this.db.exec(`
      -- 旅程流程定义
      CREATE TABLE IF NOT EXISTS journeys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        trigger_type TEXT NOT NULL,
        trigger_config TEXT DEFAULT '{}',
        steps TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 0,
        total_entered INTEGER DEFAULT 0,
        total_completed INTEGER DEFAULT 0,
        total_converted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 客户在旅程中的状态
      CREATE TABLE IF NOT EXISTS journey_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journey_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        current_step INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        next_action_at DATETIME,
        completed_at DATETIME,
        data TEXT DEFAULT '{}',
        UNIQUE(journey_id, customer_id)
      );

      -- 旅程动作日志
      CREATE TABLE IF NOT EXISTS journey_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journey_id INTEGER,
        customer_id INTEGER,
        step_index INTEGER,
        action_type TEXT,
        action_detail TEXT DEFAULT '',
        result TEXT DEFAULT 'ok',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_journey_enroll_status ON journey_enrollments(status);
      CREATE INDEX IF NOT EXISTS idx_journey_enroll_next ON journey_enrollments(next_action_at);
      CREATE INDEX IF NOT EXISTS idx_journey_logs_jid ON journey_logs(journey_id);
    `);
  }

  // ========== 旅程CRUD ==========

  createJourney(data) {
    const steps = data.steps || [];
    const r = this.db.prepare(`INSERT INTO journeys (name,description,trigger_type,trigger_config,steps,is_active)
      VALUES (?,?,?,?,?,?)`)
      .run(data.name, data.description || '', data.trigger_type,
        JSON.stringify(data.trigger_config || {}), JSON.stringify(steps), data.is_active ? 1 : 0);
    return { id: r.lastInsertRowid };
  }

  getJourneys() {
    return this.db.prepare('SELECT * FROM journeys ORDER BY created_at DESC').all()
      .map(j => ({ ...j, trigger_config: JSON.parse(j.trigger_config || '{}'), steps: JSON.parse(j.steps || '[]') }));
  }

  getJourney(id) {
    const j = this.db.prepare('SELECT * FROM journeys WHERE id=?').get(id);
    if (!j) return null;
    return { ...j, trigger_config: JSON.parse(j.trigger_config || '{}'), steps: JSON.parse(j.steps || '[]') };
  }

  updateJourney(id, data) {
    const updates = []; const params = [];
    if (data.name) { updates.push('name=?'); params.push(data.name); }
    if (data.description !== undefined) { updates.push('description=?'); params.push(data.description); }
    if (data.trigger_type) { updates.push('trigger_type=?'); params.push(data.trigger_type); }
    if (data.trigger_config) { updates.push('trigger_config=?'); params.push(JSON.stringify(data.trigger_config)); }
    if (data.steps) { updates.push('steps=?'); params.push(JSON.stringify(data.steps)); }
    if (data.is_active !== undefined) { updates.push('is_active=?'); params.push(data.is_active ? 1 : 0); }
    if (updates.length === 0) return;
    updates.push("updated_at=datetime('now')");
    params.push(id);
    this.db.prepare(`UPDATE journeys SET ${updates.join(',')} WHERE id=?`).run(...params);
  }

  deleteJourney(id) {
    this.db.prepare('DELETE FROM journeys WHERE id=?').run(id);
    this.db.prepare('DELETE FROM journey_enrollments WHERE journey_id=?').run(id);
    this.db.prepare('DELETE FROM journey_logs WHERE journey_id=?').run(id);
  }

  // ========== 触发与执行 ==========

  /** 
   * 触发事件（由外部模块调用）
   * @param {string} eventType - new_lead | lead_score_change | whatsapp_msg | email_open | form_submit | manual
   * @param {object} eventData - { customer_id, ... }
   */
  triggerEvent(eventType, eventData) {
    const journeys = this.db.prepare("SELECT * FROM journeys WHERE is_active=1 AND trigger_type=?").all(eventType);
    let enrolled = 0;

    for (const j of journeys) {
      const config = JSON.parse(j.trigger_config || '{}');
      
      // 检查触发条件
      if (!this._matchTrigger(config, eventData)) continue;

      // 检查是否已加入
      const existing = this.db.prepare('SELECT id FROM journey_enrollments WHERE journey_id=? AND customer_id=?')
        .get(j.id, eventData.customer_id);
      if (existing) continue;

      // 加入旅程
      const steps = JSON.parse(j.steps || '[]');
      const firstDelay = steps[0]?.delay_hours || 0;
      const nextAt = new Date(Date.now() + firstDelay * 3600000);

      this.db.prepare(`INSERT INTO journey_enrollments (journey_id, customer_id, next_action_at)
        VALUES (?,?,?)`)
        .run(j.id, eventData.customer_id, nextAt.toISOString());

      this.db.prepare('UPDATE journeys SET total_entered=total_entered+1 WHERE id=?').run(j.id);
      this._log(j.id, eventData.customer_id, -1, 'trigger', `入旅程: ${eventType}`);
      enrolled++;
    }
    return enrolled;
  }

  /** 处理到期的旅程步骤（cron调用） */
  async processQueue() {
    const pending = this.db.prepare(`
      SELECT e.*, j.steps as journey_steps, j.name as journey_name
      FROM journey_enrollments e
      JOIN journeys j ON e.journey_id = j.id
      WHERE e.status='active' AND e.next_action_at <= datetime('now') AND j.is_active=1
      ORDER BY e.next_action_at ASC LIMIT 20
    `).all();

    const results = { processed: 0, completed: 0, errors: 0 };

    for (const enrollment of pending) {
      try {
        const steps = JSON.parse(enrollment.journey_steps || '[]');
        const step = steps[enrollment.current_step];

        if (!step) {
          this._complete(enrollment);
          results.completed++;
          continue;
        }

        // 条件检查
        if (step.condition && !this._checkCondition(step.condition, enrollment.customer_id)) {
          // 条件不满足，跳过此步
          this._advanceStep(enrollment, steps);
          this._log(enrollment.journey_id, enrollment.customer_id, enrollment.current_step, 'skip', '条件不满足');
          continue;
        }

        // 执行动作
        await this._executeAction(step, enrollment);
        this._log(enrollment.journey_id, enrollment.customer_id, enrollment.current_step, step.action, step.action_detail || '');

        // 推进
        this._advanceStep(enrollment, steps);
        results.processed++;
      } catch (err) {
        this._log(enrollment.journey_id, enrollment.customer_id, enrollment.current_step, 'error', err.message);
        results.errors++;
      }
    }
    return results;
  }

  /** 手动加入旅程 */
  enrollCustomer(journeyId, customerId) {
    const j = this.getJourney(journeyId);
    if (!j) return { error: '旅程不存在' };

    try {
      const steps = j.steps;
      const firstDelay = steps[0]?.delay_hours || 0;
      const nextAt = new Date(Date.now() + firstDelay * 3600000);

      this.db.prepare(`INSERT OR IGNORE INTO journey_enrollments (journey_id, customer_id, next_action_at)
        VALUES (?,?,?)`)
        .run(journeyId, customerId, nextAt.toISOString());

      this.db.prepare('UPDATE journeys SET total_entered=total_entered+1 WHERE id=?').run(journeyId);
      return { success: true };
    } catch(e) {
      return { error: e.message };
    }
  }

  /** 移出旅程 */
  unenrollCustomer(journeyId, customerId) {
    this.db.prepare("UPDATE journey_enrollments SET status='removed' WHERE journey_id=? AND customer_id=?")
      .run(journeyId, customerId);
  }

  /** 获取旅程中的客户 */
  getEnrollments(journeyId, status = 'active') {
    return this.db.prepare(`
      SELECT e.*, c.company, c.contact_name, c.email, c.lead_score
      FROM journey_enrollments e
      LEFT JOIN customers c ON e.customer_id = c.id
      WHERE e.journey_id=? AND e.status=?
      ORDER BY e.entered_at DESC
    `).all(journeyId, status);
  }

  /** 获取客户的旅程历史 */
  getCustomerJourneys(customerId) {
    return this.db.prepare(`
      SELECT e.*, j.name as journey_name
      FROM journey_enrollments e
      JOIN journeys j ON e.journey_id = j.id
      WHERE e.customer_id=?
      ORDER BY e.entered_at DESC
    `).all(customerId);
  }

  /** 获取旅程日志 */
  getLogs(journeyId, limit = 50) {
    return this.db.prepare('SELECT * FROM journey_logs WHERE journey_id=? ORDER BY created_at DESC LIMIT ?')
      .all(journeyId, limit);
  }

  // ========== 统计 ==========

  getStats() {
    return {
      activeJourneys: this.db.prepare("SELECT COUNT(*) as c FROM journeys WHERE is_active=1").get().c,
      totalEnrolled: this.db.prepare("SELECT COUNT(*) as c FROM journey_enrollments WHERE status='active'").get().c,
      completedToday: this.db.prepare("SELECT COUNT(*) as c FROM journey_enrollments WHERE completed_at >= date('now')").get().c,
      conversionRate: this._calcConversionRate(),
    };
  }

  // ========== 预设旅程模板 ==========

  getTemplates() {
    return [
      {
        name: '新线索培育（电表行业）',
        trigger_type: 'new_lead',
        trigger_config: {},
        steps: [
          { action: 'send_email', delay_hours: 1, action_detail: '发送欢迎邮件 + 公司介绍', template: 'welcome' },
          { action: 'wait', delay_hours: 48, action_detail: '等待2天' },
          { action: 'send_email', delay_hours: 0, action_detail: '发送产品目录PDF', template: 'catalog' },
          { action: 'update_score', delay_hours: 0, action_detail: '加分: catalog_download', event: 'catalog_download' },
          { action: 'wait', delay_hours: 72, action_detail: '等待3天' },
          { action: 'send_whatsapp', delay_hours: 0, action_detail: 'WhatsApp跟进消息', template: 'followup' },
          { action: 'wait', delay_hours: 168, action_detail: '等待1周' },
          { action: 'check_score', delay_hours: 0, condition: { type: 'score_gte', value: 50 }, action_detail: '检查评分>=50' },
          { action: 'assign_sales', delay_hours: 0, action_detail: '分配给销售跟进' },
          { action: 'notify', delay_hours: 0, action_detail: '通知销售团队' },
        ]
      },
      {
        name: '询盘快速响应',
        trigger_type: 'form_submit',
        trigger_config: { form_type: 'inquiry' },
        steps: [
          { action: 'send_email', delay_hours: 0, action_detail: '立即发送确认邮件', template: 'inquiry_confirm' },
          { action: 'update_score', delay_hours: 0, action_detail: '加分: inquiry_submit', event: 'inquiry_submit' },
          { action: 'notify', delay_hours: 0, action_detail: '通知销售有新询盘' },
          { action: 'send_whatsapp', delay_hours: 2, action_detail: 'WhatsApp个性化跟进' },
          { action: 'wait', delay_hours: 24, action_detail: '等待1天' },
          { action: 'send_email', delay_hours: 0, action_detail: '发送报价/技术资料' },
        ]
      },
      {
        name: 'LinkedIn连接后培育',
        trigger_type: 'lead_score_change',
        trigger_config: { event: 'linkedin_connect' },
        steps: [
          { action: 'wait', delay_hours: 24, action_detail: '连接后等1天' },
          { action: 'send_linkedin', delay_hours: 0, action_detail: '发送感谢+公司介绍' },
          { action: 'wait', delay_hours: 72, action_detail: '等3天' },
          { action: 'send_linkedin', delay_hours: 0, action_detail: '分享行业案例' },
          { action: 'wait', delay_hours: 168, action_detail: '等1周' },
          { action: 'send_email', delay_hours: 0, action_detail: '邮件发送完整产品手册', condition: { type: 'has_email' } },
        ]
      }
    ];
  }

  // ========== 内部方法 ==========

  _matchTrigger(config, data) {
    if (config.min_score && data.score < config.min_score) return false;
    if (config.source && data.source !== config.source) return false;
    if (config.event && data.event !== config.event) return false;
    return true;
  }

  _checkCondition(condition, customerId) {
    if (!condition) return true;
    const customer = this.db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
    if (!customer) return false;

    switch (condition.type) {
      case 'score_gte': return (customer.lead_score || 0) >= condition.value;
      case 'score_lt': return (customer.lead_score || 0) < condition.value;
      case 'has_email': return !!customer.email;
      case 'stage_is': return customer.stage === condition.value;
      case 'country_in': return (condition.values || []).includes(customer.country);
      default: return true;
    }
  }

  async _executeAction(step, enrollment) {
    switch (step.action) {
      case 'update_score':
        if (this.leadScoring && step.event) {
          this.leadScoring.recordEvent(enrollment.customer_id, step.event, { source: 'journey' });
        }
        break;
      case 'notify':
        if (this.io) {
          const customer = this.db.prepare('SELECT company,contact_name FROM customers WHERE id=?').get(enrollment.customer_id);
          this.io.emit('notification', {
            type: 'journey_action',
            data: { title: `旅程: ${enrollment.journey_name}`, message: step.action_detail, customer: customer?.contact_name || '' },
            timestamp: new Date().toISOString()
          });
        }
        break;
      case 'assign_sales':
        this.db.prepare("UPDATE customers SET stage='qualified' WHERE id=? AND stage IN ('new','contacted','engaged')")
          .run(enrollment.customer_id);
        break;
      // send_email, send_whatsapp, send_linkedin — 记录日志，实际发送需各渠道引擎
      case 'send_email':
        // 真正发送邮件
        try {
          const customer = this.db.prepare('SELECT email, contact_name, company, country, tags FROM customers WHERE id=?').get(enrollment.customer_id);
          if (customer && customer.email) {
            // 获取AI配置，尝试生成个性化内容
            let subject = step.subject || step.action_detail || '跟进邮件';
            let body = step.body || step.action_detail || '';
            
            // 如果有模板或AI提示词，尝试AI生成
            if (step.ai_prompt || step.template) {
              try {
                const aiRow = this.db.prepare("SELECT value FROM settings WHERE key='ai_provider'").get();
                if (aiRow) {
                  const aiConfig = JSON.parse(aiRow.value);
                  if (aiConfig.enabled && aiConfig.baseUrl && aiConfig.apiKey) {
                    const decryptedConfig = { ...aiConfig, apiKey: aiConfig.apiKey ? decrypt(aiConfig.apiKey) : '' };
                    const axios = require('axios');
                    const { injectProxy } = require('./outbound-proxy');
                    const prompt = step.ai_prompt || `Write a professional B2B email for ${customer.company || 'a client'} in ${customer.country || 'international'} market about: ${step.action_detail}. Keep it 2-3 paragraphs, warm but professional. Return JSON: {"subject":"...","body":"..."}`;
                    const apiUrl = decryptedConfig.baseUrl.replace(/\/+$/, '') + '/v1/chat/completions';
                    const resp = await axios.post(apiUrl, {
                      model: decryptedConfig.model || 'gpt-4o-mini',
                      messages: [{ role: 'user', content: prompt }],
                      temperature: 0.7
                    }, injectProxy(this.db, {
                      headers: { 'Authorization': `Bearer ${decryptedConfig.apiKey}`, 'Content-Type': 'application/json' },
                      timeout: 30000
                    }));
                    const aiContent = resp.data.choices?.[0]?.message?.content || '';
                    const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      const parsed = JSON.parse(jsonMatch[0]);
                      subject = parsed.subject || subject;
                      body = parsed.body || body;
                    }
                  }
                }
              } catch(aiErr) {
                // AI生成失败，使用原始内容
                console.log('[Journey] AI邮件生成失败，使用默认内容:', aiErr.message);
              }
            }
            
            // 添加称呼
            const salutation = customer.contact_name ? `Dear ${customer.contact_name},\n\n` : 'Dear Sir/Madam,\n\n';
            const fullBody = salutation + body;
            
            // 创建邮件记录并发送
            const r = this.db.prepare("INSERT INTO emails (customer_id, to_addr, subject, body, status, created_at) VALUES (?,?,?,?,'queued',datetime('now'))")
              .run(enrollment.customer_id, customer.email, subject, fullBody);
            
            // 异步发送（不阻塞旅程推进）
            setImmediate(async () => {
              try {
                const sender = new EmailSender(this.db);
                await sender.sendEmail(r.lastInsertRowid);
                sender.closeAll();
              } catch(e) {
                console.error('[Journey] 邮件发送失败:', e.message);
              }
            });
          }
        } catch(e) {
          console.error('[Journey] send_email执行失败:', e.message);
        }
        break;
      case 'send_whatsapp':
      case 'send_linkedin':
      case 'share_content':
        // 待集成各渠道发送引擎
        break;
      case 'wait':
      case 'check_score':
        break;
    }
  }

  _advanceStep(enrollment, steps) {
    const nextIdx = enrollment.current_step + 1;
    if (nextIdx >= steps.length) {
      this._complete(enrollment);
    } else {
      const nextDelay = steps[nextIdx].delay_hours || 0;
      const nextAt = new Date(Date.now() + nextDelay * 3600000);
      this.db.prepare("UPDATE journey_enrollments SET current_step=?, next_action_at=? WHERE id=?")
        .run(nextIdx, nextAt.toISOString(), enrollment.id);
    }
  }

  _complete(enrollment) {
    this.db.prepare("UPDATE journey_enrollments SET status='completed', completed_at=datetime('now') WHERE id=?")
      .run(enrollment.id);
    this.db.prepare('UPDATE journeys SET total_completed=total_completed+1 WHERE id=?')
      .run(enrollment.journey_id);
  }

  _log(journeyId, customerId, stepIndex, actionType, detail) {
    this.db.prepare('INSERT INTO journey_logs (journey_id,customer_id,step_index,action_type,action_detail) VALUES (?,?,?,?,?)')
      .run(journeyId, customerId, stepIndex, actionType, detail);
  }

  _calcConversionRate() {
    const total = this.db.prepare("SELECT COUNT(*) as c FROM journey_enrollments").get().c;
    const converted = this.db.prepare("SELECT COUNT(*) as c FROM journey_enrollments WHERE status='completed'").get().c;
    return total > 0 ? Math.round(converted / total * 100) : 0;
  }
}

module.exports = { JourneyEngine };
