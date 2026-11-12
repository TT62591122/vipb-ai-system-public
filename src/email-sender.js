/**
 * 邮件发送引擎
 * - SMTP连接管理（nodemailer）
 * - 多账号轮发
 * - 频率控制（warmup stage限制）
 * - 发送间隔控制（3-8分钟随机）
 * - 重试机制（最多3次）
 * - 退信检测
 * - 队列处理
 */
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const OAuth2Client = google.auth.OAuth2;
const { EmailTracker } = require('./email-tracker');
const { decrypt, encrypt } = require('./crypto-utils');

// 预热阶段对应的每日发送限额（仅作为后备默认值，优先从数据库防封规则读取）
const WARMUP_LIMITS_DEFAULT = {
  'week1': 3,
  'week2': 8,
  'week3': 15,
  'week4': 25,
  'week5plus': 40
};

// 默认限额
const DEFAULT_DAILY_LIMIT = 40;

// 退信率阈值（仅作为后备默认值，优先从数据库防封规则读取）
const BOUNCE_THRESHOLD_DEFAULT = 0.08;

class EmailSender {
  constructor(db) {
    this.db = db;
    this.transporters = new Map();
    this.tracker = new EmailTracker(db);
  }

  /**
   * 获取退信率阈值（优先从数据库防封规则读取）
   */
  _getBounceThreshold() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='antiban_rules'").get();
      if (row) {
        const rules = JSON.parse(row.value);
        if (rules?.email?.sending?.max_bounce_rate) return rules.email.sending.max_bounce_rate;
      }
    } catch (e) { /* 读取失败用默认值 */ }
    return BOUNCE_THRESHOLD_DEFAULT;
  }

  /**
   * 获取或创建SMTP transporter
   */
  _getTransporter(account) {
    const key = `${account.id}`;
    if (this.transporters.has(key)) {
      return this.transporters.get(key);
    }

    const transportConfig = {
      host: account.smtp_host,
      port: account.smtp_port || 587,
      secure: account.smtp_port === 465, // true for 465, false for others
      auth: {
        user: account.smtp_user || account.email,
        pass: decrypt(account.smtp_pass)
      },
      tls: {
        rejectUnauthorized: false // 允许自签名证书
      },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    };

    // SMTP直连，不走代理（机场节点通常封SMTP端口）
    // 通过自定义socket工厂绕过系统代理，使用DNS直连
    const net = require('net');
    const dns = require('dns');
    const { Resolver } = dns;
    transportConfig.getSocket = (options, callback) => {
      // 用多个公共DNS解析，收集所有IP，逐个尝试连接
      const resolver1 = new Resolver(); resolver1.setServers(['8.8.8.8']);
      const resolver2 = new Resolver(); resolver2.setServers(['1.1.1.1']);
      const resolver3 = new Resolver(); resolver3.setServers(['208.67.222.222']); // OpenDNS
      
      let resolved = 0;
      const allIPs = new Set();
      const onResolved = () => {
        resolved++;
        if (resolved < 3) return; // 等所有DNS都返回
        const addresses = [...allIPs];
        if (addresses.length === 0) return callback(new Error('DNS resolution failed for ' + options.host));
        
        let tried = 0;
        const tryNext = () => {
          if (tried >= addresses.length) {
            return callback(new Error('SMTP direct connect failed - all IPs unreachable'));
          }
          const ip = addresses[tried++];
          console.log(`[Email] SMTP直连: ${options.host} -> ${ip}:${options.port} (${tried}/${addresses.length})`);
          const socket = net.connect({ host: ip, port: options.port, family: 4 });
          const timer = setTimeout(() => {
            socket.destroy();
            tryNext();
          }, 10000);
          socket.once('connect', () => {
            clearTimeout(timer);
            callback(null, { connection: socket });
          });
          socket.once('error', () => {
            clearTimeout(timer);
            tryNext();
          });
        };
        tryNext();
      };
      
      [resolver1, resolver2, resolver3].forEach(r => {
        r.resolve4(options.host, (err, addrs) => {
          if (!err && addrs) addrs.forEach(ip => allIPs.add(ip));
          onResolved();
        });
      });
    };

    const transporter = nodemailer.createTransport(transportConfig);

    this.transporters.set(key, transporter);
    return transporter;
  }

  /**
   * 清除缓存的transporter
   */
  _clearTransporter(accountId) {
    const key = `${accountId}`;
    if (this.transporters.has(key)) {
      const t = this.transporters.get(key);
      try { t.close(); } catch {}
      this.transporters.delete(key);
    }
  }

  /**
   * 测试SMTP连接
   */
  async testConnection(accountId) {
    const account = this.db.prepare('SELECT * FROM email_accounts WHERE id=?').get(accountId);
    if (!account) {
      return { success: false, error: '邮箱账号不存在' };
    }

    if (!account.smtp_host || !account.smtp_pass) {
      return { success: false, error: '请先配置SMTP主机和密码' };
    }

    // 清除旧连接缓存
    this._clearTransporter(accountId);

    try {
      const transporter = this._getTransporter(account);
      await transporter.verify();
      return { success: true, message: `SMTP连接成功: ${account.email}` };
    } catch (err) {
      this._clearTransporter(accountId);
      let errorMsg = err.message;
      if (err.code === 'ECONNREFUSED') {
        errorMsg = `无法连接 ${account.smtp_host}:${account.smtp_port}，请检查主机和端口`;
      } else if (err.code === 'EAUTH' || err.responseCode === 535) {
        errorMsg = '认证失败，请检查SMTP用户名和密码';
      } else if (err.code === 'ETIMEDOUT') {
        errorMsg = '连接超时，请检查网络和SMTP配置';
      }
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 获取账号的当前发送限额（优先从数据库防封规则读取，后备用硬编码默认值）
   */
  _getDailyLimit(account) {
    // 优先从数据库 antiban_rules 读取 email warmup 配置
    let warmupLimit = DEFAULT_DAILY_LIMIT;
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='antiban_rules'").get();
      if (row) {
        const rules = JSON.parse(row.value);
        const stages = rules?.email?.warmup?.stages;
        if (Array.isArray(stages) && account.warmup_stage) {
          // 根据 warmup_stage 名称匹配（如 week1, week2 等）
          const matched = stages.find(s => s.name === account.warmup_stage);
          if (matched && matched.max_daily) {
            warmupLimit = matched.max_daily;
          } else {
            // 后备：用硬编码默认值
            warmupLimit = WARMUP_LIMITS_DEFAULT[account.warmup_stage] || DEFAULT_DAILY_LIMIT;
          }
        } else if (rules?.email?.sending?.max_daily_per_account) {
          warmupLimit = rules.email.sending.max_daily_per_account;
        }
      } else {
        warmupLimit = WARMUP_LIMITS_DEFAULT[account.warmup_stage] || DEFAULT_DAILY_LIMIT;
      }
    } catch (e) {
      warmupLimit = WARMUP_LIMITS_DEFAULT[account.warmup_stage] || DEFAULT_DAILY_LIMIT;
    }
    const configuredLimit = account.daily_limit || DEFAULT_DAILY_LIMIT;
    return Math.min(warmupLimit, configuredLimit);
  }

  /**
   * 检查账号是否可以发送
   */
  _canSend(account) {
    if (!account.is_active) {
      return { can: false, reason: '邮箱账号已停用' };
    }
    
    // Gmail API 账号检查 OAuth 凭证
    if (account.auth_type === 'gmail_api') {
      if (!account.gmail_client_id || !account.gmail_client_secret) {
        return { can: false, reason: '未配置Gmail Client ID/Secret' };
      }
      if (!account.oauth_credentials) {
        return { can: false, reason: 'Gmail未授权，请先完成OAuth授权' };
      }
    } else {
      // SMTP 账号检查 SMTP 配置
      if (!account.smtp_host || !account.smtp_pass) {
        return { can: false, reason: '未配置SMTP' };
      }
    }

    const dailyLimit = this._getDailyLimit(account);
    const todaySent = account.daily_sent || 0;
    if (todaySent >= dailyLimit) {
      return { can: false, reason: `今日已达限额 (${todaySent}/${dailyLimit})` };
    }

    // 检查退信率
    const bounceRate = this._getBounceRate(account.id);
    const bounceThreshold = this._getBounceThreshold();
    if (bounceRate > bounceThreshold) {
      // 自动暂停
      this.db.prepare('UPDATE email_accounts SET is_active=0 WHERE id=?').run(account.id);
      return { can: false, reason: `退信率过高(${(bounceRate * 100).toFixed(1)}%)，已自动暂停` };
    }

    return { can: true };
  }

  _getBounceRate(accountId) {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN bounced=1 THEN 1 ELSE 0 END) as bounced
      FROM emails 
      WHERE account_id=? AND status='sent' AND sent_at > datetime('now', '-30 days')
    `).get(accountId);
    
    if (!stats || stats.total === 0) return 0;
    return stats.bounced / stats.total;
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
      console.log(`[Gmail] 使用代理 ${proxyUrl} 访问Google API`);
    } catch (proxyErr) {
      console.warn('[Gmail] 代理配置失败，尝试直连:', proxyErr.message);
    }

    // 检查 token 是否过期，如果过期则刷新
    if (oauth2Client.isTokenExpiring()) {
      console.log(`[Gmail] 账号 ${account.email} token即将过期，尝试刷新...`);
      const { credentials: refreshedTokens } = await oauth2Client.refreshAccessToken();
      
      // 更新数据库中的 credentials
      this.db.prepare(
        'UPDATE email_accounts SET oauth_credentials=? WHERE id=?'
      ).run(encrypt(JSON.stringify(refreshedTokens)), account.id);
      console.log(`[Gmail] 账号 ${account.email} token刷新成功。`);
      oauth2Client.setCredentials(refreshedTokens);
    }

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * 构建 RFC 2822 格式的原始邮件
   */
  async _buildRawEmail(account, email) {
    const MailComposer = require('nodemailer/lib/mail-composer');
    
    // 清理参考内容标记（转人工草稿中的原始邮件，仅供审核参考，不发给客户）
    const refMarker = '<!-- REFERENCE_ONLY_DO_NOT_SEND -->';
    const cleanBody = email.body.includes(refMarker)
      ? email.body.substring(0, email.body.indexOf(refMarker)).trim()
      : email.body;

    const mailOptions = {
      from: account.display_name 
        ? `"${account.display_name}" <${account.email}>`
        : account.email,
      to: email.to_addr,
      subject: email.subject,
      html: this.tracker.injectTracking(email.id, cleanBody.replace(/\n/g, '<br>')),
      text: cleanBody, // 纯文本备选
      // headers: {
      //   'X-Mailer': 'VIPB-AI-System' // 可选，用于标识邮件客户端
      // }
    };

    // 处理附件
    if (email.attachments) {
      try {
        const paths = JSON.parse(email.attachments);
        const fs = require('fs');
        const path = require('path');
        if (Array.isArray(paths) && paths.length > 0) {
          mailOptions.attachments = (mailOptions.attachments || []).concat(
            paths.filter(p => fs.existsSync(p)).map(p => ({ filename: path.basename(p), path: p }))
          );
        }
      } catch(e) {
        console.warn('[Gmail] 解析附件失败:', e.message);
      }
    }

    // 处理内嵌图片（CID方式，直接显示在邮件正文中）
    if (email.inline_images) {
      try {
        const paths = JSON.parse(email.inline_images);
        const fs = require('fs');
        const path = require('path');
        if (Array.isArray(paths) && paths.length > 0) {
          const inlineAttachments = [];
          let inlineHtml = '';
          paths.forEach((p, i) => {
            if (fs.existsSync(p)) {
              const cid = `inline_img_${i}_${Date.now()}`;
              const ext = path.extname(p).toLowerCase();
              const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
              inlineAttachments.push({
                filename: path.basename(p),
                path: p,
                cid: cid,
                contentDisposition: 'inline',
                contentType: mimeMap[ext] || 'image/jpeg'
              });
              inlineHtml += `<br><img src="cid:${cid}" style="max-width:100%;height:auto;" alt="Product Image"><br>`;
            }
          });
          if (inlineAttachments.length > 0) {
            mailOptions.attachments = (mailOptions.attachments || []).concat(inlineAttachments);
            // 在邮件正文末尾（签名前）插入内嵌图片
            mailOptions.html = inlineHtml + '<br>' + mailOptions.html;
            console.log(`[Gmail] 内嵌图片: ${inlineAttachments.map(a => a.filename).join(', ')}`);
          }
        }
      } catch(e) {
        console.warn('[Gmail] 解析内嵌图片失败:', e.message);
      }
    }

    const mail = new MailComposer(mailOptions);
    const raw = await mail.compile().build();
    return Buffer.from(raw).toString('base64url');
  }

  /**
   * 通过Gmail API发送邮件
   */
  async _sendViaGmailAPI(account, email, emailId) {
    // 更新状态为sending
    this.db.prepare("UPDATE emails SET status='sending', account_id=? WHERE id=?").run(account.id, emailId);

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const gmail = await this._getGmailClient(account);
        const rawEmail = await this._buildRawEmail(account, email);

        const res = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: rawEmail,
          },
        });

        // 发送成功后的后续操作 (与SMTP逻辑一致)
        this.db.prepare("UPDATE emails SET status='sent', sent_at=datetime('now'), from_addr=? WHERE id=?")
          .run(account.email, emailId);

        this.db.prepare('UPDATE email_accounts SET daily_sent = daily_sent + 1 WHERE id=?')
          .run(account.id);

        if (email.customer_id) {
          this.db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('customer',?,?,?)")
            .run(email.customer_id, 'email_sent', JSON.stringify({ emailId, subject: email.subject, to: email.to_addr }));
        }

        console.log(`📧 邮件发送成功 (Gmail API): ${email.to_addr} (via ${account.email})`);

        // 同步到统一收件箱（outgoing消息）
        try {
          const channelId = `email:${email.to_addr}:${account.id}`;
          const conv = this.db.prepare('SELECT id FROM inbox_conversations WHERE channel_id=?').get(channelId);
          if (conv) {
            this.db.prepare(`INSERT INTO inbox_messages 
              (conversation_id, channel, direction, sender_name, content, content_type, metadata)
              VALUES (?, 'email', 'out', ?, ?, 'text', ?)`)
              .run(conv.id, account.email, `📧 ${email.subject}\n\n${email.body}`, JSON.stringify({ email_id: emailId }));
            this.db.prepare(`UPDATE inbox_conversations SET last_message=?, last_message_at=datetime('now'), last_direction='out', updated_at=datetime('now') WHERE id=?`)
              .run(`📧 ${email.subject}`.substring(0, 200), conv.id);
          }
        } catch(syncErr) {
          console.warn('[EmailSender] 同步到收件箱失败:', syncErr.message);
        }

        return { success: true, messageId: res.data.id };

      } catch (err) {
        console.error(`[Gmail] 发送失败(尝试${attempt}/${maxRetries}):`, err.message);

        let errorMsg = err.message;

        // 特殊处理 Gmail API 错误
        if (err.code === 401 && err.message.includes('Invalid Credentials')) {
            errorMsg = 'Gmail认证失败或授权已过期，请重新授权。';
            // 尝试清除旧的transporter，强制重建
            this._clearTransporter(account.id); 
            this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
            return { success: false, error: errorMsg };
        } else if (err.errors && err.errors[0] && err.errors[0].reason === 'authError') {
            errorMsg = 'Gmail认证失败或授权已过期，请重新授权。';
            this._clearTransporter(account.id);
            this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
            return { success: false, error: errorMsg };
        } else if (err.response && err.response.data && err.response.data.error === 'invalid_grant') {
          errorMsg = 'Gmail授权已失效，请重新授权。';
          this._clearTransporter(account.id);
          this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
          return { success: false, error: errorMsg };
        }
        
        // 其他错误按SMTP的重试逻辑处理
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          // 不清除transporter，因为Gmail API客户端会自行处理token刷新
        } else {
          this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
          return { success: false, error: '发送失败: ' + errorMsg };
        }
      }
    }
  }

  /**
   * 发送单封邮件
   * @param {number} emailId - emails表的ID
   * @returns {{ success: boolean, error?: string }}
   */
  async sendEmail(emailId) {
    const email = this.db.prepare('SELECT * FROM emails WHERE id=?').get(emailId);
    if (!email) {
      return { success: false, error: '邮件不存在' };
    }

    if (email.status === 'sent') {
      return { success: false, error: '邮件已发送过' };
    }

    if (!email.to_addr || !email.subject || !email.body) {
      return { success: false, error: '收件人、主题和正文不能为空' };
    }

    // 检查收件人是否在退信黑名单中
    const blacklisted = this.db.prepare('SELECT email FROM email_blacklist WHERE email=?').get(email.to_addr);
    if (blacklisted) {
      this.db.prepare("UPDATE emails SET status='skipped' WHERE id=?").run(emailId);
      return { success: false, error: `收件人 ${email.to_addr} 在退信黑名单中，已跳过` };
    }

    // 发送前邮箱验证（仅检查格式+MX，跳过SMTP握手以免拖慢发送）
    try {
      const { EmailVerifier } = require('./email-verifier');
      const verifier = new EmailVerifier(this.db);
      const vResult = await verifier.verify(email.to_addr, { skipSmtp: true });
      // ⚠️ 阈值50分：角色账号(-30)、MX失败(-20)、SMTP超时(-15) 等都会被拦截
      if (!vResult.valid || vResult.score < 50) {
        this.db.prepare("UPDATE emails SET status='skipped' WHERE id=?").run(emailId);
        console.warn(`[EmailSender] 邮件#${emailId} 收件人验证未通过(${vResult.score}分): ${vResult.reason}`);
        return { success: false, error: `收件人验证失败(${vResult.score}分): ${vResult.reason}` };
      }
    } catch (e) { 
      console.warn('[EmailSender] 邮箱验证模块异常，继续发送:', e.message);
    }

    // 垃圾词检测（warning级别记录日志，danger级别阻止发送）
    try {
      const { SpamDetector } = require('./spam-detector');
      const detector = new SpamDetector();
      const spamResult = detector.analyze(email.subject, email.body);
      if (spamResult.level === 'danger') {
        console.warn(`[EmailSender] 邮件#${emailId} 垃圾词评分过低(${spamResult.score})，已拦截:`, spamResult.suggestions.slice(0, 3));
        this.db.prepare("UPDATE emails SET status='spam_blocked' WHERE id=?").run(emailId);
        return { success: false, error: `邮件被垃圾词检测拦截(评分${spamResult.score}/100): ${spamResult.suggestions.slice(0, 2).join('; ')}` };
      } else if (spamResult.level === 'warning') {
        console.warn(`[EmailSender] 邮件#${emailId} 垃圾词评分偏低(${spamResult.score}):`, spamResult.suggestions.slice(0, 2));
      }
    } catch (e) { /* 检测模块异常不阻塞发送 */ }

    // 获取发件账号
    const account = email.account_id 
      ? this.db.prepare('SELECT * FROM email_accounts WHERE id=?').get(email.account_id)
      : this._selectSendAccountForCustomer(email.customer_id);
    
    if (!account) {
      this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
      return { success: false, error: '没有可用的发件账号' };
    }

    // 检查是否可以发送
    const canSend = this._canSend(account);
    if (!canSend.can) {
      // 将状态回退为failed，避免邮件永远卡在queued/sending状态
      this.db.prepare("UPDATE emails SET status='failed' WHERE id=? AND status IN ('queued','sending')").run(emailId);
      return { success: false, error: canSend.reason };
    }

    // Gmail API 分流
    if (account.auth_type === 'gmail_api') {
      return await this._sendViaGmailAPI(account, email, emailId);
    }

    // 更新状态为sending
    this.db.prepare("UPDATE emails SET status='sending', account_id=? WHERE id=?").run(account.id, emailId);

    // 重试发送
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const transporter = this._getTransporter(account);
        
        // 清理参考内容标记（转人工草稿中的原始邮件，仅供审核参考，不发给客户）
        const refMarker = '<!-- REFERENCE_ONLY_DO_NOT_SEND -->';
        const cleanBody = email.body.includes(refMarker)
          ? email.body.substring(0, email.body.indexOf(refMarker)).trim()
          : email.body;

        // Inject tracking pixel + link rewriting
        const trackedBody = this.tracker.injectTracking(emailId, cleanBody.replace(/\n/g, '<br>'));

        const mailOptions = {
          from: account.display_name 
            ? `"${account.display_name}" <${account.email}>`
            : account.email,
          to: email.to_addr,
          subject: email.subject,
          html: trackedBody,
          text: cleanBody // 纯文本备选
        };

        // 处理附件
        if (email.attachments) {
          try {
            const paths = JSON.parse(email.attachments);
            const fs = require('fs');
            const path = require('path');
            if (Array.isArray(paths) && paths.length > 0) {
              mailOptions.attachments = (mailOptions.attachments || []).concat(
                paths.filter(p => fs.existsSync(p)).map(p => ({ filename: path.basename(p), path: p }))
              );
            }
          } catch(e) {
            console.warn('[Email] 解析附件失败:', e.message);
          }
        }

        // 处理内嵌图片（CID方式，直接显示在邮件正文中）
        if (email.inline_images) {
          try {
            const paths = JSON.parse(email.inline_images);
            const fs = require('fs');
            const path = require('path');
            if (Array.isArray(paths) && paths.length > 0) {
              const inlineAttachments = [];
              let inlineHtml = '';
              paths.forEach((p, i) => {
                if (fs.existsSync(p)) {
                  const cid = `inline_img_${i}_${Date.now()}`;
                  const ext = path.extname(p).toLowerCase();
                  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
                  inlineAttachments.push({
                    filename: path.basename(p),
                    path: p,
                    cid: cid,
                    contentDisposition: 'inline',
                    contentType: mimeMap[ext] || 'image/jpeg'
                  });
                  inlineHtml += `<br><img src="cid:${cid}" style="max-width:100%;height:auto;" alt="Product Image"><br>`;
                }
              });
              if (inlineAttachments.length > 0) {
                mailOptions.attachments = (mailOptions.attachments || []).concat(inlineAttachments);
                // 在邮件正文末尾（签名前）插入内嵌图片
                mailOptions.html = inlineHtml + '<br>' + mailOptions.html;
                console.log(`[Email] 内嵌图片: ${inlineAttachments.map(a => a.filename).join(', ')}`);
              }
            }
          } catch(e) {
            console.warn('[Email] 解析内嵌图片失败:', e.message);
          }
        }

        if (mailOptions.attachments && mailOptions.attachments.length > 0) {
          console.log(`[Email] 附件总数: ${mailOptions.attachments.length}`);
        }

        const info = await transporter.sendMail(mailOptions);

        // 发送成功
        this.db.prepare("UPDATE emails SET status='sent', sent_at=datetime('now'), from_addr=? WHERE id=?")
          .run(account.email, emailId);

        // 更新账号今日发送计数
        this.db.prepare('UPDATE email_accounts SET daily_sent = daily_sent + 1 WHERE id=?')
          .run(account.id);

        // 记录活动日志
        if (email.customer_id) {
          this.db.prepare("INSERT INTO activity_log (entity_type,entity_id,action,details) VALUES ('customer',?,?,?)")
            .run(email.customer_id, 'email_sent', JSON.stringify({ emailId, subject: email.subject, to: email.to_addr }));
        }

        console.log(`📧 邮件发送成功: ${email.to_addr} (via ${account.email})`);

        // 同步到统一收件箱（outgoing消息）
        try {
          const channelId = `email:${email.to_addr}:${account.id}`;
          const conv = this.db.prepare('SELECT id FROM inbox_conversations WHERE channel_id=?').get(channelId);
          if (conv) {
            this.db.prepare(`INSERT INTO inbox_messages 
              (conversation_id, channel, direction, sender_name, content, content_type, metadata)
              VALUES (?, 'email', 'out', ?, ?, 'text', ?)`)
              .run(conv.id, account.email, `📧 ${email.subject}\n\n${email.body}`, JSON.stringify({ email_id: emailId }));
            this.db.prepare(`UPDATE inbox_conversations SET last_message=?, last_message_at=datetime('now'), last_direction='out', updated_at=datetime('now') WHERE id=?`)
              .run(`📧 ${email.subject}`.substring(0, 200), conv.id);
          }
        } catch(syncErr) {
          console.warn('[EmailSender] 同步到收件箱失败:', syncErr.message);
        }

        return { success: true, messageId: info.messageId };

      } catch (err) {
        console.error(`[Email] 发送失败(尝试${attempt}/${maxRetries}):`, err.message);

        // 检测退信
        if (this._isBounce(err)) {
          this.db.prepare("UPDATE emails SET status='bounced', bounced=1 WHERE id=?").run(emailId);
          // 将退信地址加入黑名单
          try {
            this.db.prepare(
              "INSERT OR IGNORE INTO email_blacklist (email, reason, bounced_at, created_at) VALUES (?, ?, datetime('now'), datetime('now'))"
            ).run(email.to_addr, err.response || err.message);
          } catch(e) { /* ignore duplicate */ }
          // 检查退信率是否过高
          const bounceRate = this._getBounceRate(account.id);
          if (bounceRate > this._getBounceThreshold()) {
            this.db.prepare('UPDATE email_accounts SET is_active=0 WHERE id=?').run(account.id);
            console.warn(`⚠️ 邮箱 ${account.email} 退信率过高(${(bounceRate*100).toFixed(1)}%)，已自动暂停`);
          }
          return { success: false, error: '邮件退信: ' + err.message, bounced: true };
        }

        // 认证失败不重试
        if (err.code === 'EAUTH' || err.responseCode === 535) {
          this._clearTransporter(account.id);
          this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
          return { success: false, error: 'SMTP认证失败，请检查密码' };
        }

        if (attempt < maxRetries) {
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          this._clearTransporter(account.id); // 重建连接
        } else {
          // 最后一次重试也失败
          this.db.prepare("UPDATE emails SET status='failed' WHERE id=?").run(emailId);
          return { success: false, error: '发送失败: ' + err.message };
        }
      }
    }
  }

  /**
   * 判断是否是退信
   */
  _isBounce(err) {
    const bounceCodes = [550, 551, 552, 553, 554];
    if (err.responseCode && bounceCodes.includes(err.responseCode)) return true;
    if (err.response && /mailbox not found|user unknown|does not exist|invalid recipient/i.test(err.response)) return true;
    return false;
  }

  _selectSendAccountForCustomer(customerId) {
    // 优先用客户绑定的账号
    if (customerId) {
      const cust = this.db.prepare("SELECT preferred_email_account_id FROM customers WHERE id=?").get(customerId);
      if (cust && cust.preferred_email_account_id) {
        const bound = this.db.prepare("SELECT * FROM email_accounts WHERE id=? AND is_active=1").get(cust.preferred_email_account_id);
        if (bound) {
          const canSend = this._canSend(bound);
          if (canSend.can) return bound;
        }
      }
    }
    // 其次用默认账号
    const defaultId = this.db.prepare("SELECT value FROM settings WHERE key='default_email_account_id'").get();
    if (defaultId && defaultId.value) {
      const def = this.db.prepare("SELECT * FROM email_accounts WHERE id=? AND is_active=1").get(parseInt(defaultId.value));
      if (def) {
        const canSend = this._canSend(def);
        if (canSend.can) return def;
      }
    }
    // 兜底：原有轮询逻辑
    return this._selectSendAccount();
  }

  /**
   * 选择一个可用的发送账号（轮发策略）
   */
  _selectSendAccount() {
    const accounts = this.db.prepare(`
      SELECT * FROM email_accounts 
      WHERE is_active=1 AND (
        (auth_type='smtp' AND smtp_host IS NOT NULL AND smtp_host != '' AND smtp_pass IS NOT NULL AND smtp_pass != '')
        OR (auth_type='gmail_api' AND oauth_credentials IS NOT NULL AND oauth_credentials != '')
      )
      ORDER BY daily_sent ASC
    `).all();

    for (const account of accounts) {
      const canSend = this._canSend(account);
      if (canSend.can) return account;
    }
    return null;
  }

  /**
   * 批量发送（加入队列）
   * @param {number[]} emailIds - 邮件ID列表
   */
  async batchSend(emailIds) {
    if (!emailIds || !emailIds.length) {
      return { success: false, error: '无邮件可发送' };
    }

    // 将所有邮件标记为queued
    const stmt = this.db.prepare("UPDATE emails SET status='queued' WHERE id=? AND status IN ('draft', 'failed')");
    let queued = 0;
    emailIds.forEach(id => {
      const result = stmt.run(id);
      if (result.changes > 0) queued++;
    });

    return { success: true, queued, message: `${queued}封邮件已加入发送队列` };
  }

  /**
   * 处理发送队列 — 每次处理一封
   * 适合被定时调用（如每分钟一次）
   * @returns {{ sent: number, failed: number, remaining: number }}
   */
  async processQueue() {
    // 获取队列中的下一封
    const nextEmail = this.db.prepare(`
      SELECT * FROM emails 
      WHERE status='queued' 
      ORDER BY created_at ASC 
      LIMIT 1
    `).get();

    if (!nextEmail) {
      return { sent: 0, failed: 0, remaining: 0 };
    }

    const result = await this.sendEmail(nextEmail.id);

    const remaining = this.db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='queued'").get().c;

    return {
      sent: result.success ? 1 : 0,
      failed: result.success ? 0 : 1,
      remaining,
      lastResult: result
    };
  }

  /**
   * 重置所有账号的每日发送计数（凌晨调用）
   */
  resetDailySent() {
    this.db.prepare('UPDATE email_accounts SET daily_sent = 0').run();
    console.log('📧 邮件账号每日发送计数已重置');
  }

  /**
   * 关闭所有SMTP连接
   */
  closeAll() {
    this.transporters.forEach((t, key) => {
      try { t.close(); } catch {}
    });
    this.transporters.clear();
  }
}

module.exports = { EmailSender };
