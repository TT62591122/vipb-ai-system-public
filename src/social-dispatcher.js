/**
 * 社媒统一调度层
 * - 统一的账号选择 + 执行接口
 * - 平台适配器模式：每个平台一个适配器
 * - 发帖/发消息时自动读取账号配置（代理IP、cookies等）
 * - 执行后更新账号状态（今日发送量、最后活跃时间）
 * - 养号限制检查（天数不够/超出每日限额 → 拦截）
 */

// ========== 适配器基类 ==========
class BaseAdapter {
  constructor(platform) {
    this.platform = platform;
  }

  async connect(account) {
    throw new Error(`${this.platform}.connect() 未实现`);
  }

  async disconnect(account) {
    throw new Error(`${this.platform}.disconnect() 未实现`);
  }

  async sendMessage(account, target, content) {
    throw new Error(`${this.platform}.sendMessage() 未实现`);
  }

  async post(account, content, media) {
    throw new Error(`${this.platform}.post() 未实现`);
  }

  async getStatus(account) {
    return { online: false, platform: this.platform };
  }
}

// ========== WhatsApp 适配器 ==========
class WhatsAppAdapter extends BaseAdapter {
  constructor(waManager) {
    super('whatsapp');
    this.waManager = waManager;
  }

  async connect(account) {
    // 通过 WhatsAppManager 连接
    if (this.waManager) {
      return { success: true, message: '请通过WhatsApp页面扫码连接' };
    }
    return { success: false, message: 'WhatsApp管理器未初始化' };
  }

  async disconnect(account) {
    return { success: true, message: '已断开WhatsApp连接' };
  }

  async sendMessage(account, target, content) {
    if (this.waManager) {
      try {
        await this.waManager.sendMessage(target, content);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'WhatsApp未连接' };
  }

  async post(account, content, media) {
    return { success: false, error: 'WhatsApp不支持发帖操作' };
  }

  async getStatus(account) {
    return { online: account.status === 'connected', platform: 'whatsapp' };
  }
}

// ========== TikTok 适配器 ==========
class TikTokAdapter extends BaseAdapter {
  constructor() {
    super('tiktok');
  }

  async connect(account) {
    // TODO: 实现TikTok API连接
    return { success: true, message: 'TikTok连接（骨架）' };
  }

  async disconnect(account) {
    return { success: true };
  }

  async sendMessage(account, target, content) {
    // TODO: TikTok私信API
    return { success: false, error: 'TikTok私信功能待实现' };
  }

  async post(account, content, media) {
    // TODO: TikTok发布API
    return { success: false, error: 'TikTok发布功能待实现' };
  }

  async getStatus(account) {
    return { online: account.status === 'connected', platform: 'tiktok' };
  }
}

// ========== Facebook 适配器 ==========
class FacebookAdapter extends BaseAdapter {
  constructor() {
    super('facebook');
  }

  async connect(account) {
    return { success: true, message: 'Facebook连接（骨架）' };
  }

  async disconnect(account) {
    return { success: true };
  }

  async sendMessage(account, target, content) {
    return { success: false, error: 'Facebook Messenger功能待实现' };
  }

  async post(account, content, media) {
    return { success: false, error: 'Facebook发帖功能待实现' };
  }

  async getStatus(account) {
    return { online: account.status === 'connected', platform: 'facebook' };
  }
}

// ========== LinkedIn 适配器 ==========
class LinkedInAdapter extends BaseAdapter {
  constructor(linkedinAutomation) {
    super('linkedin');
    this.linkedin = linkedinAutomation;
  }

  async connect(account) {
    return { success: true, message: 'LinkedIn连接（骨架）' };
  }

  async disconnect(account) {
    return { success: true };
  }

  async sendMessage(account, target, content) {
    return { success: false, error: 'LinkedIn消息功能待实现' };
  }

  async post(account, content, media) {
    return { success: false, error: 'LinkedIn发帖功能待实现' };
  }

