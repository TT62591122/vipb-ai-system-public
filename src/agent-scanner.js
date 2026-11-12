/**
 * Agent Scanner — 自动巡检引擎
 * 
 * 定时扫描CRM，发现需要跟进的客户，交给决策引擎处理
 * 受Agent模块开关和成本控制约束
 * 
 * 冲突排除：
 * - 排除已在邮件序列(sequence_enrollments)中的客户
 * - 排除已在客户旅程(journey_enrollments)中的客户
 * - 排除auto-replier已处理的邮件(ai_reply_id不为空)
 * - 各渠道扫描前检查对应模块开关
 */

const { v4: uuidv4 } = require('uuid');
const { getAgentMemory } = require('./agent-memory');
const { getCostController } = require('./cost-controller');
const { AgentDecision } = require('./agent-decision');
const { AgentLearner } = require('./agent-learner');

class AgentScanner {
  constructor(db, io, options = {}) {
    this.db = db;
    this.io = io;
    this.memory = getAgentMemory(db);
    this.costCtrl = getCostController(db);
    this.decision = new AgentDecision(db, io);
    this.learner = new AgentLearner(db);
    this.aiBrain = options.aiBrain || null;
    this.running = false;
    this._timer = null;
  }

  /**
   * 启动定时巡检
   */
  start() {
    if (this._timer) this.stop();
    const intervalHours = this._getScanInterval();
    console.log(`[AgentScanner] 启动，巡检间隔: ${intervalHours}小时`);

    // 启动后延迟5分钟执行第一次（让系统完全启动）
    setTimeout(() => {
      this.runScan().catch(e => console.error('[AgentScanner] 首次巡检失败:', e.message));
    }, 5 * 60 * 1000);

    this._timer = setInterval(() => {
      this.runScan().catch(e => console.error('[AgentScanner] 定时巡检失败:', e.message));
    }, intervalHours * 3600 * 1000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.running = false;
    console.log('[AgentScanner] 已停止');
  }

  /**
   * 执行一次完整巡检
   */
  async runScan() {
    if (this.running) {
      console.log('[AgentScanner] 上一次巡检还在进行中，跳过');
      return { skipped: true };
    }

    // 检查模块开关
    if (!this._isAgentEnabled()) {
      return { skipped: true, reason: 'Agent模块未启用' };
    }

    // 检查成本
    const costCheck = this.costCtrl.canAgentSpend();
    if (!costCheck.allowed) {
      console.log('[AgentScanner] 成本超限，跳过巡检:', costCheck.reason);
      return { skipped: true, reason: costCheck.reason };
    }

    this.running = true;
    const scanId = uuidv4().substring(0, 8);
    const startTime = Date.now();
    console.log(`[AgentScanner] 开始巡检 #${scanId}`);

    const rules = this._getScanRules();
    const triggers = [];

    try {
      // ===== 邮件渠道扫描 =====
      const firstTouchTriggers = this._scanFirstTouch(rules.first_touch_hours || 24);
      triggers.push(...firstTouchTriggers);

      const followUpTriggers = this._scanFollowUp(rules.follow_up_days || 3);
      triggers.push(...followUpTriggers);

      const inquiryTriggers = this._scanInquiryReply(rules.inquiry_reply_hours || 2);
      triggers.push(...inquiryTriggers);

      const hotLeadTriggers = this._scanHotLeads(rules.hot_lead_hours || 12);
      triggers.push(...hotLeadTriggers);

      // ===== 多渠道扫描（检查模块开关）=====
      if (this._isModuleEnabled('whatsapp')) {
        const waTriggers = this._scanWhatsApp(rules.wa_unreply_hours || 4);
        triggers.push(...waTriggers);
      }

      if (this._isModuleEnabled('linkedin')) {
        const liTriggers = this._scanLinkedIn(rules.li_followup_days || 5);
        triggers.push(...liTriggers);
      }

      const socialTriggers = this._scanSocialLeads();
      triggers.push(...socialTriggers);

      // 限制每次巡检最大操作数
      const maxActions = rules.max_actions_per_scan || 10;
      const limitedTriggers = triggers.slice(0, maxActions);

      // 对每个触发项做决策
      let executed = 0, drafted = 0, notified = 0, skipped = 0;

      for (const trigger of limitedTriggers) {
        const scanCostCheck = this.costCtrl.canAgentScanSpend(0);
        if (!scanCostCheck.allowed) {
          console.log('[AgentScanner] 单次巡检成本超限，停止处理');
          break;
        }

        const decision = this.decision.decide(trigger);

        // 记录巡检结果
        this.db.prepare(`
          INSERT INTO agent_scan_results (scan_id, customer_id, trigger_type, trigger_reason, priority, decision, decision_reason, action_type, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(scanId, trigger.customerId, trigger.triggerType, trigger.triggerReason, trigger.priority, decision.action, decision.reason, trigger.triggerType, decision.action === 'skip' ? 'skipped' : 'pending');

        if (decision.action === 'skip') {
          skipped++;
          continue;
        }

        if (decision.action === 'notify') {
          this._notifyUser(trigger, decision);
          notified++;
        } else if (decision.action === 'draft') {
          const draftCreated = await this._generateDraft(trigger, scanId);
          if (draftCreated) {
            drafted++;
          } else {
            skipped++;
          }
        } else if (decision.action === 'auto_execute') {
          await this._autoExecute(trigger, scanId);
          executed++;
        }
      }

      // 巡检完成后检查升级资格
      this.decision.checkUpgradeEligibility();

      // 巡检完成后执行主动学习
      let learnResult = null;
      try {
        learnResult = this.learner.analyze();
        if (learnResult && !learnResult.skipped && learnResult.strategiesCreated > 0) {
          console.log(`[AgentScanner] 主动学习: 发现${learnResult.insights}个洞察, 创建${learnResult.strategiesCreated}个策略草稿`);
          this._emit('learning_complete', learnResult);
        }
      } catch (e) {
        console.warn('[AgentScanner] 主动学习失败:', e.message);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const summary = {
        scanId, total: triggers.length, processed: limitedTriggers.length,
        executed, drafted, notified, skipped, duration: duration + 's',
        learning: learnResult ? { skipped: learnResult.skipped, insights: learnResult.insights || 0, strategies: learnResult.strategiesCreated || 0 } : null
      };
      console.log(`[AgentScanner] 巡检 #${scanId} 完成:`, JSON.stringify(summary));

      this.memory.logAction({
        action_type: 'scan',
        triggered_by: 'agent',
        action_detail: `巡检#${scanId}: 发现${triggers.length}个机会, 处理${limitedTriggers.length}个 (执行${executed}/草稿${drafted}/通知${notified}/跳过${skipped})`,
        result: JSON.stringify(summary),
        status: 'executed'
      });

      this._emit('scan_complete', summary);
      return summary;
    } catch (e) {
      console.error(`[AgentScanner] 巡检 #${scanId} 异常:`, e.message);
      this.memory.logAction({
        action_type: 'scan',
        triggered_by: 'agent',
        action_detail: `巡检#${scanId}异常: ${e.message}`,
        status: 'failed'
      });
      return { error: e.message };
    } finally {
      this.running = false;
    }
  }

  // ========== 邮件渠道扫描（含冲突排除）==========

  /**
   * 冲突排除SQL片段：排除在邮件序列或客户旅程中的客户
   */
  get _conflictExclusionSQL() {
    return `
      AND NOT EXISTS (SELECT 1 FROM sequence_enrollments se WHERE se.customer_id = c.id AND se.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM journey_enrollments je WHERE je.customer_id = c.id AND je.status = 'active')
    `;
  }

  _scanFirstTouch(hours) {
    const triggers = [];
    try {
      const customers = this.db.prepare(`
        SELECT c.id, c.company, c.contact_name, c.email, c.country, c.stage, c.source, c.created_at
        FROM customers c
        WHERE c.stage = 'new'
          AND c.email IS NOT NULL AND c.email != ''
          AND c.created_at < datetime('now', '-${hours} hours')
          AND NOT EXISTS (SELECT 1 FROM emails e WHERE e.customer_id = c.id AND e.direction = 'outbound')
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.customer_id = c.id AND sr.trigger_type = 'first_touch' AND sr.status IN ('pending','executed') AND sr.created_at > datetime('now', '-24 hours'))
          ${this._conflictExclusionSQL}
        ORDER BY c.created_at ASC LIMIT 20
      `).all();

      for (const c of customers) {
        triggers.push({
          customerId: c.id, triggerType: 'first_touch',
          triggerReason: `新线索 ${c.company || c.contact_name} (${c.country || '未知'}) 已${hours}小时未触达`,
          priority: 'high', customerData: c
        });
      }
    } catch (e) { console.warn('[AgentScanner] 扫描首次触达失败:', e.message); }
    return triggers;
  }

  _scanFollowUp(days) {
    const triggers = [];
    try {
      const customers = this.db.prepare(`
        SELECT c.id, c.company, c.contact_name, c.email, c.country, c.stage,
          MAX(e.sent_at) as last_sent_at
        FROM customers c
        JOIN emails e ON e.customer_id = c.id AND e.direction = 'outbound' AND e.status = 'sent'
        WHERE c.stage IN ('contacted', 'negotiating')
          AND c.email IS NOT NULL AND c.email != ''
          ${this._conflictExclusionSQL}
        GROUP BY c.id
        HAVING last_sent_at < datetime('now', '-${days} days')
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.customer_id = c.id AND sr.trigger_type = 'follow_up' AND sr.status IN ('pending','executed') AND sr.created_at > datetime('now', '-24 hours'))
        ORDER BY last_sent_at ASC LIMIT 20
      `).all();

      for (const c of customers) {
        triggers.push({
          customerId: c.id, triggerType: 'follow_up',
          triggerReason: `${c.company || c.contact_name} 已${days}天未跟进 (上次: ${c.last_sent_at})`,
          priority: 'medium', customerData: { ...c, total_interactions: 1 }
        });
      }
    } catch (e) { console.warn('[AgentScanner] 扫描跟进失败:', e.message); }
    return triggers;
  }

  _scanInquiryReply(hours) {
    const triggers = [];
    try {
      // 排除auto-replier已处理的(ai_reply_id不为空)和已在序列/旅程中的客户
      const unreplied = this.db.prepare(`
        SELECT re.id as email_id, re.from_email, re.from_name, re.subject, re.received_at, re.customer_id,
          c.company, c.contact_name, c.country, c.stage
        FROM received_emails re
        LEFT JOIN customers c ON c.id = re.customer_id
        WHERE re.is_replied = 0
          AND (re.ai_reply_id IS NULL OR re.ai_reply_id = 0)
          AND re.received_at < datetime('now', '-${hours} hours')
          AND re.received_at > datetime('now', '-7 days')
          AND re.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.customer_id = re.customer_id AND sr.trigger_type = 'inquiry_reply' AND sr.status IN ('pending','executed') AND sr.created_at > datetime('now', '-24 hours'))
          AND NOT EXISTS (SELECT 1 FROM sequence_enrollments se WHERE se.customer_id = re.customer_id AND se.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM journey_enrollments je WHERE je.customer_id = re.customer_id AND je.status = 'active')
        ORDER BY re.received_at ASC LIMIT 10
      `).all();

      for (const e of unreplied) {
        triggers.push({
          customerId: e.customer_id, triggerType: 'inquiry_reply',
          triggerReason: `${e.from_name || e.from_email} 的邮件"${(e.subject || '').substring(0, 50)}"已${hours}小时未回复`,
          priority: 'high', customerData: { ...e, stage: e.stage || 'new' }
        });
      }
    } catch (e) { console.warn('[AgentScanner] 扫描询盘回复失败:', e.message); }
    return triggers;
  }

  _scanHotLeads(hours) {
    const triggers = [];
    try {
      const hotLeads = this.db.prepare(`
        SELECT re.customer_id, re.from_email, re.from_name, re.subject, re.received_at,
          c.company, c.contact_name, c.country, c.stage
        FROM received_emails re
        JOIN customers c ON c.id = re.customer_id
        WHERE re.is_replied = 1
          AND re.received_at > datetime('now', '-3 days')
          AND NOT EXISTS (SELECT 1 FROM emails e2 WHERE e2.customer_id = re.customer_id AND e2.direction = 'outbound' AND e2.status = 'sent' AND e2.sent_at > re.received_at)
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.customer_id = re.customer_id AND sr.trigger_type = 'hot_lead' AND sr.status IN ('pending','executed') AND sr.created_at > datetime('now', '-24 hours'))
          ${this._conflictExclusionSQL.replace(/c\.id/g, 're.customer_id')}
        ORDER BY re.received_at DESC LIMIT 10
      `).all();

      for (const h of hotLeads) {
        triggers.push({
          customerId: h.customer_id, triggerType: 'hot_lead',
          triggerReason: `${h.company || h.from_name} 回复了但未二次跟进`,
          priority: 'high', customerData: { ...h, total_interactions: 1 }
        });
      }
    } catch (e) { console.warn('[AgentScanner] 扫描热线索失败:', e.message); }
    return triggers;
  }

  // ========== 多渠道扫描 ==========

  /**
   * WhatsApp未回复对话扫描
   */
  _scanWhatsApp(hours) {
    const triggers = [];
    try {
      const unreplied = this.db.prepare(`
        SELECT wc.id, wc.chat_id, wc.customer_id, wc.contact_name, wc.contact_phone,
          wc.unread_count, wc.last_message, wc.last_message_at,
          c.company, c.country, c.stage
        FROM wa_conversations wc
        LEFT JOIN customers c ON c.id = wc.customer_id
        WHERE wc.unread_count > 0
          AND wc.last_message_at < datetime('now', '-${hours} hours')
          AND wc.last_message_at > datetime('now', '-7 days')
          AND wc.is_archived = 0
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.customer_id = wc.customer_id AND sr.trigger_type = 'wa_unreply' AND sr.status IN ('pending','executed') AND sr.created_at > datetime('now', '-24 hours'))
        ORDER BY wc.last_message_at ASC LIMIT 10
      `).all();

      for (const w of unreplied) {
        if (!w.customer_id) continue;
        triggers.push({
          customerId: w.customer_id, triggerType: 'wa_unreply',
          triggerReason: `WhatsApp: ${w.contact_name || w.contact_phone} 有${w.unread_count}条未读消息，已${hours}小时`,
          priority: 'medium', customerData: { ...w, channel: 'whatsapp' }
        });
      }
    } catch (e) { console.warn('[AgentScanner] WhatsApp扫描失败:', e.message); }
    return triggers;
  }

  /**
   * LinkedIn未跟进线索扫描
   */
  _scanLinkedIn(days) {
    const triggers = [];
    try {
      const prospects = this.db.prepare(`
        SELECT lp.id, lp.customer_id, lp.full_name, lp.company as li_company, lp.headline,
          lp.connection_status, lp.last_action, lp.last_action_at, lp.reply_received,
          c.company, c.country, c.stage
        FROM li_prospects lp
        LEFT JOIN customers c ON c.id = lp.customer_id
        WHERE lp.reply_received = 0
          AND lp.last_action_at IS NOT NULL
          AND lp.last_action_at < datetime('now', '-${days} days')
          AND lp.connection_status IN ('connected', 'pending')
          AND (lp.sequence_id IS NULL OR lp.sequence_id = 0)
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.customer_id = lp.customer_id AND sr.trigger_type = 'li_followup' AND sr.status IN ('pending','executed') AND sr.created_at > datetime('now', '-24 hours'))
        ORDER BY lp.last_action_at ASC LIMIT 10
      `).all();

      for (const p of prospects) {
        if (!p.customer_id) continue;
        triggers.push({
          customerId: p.customer_id, triggerType: 'li_followup',
          triggerReason: `LinkedIn: ${p.full_name} (${p.li_company || ''}) 已${days}天未跟进`,
          priority: 'low', customerData: { ...p, channel: 'linkedin' }
        });
      }
    } catch (e) { console.warn('[AgentScanner] LinkedIn扫描失败:', e.message); }
    return triggers;
  }

  /**
   * 社媒线索未转入CRM扫描
   */
  _scanSocialLeads() {
    const triggers = [];
    try {
      const newLeads = this.db.prepare(`
        SELECT sl.id, sl.platform, sl.username, sl.profile_url, sl.message, sl.created_at
        FROM social_leads sl
        WHERE sl.status = 'new'
          AND sl.customer_id IS NULL
          AND sl.created_at > datetime('now', '-14 days')
          AND NOT EXISTS (SELECT 1 FROM agent_scan_results sr WHERE sr.trigger_type = 'social_new_lead' AND sr.action_detail LIKE '%' || sl.id || '%' AND sr.created_at > datetime('now', '-24 hours'))
        ORDER BY sl.created_at DESC LIMIT 10
      `).all();

      for (const l of newLeads) {
        triggers.push({
          customerId: null, triggerType: 'social_new_lead',
          triggerReason: `${l.platform}新线索: ${l.username} — "${(l.message || '').substring(0, 60)}"`,
          priority: 'low', customerData: { ...l, channel: l.platform }
        });
      }
    } catch (e) { console.warn('[AgentScanner] 社媒线索扫描失败:', e.message); }
    return triggers;
  }

  // ========== 执行动作 ==========

  _notifyUser(trigger, decision) {
    this._emit('agent_trigger', {
      type: trigger.triggerType,
      customer: trigger.customerData?.company || trigger.customerData?.contact_name,
      reason: trigger.triggerReason,
      decision: decision.reason
    });
  }

  async _generateDraft(trigger, scanId) {
    try {
      if (!this.aiBrain) {
        console.warn('[AgentScanner] 无AI Brain实例，无法生成草稿');
        return;
      }

      const customer = trigger.customerData;
      const profile = trigger.customerId ? this.memory.getProfile(trigger.customerId) : null;

      let prompt;
      switch (trigger.triggerType) {
        case 'first_touch':
          prompt = `为新客户 ${customer.company || customer.contact_name} (${customer.country || '未知国家'}) 写一封首次触达邮件。`;
          break;
        case 'follow_up':
          prompt = `为客户 ${customer.company || customer.contact_name} 写一封跟进邮件，上次联系已超过3天。`;
          break;
        case 'inquiry_reply':
          prompt = `回复客户 ${customer.company || customer.contact_name} 的询盘邮件。`;
          break;
        case 'hot_lead':
          prompt = `客户 ${customer.company || customer.contact_name} 刚回复了我们，写一封趁热打铁的跟进邮件。`;
          break;
        default:
          prompt = `为客户 ${customer.company || customer.contact_name} 写一封邮件。`;
      }

      if (profile) {
        prompt += ` 客户偏好语言: ${profile.language_preference || '英语'}，沟通风格: ${profile.communication_style || '专业'}。`;
      }

      const aiResult = await this._withTimeout(
        this.aiBrain.generateEmail(trigger.triggerType === 'first_touch' ? 'cold' : 'follow_up', customer, { customPrompt: prompt }),
        45000,
        'AI草稿生成超时'
      );

      if (aiResult && (aiResult.content || aiResult.result)) {
        const content = aiResult.content || aiResult.result;
        const account = this.db.prepare("SELECT id, email FROM email_accounts WHERE is_active = 1 LIMIT 1").get();
        if (account && customer.email) {
          this.db.prepare(`
            INSERT INTO emails (account_id, customer_id, to_addr, subject, body, status, direction, source, created_at)
            VALUES (?, ?, ?, ?, ?, 'draft', 'outbound', 'agent_auto', datetime('now'))
          `).run(account.id, trigger.customerId, customer.email, this._extractSubject(content) || '跟进', this._extractBody(content));

          this._emit('draft_created', {
            customer: customer.company || customer.contact_name,
            triggerType: trigger.triggerType
          });
          this.db.prepare(`
            UPDATE agent_scan_results SET status = 'executed', executed_at = datetime('now')
            WHERE scan_id = ? AND customer_id IS ? AND trigger_type = ?
          `).run(scanId, trigger.customerId || null, trigger.triggerType);
          return true;
        }
      }
      this._markDraftFailed(scanId, trigger, 'AI未返回有效草稿');
      return false;
    } catch (e) {
      console.error('[AgentScanner] 生成草稿失败:', e.message);
      this._markDraftFailed(scanId, trigger, e.message);
      return false;
    }
  }

  _markDraftFailed(scanId, trigger, reason) {
    try {
      this.db.prepare(`
        UPDATE agent_scan_results
        SET status = 'failed',
            decision_reason = COALESCE(decision_reason, '') || ?
        WHERE scan_id = ? AND customer_id IS ? AND trigger_type = ? AND status = 'pending'
      `).run(` | draft_failed:${String(reason || 'unknown').substring(0, 200)}`, scanId, trigger.customerId || null, trigger.triggerType);
    } catch (e) {
      console.warn('[AgentScanner] 标记草稿失败状态失败:', e.message);
    }
  }

  _withTimeout(promise, timeoutMs, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  async _autoExecute(trigger, scanId) {
    await this._generateDraft(trigger, scanId);

    try {
      const draft = this.db.prepare(`
        SELECT id FROM emails WHERE customer_id = ? AND status = 'draft' AND source = 'agent_auto'
        ORDER BY created_at DESC LIMIT 1
      `).get(trigger.customerId);

      if (draft) {
        this.db.prepare("UPDATE emails SET status = 'queued' WHERE id = ?").run(draft.id);

        try {
          const { EmailSender } = require('./email-sender');
          const sender = new EmailSender(this.db);
          const result = await sender.sendEmail(draft.id);
          sender.closeAll();

          if (result?.success) {
            this.db.prepare(`
              UPDATE agent_scan_results SET status = 'executed', executed_at = datetime('now')
              WHERE scan_id = ? AND customer_id = ? AND trigger_type = ?
            `).run(scanId, trigger.customerId, trigger.triggerType);

            this.memory.extractEmailExperience({
              to: trigger.customerData?.email,
              subject: 'Agent自动发送',
              customerId: trigger.customerId,
              success: true
            });

            this._emit('auto_executed', {
              customer: trigger.customerData?.company || trigger.customerData?.contact_name,
              triggerType: trigger.triggerType
            });
          }
        } catch (e) {
          console.error('[AgentScanner] 自动发送失败:', e.message);
          this.db.prepare("UPDATE emails SET status = 'draft' WHERE id = ?").run(draft.id);
        }
      }
    } catch (e) {
      console.error('[AgentScanner] 自动执行失败:', e.message);
    }
  }

  // ========== 工具方法 ==========

  _isAgentEnabled() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
      if (row) return JSON.parse(row.value).agent === true;
    } catch {}
    return false;
  }

  _isModuleEnabled(moduleName) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
      if (row) return JSON.parse(row.value)[moduleName] === true;
    } catch {}
    return false;
  }

  _getScanInterval() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='agent_scan_interval'").get();
      return row ? parseInt(row.value) || 2 : 2;
    } catch { return 2; }
  }

  _getScanRules() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='agent_scan_rules'").get();
      return row ? JSON.parse(row.value) : {};
    } catch { return {}; }
  }

  _extractSubject(content) {
    const match = content.match(/(?:Subject|主题|标题)[：:]\s*(.+)/i);
    return match ? match[1].trim() : null;
  }

  _extractBody(content) {
    return content.replace(/(?:Subject|主题|标题)[：:]\s*.+\n?/i, '').trim();
  }

  _emit(type, data) {
    if (this.io) {
      this.io.emit('agent_event', { type, data, timestamp: new Date().toISOString() });
    }
  }
}

module.exports = { AgentScanner };
