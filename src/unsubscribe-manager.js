/**
 * 退订链接管理器
 * 生成一键退订链接 + List-Unsubscribe头 + 退订页面
 * 符合CAN-SPAM / GDPR / Gmail 2024要求
 * 只加不改 — 新模块
 */
const crypto = require('crypto');

class UnsubscribeManager {
  constructor(db, options = {}) {
    this.db = db;
    this.baseUrl = options.baseUrl || 'http://localhost:3001';
    this.secret = options.secret || 'vipb-unsub-secret-2026';
    this._ensureTable();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS unsubscribes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        reason TEXT,
        source TEXT DEFAULT 'link',
        unsubscribed_at DATETIME DEFAULT (datetime('now','localtime')),
        UNIQUE(email)
      )
    `);
    // 黑名单视图：email_blacklist可能已存在
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_unsub_email ON unsubscribes(email)`);
    } catch(e) {}
  }

  /**
   * 为邮件生成退订token
   */
  generateToken(email) {
    return crypto.createHmac('sha256', this.secret).update(email.toLowerCase()).digest('hex').substring(0, 32);
  }

  /**
   * 获取退订链接
   */
  getUnsubscribeUrl(email) {
    const token = this.generateToken(email);
    return `${this.baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
  }

  /**
   * 获取List-Unsubscribe邮件头（RFC 8058 一键退订）
   */
  getHeaders(email) {
    const url = this.getUnsubscribeUrl(email);
    return {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }

  /**
   * 在HTML邮件末尾插入退订链接
   */
  appendUnsubLink(html, email, lang = 'en') {
    const url = this.getUnsubscribeUrl(email);
    const texts = {
      en: 'If you no longer wish to receive emails from us, click here to unsubscribe.',
      zh: '如果您不希望继续收到我们的邮件，请点击此处退订。',
      ar: 'إذا كنت لا ترغب في تلقي رسائل بريد إلكتروني منا، انقر هنا لإلغاء الاشتراك.',
      es: 'Si no desea recibir más correos electrónicos, haga clic aquí para cancelar la suscripción.',
      pt: 'Se não deseja mais receber nossos e-mails, clique aqui para cancelar a inscrição.',
      fr: 'Si vous ne souhaitez plus recevoir nos e-mails, cliquez ici pour vous désabonner.'
    };
    const text = texts[lang] || texts.en;
    const footer = `
      <div style="margin-top:30px;padding-top:15px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#999">
        <a href="${url}" style="color:#999;text-decoration:underline">${text}</a>
      </div>
    `;
    // 在</body>前插入，如果没有body标签就追加末尾
    if (html.includes('</body>')) {
      return html.replace('</body>', footer + '</body>');
    }
    return html + footer;
  }

  /**
   * 处理退订请求
   */
  unsubscribe(email, token, reason = '', source = 'link') {
    email = email.toLowerCase().trim();
    const expected = this.generateToken(email);
    if (token !== expected) return { success: false, error: 'invalid_token' };

    // 写入退订表
    try {
      this.db.prepare(`
        INSERT INTO unsubscribes(email, token, reason, source) VALUES(?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET reason=excluded.reason, unsubscribed_at=datetime('now','localtime')
      `).run(email, token, reason, source);
    } catch(e) {}

    // 写入email_blacklist
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO email_blacklist(email, reason, created_at)
        VALUES(?, ?, datetime('now','localtime'))
      `).run(email, 'unsubscribed: ' + (reason || 'user request'));
    } catch(e) {}

    return { success: true };
  }

  /**
   * 检查是否已退订
   */
  isUnsubscribed(email) {
    const row = this.db.prepare('SELECT 1 FROM unsubscribes WHERE email = ?').get(email.toLowerCase());
    return !!row;
  }

  /**
   * 获取退订列表
   */
  list(limit = 100) {
    return this.db.prepare('SELECT * FROM unsubscribes ORDER BY unsubscribed_at DESC LIMIT ?').all(limit);
  }

  /**
   * 重新订阅（移出退订列表）
   */
  resubscribe(email) {
    email = email.toLowerCase();
    this.db.prepare('DELETE FROM unsubscribes WHERE email = ?').run(email);
    this.db.prepare("DELETE FROM email_blacklist WHERE email = ? AND reason LIKE 'unsubscribed%'").run(email);
    return { success: true };
  }
}

module.exports = { UnsubscribeManager };
