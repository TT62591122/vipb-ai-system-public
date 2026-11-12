/**
 * 邮件发送 API
 */
const router = require('express').Router();
const { EmailSender } = require('../src/email-sender');
const { EmailReceiver } = require('../src/email-receiver');
const { encrypt, decrypt } = require('../src/crypto-utils');
const { validateBody } = require('../src/input-validator');
const { google } = require('googleapis');
const OAuth2Client = google.auth.OAuth2;

// 邮箱服务商预设配置
// guide_url 指向稳定的账户主页（不会变），steps 提供操作步骤（即使页面改版也能找到）
const EMAIL_PRESETS = {
  'gmail.com': { smtp_host: 'smtp.gmail.com', smtp_port: 587, imap_host: 'imap.gmail.com', imap_port: 993, note: '需开启应用专用密码', guide_url: 'https://myaccount.google.com/', steps: '登录Google账户 → 安全性 → 两步验证(先开启) → 应用专用密码 → 选择"邮件" → 生成 → 复制16位密码' },
  'googlemail.com': { smtp_host: 'smtp.gmail.com', smtp_port: 587, imap_host: 'imap.gmail.com', imap_port: 993, note: '同Gmail', guide_url: 'https://myaccount.google.com/', steps: '同Gmail：安全性 → 两步验证 → 应用专用密码' },
  'outlook.com': { smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, note: '需生成应用密码', guide_url: 'https://account.microsoft.com/security', steps: '登录Microsoft账户 → 安全 → 高级安全选项 → 应用密码 → 创建新密码 → 复制' },
  'hotmail.com': { smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, note: '同Outlook', guide_url: 'https://account.microsoft.com/security', steps: '同Outlook操作' },
  'live.com': { smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, note: '同Outlook', guide_url: 'https://account.microsoft.com/security', steps: '同Outlook操作' },
  'msn.com': { smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, note: '同Outlook', guide_url: 'https://account.microsoft.com/security', steps: '同Outlook操作' },
  'outlook.jp': { smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, note: '同Outlook', guide_url: 'https://account.microsoft.com/security', steps: '同Outlook操作' },
  'icloud.com': { smtp_host: 'smtp.mail.me.com', smtp_port: 587, imap_host: 'imap.mail.me.com', imap_port: 993, note: '需生成应用专用密码', guide_url: 'https://appleid.apple.com/', steps: '登录Apple ID → 登录和安全 → 应用专用密码 → 生成 → 复制' },
  'me.com': { smtp_host: 'smtp.mail.me.com', smtp_port: 587, imap_host: 'imap.mail.me.com', imap_port: 993, note: '同iCloud', guide_url: 'https://appleid.apple.com/', steps: '同iCloud操作' },
  'mac.com': { smtp_host: 'smtp.mail.me.com', smtp_port: 587, imap_host: 'imap.mail.me.com', imap_port: 993, note: '同iCloud', guide_url: 'https://appleid.apple.com/', steps: '同iCloud操作' },
  '163.com': { smtp_host: 'smtp.163.com', smtp_port: 465, imap_host: 'imap.163.com', imap_port: 993, note: '需获取授权码', guide_url: 'https://mail.163.com/', steps: '登录网页版163邮箱 → 设置 → POP3/SMTP/IMAP → 开启SMTP → 按提示用手机验证 → 获取授权码 → 复制' },
  '126.com': { smtp_host: 'smtp.126.com', smtp_port: 465, imap_host: 'imap.126.com', imap_port: 993, note: '需获取授权码', guide_url: 'https://mail.126.com/', steps: '登录网页版126邮箱 → 设置 → POP3/SMTP/IMAP → 开启SMTP → 获取授权码' },
  'yeah.net': { smtp_host: 'smtp.yeah.net', smtp_port: 465, imap_host: 'imap.yeah.net', imap_port: 993, note: '需获取授权码', guide_url: 'https://www.yeah.net/', steps: '登录网页版 → 设置 → POP3/SMTP/IMAP → 开启SMTP → 获取授权码' },
  'qq.com': { smtp_host: 'smtp.qq.com', smtp_port: 465, imap_host: 'imap.qq.com', imap_port: 993, note: '需获取授权码', guide_url: 'https://mail.qq.com/', steps: '登录QQ邮箱网页版 → 设置 → 账户 → POP3/IMAP/SMTP服务 → 开启SMTP → 验证密保 → 获取授权码 → 复制' },
  'foxmail.com': { smtp_host: 'smtp.qq.com', smtp_port: 465, imap_host: 'imap.qq.com', imap_port: 993, note: '同QQ邮箱', guide_url: 'https://mail.qq.com/', steps: '同QQ邮箱操作' },
  'sina.com': { smtp_host: 'smtp.sina.com', smtp_port: 465, imap_host: 'imap.sina.com', imap_port: 993, note: '需开启SMTP', guide_url: 'https://mail.sina.com.cn/', steps: '登录新浪邮箱 → 设置 → 客户端/POP/IMAP/SMTP → 开启SMTP' },
  'sina.cn': { smtp_host: 'smtp.sina.com', smtp_port: 465, imap_host: 'imap.sina.com', imap_port: 993, note: '同新浪邮箱', guide_url: 'https://mail.sina.com.cn/', steps: '同新浪邮箱操作' },
  'sohu.com': { smtp_host: 'smtp.sohu.com', smtp_port: 465, imap_host: 'imap.sohu.com', imap_port: 993, note: '需开启SMTP', guide_url: 'https://mail.sohu.com/', steps: '登录搜狐邮箱 → 设置 → 客户端设置 → 开启SMTP' },
  'aliyun.com': { smtp_host: 'smtp.aliyun.com', smtp_port: 465, imap_host: 'imap.aliyun.com', imap_port: 993, note: '需开启SMTP', guide_url: 'https://mail.aliyun.com/', steps: '登录阿里云邮箱 → 设置 → 账户 → 开启SMTP' },
  'yahoo.com': { smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465, imap_host: 'imap.mail.yahoo.com', imap_port: 993, note: '需生成应用密码', guide_url: 'https://login.yahoo.com/account/security', steps: '登录Yahoo → 账户安全 → 生成应用密码 → 选择"其他应用" → 生成 → 复制' },
  'yahoo.co.jp': { smtp_host: 'smtp.mail.yahoo.co.jp', smtp_port: 465, imap_host: 'imap.mail.yahoo.co.jp', imap_port: 993, note: '需生成应用密码', guide_url: 'https://login.yahoo.co.jp/', steps: '登录Yahoo Japan → 安全设置 → 应用密码' },
  'zoho.com': { smtp_host: 'smtp.zoho.com', smtp_port: 465, imap_host: 'imap.zoho.com', imap_port: 993, note: '需允许SMTP访问', guide_url: 'https://accounts.zoho.com/', steps: '登录Zoho → 安全 → 应用专用密码 → 生成' },
  'yandex.com': { smtp_host: 'smtp.yandex.com', smtp_port: 465, imap_host: 'imap.yandex.com', imap_port: 993, note: '需开启IMAP/SMTP', guide_url: 'https://mail.yandex.com/', steps: '登录Yandex邮箱 → 设置 → 邮件客户端 → 开启IMAP/SMTP' },
  'yandex.ru': { smtp_host: 'smtp.yandex.ru', smtp_port: 465, imap_host: 'imap.yandex.ru', imap_port: 993, note: '需开启IMAP/SMTP', guide_url: 'https://mail.yandex.ru/', steps: '同Yandex操作' },
  'protonmail.com': { smtp_host: 'smtp.protonmail.ch', smtp_port: 465, imap_host: 'imap.protonmail.ch', imap_port: 993, note: '需ProtonMail Bridge', guide_url: 'https://proton.me/mail/bridge', steps: '下载安装ProtonMail Bridge → 登录 → 获取Bridge专用密码' },
  'proton.me': { smtp_host: 'smtp.protonmail.ch', smtp_port: 465, imap_host: 'imap.protonmail.ch', imap_port: 993, note: '需ProtonMail Bridge', guide_url: 'https://proton.me/mail/bridge', steps: '同ProtonMail操作' },
  'aol.com': { smtp_host: 'smtp.aol.com', smtp_port: 465, imap_host: 'imap.aol.com', imap_port: 993, note: '需生成应用密码', guide_url: 'https://login.aol.com/', steps: '登录AOL → 账户安全 → 生成应用密码' },
  'mail.ru': { smtp_host: 'smtp.mail.ru', smtp_port: 465, imap_host: 'imap.mail.ru', imap_port: 993, note: '需开启SMTP', guide_url: 'https://mail.ru/', steps: '登录Mail.ru → 设置 → 安全 → 应用密码 → 创建' },
  'gmx.com': { smtp_host: 'mail.gmx.com', smtp_port: 465, imap_host: 'imap.gmx.com', imap_port: 993, note: '需开启IMAP', guide_url: 'https://www.gmx.com/', steps: '登录GMX → 设置 → POP3/IMAP → 开启IMAP' },
  'gmx.net': { smtp_host: 'mail.gmx.net', smtp_port: 465, imap_host: 'imap.gmx.net', imap_port: 993, note: '需开启IMAP', guide_url: 'https://www.gmx.net/', steps: '同GMX操作' },
};

