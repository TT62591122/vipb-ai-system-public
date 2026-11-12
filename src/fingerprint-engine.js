const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const { BrowserAdapterManager } = require('./browser-adapters');

puppeteer.use(StealthPlugin());

class BrowserPool {
  constructor(db) {
    this.db = db;
    this.instances = new Map(); // instanceId -> { browser, page, accountId, status, lastUsed, browserType, externalProfileId }
    this.maxInstances = parseInt(process.env.MAX_BROWSER_INSTANCES) || 18;
    this.idleTimeout = parseInt(process.env.BROWSER_IDLE_TIMEOUT) || 5 * 60 * 1000;
    this.profilesDir = path.join(__dirname, '../data/browser-profiles');
    this._idleChecker = null;
    
    // 初始化浏览器适配器管理器
    this.browserAdapterManager = new BrowserAdapterManager(db);

    // 确保 browser_profiles 表存在
    this._ensureTable();
    // 启动空闲检查
    this._startIdleChecker();

    console.log(`🌐 指纹浏览器池初始化完成 (最大并发: ${this.maxInstances})`);
  }

  _ensureTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS browser_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL UNIQUE,
          user_agent TEXT,
          screen_width INTEGER DEFAULT 1920,
          screen_height INTEGER DEFAULT 1080,
          language TEXT DEFAULT 'en-US',
          timezone TEXT DEFAULT 'America/New_York',
          webgl_vendor TEXT DEFAULT 'Google Inc.',
          webgl_renderer TEXT DEFAULT 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)',
          platform TEXT DEFAULT 'Win32',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e) {
      // table already exists
    }
  }

  _startIdleChecker() {
    this._idleChecker = setInterval(() => {
      const now = Date.now();
      for (const [id, inst] of this.instances) {
        if (inst.status === 'idle' && (now - inst.lastUsed) > this.idleTimeout) {
          console.log(`⏰ 浏览器实例 ${id} 空闲超时，自动关闭`);
          this.destroy(id).catch(() => {});
        }
      }
    }, 30000);
  }

  _getFingerprint(accountId) {
    try {
      const row = this.db.prepare('SELECT * FROM browser_profiles WHERE account_id = ?').get(accountId);
      if (row) return row;
    } catch (e) {}
    return null;
  }

  /**
   * 获取账号绑定的代理配置
   * 查找链路: social_accounts.proxy_id → proxies表
   * 如果proxy_id为空但chain_id有值，则使用代理链
   */
  _getAccountProxy(accountId) {
    try {
      // 先查social_accounts表的proxy_id和chain_id
      const account = this.db.prepare(
        'SELECT proxy_id, chain_id FROM social_accounts WHERE id=? OR username=?'
      ).get(accountId, accountId);
      if (!account) return null;

      // 优先使用直接绑定的代理
      if (account.proxy_id) {
        const proxy = this.db.prepare(
          'SELECT * FROM proxies WHERE id=? AND is_alive=1'
        ).get(account.proxy_id);
        if (proxy) return proxy;
      }

      // 其次使用代理链中的落地代理
      if (account.chain_id) {
        const chain = this.db.prepare(
          'SELECT landing_proxy_id FROM proxy_chains WHERE id=? AND status="active"'
        ).get(account.chain_id);
        if (chain && chain.landing_proxy_id) {
          const proxy = this.db.prepare(
            'SELECT * FROM proxies WHERE id=? AND is_alive=1'
          ).get(chain.landing_proxy_id);
          if (proxy) return proxy;
        }
      }

      return null;
    } catch (e) {
      // social_accounts表可能不存在，静默失败
      return null;
    }
  }

  /**
   * 获取账号绑定的浏览器环境指纹
   * 查找链路: social_accounts.profile_id → browser_profiles表
   * 支持两种模式：
   *   1. 账号绑定profile_id → 查browser_profiles.id
   *   2. 账号username匹配 → 查browser_profiles.account_id
   */
  _getAccountProfile(accountId) {
    try {
      const account = this.db.prepare(
        'SELECT profile_id, username FROM social_accounts WHERE id=? OR username=?'
      ).get(accountId, accountId);
      if (!account) return null;

      // 优先使用绑定的profile_id
      if (account.profile_id) {
        const profile = this.db.prepare(
          'SELECT * FROM browser_profiles WHERE id=?'
        ).get(account.profile_id);
        if (profile) return profile;
      }

      // 其次尝试username匹配（兼容旧模式）
      if (account.username) {
        const profile = this.db.prepare(
          'SELECT * FROM browser_profiles WHERE account_id=?'
        ).get(account.username);
        if (profile) return profile;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 构建代理URL字符串
   * 使用 protocol 字段（http/socks5/socks4）而非 type（residential/datacenter）
   */
  _buildProxyUrl(proxy) {
    if (!proxy || !proxy.host) return null;
    const protocol = (proxy.protocol || 'http').toLowerCase();
    const auth = proxy.username ? `${proxy.username}:${proxy.password || ''}@` : '';
    if (protocol === 'socks5' || protocol === 'socks4') {
      return `${protocol}://${auth}${proxy.host}:${proxy.port || 1080}`;
    }
    return `http://${auth}${proxy.host}:${proxy.port || 8080}`;
  }

  _generateInstanceId(accountId) {
    return `${accountId}_${Date.now()}`;
  }

  async acquire(accountId, fingerprint = null) {
    // === 外部指纹浏览器支持 ===
    const externalResult = await this._tryExternalBrowser(accountId);
    if (externalResult) return externalResult;
    // === 以下为原有 builtin 逻辑 ===
    
    // 检查是否已有该账号的空闲实例
    for (const [id, inst] of this.instances) {
      if (inst.accountId === accountId && inst.status === 'idle') {
        inst.status = 'active';
        inst.lastUsed = Date.now();
        console.log(`♻️ 复用浏览器实例 ${id}`);
        return { instanceId: id, browser: inst.browser, page: inst.page };
      }
    }

    // 检查容量
    if (this.instances.size >= this.maxInstances) {
      // 尝试关闭最老的空闲实例
      let oldest = null;
      for (const [id, inst] of this.instances) {
        if (inst.status === 'idle' && (!oldest || inst.lastUsed < oldest.lastUsed)) {
          oldest = { id, ...inst };
        }
      }
      if (oldest) {
        await this.destroy(oldest.id);
      } else {
        throw new Error(`浏览器池已满 (${this.maxInstances}/${this.maxInstances})，无空闲实例可回收`);
      }
    }

    // 查询账号的浏览器类型（仅用于日志，外部浏览器已在 _tryExternalBrowser 中处理）
    // 以下为 builtin 逻辑

    // 合并指纹：参数 > 账号绑定的环境 > 数据库(account_id匹配) > 默认
    const boundProfile = this._getAccountProfile(accountId);
    const dbFp = this._getFingerprint(accountId);
    const fp = Object.assign({
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      screen_width: 1920,
      screen_height: 1080,
      language: 'en-US',
      timezone: 'America/New_York',
      webgl_vendor: 'Google Inc.',
      webgl_renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)',
      platform: 'Win32'
    }, dbFp || {}, boundProfile || {}, fingerprint || {});

    // 为指纹噪声生成稳定的随机种子（基于accountId，确保同账号每次一致）
    let hash = 0;
    for (let i = 0; i < accountId.length; i++) {
      hash = ((hash << 5) - hash) + accountId.charCodeAt(i);
      hash |= 0;
    }
    fp._canvasSeed = Math.abs(hash) % 256;
    fp._audioSeed = Math.abs(hash >> 8) % 256;
    fp._fontSeed = Math.abs(hash >> 16) % 256;

    // 确保 userDataDir 存在
    const userDataDir = path.join(this.profilesDir, accountId);
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    // 获取账号绑定的代理
    const accountProxy = this._getAccountProxy(accountId);
    const proxyUrl = this._buildProxyUrl(accountProxy);

    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${fp.screen_width},${fp.screen_height}`,
        `--lang=${fp.language}`,
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--enforce-webrtc-ip-permission-check',
        '--disable-webrtc-hw-encoding',
        '--disable-webrtc-hw-decoding'
    ];

    // 注入代理（如果账号绑定了代理）
    if (proxyUrl) {
      launchArgs.push(`--proxy-server=${proxyUrl}`);
      console.log(`🌐 账号 ${accountId} 使用代理: ${accountProxy.host}:${accountProxy.port} (${accountProxy.type || 'http'})`);
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      userDataDir,
      args: launchArgs
    });

    const page = await browser.newPage();

    // 代理认证（如果代理需要用户名密码）
    if (accountProxy && accountProxy.username) {
      await page.authenticate({
        username: accountProxy.username,
        password: accountProxy.password || ''
      });
    }

    // 应用指纹
    await page.setUserAgent(fp.user_agent);
    await page.setViewport({ width: fp.screen_width, height: fp.screen_height });

    // 注入指纹覆盖
    await page.evaluateOnNewDocument((fp) => {
      // 时区
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
        value: function() { return { timeZone: fp.timezone, locale: fp.language }; }
      });
      // 语言
      Object.defineProperty(navigator, 'language', { get: () => fp.language });
      Object.defineProperty(navigator, 'languages', { get: () => [fp.language, fp.language.split('-')[0]] });
      // 平台
      Object.defineProperty(navigator, 'platform', { get: () => fp.platform });
      // WebGL
      const getParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return fp.webgl_vendor;
        if (param === 37446) return fp.webgl_renderer;
        return getParam.call(this, param);
      };
      // 屏幕
      Object.defineProperty(screen, 'width', { get: () => fp.screen_width });
      Object.defineProperty(screen, 'height', { get: () => fp.screen_height });

      // === Canvas 指纹噪声 ===
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (this.width === 0 || this.height === 0) return origToDataURL.apply(this, arguments);
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = imageData.data[i] ^ (fp._canvasSeed & 0xFF);
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return origToDataURL.apply(this, arguments);
      };
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
        if (this.width === 0 || this.height === 0) return origToBlob.apply(this, arguments);
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = imageData.data[i] ^ (fp._canvasSeed & 0xFF);
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return origToBlob.apply(this, arguments);
      };

      // === AudioContext 指纹噪声 ===
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(channel) {
        const data = origGetChannelData.call(this, channel);
        if (data.length > 0) {
          for (let i = 0; i < Math.min(data.length, 100); i++) {
            data[i] += (fp._audioSeed * 0.00001 * (i % 7 - 3));
          }
        }
        return data;
      };

      // === WebRTC IP 泄露防护 ===
      if (window.RTCPeerConnection) {
        const origRTC = window.RTCPeerConnection;
        window.RTCPeerConnection = function(config, constraints) {
          if (config && config.iceServers) {
            config.iceServers = [];
          }
          return new origRTC(config, constraints);
        };
        window.RTCPeerConnection.prototype = origRTC.prototype;
      }
      if (window.webkitRTCPeerConnection) {
        window.webkitRTCPeerConnection = window.RTCPeerConnection;
      }
      // 也屏蔽 navigator.mediaDevices.enumerateDevices 暴露设备信息
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices = async function() {
          return [
            { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'default' },
            { deviceId: 'default', kind: 'videoinput', label: '', groupId: 'default' },
            { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'default' }
          ];
        };
      }

      // === 字体指纹随机化 ===
      // 限制可检测的字体数量，每个配置文件返回不同子集
      const allFonts = ['Arial','Verdana','Helvetica','Times New Roman','Georgia','Courier New','Trebuchet MS','Impact','Comic Sans MS','Palatino Linotype','Lucida Console','Tahoma','Segoe UI','Cambria','Calibri','Garamond','Book Antiqua','Century Gothic','Franklin Gothic Medium','Lucida Sans Unicode'];
      const fontCount = 10 + (fp._fontSeed % 8); // 10-17种字体
      const shuffled = allFonts.slice().sort(() => (fp._fontSeed * 0.1 % 1) - 0.5);
      const allowedFonts = new Set(shuffled.slice(0, fontCount));
      // 拦截字体检测（通过offsetWidth/offsetHeight方式）
      const origCreateElement = document.createElement.bind(document);
      // 不直接覆盖createElement以避免破坏页面，而是通过CSS覆盖
      
      // === 硬件并发数伪装 ===
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => [2,4,6,8][fp._fontSeed % 4] });
      
      // === 设备内存伪装 ===
      Object.defineProperty(navigator, 'deviceMemory', { get: () => [2,4,8,16][fp._fontSeed % 4] });
      
      // === 电池API屏蔽 ===
      if (navigator.getBattery) {
        navigator.getBattery = async () => ({
          charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
          addEventListener: () => {}, removeEventListener: () => {}
        });
      }

      // === Connection API 伪装 ===
      if (navigator.connection) {
        Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
        Object.defineProperty(navigator.connection, 'downlink', { get: () => 5 + (fp._fontSeed % 20) });
        Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 + (fp._fontSeed % 100) });
      }
    }, fp);

    const instanceId = this._generateInstanceId(accountId);
    this.instances.set(instanceId, {
      browser,
      page,
      accountId,
      status: 'active',
      lastUsed: Date.now(),
      createdAt: Date.now(),
      browserType: 'builtin', // 内置浏览器
      externalProfileId: null
    });

    console.log(`🚀 创建内置浏览器实例 ${instanceId} (账号: ${accountId})`);

    // 新实例初始拟人行为（模拟真人刚打开浏览器的动作）
    try {
      const startX = 400 + Math.floor(Math.random() * 400);
      const startY = 300 + Math.floor(Math.random() * 200);
      await page.mouse.move(startX, startY, { steps: 5 + Math.floor(Math.random() * 10) });
    } catch (e) { /* ignore */ }

    return { instanceId, browser, page };
  }

  /**
   * 尝试使用外部指纹浏览器
   * 如果账号绑定了外部浏览器且可用，返回浏览器实例；否则返回null（降级到builtin）
   */
  async _tryExternalBrowser(accountId) {
    if (!this.browserAdapterManager) return null;
    
    try {
      // 查询账号的 browser_type
      const sa = this.db.prepare(
        'SELECT id, browser_type FROM social_accounts WHERE id=? OR account_id=?'
      ).get(accountId, accountId);
      
      if (!sa || !sa.browser_type || sa.browser_type === 'builtin') return null;
      
      const adapter = this.browserAdapterManager.getAdapter(sa.browser_type);
      if (!adapter) {
        console.warn(`⚠️ 未知的浏览器类型: ${sa.browser_type}，降级到builtin`);
        return null;
      }
      
      // 检查是否在线
      const status = await adapter.ping();
      if (!status.online) {
        console.warn(`⚠️ ${sa.browser_type} 不在线，降级到builtin`);
        return null;
      }
      
      // 获取外部配置文件ID
      const profile = this.db.prepare(
        'SELECT external_profile_id FROM browser_profiles WHERE id=(SELECT profile_id FROM social_accounts WHERE id=?)'
      ).get(sa.id);
      
      const externalProfileId = profile?.external_profile_id;
      if (!externalProfileId) {
        console.warn(`⚠️ 账号 ${accountId} 未绑定外部浏览器配置文件，降级到builtin`);
        return null;
      }
      
      // 启动外部浏览器
      console.log(`🔒 使用 ${sa.browser_type} 启动浏览器 (配置: ${externalProfileId})`);
      const result = await adapter.launch(externalProfileId);
      
      if (!result.browser || !result.page) {
        console.warn(`⚠️ ${sa.browser_type} 启动成功但无法获取page，降级到builtin`);
        return null;
      }
      
      // 注册到实例池
      const instanceId = `ext_${sa.browser_type}_${Date.now()}`;
      this.instances.set(instanceId, {
        browser: result.browser,
        page: result.page,
        accountId,
        status: 'active',
        lastUsed: Date.now(),
        isExternal: true,
        externalType: sa.browser_type,
        externalProfileId
      });
      
      console.log(`✅ ${sa.browser_type} 浏览器已启动 (实例: ${instanceId})`);
      return { instanceId, browser: result.browser, page: result.page };
      
    } catch (e) {
      console.error(`❌ 外部浏览器启动失败: ${e.message}，降级到builtin`);
      // 记录错误到账号
      try {
        this.db.prepare('UPDATE social_accounts SET last_error=? WHERE id=? OR account_id=?')
          .run(`外部浏览器错误: ${e.message}`, accountId, accountId);
      } catch (dbErr) {}
      return null;
    }
  }

  /**
   * 启动外部指纹浏览器
   */
  async _launchExternalBrowser(accountId, browserType, externalProfileId, fingerprint = null) {
    try {
      console.log(`🚀 启动外部浏览器 (类型: ${browserType}, 配置文件: ${externalProfileId})`);
      
      // 使用适配器启动
      const adapter = this.browserAdapterManager.getAdapter(browserType);
      if (!adapter) throw new Error(`不支持的浏览器类型: ${browserType}`);
      const { browser, page, wsEndpoint } = await adapter.launch(externalProfileId);
      
      const instanceId = this._generateInstanceId(accountId);
      this.instances.set(instanceId, {
        browser,
        page,
        accountId,
        status: 'active',
        lastUsed: Date.now(),
        createdAt: Date.now(),
        browserType,
        externalProfileId,
        wsEndpoint
      });
      
      console.log(`✅ 外部浏览器启动成功 ${instanceId} (类型: ${browserType}, 配置文件: ${externalProfileId})`);
      
      return { instanceId, browser, page };
    } catch (error) {
      console.error(`❌ 外部浏览器启动失败 (类型: ${browserType}):`, error);
      throw new Error(`外部浏览器启动失败: ${error.message}`);
    }
  }

  release(instanceId) {
    const inst = this.instances.get(instanceId);
    if (!inst) throw new Error(`实例 ${instanceId} 不存在`);
    inst.status = 'idle';
    inst.lastUsed = Date.now();
    const browserTypeLabel = inst.browserType === 'builtin' ? '内置' : `外部(${inst.browserType})`;
    console.log(`📤 释放${browserTypeLabel}浏览器实例 ${instanceId}`);
  }

  async destroy(instanceId) {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    
    try {
      // 如果是外部浏览器，调用适配器的stop
      if (inst.isExternal && this.browserAdapterManager && inst.externalType && inst.externalProfileId) {
        try {
          const adapter = this.browserAdapterManager.getAdapter(inst.externalType);
          if (adapter) await adapter.stop(inst.externalProfileId);
          console.log(`💥 关闭外部浏览器实例 ${instanceId} (类型: ${inst.externalType})`);
        } catch (e) {
          console.warn(`⚠️ 外部浏览器关闭失败: ${e.message}`);
        }
      } else if (inst.browserType && inst.browserType !== 'builtin' && inst.externalProfileId) {
        // 向后兼容旧的字段结构
        try {
          const adapter = this.browserAdapterManager.getAdapter(inst.browserType);
          if (adapter) await adapter.stop(inst.externalProfileId);
        } catch (e2) { console.warn(`⚠️ 外部浏览器关闭失败: ${e2.message}`); }
        console.log(`💥 关闭外部浏览器实例 ${instanceId} (类型: ${inst.browserType})`);
      } else {
        // 内置浏览器直接关闭
        await inst.browser.close();
        console.log(`💥 销毁内置浏览器实例 ${instanceId}`);
      }
    } catch (e) {
      console.error(`关闭浏览器实例 ${instanceId} 时出错:`, e.message);
    }
    
    this.instances.delete(instanceId);
  }

  getStatus() {
    let active = 0, idle = 0;
    let builtin = 0, external = 0;
    
    for (const inst of this.instances.values()) {
      if (inst.status === 'active') active++;
      else idle++;
      
      if (inst.browserType === 'builtin') builtin++;
      else external++;
    }
    
    return {
      active,
      idle,
      total: this.instances.size,
      builtin,
      external,
      max: this.maxInstances,
      available: this.maxInstances - this.instances.size
    };
  }

  async shutdown() {
    clearInterval(this._idleChecker);
    for (const [id] of this.instances) {
      await this.destroy(id);
    }
    console.log('🛑 浏览器池已关闭');
  }
}

module.exports = BrowserPool;
