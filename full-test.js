// VIPB 系统全面测试 - 修复后验证
const http = require('http');

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: opts.method || 'GET', headers: opts.headers || {}
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

let cookies = '';
const results = { passed: 0, failed: 0, tests: [] };

function test(name, pass, detail = '') {
  results.tests.push({ name, pass, detail });
  if (pass) { results.passed++; console.log(`✅ ${name}`); }
  else { results.failed++; console.log(`❌ ${name}: ${detail}`); }
}

async function main() {
  console.log('=== VIPB 系统全面测试 ===\n');
  
  // 1. 验证 app.js 语法
  console.log('--- 前端JS验证 ---');
  try {
    require('fs').readFileSync('public/js/app.js', 'utf8');
    new (require('vm').Script)(require('fs').readFileSync('public/js/app.js', 'utf8'));
    test('app.js 语法', true);
  } catch(e) {
    test('app.js 语法', false, e.message);
  }
  
  // 2. 登录获取会话
  console.log('\n--- 登录测试 ---');
  try {
    if (!process.env.ADMIN_PASSWORD) throw new Error('请先设置环境变量 ADMIN_PASSWORD（管理员口令）');
    const lp = await fetch('http://localhost:3001/login');
    const csrf = lp.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    cookies = (lp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    
    const loginRes = await fetch('http://localhost:3001/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
      body: `username=admin&password=${process.env.ADMIN_PASSWORD || ''}&_csrf=${csrf}`
    });
    test('用户登录', loginRes.status === 302 || loginRes.headers.location?.includes('dashboard') || loginRes.headers.location?.includes('settings'),
      `status=${loginRes.status}`);
    
    if (loginRes.headers['set-cookie']) {
      cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') || cookies;
    }
  } catch(e) {
    test('用户登录', false, e.message);
    return;
  }
  
  // 3. 测试三个问题功能的API
  console.log('\n--- 问题功能API测试 ---');
  
  // 3.1 修改密码API
  try {
    const pwdRes = await fetch('http://localhost:3001/api/settings/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookies },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'test123' })
    });
    const pwdData = JSON.parse(pwdRes.body);
    // 应该返回错误（密码错误），而不是500错误
    test('修改密码API', pwdRes.status === 200 && (pwdData.success === false || pwdData.error),
      JSON.stringify(pwdData).substring(0, 100));
  } catch(e) {
    test('修改密码API', false, e.message);
  }
  
  // 3.2 备份列表API
  try {
    const backupRes = await fetch('http://localhost:3001/api/settings/backups', {
      headers: { 'Cookie': cookies }
    });
    const backupData = JSON.parse(backupRes.body);
    test('备份列表API', backupRes.status === 200 && backupData.success === true && Array.isArray(backupData.backups),
      `success=${backupData.success}, count=${backupData.backups?.length}`);
  } catch(e) {
    test('备份列表API', false, e.message);
  }
  
  // 3.3 防封规则API
  try {
    const rulesRes = await fetch('http://localhost:3001/api/antiban/rules', {
      headers: { 'Cookie': cookies }
    });
    const rulesData = JSON.parse(rulesRes.body);
    const hasPlatforms = rulesData.whatsapp || rulesData.linkedin || rulesData.facebook || rulesData.sending;
    test('防封规则API', rulesRes.status === 200 && hasPlatforms,
      `platforms=${Object.keys(rulesData).filter(k => k !== 'version' && k !== 'updated_at').join(',')}`);
  } catch(e) {
    test('防封规则API', false, e.message);
  }
  
  // 4. 设置页面加载测试
  console.log('\n--- 页面加载测试 ---');
  try {
    const settingsRes = await fetch('http://localhost:3001/settings', { headers: { 'Cookie': cookies } });
    const hasScript = settingsRes.body.includes('async function loadBackups()');
    const hasAppJs = settingsRes.body.includes('/js/app.js');
    test('设置页面加载', settingsRes.status === 200 && hasScript && hasAppJs,
      `status=${settingsRes.status}, hasScript=${hasScript}`);
  } catch(e) {
    test('设置页面加载', false, e.message);
  }
  
  // 5. 其他核心API测试
  console.log('\n--- 核心API测试 ---');
  const apis = [
    { path: '/api/customers', name: '客户列表' },
    { path: '/api/trade/deals', name: '交易列表' },
    { path: '/api/inbox', name: '收件箱' },
    { path: '/api/settings', name: '系统设置' },
    { path: '/api/matrix/tasks', name: '矩阵任务' }
  ];
  
  for (const api of apis) {
    try {
      const res = await fetch(`http://localhost:3001${api.path}`, { headers: { 'Cookie': cookies } });
      test(api.name, res.status === 200, `status=${res.status}`);
    } catch(e) {
      test(api.name, false, e.message);
    }
  }
  
  // 6. 汇总
  console.log('\n=== 测试汇总 ===');
  console.log(`通过: ${results.passed}/${results.passed + results.failed}`);
  console.log(`失败: ${results.failed}`);
  
  if (results.failed === 0) {
    console.log('\n✅ 所有关键功能测试通过！');
  } else {
    console.log('\n⚠️ 部分测试失败，详见上方输出。');
  }
}

main().catch(e => console.error('测试失败:', e));