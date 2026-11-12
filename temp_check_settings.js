const db = require('better-sqlite3')('./data/vipb.db', { readonly: true });
const rows = db.prepare("SELECT key, value, updated_at FROM settings WHERE key LIKE 'email_last_check_%' OR key IN ('emergency_brake_state','module_switches','system_status') ORDER BY updated_at DESC").all();
console.log(JSON.stringify(rows, null, 2));
db.close();
