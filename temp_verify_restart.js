const db=require('better-sqlite3')('./data/vipb.db');
const cols=db.prepare('PRAGMA table_info(blocked_emails)').all();
console.log('blocked_emails表存在，字段数:', cols.length);
const setting=db.prepare("SELECT value FROM settings WHERE key='email_auto_reply'").get();
console.log('auto_reply设置:', setting.value);
db.close();