  async getStatus(account) {
    return { online: account.status === 'connected', platform: 'linkedin' };
  }
}

// ========== 统一调度层 ==========
class SocialDispatcher {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this.app = null; // 设置后可访问 app.locals.humanBehavior
    this.adapters = {};
    this._initTables();
  }

  // 注入 Express app 引用（用于访问 humanBehavior 等全局服务）
  setApp(app) { this.app = app; }

  _initTables() {
    // 添加新字段（如果不存在）
    const cols = this.db.prepare("PRAGMA table_info(social_accounts)").all().map(c => c.name);
    const newCols = [
      { name: 'proxy_type', def: "TEXT DEFAULT 'http'" },
      { name: 'browser_fingerprint', def: "TEXT DEFAULT ''" },
      { name: 'health_score', def: "INTEGER DEFAULT 100" },
      { name: 'last_error', def: "TEXT DEFAULT ''" },
      { name: 'execution_count', def: "INTEGER DEFAULT 0" },
    ];
    for (const col of newCols) {
      if (!cols.includes(col.name)) {
        try {
          this.db.exec(`ALTER TABLE social_accounts ADD COLUMN ${col.name} ${col.def}`);
        } catch (e) {
          // 列可能已存在
        }
      }
    }

    // 执行日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS social_execution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        platform TEXT,
        action TEXT,
        status TEXT,
        details TEXT,
        ip_used TEXT,
        created_at DATETIME DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sel_account ON social_execution_log(account_id);
      CREATE INDEX IF NOT EXISTS idx_sel_created ON social_execution_log(created_at);
    `);
  }

  // 注册适配器
  registerAdapter(platform, adapter) {
    this.adapters[platform] = adapter;
  }

  // 获取账号信息
  getAccount(accountId) {
    return this.db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(accountId);
  }

  // 执行操作前检查
  async preCheck(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return { ok: false, reason: '账号不存在' };
    if (account.status === 'banned') return { ok: false, reason: '账号已被封禁' };

    // 养号天数检查（至少3天才能高频操作）
    const warmupDays = account.warmup_days || 0;
    if (warmupDays < 3 && account.status === 'warming') {
      // 养号期间限制更严格，优先从数据库防封规则读取
      let warmupLimit = Math.min(5, account.daily_limit || 5);
      try {
        const ruleRow = this.db.prepare("SELECT value FROM settings WHERE key='antiban_rules'").get();
        if (ruleRow) {
          const rules = JSON.parse(ruleRow.value);
          const platform = account.platform;
          const stages = rules[platform]?.warmup?.stages;
          if (Array.isArray(stages) && stages.length > 0) {
            // 取第一个阶段（最严格的）的限额
            const firstStage = stages[0];
            const stageLimit = firstStage.max_outbound || firstStage.max_messages || firstStage.max_posts || firstStage.max_daily || 5;
            warmupLimit = Math.min(stageLimit, account.daily_limit || stageLimit);
          }
        }
      } catch (e) { /* 读取失败用默认值 */ }
      if ((account.today_sent || 0) >= warmupLimit) {
        return { ok: false, reason: `养号中（第${warmupDays}天），今日已达养号限额${warmupLimit}` };
      }
    }

    // 每日限额检查
    if (account.daily_limit > 0 && (account.today_sent || 0) >= account.daily_limit) {
      return { ok: false, reason: `今日已达限额 ${account.daily_limit}` };
    }

    // 健康度检查
    if ((account.health_score || 0) < 20) {
      return { ok: false, reason: `账号健康度过低(${account.health_score})，建议暂停操作` };
    }

    return { ok: true, account };
  }

  // 通过调度层执行操作
  async execute(accountId, action, params = {}) {
    const check = await this.preCheck(accountId);
    if (!check.ok) {
      this._log(accountId, check.account?.platform, action, 'skipped', check.reason);
      return { success: false, error: check.reason, skipped: true };
    }

    const account = check.account;
    const adapter = this.adapters[account.platform];
    if (!adapter) {
      this._log(accountId, account.platform, action, 'failed', '无适配器');
      return { success: false, error: `平台 ${account.platform} 无可用适配器` };
    }

    // 解析账号绑定的代理信息（用于日志记录）
    const proxyLabel = this._resolveProxyLabel(account);

    // 获取拟人行为引擎（如果可用）
    const humanBehavior = this.app && this.app.locals && this.app.locals.humanBehavior;
    const hasHuman = humanBehavior && humanBehavior.enabled && params._page;

    // 拟人包装辅助函数
    const wrapHuman = async (actionName, fn) => {
      if (hasHuman) {
        return humanBehavior.wrap(params._page, accountId, account.platform, actionName, async (human) => fn(human));
      }
      return fn(null);
    };

    let result;
    try {
      switch (action) {
        case 'connect':
          result = await wrapHuman('connect', async (human) => {
            const r = await adapter.connect(account, human);
            if (r.success) {
              this.db.prepare("UPDATE social_accounts SET status = 'connected', last_active_at = datetime('now') WHERE id = ?").run(accountId);
            }
            return r;
          });
          break;
        case 'disconnect':
          result = await adapter.disconnect(account);
          if (result.success) {
            this.db.prepare("UPDATE social_accounts SET status = 'disconnected' WHERE id = ?").run(accountId);
          }
          break;
        case 'send_message':
          result = await wrapHuman('send_message', async (human) => {
            return await adapter.sendMessage(account, params.target, params.content, human);
          });
          break;
        case 'post':
          result = await wrapHuman('post', async (human) => {
            return await adapter.post(account, params.content, params.media, human);
          });
          break;
        case 'like':
          result = await wrapHuman('like', async (human) => {
            return await adapter.like(account, params.target, human);
          });
          break;
        case 'comment':
          result = await wrapHuman('comment', async (human) => {
            return await adapter.comment(account, params.target, params.content, human);
          });
          break;
        case 'follow':
          result = await wrapHuman('follow', async (human) => {
            return await adapter.follow(account, params.target, human);
          });
          break;
        case 'unfollow':
          result = await wrapHuman('unfollow', async (human) => {
            return await adapter.unfollow(account, params.target, human);
          });
          break;
        case 'collect':
        case 'scrape':
          result = await wrapHuman('collect', async (human) => {
            return await adapter.collect(account, params, human);
          });
          break;
        case 'view_profile':
          result = await wrapHuman('view_profile', async (human) => {
            return await adapter.viewProfile(account, params.target, human);
          });
          break;
        case 'share':
        case 'repost':
          result = await wrapHuman('share', async (human) => {
            return await adapter.share(account, params.target, human);
          });
          break;
        case 'get_status':
          result = await adapter.getStatus(account);
          break;
        default:
          // 未知操作也尝试拟人包装
          result = await wrapHuman(action, async (human) => {
            if (adapter[action]) return await adapter[action](account, params, human);
            return { success: false, error: `未知操作: ${action}` };
          });
      }

      // 更新统计（扩展到所有互动操作）
      const trackActions = ['send_message', 'post', 'like', 'comment', 'follow', 'share', 'repost', 'collect', 'scrape'];
      if (result.success && trackActions.includes(action)) {
        this.db.prepare(`UPDATE social_accounts SET 
          today_sent = today_sent + 1, 
          execution_count = execution_count + 1,
          last_active_at = datetime('now') 
          WHERE id = ?`).run(accountId);
      }

      this._log(accountId, account.platform, action, result.success ? 'success' : 'failed',
        result.error || result.message || '', proxyLabel);

      return result;
    } catch (e) {
      this._log(accountId, account.platform, action, 'failed', e.message, proxyLabel);
      // 降低健康度
      this.db.prepare("UPDATE social_accounts SET health_score = MAX(0, health_score - 5), last_error = ? WHERE id = ?")
        .run(e.message, accountId);
      return { success: false, error: e.message };
    }
  }

  // 切换代理IP
  switchProxy(accountId, newProxy) {
    const account = this.getAccount(accountId);
    if (!account) return { success: false, error: '账号不存在' };

    this.db.prepare("UPDATE social_accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newProxy, accountId);
    this._log(accountId, account.platform, 'switch_proxy', 'success', `代理切换为: ${newProxy}`, newProxy);
    return { success: true };
  }

  // 切换环境
  switchEnvironment(accountId, envConfig = {}) {
    const account = this.getAccount(accountId);
    if (!account) return { success: false, error: '账号不存在' };

    const updates = [];
    const values = [];
    if (envConfig.proxy !== undefined) { updates.push('proxy = ?'); values.push(envConfig.proxy); }
    if (envConfig.proxy_type !== undefined) { updates.push('proxy_type = ?'); values.push(envConfig.proxy_type); }
    if (envConfig.browser_fingerprint !== undefined) { updates.push('browser_fingerprint = ?'); values.push(envConfig.browser_fingerprint); }
    if (envConfig.cookies !== undefined) { updates.push('cookies = ?'); values.push(envConfig.cookies); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(accountId);
      this.db.prepare(`UPDATE social_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    this._log(accountId, account.platform, 'switch_env', 'success', JSON.stringify(envConfig));
    return { success: true };
  }

