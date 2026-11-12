const db=require('better-sqlite3')('./data/vipb.db',{readonly:true});
const checks=db.prepare("SELECT key,value,updated_at FROM settings WHERE key LIKE 'email_last_check_%' ORDER BY key").all();
console.log(JSON.stringify(checks,null,2));
const latest=db.prepare("SELECT account_id, from_email, subject, received_at, created_at FROM received_emails ORDER BY id DESC LIMIT 5").all();
console.log('---latest-received---');
console.log(JSON.stringify(latest,null,2));
db.close();
