// 直接调用 AI Command Engine，绕过 HTTP API
const db = require('better-sqlite3')('data/vipb.db');
const { AICommandEngine } = require('./src/ai-command-engine');

async function testAICommand() {
  console.log('正在初始化 AI 命令引擎...\n');
  
  const engine = new AICommandEngine(db);
  
  const command = '请用 user@example.com 这个邮箱账号，给客户 customer@example.com 发一封针对非洲客户的开发信，主题要专业，内容要包含我们的产品优势、非洲市场针对性、以及行动号召。写好后直接发送。';
  
  console.log('用户指令:', command);
  console.log('\n正在处理...\n');
  
  try {
    const result = await engine.processCommand(command);
    console.log('\n===== AI 执行结果 =====\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('执行失败:', e.message);
    console.error(e.stack);
  }
  
  db.close();
}

testAICommand();
