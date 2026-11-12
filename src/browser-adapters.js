/**
 * 外部指纹浏览器适配器
 * 支持 AdsPower / Multilogin / GeeLark
 */
const axios = require('axios');
const puppeteer = require('puppeteer-core');

class BaseBrowserAdapter {
  constructor(name, defaultUrl) {
    this.name = name;
    this.defaultUrl = defaultUrl;
    this.apiUrl = defaultUrl;
  }

  setConfig(config) {
    if (config?.apiUrl) this.apiUrl = config.apiUrl;
  }

  async ping() {
    try {
      const resp = await axios.get(`${this.apiUrl}/status`, { timeout: 5000 });
      return { online: true, data: resp.data };
    } catch (e) {
      return { online: false, error: e.message };
    }
  }

  async launch(profileId) { throw new Error('未实现'); }
  async stop(profileId) { throw new Error('未实现'); }
  async listProfiles() { throw new Error('未实现'); }
}

// ==================== AdsPower ====================
class AdsPowerAdapter extends BaseBrowserAdapter {
  constructor() {
    super('adspower', 'http://local.adspower.net:50325');
  }

  async ping() {
    try {
      const resp = await axios.get(`${this.apiUrl}/api/v1/user/list?page_size=1`, { timeout: 5000 });
      return { online: resp.data?.code === 0, data: resp.data };
    } catch (e) {
      return { online: false, error: e.message };
    }
  }

  async launch(profileId) {
    const resp = await axios.get(`${this.apiUrl}/api/v1/browser/start`, {
      params: { user_id: profileId },
      timeout: 30000
    });
    if (resp.data?.code !== 0) throw new Error(`AdsPower启动失败: ${resp.data?.msg || '未知错误'}`);
    const wsEndpoint = resp.data.data?.ws?.puppeteer;
    if (!wsEndpoint) throw new Error('AdsPower未返回WebSocket地址');
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    return { browser, page, wsEndpoint, externalProfileId: profileId };
  }

  async stop(profileId) {
    const resp = await axios.get(`${this.apiUrl}/api/v1/browser/stop`, {
      params: { user_id: profileId },
      timeout: 10000
    });
    return resp.data?.code === 0;
  }

  async listProfiles(page = 1, pageSize = 100) {
    const resp = await axios.get(`${this.apiUrl}/api/v1/user/list`, {
      params: { page, page_size: pageSize },
      timeout: 10000
    });
    if (resp.data?.code !== 0) throw new Error(`获取配置文件失败: ${resp.data?.msg}`);
    return (resp.data.data?.list || []).map(p => ({
      id: p.user_id,
      name: p.name || p.user_id,
      status: p.status || 'unknown',
      raw: p
    }));
  }

  async createProfile(options = {}) {
    const resp = await axios.post(`${this.apiUrl}/api/v1/user/create`, {
      name: options.name || `profile_${Date.now()}`,
      group_id: options.groupId || '0',
      user_proxy_config: options.proxy ? {
        proxy_type: options.proxy.type || 'http',
        proxy_host: options.proxy.host,
        proxy_port: options.proxy.port,
        proxy_user: options.proxy.user || '',
        proxy_password: options.proxy.password || ''
      } : { proxy_type: 'noproxy' },
      fingerprint_config: {
        language: [options.language || 'en-US'],
        ua: options.userAgent || ''
      }
    }, { timeout: 15000 });
    if (resp.data?.code !== 0) throw new Error(`创建配置文件失败: ${resp.data?.msg}`);
    return { id: resp.data.data?.id, name: options.name };
  }
}

// ==================== Multilogin ====================
class MultiloginAdapter extends BaseBrowserAdapter {
  constructor() {
    super('multilogin', 'http://127.0.0.1:35000');
    this.token = '';
  }

  setConfig(config) {
    super.setConfig(config);
    if (config?.token) this.token = config.token;
  }

