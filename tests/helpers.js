/**
 * 测试辅助工具
 */
const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3099';
let cookie = '';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = { ...opts.headers };
    if (cookie) headers.cookie = cookie;
    if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers,
    };
    const req = http.request(options, (res) => {
      if (res.headers['set-cookie']) {
        cookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

async function login(username = 'admin', password = process.env.TEST_ADMIN_PASSWORD) {
  if (!password) throw new Error('请先设置环境变量 TEST_ADMIN_PASSWORD（测试用管理员口令）');
  const res = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${username}&password=${password}`,
  });
  return res;
}

function resetCookie() { cookie = ''; }

module.exports = { request, login, resetCookie };
