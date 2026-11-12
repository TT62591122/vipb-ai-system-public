/**
 * 报价跟踪引擎
 * - 记录每次报价（人工填写）
 * - 跟踪客户报价状态（待报价→已报价→跟进中→成交/丢失）
 * - 报价历史查询
 * - 报价提醒（报价后N天未回复→提醒跟进）
 * 
 * ⚠️ 报价只能由人工创建，AI只负责记录和提醒
 */

class QuoteTracker {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      customer_email TEXT,
      customer_name TEXT,
      channel TEXT,
      products TEXT,
      quantity TEXT,
      quoted_price TEXT,
      currency TEXT DEFAULT 'USD',
      incoterm TEXT DEFAULT 'FOB',
      payment_terms TEXT,
      validity_days INTEGER DEFAULT 30,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      pending_action_id INTEGER,
      quoted_at TEXT,
      followed_up_at TEXT,
      closed_at TEXT,
      close_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();

    try {
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id)').run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status)').run();
    } catch(e) {}
  }

  /**
   * 创建报价记录（人工操作）
   */
  create(quote) {
    const result = this.db.prepare(`INSERT INTO quotes 
      (customer_id, customer_email, customer_name, channel, products, quantity, 
       quoted_price, currency, incoterm, payment_terms, validity_days, status, notes, pending_action_id, quoted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(
        quote.customerId || null,
        quote.customerEmail || null,
        quote.customerName || null,
        quote.channel || null,
        quote.products || null,
        quote.quantity || null,
        quote.quotedPrice || null,
        quote.currency || 'USD',
        quote.incoterm || 'FOB',
        quote.paymentTerms || null,
        quote.validityDays || 30,
        'quoted',
        quote.notes || null,
        quote.pendingActionId || null
      );
    
    // 如果关联了待办，标记待办为已处理
    if (quote.pendingActionId) {
      this.db.prepare(`UPDATE pending_actions SET status = 'resolved', handled_at = datetime('now'), handled_by = 'admin', notes = '已报价 #${result.lastInsertRowid}', updated_at = datetime('now') WHERE id = ?`)
        .run(quote.pendingActionId);
    }
    
    return result.lastInsertRowid;
  }

  /**
   * 更新报价状态
   */
  updateStatus(id, status, reason = '') {
    const updates = { status, updated_at: "datetime('now')" };
    if (status === 'won' || status === 'lost') {
      this.db.prepare(`UPDATE quotes SET status = ?, close_reason = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(status, reason, id);
    } else {
      this.db.prepare(`UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(status, id);
    }
  }

  /**
   * 记录跟进
   */
  markFollowedUp(id) {
    this.db.prepare(`UPDATE quotes SET followed_up_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
  }

  /**
   * 获取需要跟进的报价（报价后N天未回复）
   */
  getNeedFollowUp(days = 3) {
    return this.db.prepare(`
      SELECT * FROM quotes 
      WHERE status = 'quoted' 
        AND quoted_at < datetime('now', '-${days} days')
        AND (followed_up_at IS NULL OR followed_up_at < datetime('now', '-${days} days'))
      ORDER BY quoted_at ASC
    `).all();
  }

  /**
   * 获取即将过期的报价
   */
  getExpiring(withinDays = 7) {
    return this.db.prepare(`
      SELECT * FROM quotes 
      WHERE status IN ('quoted', 'following_up')
        AND datetime(quoted_at, '+' || validity_days || ' days') < datetime('now', '+${withinDays} days')
        AND datetime(quoted_at, '+' || validity_days || ' days') > datetime('now')
      ORDER BY quoted_at ASC
    `).all();
  }

  /**
   * 获取客户的报价历史
   */
  getByCustomer(customerId) {
    return this.db.prepare('SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
  }

  /**
   * 报价统计
   */
  getStats(period = '30d') {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const stats = this.db.prepare(`
      SELECT status, COUNT(*) as count, 
             SUM(CASE WHEN quoted_price IS NOT NULL THEN CAST(quoted_price AS REAL) ELSE 0 END) as total_value
      FROM quotes 
      WHERE created_at > datetime('now', '-${days} days')
      GROUP BY status
    `).all();
    
    const total = stats.reduce((s, r) => s + r.count, 0);
    const won = stats.find(s => s.status === 'won');
    const winRate = total > 0 && won ? (won.count / total * 100).toFixed(1) : '0.0';
    
    return { period, total, byStatus: stats, winRate: winRate + '%' };
  }

  /**
   * 列表查询
   */
  list(opts = {}) {
    let sql = 'SELECT * FROM quotes WHERE 1=1';
    const params = [];
    
    if (opts.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts.channel) { sql += ' AND channel = ?'; params.push(opts.channel); }
    if (opts.customerId) { sql += ' AND customer_id = ?'; params.push(opts.customerId); }
    
    sql += ' ORDER BY created_at DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    
    return this.db.prepare(sql).all(...params);
  }
}

module.exports = { QuoteTracker };
