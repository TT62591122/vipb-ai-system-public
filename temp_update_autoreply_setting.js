const db=require('better-sqlite3')('./data/vipb.db');
const old=db.prepare("SELECT value FROM settings WHERE key='email_auto_reply'").get();
let v={enabled:true,delay_minutes:2,only_known_customers:true,require_approval:true};
if(old&&old.value){try{v=JSON.parse(old.value)}catch{}}
v.only_known_customers=false;
if(v.require_approval===undefined) v.require_approval=true;
db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('email_auto_reply',?,datetime('now'))").run(JSON.stringify(v));
console.log('UPDATED',JSON.stringify(v));
db.close();
