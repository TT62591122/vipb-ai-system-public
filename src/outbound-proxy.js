const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ========== 全局代理缓存（settings表） ==========
let _cachedAgent = null;
let _cacheTime = 0;
const CACHE_TTL = 30000; // 30秒缓存

function getProxyAgent(db) {
  try {
    const now = Date.now();
    if (_cachedAgent !== null && (now - _cacheTime) < CACHE_TTL) {
      return _cachedAgent || null;
    }
    
    const row = db.prepare("SELECT value FROM settings WHERE key='outbound_proxy'").get();
    if (!row) { _cachedAgent = false; _cacheTime = now; return null; }
    const config = JSON.parse(row.value);
    if (!config.enabled || !config.url) { _cachedAgent = false; _cacheTime = now; return null; }
    
    const url = config.url.trim();
    if (url.startsWith('socks')) {
      _cachedAgent = new SocksProxyAgent(url);
    } else {
      _cachedAgent = new HttpsProxyAgent(url);
    }
    _cacheTime = now;
    return _cachedAgent;
  } catch(e) {
    return null;
  }
}

// ========== 账号级代理缓存 ==========
const _accountAgentCache = new Map(); // accountId -> { agent, time }

/**
 * 获取账号绑定的代理Agent
 * 查找链路: social_accounts.proxy_id → proxies表
 *           social_accounts.chain_id → proxy_chains.landing_proxy_id → proxies表
 * 如果账号没绑定代理，返回null（调用方可fallback到全局代理）
 */
function getAccountProxyAgent(db, accountId) {
  if (!accountId) return null;
  try {
    // 缓存检查
    const cached = _accountAgentCache.get(accountId);
    if (cached && (Date.now() - cached.time) < CACHE_TTL) {
      return cached.agent || null;
    }

    const account = db.prepare(
      'SELECT proxy_id, chain_id FROM social_accounts WHERE id=? OR username=?'
    ).get(accountId, accountId);
    if (!account) { _accountAgentCache.set(accountId, { agent: false, time: Date.now() }); return null; }

    let proxy = null;

    // 优先直接绑定的代理
    if (account.proxy_id) {
      proxy = db.prepare('SELECT * FROM proxies WHERE id=? AND is_alive=1').get(account.proxy_id);
    }

    // 其次代理链的落地代理
    if (!proxy && account.chain_id) {
      const chain = db.prepare('SELECT landing_proxy_id FROM proxy_chains WHERE id=? AND status="active"').get(account.chain_id);
      if (chain && chain.landing_proxy_id) {
        proxy = db.prepare('SELECT * FROM proxies WHERE id=? AND is_alive=1').get(chain.landing_proxy_id);
      }
    }

    if (!proxy || !proxy.host) {
      _accountAgentCache.set(accountId, { agent: false, time: Date.now() });
      return null;
    }

    // 构建代理URL
    const protocol = (proxy.protocol || 'http').toLowerCase();
    const auth = proxy.username ? `${proxy.username}:${proxy.password || ''}@` : '';
    let url;
    if (protocol === 'socks5' || protocol === 'socks4') {
      url = `${protocol}://${auth}${proxy.host}:${proxy.port || 1080}`;
    } else {
      url = `http://${auth}${proxy.host}:${proxy.port || 8080}`;
    }

    const agent = url.startsWith('socks') ? new SocksProxyAgent(url) : new HttpsProxyAgent(url);
    _accountAgentCache.set(accountId, { agent, time: Date.now() });
    return agent;
  } catch (e) {
    return null;
  }
}

/**
 * 给axios config注入代理（如果已启用）
 * 支持账号级代理：优先使用accountId绑定的代理，fallback到全局代理
 * 用法: axios.get(url, injectProxy(db, { timeout: 5000 }, accountId))
 */
function injectProxy(db, axiosConfig = {}, accountId = null) {
  const agent = (accountId && getAccountProxyAgent(db, accountId)) || getProxyAgent(db);
  if (agent) {
    axiosConfig.httpAgent = agent;
    axiosConfig.httpsAgent = agent;
  }
  return axiosConfig;
}

/**
 * 给fetch options注入代理（如果已启用）
 * 支持账号级代理：优先使用accountId绑定的代理，fallback到全局代理
 * 用法: fetch(url, injectProxyFetch(db, { headers: {...} }, accountId))
 */
function injectProxyFetch(db, fetchOpts = {}, accountId = null) {
  const agent = (accountId && getAccountProxyAgent(db, accountId)) || getProxyAgent(db);
  if (agent) {
    fetchOpts.agent = agent;
  }
  return fetchOpts;
}

// 清除缓存（配置变更时调用）
function clearProxyCache() {
  _cachedAgent = null;
  _cacheTime = 0;
  _accountAgentCache.clear();
}

module.exports = { getProxyAgent, getAccountProxyAgent, injectProxy, injectProxyFetch, clearProxyCache };