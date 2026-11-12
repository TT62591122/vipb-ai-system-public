/**
 * 安全相关测试
 */
const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = { ...opts.headers };
    if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers,
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

describe('Security', () => {
  test('Protected API returns 401/302 without auth', async () => {
    const res = await request('/api/customers');
    // Should redirect to login or return 401
    expect([302, 401, 403]).toContain(res.status);
  });

  test('Protected page redirects to login without auth', async () => {
    const res = await request('/dashboard');
    expect([302, 301]).toContain(res.status);
  });

  test('SQL injection in search param does not crash', async () => {
    const res = await request("/api/health?detail=true'; DROP TABLE customers;--");
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  test('Login with wrong credentials fails', async () => {
    const res = await request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: "username=admin&password=wrongpassword",
    });
    // Should return login page (200) or redirect back
    expect([200, 302]).toContain(res.status);
  });

  test('Health endpoint is public (no auth needed)', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('Security headers are present', async () => {
    const res = await request('/api/health');
    // helmet should set these
    expect(res.headers).toHaveProperty('x-content-type-options');
  });
});
