const db=require('better-sqlite3')('./data/vipb.db',{readonly:true});
const setting=db.prepare("SELECT value,updated_at FROM settings WHERE key='email_auto_reply'").get();
console.log('=== email_auto_reply setting ===');
console.log(setting);

const latestIn=db.prepare(`SELECT id,account_id,from_email,subject,customer_id,is_replied,ai_reply_id,received_at,created_at 
FROM received_emails ORDER BY id DESC LIMIT 5`).all();
console.log('\n=== latest received_emails ===');
console.log(JSON.stringify(latestIn,null,2));

const latestOut=db.prepare(`SELECT id,account_id,customer_id,to_addr,subject,status,direction,source,retry_count,created_at,updated_at 
FROM emails ORDER BY id DESC LIMIT 20`).all();
console.log('\n=== latest emails(outbound/drafts/queue) ===');
console.log(JSON.stringify(latestOut,null,2));

db.close();
