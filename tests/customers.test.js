/**
 * 客户 CRUD 测试
 */
const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
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
      // Capture set-cookie
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

async function login() {
  const res = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=admin&password=${process.env.TEST_ADMIN_PASSWORD || ''}`,
  });
  // Follow redirect — session cookie should already be captured
  return res;
}

describe('Customer CRUD', () => {
  let createdId;
  const testEmail = `test-${Date.now()}@example.com`;

  beforeAll(async () => {
    await login();
  });

  test('POST /api/customers — create customer', async () => {
    const res = await request('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ company: 'Test Corp', contact_name: 'John', email: testEmail, country: 'US' }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    createdId = res.body.id;
  });

  test('GET /api/customers/:id — read customer', async () => {
    const res = await request(`/api/customers/${createdId}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(testEmail);
  });

  test('PUT /api/customers/:id — update customer', async () => {
    const res = await request(`/api/customers/${createdId}`, {
      method: 'PUT',
      body: JSON.stringify({ company: 'Updated Corp' }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/customers — duplicate email returns 409', async () => {
    const res = await request('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ company: 'Dup Corp', email: testEmail }),
    });
    expect(res.status).toBe(409);
  });

  test('DELETE /api/customers/:id — delete customer', async () => {
    const res = await request(`/api/customers/${createdId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/customers/:id — deleted returns 404', async () => {
    const res = await request(`/api/customers/${createdId}`);
    expect(res.status).toBe(404);
  });
});
