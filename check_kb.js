const db = require('better-sqlite3')('D:/VIPB-AI-System/data/vipb.db');

// 查找知识相关的表
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const targets = tables.filter(t => 
  t.name.includes('knowledge') || t.name.includes('template') || 
  t.name.includes('agent') || t.name.includes('content')
);

console.log('=== 知识/模板/Agent相关表 ===');
targets.forEach(t => {
  const count = db.prepare('SELECT COUNT(*) as c FROM "' + t.name + '"').get();
  const cols = db.prepare('PRAGMA table_info("' + t.name + '")').all();
  console.log('\n### ' + t.name + ' (' + count.c + '条)');
  console.log('字段: ' + cols.map(c => c.name).join(', '));
  if (count.c > 0 && count.c <= 100) {
    const rows = db.prepare('SELECT * FROM "' + t.name + '" LIMIT 60').all();
    rows.forEach(r => {
      const summary = {};
      for (const [k, v] of Object.entries(r)) {
        summary[k] = typeof v === 'string' && v.length > 200 ? v.substring(0, 200) + '...' : v;
      }
      console.log(JSON.stringify(summary));
    });
  }
});

db.close();
