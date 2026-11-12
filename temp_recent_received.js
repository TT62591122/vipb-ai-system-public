const db=require('better-sqlite3')('./data/vipb.db',{readonly:true});
const rows=db.prepare("SELECT account_id, from_email, subject, received_at, created_at FROM received_emails ORDER BY id DESC LIMIT 12").all();
console.log(JSON.stringify(rows,null,2));
db.close();