module.exports = function(db) {
  const sender = new EmailSender(db);

  // 根据邮箱地址获取预设配置
  router.get('/email-presets', (req, res) => {
    const { email } = req.query;
    if (!email || !email.includes('@')) {
      return res.json({ success: true, data: { presets: EMAIL_PRESETS } });
    }
    const domain = email.split('@')[1].toLowerCase();
    const preset = EMAIL_PRESETS[domain];
    if (preset) {
      res.json({ success: true, data: { matched: true, domain, ...preset } });
    } else {
      res.json({ success: true, data: { matched: false, domain, note: '未识别的邮箱服务商，请手动填写SMTP/IMAP配置' } });
    }
  });

  // ========== 邮件账号 CRUD ==========
  // 列表
  router.get('/email-accounts', (req, res) => {
    try {
      const accounts = db.prepare('SELECT id, email, display_name, smtp_host, smtp_port, imap_host, imap_port, warmup_stage, daily_sent, daily_limit, health_score, is_active, auth_type, created_at FROM email_accounts ORDER BY id DESC').all();
      res.json({ success: true, data: accounts });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 创建
  router.post('/email-accounts', (req, res) => {
    try {
      const { email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, daily_limit, auth_type, gmail_client_id, gmail_client_secret } = req.body;
      if (!email) return res.status(400).json({ success: false, error: '邮箱地址必填' });

      const stmt = db.prepare(`INSERT INTO email_accounts 
        (email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, daily_limit, auth_type, gmail_client_id, gmail_client_secret)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

      const result = stmt.run(
        email, 
        display_name || '', 
        smtp_host || '', 
        smtp_port || 587, 
        smtp_user || '', 
        smtp_pass ? encrypt(smtp_pass) : '', 
        imap_host || '', 
        imap_port || 993, 
        daily_limit || 40,
        auth_type || 'smtp',
        gmail_client_id || '',
        gmail_client_secret ? encrypt(gmail_client_secret) : ''
      );
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(400).json({ success: false, error: '该邮箱已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 更新
  router.put('/email-accounts/:id', (req, res) => {
    try {
      const { email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, daily_limit, warmup_stage, is_active, auth_type, oauth_credentials, gmail_client_id, gmail_client_secret } = req.body;
      const fields = [];
      const values = [];
      if (email !== undefined) { fields.push('email=?'); values.push(email); }
      if (display_name !== undefined) { fields.push('display_name=?'); values.push(display_name); }
      if (smtp_host !== undefined) { fields.push('smtp_host=?'); values.push(smtp_host); }
      if (smtp_port !== undefined) { fields.push('smtp_port=?'); values.push(smtp_port); }
      if (smtp_user !== undefined) { fields.push('smtp_user=?'); values.push(smtp_user); }
      if (smtp_pass !== undefined) { fields.push('smtp_pass=?'); values.push(smtp_pass ? encrypt(smtp_pass) : ''); }
      if (imap_host !== undefined) { fields.push('imap_host=?'); values.push(imap_host); }
      if (imap_port !== undefined) { fields.push('imap_port=?'); values.push(imap_port); }
      if (daily_limit !== undefined) { fields.push('daily_limit=?'); values.push(daily_limit); }
      if (warmup_stage !== undefined) { fields.push('warmup_stage=?'); values.push(warmup_stage); }
      if (is_active !== undefined) { fields.push('is_active=?'); values.push(is_active); }
      if (auth_type !== undefined) { fields.push('auth_type=?'); values.push(auth_type); }
      if (oauth_credentials !== undefined) { fields.push('oauth_credentials=?'); values.push(oauth_credentials ? encrypt(oauth_credentials) : ''); }
      if (gmail_client_id !== undefined) { fields.push('gmail_client_id=?'); values.push(gmail_client_id); }
      if (gmail_client_secret !== undefined) { fields.push('gmail_client_secret=?'); values.push(gmail_client_secret ? encrypt(gmail_client_secret) : ''); }
      if (!fields.length) return res.status(400).json({ success: false, error: '无更新字段' });
      values.push(req.params.id);
      db.prepare(`UPDATE email_accounts SET ${fields.join(',')} WHERE id=?`).run(...values);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 删除
  router.delete('/email-accounts/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM email_accounts WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 测试连接
  router.post('/email-accounts/:id/test', async (req, res) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = db.prepare('SELECT * FROM email_accounts WHERE id=?').get(accountId);
      if (!account) {
        return res.status(404).json({ success: false, error: '邮箱账号不存在' });
      }

      if (account.auth_type === 'gmail_api') {
        // 测试Gmail API连接
        if (!account.gmail_client_id || !account.gmail_client_secret) {
          return res.status(400).json({ success: false, error: '请先配置Gmail Client ID和Secret' });
        }
        if (!account.oauth_credentials) {
          return res.status(400).json({ success: false, error: 'Gmail账号未授权，请先进行OAuth授权' });
        }
        try {
          const credentials = JSON.parse(decrypt(account.oauth_credentials));
          const oauth2Client = new OAuth2Client(
            decrypt(account.gmail_client_id),
            decrypt(account.gmail_client_secret),
            'http://localhost:3001/api/email-accounts/gmail-callback'
          );
          oauth2Client.setCredentials(credentials);

          // 配置代理访问Google API
          try {
            const { HttpsProxyAgent } = require('https-proxy-agent');
            const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:2080';
            oauth2Client.transporter.defaults = { ...(oauth2Client.transporter.defaults || {}), agent: new HttpsProxyAgent(proxyUrl) };
          } catch (pe) { /* 代理不可用则直连 */ }

          // 检查 token 是否过期，并尝试刷新
          if (oauth2Client.isTokenExpiring()) {
            console.log(`[Gmail Test] 账号 ${account.email} token即将过期，尝试刷新...`);
            const { credentials: refreshedTokens } = await oauth2Client.refreshAccessToken();
            db.prepare(
              'UPDATE email_accounts SET oauth_credentials=? WHERE id=?'
            ).run(encrypt(JSON.stringify(refreshedTokens)), accountId);
            oauth2Client.setCredentials(refreshedTokens);
            console.log(`[Gmail Test] 账号 ${account.email} token刷新成功。`);
          }

          const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
          await gmail.users.getProfile({ userId: 'me' }); // 调用一个简单的API验证连接
          return res.json({ success: true, message: `Gmail API连接成功: ${account.email}` });
        } catch (err) {
          let errorMsg = err.message;
          if (err.code === 401 || (err.errors && err.errors[0] && err.errors[0].reason === 'authError')) {
            errorMsg = 'Gmail认证失败或授权已过期，请重新授权。';
          } else if (err.response && err.response.data && err.response.data.error === 'invalid_grant') {
            errorMsg = 'Gmail授权已失效，请重新授权。';
          }
          return res.status(400).json({ success: false, error: `Gmail API连接失败: ${errorMsg}` });
        }
      } else {
        // 测试SMTP连接
        const result = await sender.testConnection(accountId);
        sender.closeAll();
        return res.json(result);
      }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // Gmail OAuth 授权 - 生成授权URL
  router.get('/email-accounts/:id/gmail-auth-url', (req, res) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = db.prepare('SELECT * FROM email_accounts WHERE id=?').get(accountId);

      if (!account) {
        return res.status(404).json({ success: false, error: '邮箱账号不存在' });
      }
      if (!account.gmail_client_id || !account.gmail_client_secret) {
        return res.status(400).json({ success: false, error: '请先配置Gmail Client ID和Secret' });
      }

      const oauth2Client = new OAuth2Client(
        decrypt(account.gmail_client_id),
        decrypt(account.gmail_client_secret),
        'http://localhost:3001/api/email-accounts/gmail-callback'
      );

      const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // 获取refresh_token
        scope: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'],
        state: JSON.stringify({ account_id: accountId }), // 将account_id带入state
        prompt: 'consent' // 每次都显示授权页面，确保能获取refresh token
      });
      res.json({ success: true, url: authorizeUrl });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Gmail OAuth 回调
  router.get('/email-accounts/gmail-callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        return res.redirect('/settings?auth_status=failed&error=missing_code_or_state#tab-email-config');
      }

      const { account_id } = JSON.parse(state);
      const account = db.prepare('SELECT * FROM email_accounts WHERE id=?').get(account_id);

      if (!account) {
        return res.redirect('/settings?auth_status=failed&error=account_not_found#tab-email-config');
      }
      if (!account.gmail_client_id || !account.gmail_client_secret) {
        return res.redirect('/settings?auth_status=failed&error=client_id_secret_missing#tab-email-config');
      }

      const oauth2Client = new OAuth2Client(
        decrypt(account.gmail_client_id),
        decrypt(account.gmail_client_secret),
        'http://localhost:3001/api/email-accounts/gmail-callback'
      );

      // 配置代理访问Google API（getToken需要连接Google服务器）
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:2080';
        oauth2Client.transporter.defaults = { ...(oauth2Client.transporter.defaults || {}), agent: new HttpsProxyAgent(proxyUrl) };
      } catch (pe) { /* 代理不可用则直连 */ }

      const { tokens } = await oauth2Client.getToken(code);
      
      // 加密存储 tokens 到 oauth_credentials
      db.prepare(
        'UPDATE email_accounts SET oauth_credentials=? WHERE id=?'
      ).run(encrypt(JSON.stringify(tokens)), account_id);

      res.redirect('/settings?auth_status=success#tab-email-config');
    } catch (e) {
      console.error('Gmail OAuth callback error:', e);
      res.redirect(`/settings?auth_status=failed&error=${encodeURIComponent(e.message)}#tab-email-config`);
    }
  });

  // ========== 邮件 CRUD & 发送 ==========
  // 邮件列表
  router.get('/emails', (req, res) => {
    try {
      const { status, customer_id, page = 1, limit = 50 } = req.query;
      let where = '1=1';
      const params = [];
      if (status) { where += ' AND e.status=?'; params.push(status); }
      if (customer_id) { where += ' AND e.customer_id=?'; params.push(customer_id); }
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const total = db.prepare(`SELECT COUNT(*) as c FROM emails e WHERE ${where}`).get(...params).c;
      const data = db.prepare(`SELECT e.*, ea.email as account_email FROM emails e LEFT JOIN email_accounts ea ON e.account_id=ea.id WHERE ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
      res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 创建邮件(草稿)
  router.post('/emails', (req, res) => {
    try {
      const { customer_id, account_id, to_addr, subject, body } = req.body;
      if (!to_addr || !subject) return res.status(400).json({ success: false, error: '收件人和主题必填' });
      const result = db.prepare(`INSERT INTO emails (customer_id, account_id, to_addr, subject, body, status) VALUES (?,?,?,?,?,'draft')`)
        .run(customer_id || null, account_id || null, to_addr, subject, body || '');
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 发送邮件
  router.post('/emails/send', async (req, res) => {
    try {
      const { id, to_addr, subject, body, account_id, customer_id } = req.body;
      let emailId = id;
      // 如果没有id，先创建邮件
      if (!emailId) {
        if (!to_addr || !subject) return res.status(400).json({ success: false, error: '收件人和主题必填' });
        const result = db.prepare(`INSERT INTO emails (customer_id, account_id, to_addr, subject, body, status) VALUES (?,?,?,?,?,'draft')`)
          .run(customer_id || null, account_id || null, to_addr, subject, body || '');
        emailId = result.lastInsertRowid;
      }
      const result = await sender.sendEmail(emailId);
      sender.closeAll();
      res.json({ success: result.success, ...result, emailId });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 批量发送（加入队列）
  router.post('/emails/batch-send', async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !ids.length) return res.status(400).json({ success: false, error: '请提供邮件ID列表' });
      const result = await sender.batchSend(ids);
      res.json(result);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 测试发送
  router.post('/emails/send-test', async (req, res) => {
    try {
      const { to_addr, subject, body, account_id } = req.body;
      if (!to_addr) return res.status(400).json({ success: false, error: '收件人必填' });
      const result = db.prepare(`INSERT INTO emails (account_id, to_addr, subject, body, status) VALUES (?,?,?,?,'draft')`)
        .run(account_id || null, to_addr, subject || '测试邮件', body || '这是一封测试邮件。');
      const emailId = result.lastInsertRowid;
      const sendResult = await sender.sendEmail(emailId);
      sender.closeAll();
      res.json({ success: sendResult.success, ...sendResult, emailId });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ===== 邮箱验证 API =====

  // 验证单个邮箱
  router.post('/emails/verify', async (req, res) => {
    try {
      const { email, skipSmtp } = req.body;
      if (!email) return res.status(400).json({ success: false, error: '邮箱地址必填' });
      const { EmailVerifier } = require('../src/email-verifier');
      const verifier = new EmailVerifier(db);
      const result = await verifier.verify(email, { skipSmtp: skipSmtp !== false });
      res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 批量验证邮箱（最多50个）
  router.post('/emails/batch-verify', async (req, res) => {
    try {
      const { emails, skipSmtp } = req.body;
      if (!Array.isArray(emails) || !emails.length) {
        return res.status(400).json({ success: false, error: '请提供邮箱地址数组' });
      }
      if (emails.length > 50) {
        return res.status(400).json({ success: false, error: '单次最多验证50个邮箱' });
      }
      const { EmailVerifier } = require('../src/email-verifier');
      const verifier = new EmailVerifier(db);
      const results = await verifier.batchVerify(emails, { skipSmtp: skipSmtp !== false });
      const valid = results.filter(r => r.valid).length;
      const invalid = results.filter(r => !r.valid).length;
      res.json({ success: true, total: emails.length, valid, invalid, results });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 审批邮件（将draft变为queued，加入发送队列）
  router.post('/emails/approve', async (req, res) => {
    try {
      const { id, ids } = req.body;
      const emailIds = ids || (id ? [id] : []);
      if (!emailIds.length) return res.status(400).json({ success: false, error: '请提供邮件ID' });
      
      let approved = 0;
      const stmt = db.prepare("UPDATE emails SET status='queued' WHERE id=? AND status='draft'");
      for (const eid of emailIds) {
        const r = stmt.run(eid);
        if (r.changes > 0) approved++;
      }
      res.json({ success: true, approved, message: `${approved}封邮件已审批通过，加入发送队列` });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 拒绝邮件草稿
  router.post('/emails/reject', async (req, res) => {
    try {
      const { id, ids, reason } = req.body;
      const emailIds = ids || (id ? [id] : []);
      if (!emailIds.length) return res.status(400).json({ success: false, error: '请提供邮件ID' });
      
      let rejected = 0;
      const stmt = db.prepare("UPDATE emails SET status='rejected' WHERE id=? AND status='draft'");
      for (const eid of emailIds) {
        const r = stmt.run(eid);
        if (r.changes > 0) rejected++;
      }
      res.json({ success: true, rejected, message: `${rejected}封邮件已拒绝` });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
};
