/**
 * 邮件地址验证引擎
 * - 格式验证（正则）
 * - MX记录检查（DNS）
 * - SMTP握手验证（RCPT TO）
 * - 一次性邮箱检测
 * - 结果缓存（避免重复查询）
 * 
 * 用法：
 *   const verifier = new EmailVerifier(db);
 *   const result = await verifier.verify('test@example.com');
 *   // { valid: true/false, reason: '...', score: 0-100 }
 */
const dns = require('dns').promises;
const net = require('net');

// 一次性邮箱域名黑名单（常见的）
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'dispostable.com', 'mailnesia.com', 'maildrop.cc', 'temp-mail.org',
  'fakeinbox.com', 'trashmail.com', 'getnada.com', '10minutemail.com',
  'mohmal.com', 'tempail.com', 'burnermail.io', 'mailsac.com'
]);

// 角色账号（通常不是真人）
const ROLE_ACCOUNTS = new Set([
  'noreply', 'no-reply', 'postmaster', 'abuse', 'admin', 'webmaster',
  'info', 'support', 'sales', 'contact', 'help', 'mailer-daemon'
]);

class EmailVerifier {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS email_verification_cache (
      email TEXT PRIMARY KEY,
      valid INTEGER,
      score INTEGER,
      reason TEXT,
      mx_host TEXT,
      checked_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+7 days'))
    )`).run();
  }

  /**
   * 验证邮箱地址
   * @param {string} email 
   * @param {object} opts - { skipSmtp: false, forceRefresh: false }
   * @returns {{ valid: boolean, score: number, reason: string, cached: boolean }}
   */
  async verify(email, opts = {}) {
    email = (email || '').trim().toLowerCase();
    
    // 1. 格式检查
    if (!this._isValidFormat(email)) {
      return { valid: false, score: 0, reason: '邮箱格式无效', cached: false };
    }

    // 2. 查缓存
    if (!opts.forceRefresh) {
      const cached = this.db.prepare(
        "SELECT * FROM email_verification_cache WHERE email = ? AND expires_at > datetime('now')"
      ).get(email);
      if (cached) {
        return { valid: !!cached.valid, score: cached.score, reason: cached.reason, cached: true };
      }
    }

    const [local, domain] = email.split('@');
    let score = 100;
    let reasons = [];

    // 3. 一次性邮箱检测
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return this._saveAndReturn(email, false, 0, '一次性邮箱域名');
    }

    // 4. 角色账号检测
    if (ROLE_ACCOUNTS.has(local)) {
      score -= 30;
      reasons.push('角色账号');
    }

    // 5. MX记录检查
    let mxHost = null;
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        return this._saveAndReturn(email, false, 0, '域名无MX记录');
      }
      mxRecords.sort((a, b) => a.priority - b.priority);
      mxHost = mxRecords[0].exchange;
    } catch (e) {
      if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
        return this._saveAndReturn(email, false, 0, '域名不存在或无MX记录');
      }
      // DNS超时等临时错误，降分但不判死
      score -= 20;
      reasons.push('MX查询失败: ' + e.code);
    }

    // 6. SMTP握手验证（可选）
    if (!opts.skipSmtp && mxHost) {
      try {
        const smtpResult = await this._smtpCheck(email, mxHost);
        if (smtpResult.catchAll) {
          score -= 10;
          reasons.push('Catch-all域名');
        } else if (!smtpResult.exists) {
          return this._saveAndReturn(email, false, 10, 'SMTP验证: 邮箱不存在', mxHost);
        }
      } catch (e) {
        // SMTP验证失败不判死，只降分
        score -= 15;
        reasons.push('SMTP验证超时');
      }
    }

    const valid = score >= 50;
    const reason = reasons.length ? reasons.join('; ') : 'OK';
    return this._saveAndReturn(email, valid, score, reason, mxHost);
  }

  /**
   * 批量验证
   */
  async batchVerify(emails, opts = {}) {
    const results = [];
    for (const email of emails) {
      const result = await this.verify(email, opts);
      results.push({ email, ...result });
      // 避免被MX服务器限速
      await new Promise(r => setTimeout(r, 500));
    }
    return results;
  }

  /**
   * 格式验证
   */
  _isValidFormat(email) {
    const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    return re.test(email);
  }

  /**
   * SMTP RCPT TO 验证
   */
  _smtpCheck(email, mxHost) {
    return new Promise((resolve, reject) => {
      const timeout = 10000;
      const socket = net.createConnection(25, mxHost);
      let step = 0;
      let response = '';
      let catchAll = false;

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('SMTP timeout'));
      }, timeout);

      socket.setEncoding('utf8');
      socket.on('data', (data) => {
        response += data;
        if (!response.includes('\r\n')) return;
        
        const code = parseInt(response.substring(0, 3));
        response = '';

        if (step === 0 && code === 220) {
          socket.write('EHLO verify.local\r\n');
          step = 1;
        } else if (step === 1 && code === 250) {
          socket.write('MAIL FROM:<verify@verify.local>\r\n');
          step = 2;
        } else if (step === 2 && code === 250) {
          // 先测一个不存在的地址检测catch-all
          const fakeAddr = `nonexist_${Date.now()}@${email.split('@')[1]}`;
          socket.write(`RCPT TO:<${fakeAddr}>\r\n`);
          step = 3;
        } else if (step === 3) {
          if (code === 250) {
            catchAll = true; // catch-all域名，接受任何地址
          }
          // 测真实地址
          socket.write(`RCPT TO:<${email}>\r\n`);
          step = 4;
        } else if (step === 4) {
          clearTimeout(timer);
          socket.write('QUIT\r\n');
          socket.end();
          resolve({ exists: code === 250, catchAll });
        } else {
          clearTimeout(timer);
          socket.destroy();
          // 某些服务器拒绝验证，不判死
          resolve({ exists: true, catchAll: false });
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  _saveAndReturn(email, valid, score, reason, mxHost = null) {
    try {
      this.db.prepare(`INSERT OR REPLACE INTO email_verification_cache 
        (email, valid, score, reason, mx_host, checked_at, expires_at) 
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))`)
        .run(email, valid ? 1 : 0, score, reason, mxHost);
    } catch (e) {
      console.error('[EmailVerifier] 缓存写入失败:', e.message);
    }
    return { valid, score, reason, cached: false };
  }
}

module.exports = { EmailVerifier };
