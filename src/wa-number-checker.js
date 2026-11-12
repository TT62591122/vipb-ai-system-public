/**
 * WhatsApp 号码有效性检测引擎
 * - 发送前自动拦截无效号码
 * - 检测结果缓存（避免重复调用 isRegisteredUser）
 * - 批量检测 + 统计
 * - 与广播/群发集成：自动过滤无效号码
 */

class WANumberChecker {
  constructor(db, waManager) {
    this.db = db;
    this.wa = waManager;
    this._ensureSchema();
  }

  _ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wa_number_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        chat_id TEXT,
        is_valid INTEGER NOT NULL,          -- 1=有效, 0=无效
        checked_at DATETIME DEFAULT (datetime('now')),
        source TEXT DEFAULT 'manual'        -- 'manual' | 'pre_send' | 'broadcast' | 'import'
      );
      CREATE INDEX IF NOT EXISTS idx_wnc_phone ON wa_number_cache(phone);
      CREATE INDEX IF NOT EXISTS idx_wnc_valid ON wa_number_cache(is_valid);
    `);
  }

  /**
   * 标准化手机号
   */
  _normalize(phone) {
    return phone.replace(/[\s\-\(\)\.]/g, '').replace(/^00/, '+');
  }

  /**
   * 检测单个号码（带缓存）
   * @param {string} phone - 手机号
   * @param {object} opts
   * @param {boolean} opts.forceRefresh - 强制重新检测（忽略缓存）
   * @param {number} opts.cacheHours - 缓存有效期（小时），默认72
   * @param {string} opts.source - 来源标记
   * @returns {{ phone, isValid, fromCache, chatId, error? }}
   */
  async check(phone, opts = {}) {
    const { forceRefresh = false, cacheHours = 72, source = 'manual' } = opts;
    const normalized = this._normalize(phone);

    if (!normalized || normalized.replace(/[^0-9]/g, '').length < 7) {
      return { phone: normalized, isValid: false, fromCache: false, error: '号码格式无效' };
    }

    // 查缓存
    if (!forceRefresh) {
      const cached = this.db.prepare(
        `SELECT * FROM wa_number_cache WHERE phone = ? AND checked_at > datetime('now', '-${Math.floor(cacheHours)} hours')`
      ).get(normalized);

      if (cached) {
        return {
          phone: normalized,
          isValid: !!cached.is_valid,
          chatId: cached.chat_id,
          fromCache: true
        };
      }
    }

    // 调用 WhatsApp 检测
    if (!this.wa || this.wa.status !== 'ready') {
      return { phone: normalized, isValid: false, fromCache: false, error: 'WhatsApp未连接' };
    }

    try {
      const result = await this.wa.checkNumber(normalized);
      // 写入缓存
      this.db.prepare(
        'INSERT OR REPLACE INTO wa_number_cache (phone, chat_id, is_valid, checked_at, source) VALUES (?, ?, ?, datetime(\'now\'), ?)'
      ).run(normalized, result.chatId || null, result.exists ? 1 : 0, source);

      return {
        phone: normalized,
        isValid: result.exists,
        chatId: result.chatId,
        fromCache: false
      };
    } catch (e) {
      return { phone: normalized, isValid: false, fromCache: false, error: e.message };
    }
  }

  /**
   * 批量检测号码（带进度回调）
   * @param {string[]} phones
   * @param {object} opts
   * @param {Function} opts.onProgress - (done, total, current) => void
   * @param {number} opts.delayMs - 每次检测间隔（防封），默认800ms
   * @returns {{ valid: string[], invalid: string[], errors: object[], stats: object }}
   */
  async checkBatch(phones, opts = {}) {
    const { onProgress, delayMs = 800, cacheHours = 72, source = 'manual' } = opts;
    const valid = [], invalid = [], errors = [];
    const total = phones.length;

    for (let i = 0; i < phones.length; i++) {
      const result = await this.check(phones[i], { cacheHours, source });

      if (result.error) {
        errors.push({ phone: phones[i], error: result.error });
      } else if (result.isValid) {
        valid.push(phones[i]);
      } else {
        invalid.push(phones[i]);
      }

      if (onProgress) onProgress(i + 1, total, result);

      // 非缓存结果才需要延迟（缓存的不消耗API）
      if (!result.fromCache && i < phones.length - 1) {
        await new Promise(r => setTimeout(r, delayMs + Math.random() * 400));
      }
    }

    const stats = { total, valid: valid.length, invalid: invalid.length, errors: errors.length };
    console.log(`📱 批量号码检测: ${stats.valid}有效 / ${stats.invalid}无效 / ${stats.errors}错误 (共${stats.total})`);
    return { valid, invalid, errors, stats };
  }

  /**
   * 发送前拦截检查（供 sendMessage / broadcast 调用）
   * 返回 true 表示可以发送，false 表示号码无效应拦截
   */
  async preSendCheck(chatId) {
    const phone = chatId.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const result = await this.check(phone, { source: 'pre_send', cacheHours: 168 }); // 发前检查缓存7天
    return result.isValid;
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as c FROM wa_number_cache').get().c;
    const valid = this.db.prepare('SELECT COUNT(*) as c FROM wa_number_cache WHERE is_valid = 1').get().c;
    const invalid = this.db.prepare('SELECT COUNT(*) as c FROM wa_number_cache WHERE is_valid = 0').get().c;
    const recent = this.db.prepare(
      "SELECT COUNT(*) as c FROM wa_number_cache WHERE checked_at > datetime('now', '-24 hours')"
    ).get().c;
    return { total, valid, invalid, recentChecks24h: recent };
  }

  /**
   * 获取无效号码列表
   */
  getInvalidNumbers(limit = 100) {
    return this.db.prepare(
      'SELECT phone, checked_at, source FROM wa_number_cache WHERE is_valid = 0 ORDER BY checked_at DESC LIMIT ?'
    ).all(limit);
  }

  /**
   * 清除过期缓存
   * @param {number} olderThanDays
   */
  clearExpiredCache(olderThanDays = 30) {
    const result = this.db.prepare(
      `DELETE FROM wa_number_cache WHERE checked_at < datetime('now', '-${olderThanDays} days')`
    ).run();
    console.log(`🧹 清除 ${result.changes} 条过期号码缓存`);
    return { cleared: result.changes };
  }
}

module.exports = { WANumberChecker };