  // 获取执行日志
  getExecutionLog(accountId, limit = 50) {
    if (accountId) {
      return this.db.prepare('SELECT * FROM social_execution_log WHERE account_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(accountId, limit);
    }
    return this.db.prepare('SELECT * FROM social_execution_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  // 批量操作
  async batchExecute(accountIds, action, params = {}) {
    const results = [];
    for (const id of accountIds) {
      const result = await this.execute(id, action, params);
      results.push({ accountId: id, ...result });
      // 批量操作间隔随机延迟（防封）
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
    }
    return results;
  }

  // 获取统计数据
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as c FROM social_accounts').get().c;
    const online = this.db.prepare("SELECT COUNT(*) as c FROM social_accounts WHERE status = 'connected'").get().c;
    const warming = this.db.prepare("SELECT COUNT(*) as c FROM social_accounts WHERE status = 'warming'").get().c;
    const abnormal = this.db.prepare("SELECT COUNT(*) as c FROM social_accounts WHERE status IN ('banned','error')").get().c;
    const todayOps = this.db.prepare("SELECT COUNT(*) as c FROM social_execution_log WHERE created_at > datetime('now', '-1 day')").get().c;
    const byPlatform = this.db.prepare('SELECT platform, COUNT(*) as c FROM social_accounts GROUP BY platform').all();

    return { total, online, warming, abnormal, todayOps, byPlatform };
  }

  // 解析账号实际使用的代理标签（用于日志）
  // 优先级: proxy_id绑定 > chain_id链路 > 旧proxy字段 > 空
  _resolveProxyLabel(account) {
    if (!account) return '';
    try {
      if (account.proxy_id) {
        const p = this.db.prepare('SELECT host,port,label FROM proxies WHERE id=?').get(account.proxy_id);
        if (p) return p.label || `${p.host}:${p.port}`;
      }
      if (account.chain_id) {
        const chain = this.db.prepare(
          'SELECT c.name, lp.host, lp.port FROM proxy_chains c LEFT JOIN proxies lp ON c.landing_proxy_id=lp.id WHERE c.id=?'
        ).get(account.chain_id);
        if (chain && chain.host) return `[chain:${chain.name||chain.id}] ${chain.host}:${chain.port}`;
      }
    } catch (e) { /* 表不存在等情况，静默 */ }
    return account.proxy || '';
  }

  // 内部日志记录
  _log(accountId, platform, action, status, details = '', ipUsed = '') {
    try {
      this.db.prepare(`INSERT INTO social_execution_log (account_id, platform, action, status, details, ip_used) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(accountId, platform, action, status, details, ipUsed);
    } catch (e) {
      console.error('[Dispatcher] 日志记录失败:', e.message);
    }
  }
}

module.exports = {
  SocialDispatcher,
  BaseAdapter,
  WhatsAppAdapter,
  TikTokAdapter,
  FacebookAdapter,
  LinkedInAdapter
};
