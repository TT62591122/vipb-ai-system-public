/**
 * 健康检查端点测试
 */
const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = http.request(options, (res) => {
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

describe('Health Check', () => {
  test('GET /api/health returns status ok', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /api/health has uptime field', async () => {
    const res = await request('/api/health');
    expect(res.body).toHaveProperty('uptime');
  });

  test('GET /api/health has database info', async () => {
    const res = await request('/api/health');
    expect(res.body).toHaveProperty('database');
    expect(res.body.database).toHaveProperty('customers');
  });
});