  _headers() {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async ping() {
    try {
      // Multilogin 6.x 用 /api/v2/profile
      const resp = await axios.get(`${this.apiUrl}/api/v2/profile`, {
        headers: this._headers(),
        timeout: 5000
      });
      return { online: true, data: resp.data };
    } catch (e) {
      // 也试试 Multilogin X 的端口
      try {
        const resp2 = await axios.get(`${this.apiUrl}/api/v1/profile`, {
          headers: this._headers(),
          timeout: 5000
        });
        return { online: true, data: resp2.data };
      } catch (e2) {
        return { online: false, error: e.message };
      }
    }
  }

  async launch(profileId) {
    // Multilogin 6.x
    const resp = await axios.get(`${this.apiUrl}/api/v2/profile/start`, {
      params: { profileId },
      headers: this._headers(),
      timeout: 60000
    });
    const wsEndpoint = resp.data?.value;
    if (!wsEndpoint) throw new Error('Multilogin未返回WebSocket地址');
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    return { browser, page, wsEndpoint, externalProfileId: profileId };
  }

  async stop(profileId) {
    try {
      await axios.get(`${this.apiUrl}/api/v2/profile/stop`, {
        params: { profileId },
        headers: this._headers(),
        timeout: 10000
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async listProfiles() {
    const resp = await axios.get(`${this.apiUrl}/api/v2/profile`, {
      headers: this._headers(),
      timeout: 10000
    });
    return (Array.isArray(resp.data) ? resp.data : []).map(p => ({
      id: p.uuid || p.id,
      name: p.name || p.uuid,
      status: p.status || 'unknown',
      raw: p
    }));
  }
}

// ==================== GeeLark ====================
class GeeLarkAdapter extends BaseBrowserAdapter {
  constructor() {
    super('geelark', 'http://127.0.0.1:43000');
    this.apiKey = '';
  }

  setConfig(config) {
    super.setConfig(config);
    if (config?.apiKey) this.apiKey = config.apiKey;
  }

  _headers() {
    return this.apiKey ? { 'X-API-Key': this.apiKey } : {};
  }

  async ping() {
    try {
      const resp = await axios.get(`${this.apiUrl}/api/v1/phone/list`, {
        headers: this._headers(),
        params: { page: 1, page_size: 1 },
        timeout: 5000
      });
      return { online: true, data: resp.data };
    } catch (e) {
      return { online: false, error: e.message };
    }
  }

  async launch(profileId) {
    // GeeLark 启动云手机
    const resp = await axios.post(`${this.apiUrl}/api/v1/phone/start`, 
      { phone_id: profileId },
      { headers: this._headers(), timeout: 60000 }
    );
    if (resp.data?.code !== 0) throw new Error(`GeeLark启动失败: ${resp.data?.msg || '未知错误'}`);
    
    // GeeLark 返回 adb 连接信息或 WebSocket
    const connInfo = resp.data.data;
    if (connInfo?.ws_endpoint) {
      const browser = await puppeteer.connect({ browserWSEndpoint: connInfo.ws_endpoint, defaultViewport: null });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      return { browser, page, wsEndpoint: connInfo.ws_endpoint, externalProfileId: profileId };
    }
    
    // GeeLark 可能需要通过 adb 连接，返回连接信息供上层处理
    return { 
      browser: null, page: null, 
      connectionInfo: connInfo, 
      externalProfileId: profileId,
      isCloudPhone: true 
    };
  }

  async stop(profileId) {
    try {
      await axios.post(`${this.apiUrl}/api/v1/phone/stop`,
        { phone_id: profileId },
        { headers: this._headers(), timeout: 10000 }
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  async listProfiles() {
    const resp = await axios.get(`${this.apiUrl}/api/v1/phone/list`, {
      headers: this._headers(),
      params: { page: 1, page_size: 100 },
      timeout: 10000
    });
    const list = resp.data?.data?.list || resp.data?.data || [];
    return list.map(p => ({
      id: p.phone_id || p.id,
      name: p.name || `云手机#${p.phone_id || p.id}`,
      status: p.status || 'unknown',
      raw: p
    }));
  }
}

// ==================== 管理器 ====================
class BrowserAdapterManager {
  constructor(db) {
    this.db = db;
    this.adapters = {
      adspower: new AdsPowerAdapter(),
      multilogin: new MultiloginAdapter(),
      geelark: new GeeLarkAdapter()
    };
    this._loadConfig();
  }

  _loadConfig() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='browser_adapters'").get();
      if (row) {
        const config = JSON.parse(row.value);
        for (const [type, adapter] of Object.entries(this.adapters)) {
          if (config[type]) adapter.setConfig(config[type]);
        }
      }
    } catch (e) {
      console.warn('⚠️ 加载指纹浏览器配置失败:', e.message);
    }
  }

  saveConfig(config) {
    const existing = this._getConfig();
    const merged = { ...existing, ...config };
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('browser_adapters', ?)").run(JSON.stringify(merged));
    // 重新加载
    for (const [type, adapter] of Object.entries(this.adapters)) {
      if (merged[type]) adapter.setConfig(merged[type]);
    }
  }

  _getConfig() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='browser_adapters'").get();
      return row ? JSON.parse(row.value) : {};
    } catch (e) { return {}; }
  }

  getAdapter(type) {
    return this.adapters[type] || null;
  }

  async getStatus() {
    const result = {};
    for (const [type, adapter] of Object.entries(this.adapters)) {
      result[type] = await adapter.ping();
      result[type].name = adapter.name;
    }
    return result;
  }
}

module.exports = { BrowserAdapterManager, AdsPowerAdapter, MultiloginAdapter, GeeLarkAdapter };