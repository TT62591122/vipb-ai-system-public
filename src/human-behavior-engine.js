/**
 * 人工行为模拟引擎 (HumanBehaviorEngine)
 * 
 * 在浏览器操作和平台执行器之间插入一层拟人行为，
 * 让自动化操作看起来像真人在操作。
 * 
 * 集成方式：不改变现有接口，通过 wrap() 包装操作。
 */

const MouseSimulator = require('./human/mouse-simulator');
const KeyboardSimulator = require('./human/keyboard-simulator');
const ScrollSimulator = require('./human/scroll-simulator');
const BehaviorChain = require('./human/behavior-chain');
const PersonalityGenerator = require('./human/personality');

class HumanBehaviorEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.enabled = options.enabled !== false;
    this.config = {
      mouse_simulation: true,
      keyboard_simulation: true,
      scroll_simulation: true,
      warmup_browsing: true,
      cooldown_browsing: true,
      random_likes: true,
      warmup_duration_sec: [3, 20],
      cooldown_duration_sec: [2, 8],
      ...options.config
    };

    this.mouse = new MouseSimulator();
    this.keyboard = new KeyboardSimulator();
    this.scroll = new ScrollSimulator();
    this.behaviorChain = new BehaviorChain(this.mouse, this.keyboard, this.scroll);

    this._initDB();
    console.log(`🤖 HumanBehaviorEngine 已初始化 [${this.enabled ? '启用' : '禁用'}]`);
  }

  /**
   * 初始化数据库表
   */
  _initDB() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS account_personalities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL UNIQUE,
          platform TEXT NOT NULL,
          template_name TEXT DEFAULT 'normal',
          mouse_speed REAL DEFAULT 1.0,
          mouse_precision REAL DEFAULT 0.85,
          mouse_curve_intensity REAL DEFAULT 0.6,
          typing_speed_wpm INTEGER DEFAULT 45,
          typing_error_rate REAL DEFAULT 0.03,
          typing_pause_freq REAL DEFAULT 0.15,
          typing_burst_mode INTEGER DEFAULT 0,
          scroll_speed REAL DEFAULT 1.0,
          avg_page_view_sec INTEGER DEFAULT 15,
          likes_ratio REAL DEFAULT 0.3,
          comment_ratio REAL DEFAULT 0.05,
          preferred_start_hour INTEGER DEFAULT 9,
          preferred_end_hour INTEGER DEFAULT 20,
          lunch_break_start INTEGER DEFAULT 12,
          lunch_break_end INTEGER DEFAULT 13,
          avg_session_minutes INTEGER DEFAULT 15,
          is_mobile INTEGER DEFAULT 0,
          screen_dpi REAL DEFAULT 1.0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS behavior_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          action_type TEXT NOT NULL,
          duration_ms INTEGER,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_behavior_logs_account ON behavior_logs(account_id);
        CREATE INDEX IF NOT EXISTS idx_behavior_logs_created ON behavior_logs(created_at);
      `);
    } catch (e) {
      console.error('HumanBehaviorEngine DB init error:', e.message);
    }
  }

  /**
   * 获取账号行为人格（没有则自动生成）
   */
  getPersonality(accountId, platform) {
    try {
      let row = this.db.prepare('SELECT * FROM account_personalities WHERE account_id = ?').get(accountId);
      if (row) return PersonalityGenerator.fromRow(row);

      // 自动生成新人格
      const p = PersonalityGenerator.generate(platform);
      const fields = Object.keys(p);
      const placeholders = fields.map(() => '?').join(',');
      const values = fields.map(f => p[f]);

      this.db.prepare(
        `INSERT INTO account_personalities (account_id, ${fields.join(',')}) VALUES (?, ${placeholders})`
      ).run(accountId, ...values);

      console.log(`🎭 为账号 ${accountId} 生成行为人格: ${p.template_name} (速度:${p.mouse_speed}, WPM:${p.typing_speed_wpm})`);
      return { account_id: accountId, ...p };
    } catch (e) {
      // 返回默认人格
      return { account_id: accountId, ...PersonalityGenerator.generate(platform) };
    }
  }

  /**
   * 获取所有人格列表
   */
  listPersonalities(filters = {}) {
    let sql = 'SELECT * FROM account_personalities';
    const params = [];
    const conditions = [];

    if (filters.platform) {
      conditions.push('platform = ?');
      params.push(filters.platform);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }

    return this.db.prepare(sql).all(...params);
  }

  /**
   * 更新人格配置
   */
  updatePersonality(accountId, updates) {
    const fields = Object.keys(updates).filter(k => k !== 'account_id' && k !== 'id');
    if (!fields.length) return false;

    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(accountId);

    this.db.prepare(
      `UPDATE account_personalities SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?`
    ).run(...values);
    return true;
  }

  /**
   * 删除人格
   */
  deletePersonality(accountId) {
    this.db.prepare('DELETE FROM account_personalities WHERE account_id = ?').run(accountId);
  }

  /**
   * ★ 核心方法：包装页面操作，注入拟人行为
   * 
   * @param {Page} page - Puppeteer page 实例
   * @param {string} accountId - 账号ID
   * @param {string} platform - 平台名称
   * @param {string} actionName - 操作名（用于日志）
   * @param {Function} actionFn - 实际操作函数，接收 human 工具集
   * @returns {*} actionFn 的返回值
   */
  async wrap(page, accountId, platform, actionName, actionFn) {
    if (!this.enabled) {
      return await actionFn();
    }

    const personality = this.getPersonality(accountId, platform);
    personality.platform = platform;
    const startTime = Date.now();

    try {
      // 1. 预热浏览
      if (this.config.warmup_browsing) {
        await this.behaviorChain.warmup(page, personality, this.config);
        this._log(accountId, platform, 'warmup', Date.now() - startTime);
      }

      // 2. 执行操作（提供拟人工具集）
      const human = {
        click: (selector) => this.humanClick(page, selector, personality),
        type: (selector, text) => this.humanType(page, selector, text, personality),
        scroll: (direction) => this.humanScroll(page, direction, personality),
        scrollTo: (selector) => this.scroll.scrollToElement(page, selector, personality),
        wait: (min, max) => this.humanPause(min, max),
        moveTo: (x, y) => this.mouse.moveTo(page, x, y, personality),
        personality
      };

      const actionStart = Date.now();
      const result = await actionFn(human);
      this._log(accountId, platform, actionName, Date.now() - actionStart);

      // 3. 收尾行为
      if (this.config.cooldown_browsing) {
        const coolStart = Date.now();
        await this.behaviorChain.cooldown(page, personality, this.config);
        this._log(accountId, platform, 'cooldown', Date.now() - coolStart);
      }

      return result;
    } catch (error) {
      this._log(accountId, platform, `${actionName}_error`, Date.now() - startTime,
        { error: error.message });
      throw error;
    }
  }

  /**
   * 拟人点击
   */
  async humanClick(page, selector, personality) {
    if (!this.config.mouse_simulation) {
      try { await page.click(selector); } catch (e) {}
      return;
    }
    return this.mouse.clickElement(page, selector, personality);
  }

  /**
   * 拟人打字
   */
  async humanType(page, selector, text, personality) {
    if (!this.config.keyboard_simulation) {
      try {
        if (selector) await page.click(selector);
        await page.keyboard.type(text);
      } catch (e) {}
      return;
    }

    // 长文本用粘贴+局部修改（更像真人）
    if (text.length > 200) {
      await this.keyboard.paste(page, selector, text, personality);
    } else {
      await this.keyboard.type(page, selector, text, personality);
    }
  }

  /**
   * 拟人滚动
   */
  async humanScroll(page, direction = 'down', personality) {
    if (!this.config.scroll_simulation) return;
    await this.scroll.readFeed(page, personality, 2 + Math.random() * 3);
  }

  /**
   * 拟人停顿
   */
  async humanPause(minMs = 500, maxMs = 2000) {
    const duration = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, duration));
  }

  /**
   * 获取行为统计
   */
  getStats(accountId = null) {
    if (accountId) {
      return {
        personality: this.db.prepare('SELECT * FROM account_personalities WHERE account_id = ?').get(accountId),
        totalActions: this.db.prepare('SELECT COUNT(*) as count FROM behavior_logs WHERE account_id = ?').get(accountId).count,
        recentActions: this.db.prepare(
          'SELECT action_type, COUNT(*) as count, AVG(duration_ms) as avg_duration FROM behavior_logs WHERE account_id = ? GROUP BY action_type'
        ).all(accountId)
      };
    }

    return {
      totalPersonalities: this.db.prepare('SELECT COUNT(*) as count FROM account_personalities').get().count,
      totalLogs: this.db.prepare('SELECT COUNT(*) as count FROM behavior_logs').get().count,
      byPlatform: this.db.prepare(
        'SELECT platform, COUNT(*) as count FROM account_personalities GROUP BY platform'
      ).all(),
      config: this.config,
      enabled: this.enabled
    };
  }

  /**
   * 获取行为日志
   */
  getLogs(filters = {}) {
    let sql = 'SELECT * FROM behavior_logs';
    const params = [];
    const conditions = [];

    if (filters.account_id) { conditions.push('account_id = ?'); params.push(filters.account_id); }
    if (filters.platform) { conditions.push('platform = ?'); params.push(filters.platform); }
    if (filters.action_type) { conditions.push('action_type = ?'); params.push(filters.action_type); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT ${filters.limit || 50}`;

    return this.db.prepare(sql).all(...params);
  }

  /**
   * 更新全局配置
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    if (newConfig.enabled !== undefined) this.enabled = newConfig.enabled;
  }

  /**
   * 记录行为日志
   */
  _log(accountId, platform, actionType, durationMs, details = null) {
    try {
      this.db.prepare(
        'INSERT INTO behavior_logs (account_id, platform, action_type, duration_ms, details) VALUES (?, ?, ?, ?, ?)'
      ).run(accountId, platform, actionType, durationMs, details ? JSON.stringify(details) : null);
    } catch (e) {}
  }
}

module.exports = HumanBehaviorEngine;
