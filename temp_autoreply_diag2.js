const db=require('better-sqlite3')('./data/vipb.db',{readonly:true});
const cols=db.prepare("PRAGMA table_info(emails)").all();
console.log(JSON.stringify(cols,null,2));
const latestOut=db.prepare(`SELECT id,account_id,customer_id,to_addr,subject,status,direction,source,retry_count,created_at FROM emails ORDER BY id DESC LIMIT 20`).all();
console.log('\n=== latest emails ===');
console.log(JSON.stringify(latestOut,null,2));
db.close();
