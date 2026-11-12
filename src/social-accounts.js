/**
 * 社媒账号管理引擎
 * 统一管理 WhatsApp / TikTok / Facebook / LinkedIn 账号
 */

class SocialAccountManager {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this._initTables();
  }

  /**
   * 获取平台默认每日限额（优先从数据库防封规则读取）
   */
  _getPlatformDefaultLimit(platform) {
    const hardDefaults = { whatsapp: 30, tiktok: 3, facebook: 25, linkedin: 20, instagram: 30, twitter: 10, youtube: 5 };
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='antiban_rules'").get();
      if (row) {
        const rules = JSON.parse(row.value);
        const sending = rules[platform]?.sending;
        if (sending) {
          // 不同平台的主要限额字段名不同
          return sending.max_daily_outbound || sending.max_daily_messages || sending.max_daily_posts
            || sending.max_daily_per_account || hardDefaults[platform] || 20;
        }
      }
    } catch (e) { /* 读取失败用默认值 */ }
    return hardDefaults[platform] || 20;
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        password TEXT DEFAULT '',
        proxy TEXT DEFAULT '',
        cookies TEXT DEFAULT '',
        access_token TEXT DEFAULT '',
        status TEXT DEFAULT 'disconnected',
        account_type TEXT DEFAULT 'personal',
        warmup_days INTEGER DEFAULT 0,
        warmup_start DATE,
        daily_limit INTEGER DEFAULT 0,
        today_sent INTEGER DEFAULT 0,
        tags TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        last_active_at DATETIME,
        login_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(platform, account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_sa_platform ON social_accounts(platform);
      CREATE INDEX IF NOT EXISTS idx_sa_status ON social_accounts(status);
    `);

    // 关联环境管理字段（已存在则忽略）
    const alterCols = [
      'proxy_id INTEGER DEFAULT NULL',
      'profile_id INTEGER DEFAULT NULL',
      'phone_id INTEGER DEFAULT NULL',
      'chain_id INTEGER DEFAULT NULL'
    ];
    for (const col of alterCols) {
      try { this.db.exec(`ALTER TABLE social_accounts ADD COLUMN ${col}`); } catch(e) { /* already exists */ }
    }

    // proxies 表新增字段
    const proxyAlterCols = [
      "role TEXT DEFAULT 'landing'",
      "protocol TEXT DEFAULT 'http'",
      "label TEXT DEFAULT ''"
    ];
    for (const col of proxyAlterCols) {
      try { this.db.exec(`ALTER TABLE proxies ADD COLUMN ${col}`); } catch(e) { /* already exists */ }
    }

    // 代理链表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proxy_chains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT DEFAULT '',
        frontend_proxy_id INTEGER DEFAULT NULL,
        vpn_proxy_id INTEGER DEFAULT NULL,
        landing_proxy_id INTEGER DEFAULT NULL,
        status TEXT DEFAULT 'active',
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now')),
        updated_at DATETIME DEFAULT (datetime('now'))
      );
    `);
  }

  // ========== 单个添加 ==========
  addAccount(data) {
    try {
      const platform = data.platform;
      const dailyLimit = this._getPlatformDefaultLimit(platform);

      const r = this.db.prepare(`INSERT INTO social_accounts 
        (platform, account_id, display_name, phone, email, password, proxy, cookies, access_token,
         account_type, browser_type, daily_limit, tags, notes, warmup_start, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,date('now'),?)`)
        .run(
          platform,
          data.account_id || data.phone || data.email || '',
          data.display_name || data.account_id || '',
          data.phone || '',
          data.email || '',
          data.password || '',
          data.proxy || '',
          data.cookies || '',
          data.access_token || '',
          data.account_type || 'personal',
          data.browser_type || 'builtin',
          data.daily_limit || dailyLimit,
          JSON.stringify(data.tags || []),
          data.notes || '',
          'disconnected'
        );
      return { success: true, id: r.lastInsertRowid };
    } catch(e) {
      if (e.message.includes('UNIQUE')) return { success: false, error: '该账号已存在' };
      return { success: false, error: e.message };
    }
  }

  // ========== 批量添加 ==========
  addAccountsBatch(platform, accounts) {
    let added = 0, skipped = 0, errors = [];
    const dailyLimit = this._getPlatformDefaultLimit(platform);

    const insert = this.db.prepare(`INSERT OR IGNORE INTO social_accounts 
      (platform, account_id, display_name, phone, email, password, proxy, cookies, access_token,
       account_type, browser_type, daily_limit, tags, notes, warmup_start, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,date('now'),'disconnected')`);

    const tx = this.db.transaction((list) => {
      for (const a of list) {
        try {
          const r = insert.run(
            platform,
            a.account_id || a.phone || a.email || '',
            a.display_name || a.account_id || a.phone || '',
            a.phone || '',
            a.email || '',
            a.password || '',
            a.proxy || '',
            a.cookies || '',
            a.access_token || '',
            a.account_type || 'personal',
            a.browser_type || 'builtin',
            a.daily_limit || dailyLimit,
            JSON.stringify(a.tags || []),
            a.notes || ''
          );
          if (r.changes > 0) added++; else skipped++;
        } catch(e) {
          skipped++;
          errors.push(e.message);
        }
      }
    });
    tx(accounts);
    return { added, skipped, total: accounts.length, errors: errors.slice(0, 5) };
  }

  // ========== 查询 ==========
  getAccounts(platform, filters = {}) {
    let where = '1=1';
    const params = [];
    if (platform) { where += ' AND platform=?'; params.push(platform); }
    if (filters.status) { where += ' AND status=?'; params.push(filters.status); }
    if (filters.search) {
      where += ' AND (display_name LIKE ? OR account_id LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s, s);
    }
    if (filters.account_type) { where += ' AND account_type=?'; params.push(filters.account_type); }

    const data = this.db.prepare(`SELECT sa.*,
        p.type as _p_type, p.host as _p_host, p.port as _p_port, p.country as _p_country, p.is_alive as _p_alive,
        bp.name as _bp_name, bp.platform as _bp_platform, bp.status as _bp_status, bp.health_score as _bp_health,
        pn.number as _pn_number, pn.country as _pn_country, pn.status as _pn_status
      FROM social_accounts sa
      LEFT JOIN proxies p ON sa.proxy_id = p.id
      LEFT JOIN browser_profiles bp ON sa.profile_id = bp.id
      LEFT JOIN phone_numbers pn ON sa.phone_id = pn.id
      WHERE ${where.replace(/\b(platform|status|display_name|account_id|phone|email|account_type)\b/g, 'sa.$1')}
      ORDER BY sa.platform, sa.created_at DESC`)
      .all(...params);
    return data.map(a => {
      const row = { ...a, tags: JSON.parse(a.tags || '[]') };
      // Build binding info
      row.proxy_info = a.proxy_id ? { id: a.proxy_id, type: a._p_type, host: a._p_host, port: a._p_port, country: a._p_country, is_alive: a._p_alive } : null;
      row.profile_info = a.profile_id ? { id: a.profile_id, name: a._bp_name, platform: a._bp_platform, status: a._bp_status, health_score: a._bp_health } : null;
      row.phone_info = a.phone_id ? { id: a.phone_id, number: a._pn_number, country: a._pn_country, status: a._pn_status } : null;
      // Clean temp fields
      for (const k of Object.keys(row)) { if (k.startsWith('_p_') || k.startsWith('_bp_') || k.startsWith('_pn_')) delete row[k]; }
      return row;
    });
  }

  getAccount(id) {
    const a = this.db.prepare('SELECT * FROM social_accounts WHERE id=?').get(id);
    if (a) a.tags = JSON.parse(a.tags || '[]');
    return a;
  }

  // ========== 更新 ==========
  updateAccount(id, data) {
    const fields = ['display_name','phone','email','password','proxy','cookies','access_token',
      'account_type','daily_limit','notes','status','proxy_type','browser_fingerprint','health_score','last_error',
      'proxy_id','profile_id','phone_id','chain_id'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (data[f] !== undefined) { updates.push(`${f}=?`); params.push(data[f]); }
    }
    if (data.tags) { updates.push('tags=?'); params.push(JSON.stringify(data.tags)); }
    if (updates.length === 0) return;
    updates.push("updated_at=datetime('now')");
    params.push(id);
    this.db.prepare(`UPDATE social_accounts SET ${updates.join(',')} WHERE id=?`).run(...params);
  }

  // ========== 删除 ==========
  deleteAccount(id) {
    this.db.prepare('DELETE FROM social_accounts WHERE id=?').run(id);
  }

  deleteAccountsBatch(ids) {
    const del = this.db.prepare('DELETE FROM social_accounts WHERE id=?');
    const tx = this.db.transaction((list) => { for (const id of list) del.run(id); });
    tx(ids);
    return { deleted: ids.length };
  }

  // ========== 状态更新 ==========
  setStatus(id, status) {
    this.db.prepare("UPDATE social_accounts SET status=?, updated_at=datetime('now'), last_active_at=CASE WHEN ?='connected' THEN datetime('now') ELSE last_active_at END WHERE id=?")
      .run(status, status, id);
  }

  recordActivity(id) {
    this.db.prepare("UPDATE social_accounts SET last_active_at=datetime('now'), today_sent=today_sent+1, updated_at=datetime('now') WHERE id=?")
      .run(id);
  }

  resetDailyCounts() {
    this.db.prepare("UPDATE social_accounts SET today_sent=0").run();
  }

  // ========== 养号天数计算 ==========
  updateWarmupDays() {
    this.db.prepare(`UPDATE social_accounts SET warmup_days = CAST(julianday('now') - julianday(warmup_start) AS INTEGER)
      WHERE warmup_start IS NOT NULL`).run();
  }

  // ========== 统计 ==========
  getStats(platform) {
    let where = platform ? 'WHERE platform=?' : '';
    const params = platform ? [platform] : [];

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM social_accounts ${where}`).get(...params).c;
    const connected = this.db.prepare(`SELECT COUNT(*) as c FROM social_accounts ${where ? where + " AND" : "WHERE"} status='connected'`).get(...params).c;
    const warming = this.db.prepare(`SELECT COUNT(*) as c FROM social_accounts ${where ? where + " AND" : "WHERE"} warmup_days < 28`).get(...params).c;

    let byPlatform = [];
    if (!platform) {
      byPlatform = this.db.prepare(`SELECT platform, COUNT(*) as total,
        SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) as connected,
        SUM(CASE WHEN status='banned' THEN 1 ELSE 0 END) as banned
        FROM social_accounts GROUP BY platform`).all();
    }

    return { total, connected, warming, byPlatform };
  }
}

module.exports = { SocialAccountManager };
