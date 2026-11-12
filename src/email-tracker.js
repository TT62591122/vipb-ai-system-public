/**
 * 邮件追踪引擎
 * - 打开追踪：1px透明像素
 * - 点击追踪：链接重写 → 记录 → 重定向
 * - 追踪数据写入 emails 表 (opened, clicked)
 */

class EmailTracker {
  constructor(db, baseUrl) {
    this.db = db;
    this.baseUrl = baseUrl || 'http://localhost:3001';
    this._ensureTable();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_tracking_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,  -- 'open' | 'click'
        url TEXT,                  -- clicked URL (for click events)
        ip TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tracking_email ON email_tracking_events(email_id);
    `);

    // Ensure opened/clicked columns exist
    try { this.db.exec('ALTER TABLE emails ADD COLUMN open_count INTEGER DEFAULT 0'); } catch {}
    try { this.db.exec('ALTER TABLE emails ADD COLUMN click_count INTEGER DEFAULT 0'); } catch {}
    try { this.db.exec('ALTER TABLE emails ADD COLUMN first_opened_at DATETIME'); } catch {}
    try { this.db.exec('ALTER TABLE emails ADD COLUMN first_clicked_at DATETIME'); } catch {}
  }

  /**
   * Inject tracking into email HTML body before sending
   * @param {number} emailId
   * @param {string} htmlBody
   * @returns {string} modified HTML with tracking pixel + rewritten links
   */
  injectTracking(emailId, htmlBody) {
    let body = htmlBody;

    // 1. Rewrite links for click tracking
    // Match <a href="..."> but skip mailto: and # links
    body = body.replace(
      /<a\s+([^>]*?)href=["'](https?:\/\/[^"']+)["']([^>]*?)>/gi,
      (match, before, url, after) => {
        const trackUrl = `${this.baseUrl}/api/track/click/${emailId}?url=${encodeURIComponent(url)}`;
        return `<a ${before}href="${trackUrl}"${after}>`;
      }
    );

    // 2. Append tracking pixel
    const pixelUrl = `${this.baseUrl}/api/track/open/${emailId}.png`;
    const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0;" alt="" />`;
    
    // Insert before </body> if exists, otherwise append
    if (body.includes('</body>')) {
      body = body.replace('</body>', pixel + '</body>');
    } else {
      body += pixel;
    }

    return body;
  }

  /**
   * Record an open event
   */
  recordOpen(emailId, ip, userAgent) {
    // Record event
    this.db.prepare(
      'INSERT INTO email_tracking_events (email_id, event_type, ip, user_agent) VALUES (?, ?, ?, ?)'
    ).run(emailId, 'open', ip || '', userAgent || '');

    // Update email record
    this.db.prepare(
      'UPDATE emails SET opened = 1, open_count = open_count + 1 WHERE id = ?'
    ).run(emailId);

    // Set first opened time
    this.db.prepare(
      "UPDATE emails SET first_opened_at = datetime('now') WHERE id = ? AND first_opened_at IS NULL"
    ).run(emailId);

    console.log(`📧 追踪: 邮件 #${emailId} 被打开 (IP: ${ip})`);
  }

  /**
   * Record a click event and return the original URL
   */
  recordClick(emailId, url, ip, userAgent) {
    // Record event
    this.db.prepare(
      'INSERT INTO email_tracking_events (email_id, event_type, url, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
    ).run(emailId, 'click', url, ip || '', userAgent || '');

    // Update email record
    this.db.prepare(
      'UPDATE emails SET clicked = 1, click_count = click_count + 1 WHERE id = ?'
    ).run(emailId);

    // Set first clicked time
    this.db.prepare(
      "UPDATE emails SET first_clicked_at = datetime('now') WHERE id = ? AND first_clicked_at IS NULL"
    ).run(emailId);

    console.log(`📧 追踪: 邮件 #${emailId} 链接被点击 → ${url}`);
    return url;
  }

  /**
   * Get tracking stats for an email
   */
  getStats(emailId) {
    const email = this.db.prepare(
      'SELECT opened, open_count, click_count, first_opened_at, first_clicked_at FROM emails WHERE id = ?'
    ).get(emailId);

    const events = this.db.prepare(
      'SELECT event_type, url, ip, created_at FROM email_tracking_events WHERE email_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(emailId);

    return { ...email, events };
  }

  /**
   * Get aggregate tracking stats
   */
  getAggregateStats() {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total_sent,
        SUM(CASE WHEN opened = 1 THEN 1 ELSE 0 END) as total_opened,
        SUM(CASE WHEN clicked = 1 THEN 1 ELSE 0 END) as total_clicked,
        ROUND(AVG(CASE WHEN status='sent' THEN opened ELSE NULL END) * 100, 1) as open_rate,
        ROUND(AVG(CASE WHEN status='sent' THEN clicked ELSE NULL END) * 100, 1) as click_rate
      FROM emails WHERE status = 'sent'
    `).get();

    return stats;
  }
}

module.exports = { EmailTracker };
