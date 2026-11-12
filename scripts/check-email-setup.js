const db = require('better-sqlite3')('./data/vipb.db');

console.log('=== EMAIL ACCOUNTS ===');
db.prepare('SELECT id,email,auth_type,is_active,daily_limit,daily_sent,warmup_stage,health_score FROM email_accounts').all().forEach(a => console.log(JSON.stringify(a)));

console.log('\n=== EMAIL STATS ===');
console.log('Total:', db.prepare('SELECT COUNT(*) as t FROM emails').get().t);
db.prepare('SELECT status,COUNT(*) as c FROM emails GROUP BY status').all().forEach(s => console.log(s.status + ':', s.c));

console.log('\n=== RECENT EMAILS (last 10) ===');
db.prepare('SELECT id,from_addr,to_addr,subject,status,sent_at,source FROM emails ORDER BY id DESC LIMIT 10').all().forEach(e => console.log(JSON.stringify(e)));

console.log('\n=== EMAIL SETTINGS ===');
db.prepare("SELECT key,value FROM settings WHERE key LIKE '%email%' OR key LIKE '%warmup%' OR key LIKE '%send%'").all().forEach(s => console.log(s.key + ':', s.value));

console.log('\n=== BRAIN RULES (email related) ===');
db.prepare("SELECT id,rule_text FROM brain_rules WHERE rule_text LIKE '%邮%' OR rule_text LIKE '%email%' OR rule_text LIKE '%发送%'").all().forEach(r => console.log('R' + r.id + ':', r.rule_text.substring(0, 200)));

console.log('\n=== MODULE SWITCHES ===');
db.prepare("SELECT key,value FROM settings WHERE key LIKE 'module_%'").all().forEach(m => console.log(m.key + ':', m.value));

console.log('\n=== SEQUENCES ===');
try { db.prepare('SELECT id,name,status,total_steps FROM email_sequences').all().forEach(s => console.log(JSON.stringify(s))); } catch(e) { console.log('No sequences table or error:', e.message); }

db.close();
