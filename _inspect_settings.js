const db = require('better-sqlite3')('./data/vipb.db', {readonly:true});
const rows = db.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all();
for (const r of rows) {
  let val = r.value;
  if (val && val.length > 150) val = val.substring(0, 150) + '...';
  console.log(`[${r.key}] = ${val}`);
  console.log(`  updated: ${r.updated_at}\n`);
}
db.close();
