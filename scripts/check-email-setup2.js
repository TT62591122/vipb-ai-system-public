const db = require('better-sqlite3')('./data/vipb.db');

console.log('=== MODULE SWITCHES ===');
db.prepare("SELECT key,value FROM settings WHERE key LIKE 'module_%'").all().forEach(m => console.log(m.key + ':', m.value));

console.log('\n=== SEQUENCES ===');
try { db.prepare('SELECT id,name,status,total_steps FROM email_sequences').all().forEach(s => console.log(JSON.stringify(s))); } catch(e) { console.log('No table:', e.message); }

console.log('\n=== AUTO TASKS ===');
try { db.prepare('SELECT * FROM auto_tasks LIMIT 10').all().forEach(t => console.log(JSON.stringify(t))); } catch(e) { console.log('No table:', e.message); }

console.log('\n=== WARMUP CONFIG ===');
db.prepare("SELECT key,value FROM settings WHERE key LIKE '%warm%'").all().forEach(s => console.log(s.key + ':', s.value));

console.log('\n=== EMAIL ENGINE FILES ===');
const fs = require('fs');
const path = require('path');
const engDir = path.join(__dirname, '..', 'engines');
fs.readdirSync(engDir).filter(f => f.includes('email')).forEach(f => console.log(f));

console.log('\n=== CUSTOMERS ===');
console.log('Total:', db.prepare('SELECT COUNT(*) as t FROM customers').get().t);
db.prepare('SELECT id,name,email,company,status FROM customers LIMIT 5').all().forEach(c => console.log(JSON.stringify(c)));

db.close();
