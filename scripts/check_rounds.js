const Database = require('better-sqlite3');
const db = new Database('D:\\VIPB-AI-System\\data\\vipb.db');

// 查所有knowledge_base条目，按id排序看哪些是各轮加的
const rows = db.prepare('SELECT id, category, key, substr(value,1,100) as preview FROM knowledge_base ORDER BY id').all();

console.log('=== 全部 ' + rows.length + ' 条 knowledge_base ===\n');

// 第一轮：id 1-50，第二轮：51-66，第三轮：67-78(patch)，第三轮b：79-86(patch2)，第四轮：87-100
let round1 = [], round2 = [], round3 = [], round3b = [], round4 = [];
rows.forEach(r => {
  if (r.id <= 50) round1.push(r);
  else if (r.id <= 66) round2.push(r);
  else if (r.id <= 78) round3.push(r);
  else if (r.id <= 86) round3b.push(r);
  else round4.push(r);
});

console.log('--- 第二轮 (id 51-66, +16条) ---');
round2.forEach(r => console.log(`  [${r.id}] ${r.category} / ${r.key}`));

console.log('\n--- 第三轮 (id 67-78, +12条) ---');
round3.forEach(r => console.log(`  [${r.id}] ${r.category} / ${r.key}`));

console.log('\n--- 第三轮b (id 79-86, +8条) ---');
round3b.forEach(r => console.log(`  [${r.id}] ${r.category} / ${r.key}`));

console.log('\n--- 第四轮 (id 87-100, +14条) ---');
round4.forEach(r => console.log(`  [${r.id}] ${r.category} / ${r.key}`));

// 同样查content_templates
const templates = db.prepare('SELECT id, name, category FROM content_templates ORDER BY id').all();
console.log('\n=== content_templates (' + templates.length + ' 条) ===');
templates.forEach(r => console.log(`  [${r.id}] ${r.category} / ${r.name}`));

db.close();
