/**
 * 矩阵任务 API 测试
 */
const { request, login } = require('./helpers');

describe('Matrix Task API', () => {
  beforeAll(async () => { await login(); });

  test('GET /api/matrix/stats — 获取统计', async () => {
    const res = await request('/api/matrix/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
  });

  test('POST /api/matrix/tasks — 创建任务', async () => {
    const res = await request('/api/matrix/tasks', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Task',
        platform: 'google_maps',
        action: 'collect_businesses',
        config: { keyword: 'test', region: 'US' }
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/matrix/tasks — 任务列表', async () => {
    const res = await request('/api/matrix/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks || res.body.data || res.body)).toBe(true);
  });
});
