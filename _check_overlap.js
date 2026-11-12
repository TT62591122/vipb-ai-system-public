const { initDatabase } = require('./src/database');
const db = initDatabase();

// 获取所有知识库条目的完整内容
const rows = db.prepare('SELECT id, category, key, value FROM knowledge_base ORDER BY category, id').all();

console.log(`=== 现有知识库共 ${rows.length} 条 ===\n`);

// 按分类归组
const grouped = {};
rows.forEach(r => {
  if (!grouped[r.category]) grouped[r.category] = [];
  grouped[r.category].push(r);
});

Object.keys(grouped).sort().forEach(cat => {
  console.log(`\n【${cat}】(${grouped[cat].length}条)`);
  grouped[cat].forEach(r => {
    // 提取value的关键内容摘要
    let summary = '';
    try {
      const val = JSON.parse(r.value);
      if (typeof val === 'object') {
        summary = Object.keys(val).join(', ');
      } else {
        summary = String(val).substring(0, 150);
      }
    } catch(e) {
      summary = String(r.value).substring(0, 150);
    }
    console.log(`  #${r.id} [${r.key}]: ${summary}`);
  });
});
