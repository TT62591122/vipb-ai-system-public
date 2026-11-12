const Database = require('better-sqlite3');
const db = new Database('./data/vipb.db');

// 查邮件自动回复设置
const row = db.prepare("SELECT value FROM settings WHERE key = 'email_auto_reply'").get();
console.log('=== 邮件自动回复设置 ===');
console.log(JSON.stringify(JSON.parse(row.value), null, 2));

// 查最近收到的邮件
console.log('\n=== 最近收到的邮件(5封) ===');
const emails = db.prepare("SELECT id, from_email, subject, customer_id, received_at FROM received_emails ORDER BY received_at DESC LIMIT 5").all();
emails.forEach(e => console.log(JSON.stringify(e)));

// 查最近的草稿
console.log('\n=== 最近的草稿/待发邮件 ===');
const drafts = db.prepare("SELECT id, to_addr, subject, status, source, created_at FROM emails WHERE status IN ('draft','pending') ORDER BY created_at DESC LIMIT 5").all();
drafts.forEach(d => console.log(JSON.stringify(d)));

db.close();
