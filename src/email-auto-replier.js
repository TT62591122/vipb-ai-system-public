/**
 * 邮件AI自动回复处理器
 * 监听 EmailReceiver 的 newEmail 事件
 * 调用 AI Brain 生成回复 → 通过 EmailSender 发送
 */

class EmailAutoReplier {
  constructor(db, io, { emailReceiver, emailSender, aiBrain }) {
    this.db = db;
    this.io = io;
    this.emailReceiver = emailReceiver;
    this.emailSender = emailSender;
    this.aiBrain = aiBrain;
    this.enabled = true;

    this._initSettings();
    this._bindEvents();
  }

  _initSettings() {
    // 从数据库读取自动回复设置
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key = 'email_auto_reply'").get();
      if (row) {
        const settings = JSON.parse(row.value);
        this.enabled = settings.enabled !== false;
        this.replyDelay = settings.delay_minutes || 2; // 默认2分钟后回复（更自然）
        this.onlyKnownCustomers = settings.only_known_customers !== false; // 默认只回复已知客户
        this.requireApproval = settings.require_approval || false; // 是否需要人工审批
      } else {
        // 写入默认设置
        const defaults = { enabled: true, delay_minutes: 2, only_known_customers: true, require_approval: false };
        this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('email_auto_reply', ?, datetime('now'))").run(JSON.stringify(defaults));
        this.enabled = true;
        this.replyDelay = 2;
        this.onlyKnownCustomers = true;
        this.requireApproval = false;
      }
    } catch (e) {
      console.error('[AutoReplier] 读取设置失败:', e.message);
      this.enabled = true;
      this.replyDelay = 2;
      this.onlyKnownCustomers = true;
      this.requireApproval = false;
    }
  }

  _bindEvents() {
    if (!this.emailReceiver) return;
    this.emailReceiver.on('newEmail', (email) => {
      if (!this.enabled) return;
      this._handleNewEmail(email).catch(e => {
        console.error('[AutoReplier] 处理新邮件失败:', e.message);
      });
    });
  }

  async _handleNewEmail(email) {
    const eligibility = this._classifyAutoReplyEligibility(email);
    if (eligibility.skip) {
      console.log(`[AutoReplier] 跳过自动回复: ${email.from_email} (${eligibility.reason})`);
      this._notify('auto_reply_skipped', {
        from: email.from_email,
        subject: email.subject,
        reason: eligibility.reason,
        signals: eligibility.signals
      });
      this._logAutoReplySkip(email, eligibility);
      return;
    }

    console.log(`[AutoReplier] 收到新邮件: ${email.from_email} → ${email.subject}`);

    // 被动学习：收到客户回复时更新画像
    if (email.customer_id) {
      try {
        const { getAgentMemory } = require('./agent-memory');
        const memory = getAgentMemory(this.db);
        if (memory) {
          memory.updateProfileHardData(email.customer_id);
          memory.logAction({
            action_type: 'manual',
            triggered_by: 'user',
            target_customer_id: email.customer_id,
            action_detail: `收到客户回复: ${(email.subject || '').substring(0, 100)}`,
            result: '已更新客户画像',
            status: 'executed'
          });
        }
      } catch (e) { /* 被动学习失败不影响主流程 */ }
    }

    // 只回复已知客户？
    if (this.onlyKnownCustomers && !email.customer_id) {
      console.log(`[AutoReplier] 跳过未知发件人: ${email.from_email}`);
      // 但仍然通知前端
      this._notify('new_email_unknown', { from: email.from_email, subject: email.subject });
      return;
    }

    // 延迟回复（更自然）
    const delayMs = this.replyDelay * 60 * 1000;
    console.log(`[AutoReplier] 将在 ${this.replyDelay} 分钟后生成AI回复`);
    
    setTimeout(async () => {
      try {
        await this._generateAndSendReply(email);
      } catch (e) {
        console.error(`[AutoReplier] AI回复失败:`, e.message);
        this._notify('auto_reply_failed', { from: email.from_email, error: e.message });
      }
    }, delayMs);
  }

  async _generateAndSendReply(email) {
    // 获取客户信息
    let customer = email.customer;
    if (!customer && email.customer_id) {
      customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(email.customer_id);
    }
    if (!customer) {
      customer = { company: '未知', contact_name: email.from_name, email: email.from_email, country: '' };
    }

    // 获取历史邮件上下文（收到的 + 发出的，按时间排序）
    const incomingHistory = this.db.prepare(`
      SELECT 'in' as direction, from_email as who, subject, body_text as body, received_at as time
      FROM received_emails 
      WHERE (from_email = ? OR to_email = ?) AND id != ?
      ORDER BY received_at DESC LIMIT 8
    `).all(email.from_email, email.from_email, email.id);

    const outgoingHistory = this.db.prepare(`
      SELECT 'out' as direction, to_addr as who, subject, body, sent_at as time
      FROM emails 
      WHERE to_addr = ? AND status = 'sent'
      ORDER BY sent_at DESC LIMIT 8
    `).all(email.from_email);

    // 合并并按时间排序（最近的在前）
    const allHistory = [...incomingHistory, ...outgoingHistory]
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
      .slice(0, 15);

    let historyContext = '';
    if (allHistory.length > 0) {
      historyContext = '\n\n与该客户的邮件往来记录（从近到远）:\n' + allHistory.map(h => {
        const dir = h.direction === 'in' ? '客户→我们' : '我们→客户';
        const bodyPreview = (h.body || '').replace(/\n/g, ' ').substring(0, 200);
        return `[${dir}] ${h.subject}\n  内容摘要: ${bodyPreview}`;
      }).join('\n\n');
    }

    // 调用AI生成回复
    console.log(`[AutoReplier] 调用AI生成回复...`);

    // ===== 产品信息辅助：尝试从产品库匹配相关产品，作为AI回复参考 =====
    const specCheck = this._checkProductSpecRequest(email.subject, email.body);
    let productContext = '';
    if (specCheck.matchedProducts && specCheck.matchedProducts.length > 0) {
      productContext = '\n\n【产品库匹配数据（请基于此回复，不要编造参数）】:\n' + specCheck.matchedProducts.map(p => {
        return `产品: ${p.name} (${p.model || ''})\n规格: ${p.specs || '无'}\n认证: ${p.certifications || '无'}\n价格(MOQ100): ${p.price_100 || '询价'}`;
      }).join('\n---\n');
    } else if (specCheck.noProductData) {
      productContext = '\n\n【注意：产品库暂无匹配数据。不要编造具体产品型号、技术参数和价格。可以介绍公司产品大类（智能电表、断路器等），引导客户提供更多需求细节，告知会尽快安排专人跟进具体报价。】';
    }

    const aiResult = await this.aiBrain.generateEmail('reply', customer, {
      incomingEmail: `主题: ${email.subject}\n内容: ${email.body}${historyContext}${productContext}`
    });

    if (!aiResult || (!aiResult.content && !aiResult.result)) {
      console.error('[AutoReplier] AI未生成有效回复');
      return;
    }

    // 解析AI回复（提取主题和正文）
    const aiContent = aiResult.content || aiResult.result;
    const { subject: replySubject, body: replyBody } = this._parseAIReply(aiContent, email.subject);

    if (this.requireApproval) {
      // 需要人工审批：保存草稿，通知前端
      this.db.prepare(`
        INSERT INTO emails (account_id, customer_id, to_addr, subject, body, status, direction, source, created_at)
        VALUES (?, ?, ?, ?, ?, 'draft', 'outbound', 'auto_reply', datetime('now'))
      `).run(email.account_id, email.customer_id || null, email.from_email, replySubject, replyBody);
      
      this._notify('auto_reply_draft', {
        from: email.from_email,
        subject: replySubject,
        message: '已生成AI回复草稿，等待审批'
      });
      console.log(`[AutoReplier] 已生成草稿，等待人工审批`);
      return;
    }

    // 直接发送：先插入emails表，再调用sendEmail(id)
    const insertResult = this.db.prepare(`
      INSERT INTO emails (account_id, customer_id, to_addr, subject, body, status, direction, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'out', datetime('now'))
    `).run(email.account_id, email.customer_id || null, email.from_email, replySubject, replyBody);
    const newEmailId = insertResult.lastInsertRowid;

    const sendResult = await this.emailSender.sendEmail(newEmailId);

    if (sendResult?.success) {
      // 标记原邮件已回复
      this.db.prepare('UPDATE received_emails SET is_replied = 1, ai_reply_id = ? WHERE id = ?')
        .run(newEmailId, email.id);
      
      console.log(`[AutoReplier] ✅ AI自动回复已发送: ${email.from_email}`);
      this._notify('auto_reply_sent', {
        from: email.from_email,
        subject: replySubject,
        message: 'AI自动回复已发送'
      });

      // 更新客户阶段
      if (email.customer_id) {
        try {
          this.db.prepare("UPDATE customers SET stage = 'contacted', updated_at = datetime('now') WHERE id = ? AND stage = 'new'")
            .run(email.customer_id);
        } catch (e) {}
      }
    } else {
      console.error(`[AutoReplier] 发送失败:`, sendResult?.error);
      this._notify('auto_reply_failed', { from: email.from_email, error: sendResult?.error });
    }
  }

  _parseAIReply(aiContent, originalSubject) {
    let subject = `Re: ${originalSubject}`;
    let body = aiContent;

    // === 第一步：去掉AI的内部分析内容 ===
    // 删除明显的分析段落（策略分析、客户画像、建议等）
    const analysisPatterns = [
      /^.*(?:策略分析|客户画像|回复策略|分析|我的建议|注意：|注意:).*$/gm,
      /^[-•]\s*(?:新客户|客户用|客户明确|原始|围绕).*$/gm,
      /^(?:好的|数据已经拿到|下面是我的).*$/gm,
      /^(?:我推荐使用|如果客户后续).*$/gm,
    ];
    for (const pat of analysisPatterns) {
      body = body.replace(pat, '');
    }

    // === 第二步：提取正式邮件正文 ===
    // 找到邮件正文的开头（称呼语）
    const greetingPatterns = [
      /(?:^|\n)((?:Dear|Hi|Hello|尊敬的|亲爱的).+(?:您好|,|，|！|!|:))/m,
      /(?:^|\n)(.+(?:您好|你好)[！!，,]?)/m,
    ];
    for (const pat of greetingPatterns) {
      const match = body.match(pat);
      if (match && match.index !== undefined) {
        const startIdx = body.indexOf(match[1]);
        if (startIdx > 20) { // 前面有分析内容
          body = body.substring(startIdx);
          break;
        }
      }
    }

    // === 第三步：去掉多版本内容，只保留第一个版本 ===
    const versionMarkers = [
      /\n---+\s*\n*版本[B-Z]/i,
      /\n---+\s*\n*Version [B-Z]/i,
      /\n版本[B-Z][\s（(]/i,
      /\n---+\s*\n*建议\n/i,
      /\n---+\s*\n*我推荐/i,
    ];
    for (const marker of versionMarkers) {
      const match = body.match(marker);
      if (match && match.index && match.index > 100) {
        body = body.substring(0, match.index);
        break;
      }
    }

    // === 第四步：提取主题行 ===
    const subjectMatch = body.match(/(?:主题|Subject)[：:]\s*(.+?)[\n\r]/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim().replace(/^Re:\s*/i, '');
      subject = `Re: ${subject}`;
      body = body.replace(subjectMatch[0], '').trim();
    }

    // === 第五步：清理格式 ===
    body = body
      .replace(/^#{1,3}\s+/gm, '')           // 去掉markdown标题
      .replace(/\*\*/g, '')                    // 去掉加粗
      .replace(/^---+\s*$/gm, '')              // 去掉分隔线
      .replace(/^\s*邮件正文.*$/gm, '')         // 去掉"邮件正文"标记
      .replace(/^\s*版本[A-Z].*$/gm, '')        // 去掉版本标记
      .replace(/\[Your Name\]/g, '')           // 去掉占位符
      .replace(/\[你的名字\]/g, '')
      .replace(/\n{3,}/g, '\n\n')             // 合并多余空行
      .trim();

    // === 第六步：截掉签名后的多余内容 ===
    const sigMarkers = ['www.chinavipb.com', '温州星源控股', 'Wenzhou Xingyuan'];
    for (const sig of sigMarkers) {
      const sigIdx = body.indexOf(sig);
      if (sigIdx > -1) {
        body = body.substring(0, sigIdx + sig.length);
        break;
      }
    }

    return { subject, body };
  }

  _notify(type, data) {
    if (this.io) {
      this.io.emit('notification', { type, data, timestamp: new Date().toISOString() });
    }
  }

  /**
   * 更新设置
   */
  updateSettings(settings) {
    this.enabled = settings.enabled !== undefined ? settings.enabled : this.enabled;
    this.replyDelay = settings.delay_minutes || this.replyDelay;
    this.onlyKnownCustomers = settings.only_known_customers !== undefined ? settings.only_known_customers : this.onlyKnownCustomers;
    this.requireApproval = settings.require_approval !== undefined ? settings.require_approval : this.requireApproval;
    
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('email_auto_reply', ?, datetime('now'))").run(JSON.stringify({
      enabled: this.enabled,
      delay_minutes: this.replyDelay,
      only_known_customers: this.onlyKnownCustomers,
      require_approval: this.requireApproval,
      guard_enabled: true
    }));
    return { ok: true };
  }

  getSettings() {
    return {
      enabled: this.enabled,
      delay_minutes: this.replyDelay,
      only_known_customers: this.onlyKnownCustomers,
      require_approval: this.requireApproval,
      guard_enabled: true
    };
  }

  // ========== 产品信息辅助匹配 ==========

  /**
   * 尝试从产品库匹配相关产品信息，作为AI回复的参考context
   * 永远不拦截AI回复流程，产品库数据量和完整性不影响回复
   * @returns {{ needsHuman: false, noProductData: boolean, matchedKeywords: string[], matchedProducts: object[] }}
   */
  _classifyAutoReplyEligibility(email) {
    const fromEmail = String(email.from_email || '').trim().toLowerCase();
    const fromName = String(email.from_name || '').trim().toLowerCase();
    const subject = String(email.subject || '').trim().toLowerCase();
    const body = String(email.body || '').slice(0, 4000).toLowerCase();
    const text = `${fromEmail} ${fromName} ${subject} ${body}`;
    const localPart = fromEmail.split('@')[0] || '';
    const domain = fromEmail.split('@').pop() || '';
    const signals = [];

    const systemDomains = [
      'facebookmail.com', 'facebook.com', 'linkedin.com', 'google.com',
      'accounts.google.com', 'workspace.google.com', 'youtube.com',
      'instagram.com', 'tiktok.com', 'x.com', 'twitter.com',
      'microsoft.com', 'apple.com', 'github.com', 'mailchimp.com',
      'sendgrid.net', 'amazonses.com'
    ];
    if (systemDomains.some(d => domain === d || domain.endsWith(`.${d}`))) {
      signals.push(`domain:${domain}`);
    }

    const systemLocalParts = [
      'noreply', 'no-reply', 'notification', 'notifications', 'security',
      'billing', 'payments', 'reminder', 'reminders', 'verification',
      'mailer-daemon', 'postmaster', 'bounce', 'newsletter'
    ];
    if (systemLocalParts.some(p => localPart === p || localPart.includes(p))) {
      signals.push(`local:${localPart}`);
    }

    const systemKeywords = [
      'verification code', 'security alert', 'password reset', 'sign-in',
      'login alert', 'two-factor', '2fa', 'invoice', 'receipt', 'billing',
      'payment due', 'facebook', 'linkedin', 'google workspace',
      'friend request', 'notification', 'notifications', '验证码', '安全提醒',
      '密码重置', '登录', '登入', '通知', '账单', '帐单', '付款', '好友请求'
    ];
    for (const keyword of systemKeywords) {
      if (text.includes(keyword)) {
        signals.push(`keyword:${keyword}`);
        break;
      }
    }

    if (signals.length > 0) {
      return { skip: true, reason: 'system_notification', signals };
    }

    return { skip: false, reason: 'eligible', signals: [] };
  }

  _logAutoReplySkip(email, eligibility) {
    try {
      this.db.prepare(`
        INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at)
        VALUES ('email', ?, 'auto_reply_skipped', ?, 'system', 'mail-guard', datetime('now'))
      `).run(email.id || null, JSON.stringify({
        from: email.from_email,
        subject: email.subject,
        reason: eligibility.reason,
        signals: eligibility.signals
      }));
    } catch (e) {}
  }

  _checkProductSpecRequest(subject, body) {
    const text = ((subject || '') + ' ' + (body || '')).toLowerCase();

    try {
      const products = this.db.prepare(`
        SELECT id, name, model, category, specs, certifications, price_100, price_500, price_1000, moq
        FROM products WHERE is_active = 1 AND name IS NOT NULL AND name != ''
      `).all();

      // 产品库为空，标记noProductData，AI自行处理（不编参数）
      if (products.length === 0) {
        return { needsHuman: false, noProductData: true, matchedKeywords: [], matchedProducts: [] };
      }

      // 尝试匹配客户提到的产品
      const matchedProducts = products.filter(p => {
        const pName = (p.name || '').toLowerCase();
        const pModel = (p.model || '').toLowerCase();
        const pCategory = (p.category || '').toLowerCase();
        return text.includes(pName) || text.includes(pModel) || text.includes(pCategory)
          || (pName && pName.split(/\s+/).some(w => w.length > 2 && text.includes(w)));
      });

      if (matchedProducts.length > 0) {
        // 匹配到产品，返回产品数据供AI参考
        return { needsHuman: false, noProductData: false, matchedKeywords: [], matchedProducts };
      }

      // 没匹配到具体产品，标记noProductData
      return { needsHuman: false, noProductData: true, matchedKeywords: [], matchedProducts: [] };

    } catch (e) {
      console.error('[AutoReplier] 产品信息匹配失败:', e.message);
      return { needsHuman: false, noProductData: true, matchedKeywords: [], matchedProducts: [] };
    }
  }
}

module.exports = { EmailAutoReplier };
