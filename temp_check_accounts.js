const db=require('better-sqlite3')('./data/vipb.db',{readonly:true});
const rows=db.prepare("SELECT id,email,auth_type,imap_host,is_active FROM email_accounts WHERE is_active=1 ORDER BY id").all();
console.log(JSON.stringify(rows,null,2));
const checks=db.prepare("SELECT key,value,updated_at FROM settings WHERE key LIKE 'email_last_check_%' ORDER BY key").all();
console.log('---last_check---');
console.log(JSON.stringify(checks,null,2));
db.close();
