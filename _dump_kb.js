const { initDatabase } = require('./src/database');
const db = initDatabase();

// 获取所有知识库条目的完整value
const rows = db.prepare('SELECT id, category, key, value FROM knowledge_base ORDER BY id').all();

// 逐条输出完整value内容
rows.forEach(r => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`#${r.id} | ${r.category} | ${r.key}`);
  console.log(`${'='.repeat(80)}`);
  
  let val = r.value;
  try {
    const parsed = JSON.parse(val);
    val = JSON.stringify(parsed, null, 2);
  } catch(e) {
    // 已经是文本格式
  }
  console.log(val);
});
