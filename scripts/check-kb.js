const db = require('better-sqlite3')('./data/vipb.db');
const rows = db.prepare("SELECT category, key, substr(value,1,200) as val_preview FROM knowledge_base ORDER BY category, key").all();
console.log('Total rows:', rows.length);
rows.forEach(r => console.log('[' + r.category + '] ' + r.key + ': ' + r.val_preview));
db.close();
