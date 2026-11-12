const db = require('better-sqlite3')('./data/vipb.db');
const rows = db.prepare("SELECT id,email,auth_type,imap_host,is_active FROM email_accounts WHERE is_active=1 ORDER BY id").all();
const checks = db.prepare("SELECT key,value,updated_at FROM settings WHERE key LIKE 'email_last_check_%' ORDER BY key").all();
console.log('=== ACTIVE ACCOUNTS ===');
console.log(JSON.stringify(rows, null, 2));
console.log('=== LAST CHECK SETTINGS ===');
console.log(JSON.stringify(checks, null, 2));
db.close();
