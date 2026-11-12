/**
 * 代理分享链接解析器 — 参考 NekoBox
 * 支持: ss:// vmess:// vless:// trojan:// hy2:// tuic:// socks:// http://
 */

function parseShareLink(link) {
  if (!link || typeof link !== 'string') return null;
  link = link.trim();
  if (!link) return null;

  try {
    if (link.startsWith('ss://')) return parseSS(link);
    if (link.startsWith('vmess://')) return parseVMess(link);
    if (link.startsWith('vless://')) return parseVLESS(link);
    if (link.startsWith('trojan://')) return parseTrojan(link);
    if (link.startsWith('hy2://') || link.startsWith('hysteria2://')) return parseHysteria2(link);
    if (link.startsWith('tuic://')) return parseTUIC(link);
    if (link.startsWith('wg://') || link.startsWith('wireguard://')) return parseWireGuard(link);
    if (link.startsWith('socks://') || link.startsWith('socks5://') || link.startsWith('socks4://')) return parseSOCKS(link);
  } catch (e) {
    console.error('[proxy-parser] Failed to parse:', link.substring(0, 60), e.message);
    return null;
  }
  return null;
}

function safeDecode(str) {
  // Handle both standard and URL-safe base64
  try {
    const padded = str + '='.repeat((4 - str.length % 4) % 4);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch { return null; }
}

function extractFragment(link) {
  const idx = link.lastIndexOf('#');
  if (idx === -1) return ['', link];
  return [decodeURIComponent(link.substring(idx + 1)), link.substring(0, idx)];
}

// ss://BASE64(method:password)@host:port#name   (SIP002)
// ss://BASE64(method:password@host:port)#name   (legacy)
function parseSS(link) {
  const [label, rest] = extractFragment(link);
  const body = rest.replace('ss://', '');

  // SIP002: base64userinfo@host:port
  if (body.includes('@')) {
    const atIdx = body.lastIndexOf('@');
    const userinfo = safeDecode(body.substring(0, atIdx));
    const hostport = body.substring(atIdx + 1);
    if (!userinfo) return null;
    const colonIdx = userinfo.indexOf(':');
    const method = userinfo.substring(0, colonIdx);
    const password = userinfo.substring(colonIdx + 1);
    const [host, portStr] = splitHostPort(hostport);
    return {
      protocol: 'shadowsocks', host, port: parseInt(portStr), password,
      label: label || '', share_link: link,
      extra_config: JSON.stringify({ method })
    };
  }

  // Legacy: entire thing is base64
  const decoded = safeDecode(body);
  if (!decoded) return null;
  const atIdx = decoded.lastIndexOf('@');
  const userinfo = decoded.substring(0, atIdx);
  const hostport = decoded.substring(atIdx + 1);
  const colonIdx = userinfo.indexOf(':');
  const method = userinfo.substring(0, colonIdx);
  const password = userinfo.substring(colonIdx + 1);
  const [host, portStr] = splitHostPort(hostport);
  return {
    protocol: 'shadowsocks', host, port: parseInt(portStr), password,
    label: label || '', share_link: link,
    extra_config: JSON.stringify({ method })
  };
}

// vmess://BASE64(JSON)
function parseVMess(link) {
  const body = link.replace('vmess://', '');
  const decoded = safeDecode(body);
  if (!decoded) return null;
  let json;
  try { json = JSON.parse(decoded); } catch { return null; }
  return {
    protocol: 'vmess',
    host: json.add || json.host || '',
    port: parseInt(json.port) || 0,
    password: json.id || '',
    label: json.ps || json.remark || '',
    share_link: link,
    extra_config: JSON.stringify({
      aid: json.aid || 0, net: json.net || 'tcp', type: json.type || 'none',
      host: json.host || '', path: json.path || '', tls: json.tls || '',
      sni: json.sni || '', alpn: json.alpn || '', v: json.v || '2'
    })
  };
}

// vless://uuid@host:port?params#name
function parseVLESS(link) {
  const [label, rest] = extractFragment(link);
  const url = new URL(rest.replace('vless://', 'http://'));
  const params = Object.fromEntries(url.searchParams);
  return {
    protocol: 'vless',
    host: url.hostname, port: parseInt(url.port) || 443,
    password: decodeURIComponent(url.username),
    label: label || '', share_link: link,
    extra_config: JSON.stringify({
      type: params.type || 'tcp', security: params.security || '',
      sni: params.sni || '', alpn: params.alpn || '', fp: params.fp || '',
      pbk: params.pbk || '', sid: params.sid || '', flow: params.flow || '',
      path: params.path || '', host: params.host || '',
      serviceName: params.serviceName || '', mode: params.mode || ''
    })
  };
}

// trojan://password@host:port?params#name
function parseTrojan(link) {
  const [label, rest] = extractFragment(link);
  const url = new URL(rest.replace('trojan://', 'http://'));
  const params = Object.fromEntries(url.searchParams);
  return {
    protocol: 'trojan',
    host: url.hostname, port: parseInt(url.port) || 443,
    password: decodeURIComponent(url.username),
    label: label || '', share_link: link,
    extra_config: JSON.stringify({
      sni: params.sni || '', alpn: params.alpn || '',
      type: params.type || 'tcp', path: params.path || '',
      host: params.host || '', fp: params.fp || ''
    })
  };
}

// hy2://auth@host:port?params#name
function parseHysteria2(link) {
  const [label, rest] = extractFragment(link);
  const normalized = rest.replace('hysteria2://', 'http://').replace('hy2://', 'http://');
  const url = new URL(normalized);
  const params = Object.fromEntries(url.searchParams);
  return {
    protocol: 'hysteria2',
    host: url.hostname, port: parseInt(url.port) || 443,
    password: decodeURIComponent(url.username),
    label: label || '', share_link: link,
    extra_config: JSON.stringify({
      sni: params.sni || '', insecure: params.insecure || '0',
      obfs: params.obfs || '', 'obfs-password': params['obfs-password'] || ''
    })
  };
}

// tuic://uuid:password@host:port?params#name
function parseTUIC(link) {
  const [label, rest] = extractFragment(link);
  const url = new URL(rest.replace('tuic://', 'http://'));
  const params = Object.fromEntries(url.searchParams);
  return {
    protocol: 'tuic',
    host: url.hostname, port: parseInt(url.port) || 443,
    password: decodeURIComponent(url.username) + (url.password ? ':' + decodeURIComponent(url.password) : ''),
    label: label || '', share_link: link,
    extra_config: JSON.stringify({
      congestion_control: params.congestion_control || 'bbr',
      alpn: params.alpn || '', sni: params.sni || '',
      udp_relay_mode: params.udp_relay_mode || ''
    })
  };
}

// wg://...  (simplified)
function parseWireGuard(link) {
  const [label, rest] = extractFragment(link);
  const normalized = rest.replace('wireguard://', 'http://').replace('wg://', 'http://');
  const url = new URL(normalized);
  const params = Object.fromEntries(url.searchParams);
  return {
    protocol: 'wireguard',
    host: url.hostname, port: parseInt(url.port) || 51820,
    password: decodeURIComponent(url.username),
    label: label || '', share_link: link,
    extra_config: JSON.stringify({
      publickey: params.publickey || '', mtu: params.mtu || '',
      address: params.address || '', dns: params.dns || ''
    })
  };
}

// socks(5)://user:pass@host:port#name
function parseSOCKS(link) {
  const [label, rest] = extractFragment(link);
  const normalized = rest.replace(/^socks[45]?:\/\//, 'http://');
  const url = new URL(normalized);
  const proto = link.startsWith('socks4') ? 'socks4' : 'socks5';
  return {
    protocol: proto,
    host: url.hostname, port: parseInt(url.port) || 1080,
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    label: label || '', share_link: link,
    extra_config: '{}'
  };
}

function splitHostPort(str) {
  // Handle [ipv6]:port
  if (str.startsWith('[')) {
    const end = str.indexOf(']');
    return [str.substring(1, end), str.substring(end + 2)];
  }
  const idx = str.lastIndexOf(':');
  return [str.substring(0, idx), str.substring(idx + 1)];
}

/**
 * 解析 Clash YAML 格式的代理列表
 */
/**
 * 检测字符串是否为IP地址（v4或v6）
 */
function isIPAddress(str) {
  if (!str) return false;
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(str)) return true;
  // IPv6 (simplified check)
  if (str.includes(':') && /^[0-9a-fA-F:]+$/.test(str)) return true;
  return false;
}

/**
 * 修正 security 字段 — 参考 NekoBox RawUpdater_FixEnt
 */
function fixSecurity(extra, server) {
  if (extra.security !== undefined) {
    const sec = String(extra.security).toLowerCase();
    if (sec === 'none' || sec === '0' || sec === 'false') {
      extra.security = '';
    } else if (sec === '1' || sec === 'true') {
      extra.security = 'tls';
    }
  }
  // 当security为tls、server是IP、有host但没sni时，sni = host
  if (extra.security === 'tls' && isIPAddress(server)) {
    const host = extra.host || (extra['ws-opts'] && extra['ws-opts'].headers && extra['ws-opts'].headers.Host) || '';
    if (host && !extra.sni) {
      extra.sni = host;
    }
  }
}

function parseClashYAML(text) {
  const results = [];
  try {
    const yaml = require('js-yaml');
    const config = yaml.load(text);
    if (!config || !Array.isArray(config.proxies)) return results;

    for (const p of config.proxies) {
      if (!p || !p.server) continue;
      let protocol = (p.type || 'unknown').toLowerCase();
      const extra = {};

      // SSR 类型
      if (protocol === 'ssr') {
        if (p.cipher) extra.method = p.cipher;
        if (p.obfs) extra.obfs = p.obfs;
        if (p['obfs-param']) extra['obfs-param'] = p['obfs-param'];
        if (p.protocol) extra.protocol = p.protocol;
        if (p['protocol-param']) extra['protocol-param'] = p['protocol-param'];
      }

      // 通用字段
      if (p.cipher) extra.method = p.cipher;
      if (p.network) extra.net = p.network;
      if (p.tls !== undefined) {
        extra.tls = p.tls;
        // 将 tls bool 映射到 security
        if (p.tls === true) extra.security = 'tls';
        else if (p.tls === false) extra.security = '';
      }
      if (p.sni) extra.sni = p.sni;
      if (p.alpn) extra.alpn = Array.isArray(p.alpn) ? p.alpn.join(',') : p.alpn;
      if (p['skip-cert-verify'] !== undefined) extra['skip-cert-verify'] = p['skip-cert-verify'];
      if (p['servername']) extra.sni = p['servername'];
      if (p.flow) extra.flow = p.flow;
      if (p['client-fingerprint']) extra.fp = p['client-fingerprint'];

      // vmess 特有
      if (p.alterId !== undefined) extra.aid = p.alterId;
      if (p['alter-id'] !== undefined) extra.aid = p['alter-id'];

      // hysteria2
      if (p.obfs && protocol === 'hysteria2') extra.obfs = p.obfs;
      if (p['obfs-password']) extra['obfs-password'] = p['obfs-password'];
      if (p.up) extra.up = p.up;
      if (p.down) extra.down = p.down;

      // --- ws-opts 完整解析 ---
      if (p['ws-opts']) {
        const wo = p['ws-opts'];
        extra['ws-opts'] = {};
        if (wo.path) extra['ws-opts'].path = wo.path;
        if (wo.headers) {
          extra['ws-opts'].headers = wo.headers;
          // 提取 host 便于后续使用
          if (wo.headers.Host) extra.host = wo.headers.Host;
        }
        if (wo['max-early-data'] !== undefined) extra['ws-opts']['max-early-data'] = wo['max-early-data'];
        if (wo['early-data-header-name']) extra['ws-opts']['early-data-header-name'] = wo['early-data-header-name'];
      }

      // --- grpc-opts ---
      if (p['grpc-opts']) {
        extra['grpc-opts'] = {};
        if (p['grpc-opts']['grpc-service-name']) extra['grpc-opts']['grpc-service-name'] = p['grpc-opts']['grpc-service-name'];
      }

      // --- h2-opts ---
      if (p['h2-opts']) {
        extra['h2-opts'] = {};
        if (p['h2-opts'].host) extra['h2-opts'].host = Array.isArray(p['h2-opts'].host) ? p['h2-opts'].host : [p['h2-opts'].host];
        if (p['h2-opts'].path) extra['h2-opts'].path = p['h2-opts'].path;
      }

      // --- http-opts (TCP伪装HTTP) ---
      if (p['http-opts']) {
        extra['http-opts'] = {};
        if (p['http-opts'].method) extra['http-opts'].method = p['http-opts'].method;
        if (p['http-opts'].path) extra['http-opts'].path = p['http-opts'].path;
        if (p['http-opts'].headers) extra['http-opts'].headers = p['http-opts'].headers;
      }

      // --- reality-opts ---
      if (p['reality-opts']) {
        extra['reality-opts'] = {};
        if (p['reality-opts']['public-key']) extra['reality-opts']['public-key'] = p['reality-opts']['public-key'];
        if (p['reality-opts']['short-id']) extra['reality-opts']['short-id'] = p['reality-opts']['short-id'];
        // Also set security to reality
        extra.security = 'reality';
      }

      // --- SS 插件 ---
      if (p.plugin) {
        extra.plugin = p.plugin;
        if (p['plugin-opts']) extra['plugin-opts'] = p['plugin-opts'];
      }

      // --- smux (sing-mux) ---
      if (p.smux) {
        extra.smux = {};
        if (p.smux.enabled !== undefined) extra.smux.enabled = p.smux.enabled;
        if (p.smux.protocol) extra.smux.protocol = p.smux.protocol;
        if (p.smux['max-connections']) extra.smux['max-connections'] = p.smux['max-connections'];
      }

      // --- udp-over-tcp ---
      if (p['udp-over-tcp'] !== undefined) extra['udp-over-tcp'] = p['udp-over-tcp'];
      if (p['udp-over-tcp-version'] !== undefined) extra['udp-over-tcp-version'] = p['udp-over-tcp-version'];

      // --- packet-addr / xudp (VLESS packet encoding) ---
      if (p['packet-addr'] !== undefined) extra['packet-addr'] = p['packet-addr'];
      if (p.xudp !== undefined) extra.xudp = p.xudp;
      if (p['packet-encoding']) extra['packet-encoding'] = p['packet-encoding'];

      // --- security 字段自动修正 ---
      fixSecurity(extra, p.server);

      results.push({
        protocol,
        host: p.server,
        port: parseInt(p.port) || 0,
        username: '',
        password: p.password || p.uuid || '',
        label: p.name || '',
        share_link: '',
        extra_config: JSON.stringify(extra),
        group_name: ''
      });
    }
  } catch (e) {
    console.error('[proxy-parser] Clash YAML parse failed:', e.message);
  }
  return results;
}

/**
 * 解析订阅内容 — 支持 Clash YAML / base64 / 逐行分享链接
 * @param {string} text - 订阅返回的原始文本
 * @returns {Array} 解析出的节点列表
 */
function parseSubscription(text) {
  if (!text || typeof text !== 'string') return [];

  // 检测 Clash YAML 格式
  if (text.includes('proxies:') && (text.includes('port:') || text.includes('server:'))) {
    const clashNodes = parseClashYAML(text);
    if (clashNodes.length > 0) return clashNodes;
  }

  // 尝试 base64 解码
  let decoded = safeDecode(text.trim());
  let lines;
  if (decoded && (decoded.includes('://') || decoded.includes('\n'))) {
    lines = decoded.split(/\r?\n/);
  } else {
    lines = text.split(/\r?\n/);
  }

  const results = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseShareLink(trimmed);
    if (parsed) results.push(parsed);
  }
  return results;
}

module.exports = { parseShareLink, parseSubscription };
