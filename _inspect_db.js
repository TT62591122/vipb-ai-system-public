const db = require('better-sqlite3')('./data/vipb.db', {readonly:true});
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
for (const t of tables) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM [${t.name}]`).get();
  const cols = db.prepare(`PRAGMA table_info([${t.name}])`).all().map(c => c.name);
  console.log(`\n=== ${t.name} (${count.c} rows) ===`);
  console.log('Cols:', cols.join(', '));
  if (count.c > 0) {
    const rows = db.prepare(`SELECT * FROM [${t.name}] LIMIT 2`).all();
    console.log('Sample:', JSON.stringify(rows).substring(0, 300));
  }
}
db.close();
