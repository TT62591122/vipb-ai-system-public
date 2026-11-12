// 测试邮件安全改造
const db = require('better-sqlite3')('./data/vipb.db');

console.log('=== 测试1: 人工审批配置 ===');
const cfg = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='email_auto_reply'").get().value);
console.log('require_approval:', cfg.require_approval);
console.log(cfg.require_approval === true ? '✅ 人工审批已开启' : '❌ 人工审批未开启');

console.log('\n=== 测试2: 邮箱验证模块 ===');
const { EmailVerifier } = require('../src/email-verifier');
const verifier = new EmailVerifier(db);

async function runTests() {
  // 测试有效邮箱
  const r1 = await verifier.verify('test@gmail.com', { skipSmtp: true });
  console.log('gmail.com:', JSON.stringify(r1));
  console.log(r1.valid && r1.score >= 50 ? '✅ 有效邮箱通过' : '⚠️ 可能有问题');

  // 测试无效域名
  const r2 = await verifier.verify('test@thisdoesnotexist12345.com', { skipSmtp: true });
  console.log('无效域名:', JSON.stringify(r2));
  console.log(!r2.valid ? '✅ 无效域名被拦截' : '❌ 无效域名未拦截');

  // 测试一次性邮箱
  const r3 = await verifier.verify('test@mailinator.com', { skipSmtp: true });
  console.log('一次性邮箱:', JSON.stringify(r3));
  console.log(!r3.valid ? '✅ 一次性邮箱被拦截' : '❌ 一次性邮箱未拦截');

  // 测试格式错误
  const r4 = await verifier.verify('notanemail', { skipSmtp: true });
  console.log('格式错误:', JSON.stringify(r4));
  console.log(!r4.valid ? '✅ 格式错误被拦截' : '❌ 格式错误未拦截');

  // 测试角色账号
  const r5 = await verifier.verify('noreply@gmail.com', { skipSmtp: true });
  console.log('角色账号:', JSON.stringify(r5));
  console.log(r5.score < 100 ? '✅ 角色账号被降分(score=' + r5.score + ')' : '⚠️ 角色账号未降分');
  
  // 测试验证阈值（新阈值<50拦截）
  console.log('\n=== 测试3: 发信阈值检查 ===');
  console.log('阈值: score < 50 拦截');
  console.log('角色账号score=' + r5.score + ':', r5.score < 50 ? '会被拦截 ✅' : '不会被拦截（预期，只降分30）');

  // 验证cache表
  console.log('\n=== 测试4: 缓存表 ===');
  const cacheCount = db.prepare('SELECT COUNT(*) as c FROM email_verification_cache').get().c;
  console.log('缓存记录数:', cacheCount);
  console.log(cacheCount > 0 ? '✅ 缓存工作正常' : '❌ 缓存未写入');

  // 检查API端点是否注册
  console.log('\n=== 测试5: API路由检查 ===');
  const http = require('http');
  const testApi = (path) => new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: 3001, path, method: 'POST', 
      headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.substring(0, 200) }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.write('{"email":"test@test.com"}');
    req.end();
  });
  
  const apis = ['/api/emails/verify', '/api/emails/batch-verify', '/api/emails/approve', '/api/emails/reject'];
  for (const api of apis) {
    const r = await testApi(api);
    // 302=需要登录(路由存在), 200=OK, 403=需认证
    const exists = r.status !== 404 && !r.body.includes('Cannot POST');
    console.log(api + ':', r.status, exists ? '✅ 路由存在' : '❌ 路由不存在');
  }

  db.close();
  console.log('\n=== 全部测试完成 ===');
}

runTests().catch(e => { console.error(e); db.close(); });
