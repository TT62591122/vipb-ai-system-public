/**
 * 邮件接收引擎 (Email Receiver)
 * - IMAP连接管理（imapflow）
 * - 多账号轮询收取
 * - 新邮件检测 + 解析
 * - 自动同步到统一收件箱
 * - 触发AI自动回复
 * - 客户匹配（通过发件人邮箱关联CRM客户）
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { decrypt, encrypt } = require('./crypto-utils');
const EventEmitter = require('events');
const { google } = require('googleapis');
const OAuth2Client = google.auth.OAuth2;

class EmailReceiver extends EventEmitter {
  constructor(db, io, options = {}) {
    super();
    this.db = db;
    this.io = io;
    this.pollInterval = options.pollInterval || 60000; // 默认60秒轮询
    this.timers = {};       // accountId -> timer
    this.connections = {};  // accountId -> ImapFlow client
    this.running = false;
    this.timers = this.timers || {};
    this.failureThreshold = options.failureThreshold || 5;
    this.pauseDurationMs = options.pauseDurationMs || (15 * 60 * 1000);
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS received_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        message_id TEXT,
        from_email TEXT,
        from_name TEXT,
        to_email TEXT,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        in_reply_to TEXT,
        references_header TEXT,
        uid INTEGER,
        flags TEXT DEFAULT '[]',
        customer_id INTEGER,
        is_read INTEGER DEFAULT 0,
        is_replied INTEGER DEFAULT 0,
        ai_reply_id INTEGER,
        folder TEXT DEFAULT 'INBOX',
        received_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_received_emails_account ON received_emails(account_id);
      CREATE INDEX IF NOT EXISTS idx_received_emails_from ON received_emails(from_email);
      CREATE INDEX IF NOT EXISTS idx_received_emails_customer ON received_emails(customer_id);
      CREATE INDEX IF NOT EXISTS idx_received_emails_date ON received_emails(received_at);

      CREATE TABLE IF NOT EXISTS blocked_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        message_id TEXT,
        from_email TEXT,
        from_name TEXT,
        subject TEXT,
        body_preview TEXT,
        block_type TEXT,
        score INTEGER DEFAULT 0,
        reasons TEXT DEFAULT '[]',
        rule_version TEXT DEFAULT 'mail-guard-v1',
        received_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_blocked_emails_date ON blocked_emails(received_at);
      CREATE INDEX IF NOT EXISTS idx_blocked_emails_from ON blocked_emails(from_email);
    `);
  }

  /**
   * 启动所有活跃邮箱的IMAP轮询
   */
  start() {
    if (this.running) return { ok: true, message: '已在运行' };
    this.running = true;
    const accounts = this._getActiveAccounts();
    let started = 0;
    for (const acc of accounts) {
      if ((acc.imap_host && acc.imap_host.trim()) || acc.auth_type === 'gmail_api') {
        this._startPolling(acc);
        started++;
      }
    }
    console.log(`[EmailReceiver] 启动完成，${started}/${accounts.length} 个账号开始轮询`);
    this.emit('started', { accounts: started });
    return { ok: true, started, total: accounts.length };
  }

  /**
   * 停止所有轮询
   */
  stop() {
    this.running = false;
    for (const [accId, timer] of Object.entries(this.timers)) {
      clearTimeout(timer);
      delete this.timers[accId];
    }
    // 关闭所有IMAP连接
    for (const [accId, client] of Object.entries(this.connections)) {
      try { client.close(); } catch (e) {}
      delete this.connections[accId];
    }
    console.log('[EmailReceiver] 已停止所有轮询');
    this.emit('stopped');
    return { ok: true };
  }

  /**
   * 获取接收状态
   */
  getStatus() {
    const accounts = this._getActiveAccounts();
    return {
      running: this.running,
      accounts: accounts.map(a => ({
        id: a.id,
        email: a.email,
        imap_host: a.imap_host,
        polling: !!this.timers[a.id],
        lastCheck: this._getLastCheck(a.id),
        health: this._getAccountHealth(a.id)
      }))
    };
  }

  /**
   * 手动检查单个账号
   */
  async checkAccount(accountId) {
    const acc = this.db.prepare('SELECT * FROM email_accounts WHERE id = ? AND is_active = 1').get(accountId);
    if (!acc) return { ok: false, error: '账号不存在或已禁用' };
    if (!acc.imap_host && acc.auth_type !== 'gmail_api') return { ok: false, error: '未配置IMAP服务器' };
    const result = await this._fetchNewEmails(acc);
    this._recordFetchResult(acc, result, 'manual');
    return { ...result, health: this._getAccountHealth(acc.id) };
  }

  // ========== 内部方法 ==========

  _getActiveAccounts() {
    return this.db.prepare('SELECT * FROM email_accounts WHERE is_active = 1').all();
  }

  async _pollAccount(account, source = 'scheduled') {
    const pause = this._getPauseState(account.id);
    if (pause.paused) {
      return {
        ok: false,
        account: account.email,
        skipped: true,
        paused: true,
        pausedUntil: pause.pausedUntil,
        error: `Polling paused until ${pause.pausedUntil}`
      };
    }

    const result = await this._fetchNewEmails(account);
    this._recordFetchResult(account, result, source);
    return result;
  }

  _healthKey(accountId) {
    return `email_receiver_health_${accountId}`;
  }

  _getAccountHealth(accountId) {
    const defaults = {
      consecutiveFailures: 0,
      pausedUntil: null,
      lastError: null,
      lastFailureAt: null,
      lastSuccessAt: null
    };

    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(this._healthKey(accountId));
      if (!row || !row.value) return { ...defaults, paused: false };
      const health = { ...defaults, ...JSON.parse(row.value) };
      const pause = this._getPauseState(accountId, health);
      return { ...health, paused: pause.paused, pausedUntil: pause.pausedUntil };
    } catch (e) {
      return { ...defaults, paused: false };
    }
  }

  _saveAccountHealth(accountId, health) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .run(this._healthKey(accountId), JSON.stringify(health));
  }

  _getPauseState(accountId, health = null) {
    const state = health || this._getAccountHealth(accountId);
    if (!state.pausedUntil) return { paused: false, pausedUntil: null };
    const pausedUntilMs = new Date(state.pausedUntil).getTime();
    if (!Number.isFinite(pausedUntilMs) || pausedUntilMs <= Date.now()) {
      return { paused: false, pausedUntil: null };
    }
    return { paused: true, pausedUntil: state.pausedUntil };
  }

  _recordFetchResult(account, result, source = 'scheduled') {
    if (result && result.ok) {
      const health = this._getAccountHealth(account.id);
      this._saveAccountHealth(account.id, {
        ...health,
        consecutiveFailures: 0,
        pausedUntil: null,
        lastError: null,
        lastSuccessAt: new Date().toISOString()
      });
      return;
    }

    if (result && result.skipped && result.paused) return;

    const health = this._getAccountHealth(account.id);
    const consecutiveFailures = (health.consecutiveFailures || 0) + 1;
    const now = new Date();
    const nextHealth = {
      ...health,
      consecutiveFailures,
      lastError: this._formatError(result?.error || 'unknown error'),
      lastFailureAt: now.toISOString(),
      pausedUntil: health.pausedUntil || null
    };

    if (consecutiveFailures >= this.failureThreshold) {
      nextHealth.pausedUntil = new Date(Date.now() + this.pauseDurationMs).toISOString();
    }

    this._saveAccountHealth(account.id, nextHealth);

    if (consecutiveFailures === 1 || consecutiveFailures === this.failureThreshold) {
      console.warn(`[EmailReceiver] ${account.email} fetch failed (${source}, #${consecutiveFailures}): ${nextHealth.lastError}`);
    }
    if (consecutiveFailures === this.failureThreshold) {
      console.warn(`[EmailReceiver] ${account.email} polling paused until ${nextHealth.pausedUntil}`);
    }
  }

  _formatError(err) {
    const message = err instanceof Error ? err.message : String(err || 'unknown error');
    return message.length > 300 ? `${message.slice(0, 300)}...` : message;
  }

  _startPolling(account) {
    this._pollAccount(account, 'initial').catch(e => {
      console.error(`[EmailReceiver] ${account.email} 首次检查失败:`, e.message);
    });
    // 设置定时轮询
    const poll = () => {
      if (!this.running) return;
      this._pollAccount(account, 'scheduled').catch(e => {
        console.error(`[EmailReceiver] ${account.email} 轮询失败:`, e.message);
      }).finally(() => {
        if (this.running) {
          this.timers[account.id] = setTimeout(poll, this.pollInterval);
        }
      });
    };
    this.timers[account.id] = setTimeout(poll, this.pollInterval);
  }

  async _fetchNewEmails(account) {
    // Gmail API 分流
    if (account.auth_type === 'gmail_api') {
      return await this._fetchViaGmailAPI(account);
    }

    const startTime = Date.now();
    let client;
    try {
      // 解密IMAP密码（与SMTP共用同一个密码）
      let password = account.smtp_pass;
      try { password = decrypt(password); } catch (e) { /* 可能未加密 */ }

      client = new ImapFlow({
        host: account.imap_host,
        port: account.imap_port || 993,
        secure: true,
        auth: { user: account.smtp_user || account.email, pass: password },
        logger: false,
        tls: { rejectUnauthorized: false }
      });

      await client.connect();
      this.connections[account.id] = client;

      // 打开INBOX
      const mailbox = await client.mailboxOpen('INBOX');
      
      // 获取上次检查的最大UID
      const lastUid = this._getLastUid(account.id);
      
      // 搜索新邮件（UID大于上次的）
      let searchCriteria;
      if (lastUid > 0) {
        searchCriteria = { uid: `${lastUid + 1}:*` };
      } else {
        // 首次：只取最近7天的邮件
        const since = new Date();
        since.setDate(since.getDate() - 7);
        searchCriteria = { since };
      }

      const messages = [];
      try {
        for await (const msg of client.fetch(searchCriteria, {
          uid: true,
          flags: true,
          envelope: true,
          source: true
        })) {
          // 解析邮件
          const parsed = await simpleParser(msg.source);
          const fromAddr = parsed.from?.value?.[0]?.address || '';
          const fromName = parsed.from?.value?.[0]?.name || fromAddr;

          // 跳过自己发的邮件
          if (fromAddr.toLowerCase() === account.email.toLowerCase()) continue;

          // 检查是否已存在
          const msgId = parsed.messageId || `uid-${account.id}-${msg.uid}`;
          const exists = this.db.prepare('SELECT id FROM received_emails WHERE account_id = ? AND message_id = ?').get(account.id, msgId);
          if (exists) continue;

          // 检查是否已在拦截表（防重复处理）
          const blockedExists = this.db.prepare('SELECT id FROM blocked_emails WHERE account_id = ? AND message_id = ?').get(account.id, msgId);
          if (blockedExists) continue;

          // 匹配CRM客户
          const customer = this.db.prepare('SELECT id, company, contact_name FROM customers WHERE email = ?').get(fromAddr);

          // 仅对未知客户做广告/隐私拦截
          const blockDecision = this._shouldBlockUnknownEmail({
            accountId: account.id,
            messageId: msgId,
            fromEmail: fromAddr,
            fromName,
            subject: parsed.subject || '(无主题)',
            bodyText: (parsed.text || '').substring(0, 10000),
            receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
            customerId: customer?.id || null
          });
          if (blockDecision.blocked) {
            this._logBlockedEmail(blockDecision);
            continue;
          }

          // 保存到数据库
          const result = this.db.prepare(`
            INSERT INTO received_emails (account_id, message_id, from_email, from_name, to_email, subject, body_text, body_html, in_reply_to, references_header, uid, flags, customer_id, folder, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INBOX', ?)
          `).run(
            account.id,
            msgId,
            fromAddr,
            fromName,
            account.email,
            parsed.subject || '(无主题)',
            (parsed.text || '').substring(0, 10000),
            (parsed.html || '').substring(0, 50000),
            parsed.inReplyTo || '',
            Array.isArray(parsed.references) ? parsed.references.join(', ') : (parsed.references || ''),
            msg.uid,
            JSON.stringify(Array.from(msg.flags || [])),
            customer?.id || null,
            parsed.date?.toISOString() || new Date().toISOString()
          );

          const emailData = {
            id: result.lastInsertRowid,
            account_id: account.id,
            from_email: fromAddr,
            from_name: fromName,
            subject: parsed.subject,
            body_text: (parsed.text || '').substring(0, 2000),
            customer_id: customer?.id,
            customer,
            received_at: parsed.date?.toISOString()
          };

          messages.push(emailData);

          // 更新最大UID
          this._updateLastUid(account.id, msg.uid);
        }
      } catch (fetchErr) {
        // IMAP fetch可能因为UID范围无效而报错，忽略
        if (!fetchErr.message?.includes('UID')) {
          throw fetchErr;
        }
      }

      await client.logout();
      delete this.connections[account.id];

      // 处理新邮件
      if (messages.length > 0) {
        console.log(`[EmailReceiver] ${account.email}: 收到 ${messages.length} 封新邮件`);
        for (const email of messages) {
          this._processNewEmail(email, account);
        }
      }

      this._updateCheckTime(account.id);
      const elapsed = Date.now() - startTime;
      return { ok: true, account: account.email, newEmails: messages.length, elapsed: `${elapsed}ms` };

    } catch (err) {
      if (client) { try { await client.logout(); } catch (e) {} }
      delete this.connections[account.id];
      return { ok: false, account: account.email, error: err.message };
    }
  }

  /**
   * 处理新收到的邮件
   */
  _processNewEmail(email, account) {
    // 1. 同步到统一收件箱
    this._syncToInbox(email, account);

    // 2. WebSocket实时通知前端
    if (this.io) {
      this.io.emit('notification', {
        type: 'new_email',
        data: {
          from: email.from_name || email.from_email,
          subject: email.subject,
          customer_id: email.customer_id,
          account: account.email
        },
        timestamp: new Date().toISOString()
      });
    }

    // 3. 触发AI自动回复事件（由外部监听处理）
    this.emit('newEmail', {
      id: email.id,
      from_email: email.from_email,
      from_name: email.from_name,
      subject: email.subject,
      body: email.body_text,
      customer_id: email.customer_id,
      customer: email.customer,
      account_id: account.id,
      account_email: account.email
    });

    // 4. 记录活动日志
    try {
      this.db.prepare(`INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at) VALUES ('email', ?, 'received', ?, 'system', 'imap', datetime('now'))`)
        .run(email.id, JSON.stringify({ from: email.from_email, subject: email.subject, customer_id: email.customer_id }));
    } catch (e) {}
  }

  /**
   * 同步到统一收件箱
   */
  _syncToInbox(email, account) {
    try {
      // 统一时间格式为 YYYY-MM-DD HH:MM:SS（SQLite友好）
      const normalizeTime = (t) => {
        if (!t) return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        return String(t).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
      };
      const msgTime = normalizeTime(email.received_at);

      // 查找或创建会话
      const channelId = `email:${email.from_email}:${account.id}`;
      let conv = this.db.prepare('SELECT id FROM inbox_conversations WHERE channel = ? AND channel_id = ?').get('email', channelId);
      
      if (!conv) {
        const r = this.db.prepare(`INSERT INTO inbox_conversations (channel, channel_id, customer_id, contact_name, last_message, last_message_at, unread_count, status) VALUES ('email', ?, ?, ?, ?, ?, 1, 'open')`)
          .run(channelId, email.customer_id, email.from_name || email.from_email, `📧 ${email.subject}`, msgTime);
        conv = { id: r.lastInsertRowid };
      } else {
        this.db.prepare('UPDATE inbox_conversations SET last_message = ?, last_message_at = ?, unread_count = unread_count + 1, last_direction = ?, updated_at = datetime(?) WHERE id = ?')
          .run(`📧 ${email.subject}`, msgTime, 'in', 'now', conv.id);
      }

      // 插入消息
      this.db.prepare(`INSERT INTO inbox_messages (conversation_id, channel, direction, sender_name, content, content_type, metadata, created_at) VALUES (?, 'email', 'in', ?, ?, 'email', ?, ?)`)
        .run(conv.id, email.from_name || email.from_email, `📧 ${email.subject}\n\n${email.body_text || ''}`.substring(0, 2000), JSON.stringify({ email_id: email.id, from: email.from_email, subject: email.subject }), msgTime);

    } catch (e) {
      console.error('[EmailReceiver] 同步到收件箱失败:', e.message);
    }
  }

  _shouldBlockUnknownEmail({ accountId, messageId, fromEmail, fromName, subject, bodyText, receivedAt, customerId }) {
    // 已知客户不走陌生强拦截
    if (customerId) {
      return { blocked: false };
    }

    const privacy = this._isPrivacyProbe(subject, bodyText, fromEmail);
    if (privacy.blocked) {
      return {
        blocked: true,
        accountId,
        messageId,
        fromEmail,
        fromName,
        subject,
        bodyPreview: (bodyText || '').substring(0, 1000),
        receivedAt,
        blockType: 'privacy_probe',
        score: 0,
        reasons: privacy.reasons
      };
    }

    const spam = this._isSpamOrAdEmail(subject, bodyText, fromEmail);
    if (spam.blocked) {
      return {
        blocked: true,
        accountId,
        messageId,
        fromEmail,
        fromName,
        subject,
        bodyPreview: (bodyText || '').substring(0, 1000),
        receivedAt,
        blockType: 'spam_ad',
        score: spam.spamRiskScore,
        reasons: spam.reasons
      };
    }

    return { blocked: false };
  }

  _isPrivacyProbe(subject, bodyText, fromEmail) {
    const text = `${subject || ''}\n${bodyText || ''}`.toLowerCase();

    const actionWords = [
      'provide', 'send', 'share', 'tell me', 'give me', 'what is', 'kindly', 'please send',
      '提供', '发送', '告诉', '给我', '请发', '请提供', '请告知', '请问'
    ];

    const sensitiveWords = [
      'password', 'passwd', 'pwd', 'passcode', 'pin',
      'otp', '2fa', 'mfa', 'verification code', 'auth code', 'token',
      'api key', 'access key', 'secret key', 'client secret', 'private key', 'ssh key', 'jwt', 'bearer',
      'bank account', 'account number', 'credit card', 'debit card', 'cvv', 'cvc', 'iban', 'swift', 'routing number',
      '密码', '口令', '验证码', '动态码', '银行卡', '卡号', '开户行', '网银', 'api密钥', '密钥', '私钥'
    ];

    const matchedSensitive = sensitiveWords.filter(w => text.includes(w));
    if (matchedSensitive.length === 0) {
      return { blocked: false, reasons: [] };
    }

    const hasAction = actionWords.some(w => text.includes(w));
    const looksLikeQuestion = /\?|？/.test(text);
    if (!hasAction && !looksLikeQuestion) {
      return { blocked: false, reasons: [] };
    }

    return {
      blocked: true,
      reasons: [
        `unknown_sender:${fromEmail}`,
        `privacy_probe:${matchedSensitive.slice(0, 5).join('|')}`
      ]
    };
  }

  _isSpamOrAdEmail(subject, bodyText, fromEmail) {
    const text = `${subject || ''}\n${bodyText || ''}`.toLowerCase();
    let spamRiskScore = 0;
    const reasons = [`unknown_sender:${fromEmail}`];

    const strongKeywords = [
      'lead generation', 'buy leads', 'seo service', 'backlink', 'guest post', 'traffic boost',
      'crypto investment', 'casino', 'adult', 'loan approval',
      '引流', '获客', '代运营', '刷单', '博彩', '贷款秒批'
    ];

    const mediumKeywords = [
      'marketing agency', 'promotion package', 'advertising offer', 'bulk email',
      '推广', '广告投放', '营销服务', '渠道合作', '软文发布'
    ];

    const inquiryKeywords = [
      'quotation', 'quote', 'moq', 'datasheet', 'specification', 'lead time', 'sample', 'price', 'fob', 'cif',
      '报价', '询价', '最小起订量', '规格', '参数', '样品', '交期', '产品型号'
    ];

    for (const kw of strongKeywords) {
      if (text.includes(kw)) {
        spamRiskScore += 3;
        reasons.push(`strong:${kw}`);
      }
    }
    for (const kw of mediumKeywords) {
      if (text.includes(kw)) {
        spamRiskScore += 2;
        reasons.push(`medium:${kw}`);
      }
    }

    const urls = text.match(/https?:\/\//g) || [];
    if (urls.length >= 3) {
      spamRiskScore += 1;
      reasons.push('weak:many_links');
    }

    const exclamations = ((subject || '') + (bodyText || '')).match(/[!！]/g) || [];
    if (exclamations.length >= 4) {
      spamRiskScore += 1;
      reasons.push('weak:too_many_exclamations');
    }

    if (/dear\s+(sir|madam)/i.test(text) && urls.length >= 1) {
      spamRiskScore += 1;
      reasons.push('weak:generic_salutation_with_link');
    }

    for (const kw of inquiryKeywords) {
      if (text.includes(kw)) {
        spamRiskScore -= 2;
        reasons.push(`normal_inquiry:${kw}`);
      }
    }

    return {
      blocked: spamRiskScore >= 5,
      spamRiskScore,
      reasons
    };
  }

  _logBlockedEmail({ accountId, messageId, fromEmail, fromName, subject, bodyPreview, blockType, score, reasons, receivedAt }) {
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO blocked_emails
        (account_id, message_id, from_email, from_name, subject, body_preview, block_type, score, reasons, rule_version, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mail-guard-v1', ?)
      `).run(
        accountId,
        messageId,
        fromEmail,
        fromName || '',
        subject || '(无主题)',
        (bodyPreview || '').substring(0, 1000),
        blockType,
        Math.max(0, parseInt(score || 0, 10)),
        JSON.stringify(reasons || []),
        receivedAt || new Date().toISOString()
      );
      console.log(`[MailGuard] 已拦截邮件: ${fromEmail} | ${blockType} | score=${score || 0}`);
    } catch (e) {
      console.error('[MailGuard] 记录拦截邮件失败:', e.message);
    }
  }

  // ========== UID跟踪 ==========

  _getLastUid(accountId) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(`email_last_uid_${accountId}`);
    return row ? parseInt(row.value) || 0 : 0;
  }

  _updateLastUid(accountId, uid) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(`email_last_uid_${accountId}`, String(uid));
  }

  _getLastCheck(accountId) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(`email_last_check_${accountId}`);
    return row?.value || null;
  }

  _updateCheckTime(accountId) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(`email_last_check_${accountId}`, new Date().toISOString());
  }

  /**
   * 获取或创建Gmail OAuth2客户端
   */
  async _getGmailClient(account) {
    if (!account.gmail_client_id || !account.gmail_client_secret) {
      throw new Error('Gmail Client ID and Secret are not configured for this account.');
    }
    if (!account.oauth_credentials) {
      throw new Error('OAuth credentials not found. Please authorize the Gmail account.');
    }

    const credentials = JSON.parse(decrypt(account.oauth_credentials));
    const oauth2Client = new OAuth2Client(
      decrypt(account.gmail_client_id),
      decrypt(account.gmail_client_secret),
      'http://localhost:3001/api/email-accounts/gmail-callback'
    );
    oauth2Client.setCredentials(credentials);

    // 配置代理（NekoBox: 127.0.0.1:2080），Gmail API需要走代理访问Google
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:2080';
      const agent = new HttpsProxyAgent(proxyUrl);
      oauth2Client.transporter.defaults = { 
        ...(oauth2Client.transporter.defaults || {}), 
        agent 
      };
    } catch (proxyErr) {
      console.warn('[GmailReceiver] 代理配置失败，尝试直连:', proxyErr.message);
    }

    // 检查 token 是否过期，如果过期则刷新
    if (oauth2Client.isTokenExpiring()) {
      console.log(`[GmailReceiver] 账号 ${account.email} token即将过期，尝试刷新...`);
      const { credentials: refreshedTokens } = await oauth2Client.refreshAccessToken();
      
      // 更新数据库中的 credentials
      this.db.prepare(
        'UPDATE email_accounts SET oauth_credentials=? WHERE id=?'
      ).run(encrypt(JSON.stringify(refreshedTokens)), account.id);
      console.log(`[GmailReceiver] 账号 ${account.email} token刷新成功。`);
      oauth2Client.setCredentials(refreshedTokens);
    }

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * 通过Gmail API收取邮件
   */
  async _fetchViaGmailAPI(account) {
    const startTime = Date.now();
    let gmail;
    try {
      gmail = await this._getGmailClient(account);

      // 获取上次检查时间，用于增量同步
      const lastCheck = this._getLastCheck(account.id);
      let query = 'is:inbox';
      if (lastCheck) {
        // Gmail API 的 after 过滤是秒级时间戳
        const lastCheckEpoch = Math.floor(new Date(lastCheck).getTime() / 1000);
        query += ` after:${lastCheckEpoch}`;
      } else {
        // 首次：只取最近7天的邮件
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoEpoch = Math.floor(sevenDaysAgo.getTime() / 1000);
        query += ` after:${sevenDaysAgoEpoch}`;
      }
      
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100, // 每次最多取100封
      });

      const messages = [];
      if (res.data.messages && res.data.messages.length > 0) {
        for (const msg of res.data.messages) {
          const msgDetails = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          });

          const headers = msgDetails.data.payload.headers;
          const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

          const fromRaw = getHeader('From');
          const toRaw = getHeader('To');
          const subject = getHeader('Subject') || '(无主题)';
          const date = getHeader('Date');
          const messageId = getHeader('Message-ID') || msg.id;
          const inReplyTo = getHeader('In-Reply-To');
          const references = getHeader('References');

          let fromEmail = '';
          let fromName = '';
          const fromMatch = fromRaw.match(/(.*)<([^>]+)>/);
          if (fromMatch) {
            fromName = fromMatch[1].trim().replace(/^"|"$/g, '');
            fromEmail = fromMatch[2];
          } else {
            fromEmail = fromRaw;
            fromName = fromRaw;
          }

          // 跳过自己发的邮件
          if (fromEmail.toLowerCase() === account.email.toLowerCase()) continue;

          // 检查是否已存在 (使用 Gmail messageId 作为唯一标识)
          const exists = this.db.prepare('SELECT id FROM received_emails WHERE account_id = ? AND message_id = ?').get(account.id, messageId);
          if (exists) continue;

          // 检查是否已在拦截表（防重复处理）
          const blockedExists = this.db.prepare('SELECT id FROM blocked_emails WHERE account_id = ? AND message_id = ?').get(account.id, messageId);
          if (blockedExists) continue;

          let bodyHtml = '';
          let bodyText = '';

          const getBody = (part) => {
            if (part.mimeType === 'text/plain' && part.body.data) {
              bodyText += Buffer.from(part.body.data, 'base64').toString('utf8');
            } else if (part.mimeType === 'text/html' && part.body.data) {
              bodyHtml += Buffer.from(part.body.data, 'base64').toString('utf8');
            } else if (part.parts) {
              part.parts.forEach(getBody);
            }
          };
          getBody(msgDetails.data.payload);

          // 匹配CRM客户
          const customer = this.db.prepare('SELECT id, company, contact_name FROM customers WHERE email = ?').get(fromEmail);

          // 仅对未知客户做广告/隐私拦截
          const blockDecision = this._shouldBlockUnknownEmail({
            accountId: account.id,
            messageId,
            fromEmail,
            fromName,
            subject,
            bodyText: bodyText.substring(0, 10000),
            receivedAt: new Date(date).toISOString(),
            customerId: customer?.id || null
          });
          if (blockDecision.blocked) {
            this._logBlockedEmail(blockDecision);
            continue;
          }

          // 保存到数据库
          const result = this.db.prepare(`
            INSERT INTO received_emails (account_id, message_id, from_email, from_name, to_email, subject, body_text, body_html, in_reply_to, references_header, uid, flags, customer_id, folder, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INBOX', ?)
          `).run(
            account.id,
            messageId,
            fromEmail,
            fromName,
            account.email,
            subject,
            bodyText.substring(0, 10000),
            bodyHtml.substring(0, 50000),
            inReplyTo,
            references,
            null, // Gmail API 不直接提供UID，设为null
            '[]',
            customer?.id || null,
            new Date(date).toISOString()
          );

          const emailData = {
            id: result.lastInsertRowid,
            account_id: account.id,
            from_email: fromEmail,
            from_name: fromName,
            subject: subject,
            body_text: bodyText.substring(0, 2000),
            customer_id: customer?.id,
            customer,
            received_at: new Date(date).toISOString()
          };
          messages.push(emailData);
        }
      }
      
      // 处理新邮件
      if (messages.length > 0) {
        console.log(`[GmailReceiver] ${account.email}: 收到 ${messages.length} 封新邮件`);
        for (const email of messages) {
          this._processNewEmail(email, account);
        }
      }

      this._updateCheckTime(account.id);
      const elapsed = Date.now() - startTime;
      return { ok: true, account: account.email, newEmails: messages.length, elapsed: `${elapsed}ms` };

    } catch (err) {
      return { ok: false, account: account.email, error: err.message };
    }
  }
}

module.exports = { EmailReceiver };
