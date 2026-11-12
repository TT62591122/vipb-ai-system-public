const Database = require('better-sqlite3');
const db = new Database('./data/vipb.db');

// 查id=30的草稿详情
console.log('=== 草稿id=30详情 ===');
const draft = db.prepare("SELECT * FROM emails WHERE id = 30").get();
console.log(JSON.stringify(draft, null, 2));

// 查所有draft状态的邮件
console.log('\n=== 所有draft状态邮件 ===');
const allDrafts = db.prepare("SELECT id, account_id, customer_id, to_addr, subject, status, direction, source, created_at FROM emails WHERE status = 'draft'").all();
allDrafts.forEach(d => console.log(JSON.stringify(d)));

// 查前端可能用的查询条件 - direction字段
console.log('\n=== emails表的direction值分布 ===');
const dirs = db.prepare("SELECT direction, COUNT(*) as cnt FROM emails GROUP BY direction").all();
dirs.forEach(d => console.log(JSON.stringify(d)));

// 查account_id
console.log('\n=== email_accounts ===');
const accounts = db.prepare("SELECT id, email, is_active FROM email_accounts").all();
accounts.forEach(a => console.log(JSON.stringify(a)));

db.close();
