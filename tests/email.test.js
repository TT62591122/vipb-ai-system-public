/**
 * 邮件 API 测试
 */
const { request, login } = require('./helpers');

describe('Email API', () => {
  beforeAll(async () => { await login(); });

  test('GET /api/email/accounts — 邮件账号列表', async () => {
    const res = await request('/api/email/accounts');
    expect(res.status).toBe(200);
  });

  test('POST /api/email/accounts — 添加邮件账号', async () => {
    const res = await request('/api/email/accounts', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        password: 'testpass'
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
