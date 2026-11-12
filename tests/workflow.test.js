/**
 * 工作流 API 测试
 */
const { request, login } = require('./helpers');

describe('Workflow API', () => {
  beforeAll(async () => { await login(); });

  test('GET /api/workflows — 工作流列表', async () => {
    const res = await request('/api/workflows');
    expect(res.status).toBe(200);
  });

  test('POST /api/workflows — 创建工作流', async () => {
    const res = await request('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Workflow',
        steps: [
          { type: 'collect', platform: 'google_maps', action: 'collect_businesses', config: { keyword: 'test' } }
        ]
      }),
    });
    expect(res.status).toBe(200);
  });
});
