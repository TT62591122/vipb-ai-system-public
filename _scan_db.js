const db = require('better-sqlite3')('D:/VIPB-AI-System/data/vipb.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const result = {};
tables.forEach(t => {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  const cnt = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get();
  result[t.name] = { columns: cols.map(c => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk })), rowCount: cnt.c };
});
require('fs').writeFileSync('D:/VIPB-AI-System/_db_schema.json', JSON.stringify(result, null, 2));
console.log('Done. Tables:', Object.keys(result).length);
db.close();
