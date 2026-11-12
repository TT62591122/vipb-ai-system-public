const db = require('better-sqlite3')('./data/vipb.db');

// 检查现有的cold email相关知识
const existing = db.prepare("SELECT key, substr(value,1,300) as v FROM knowledge_base WHERE key LIKE '%cold_email%' OR key LIKE '%deliverability%' OR key LIKE '%warmup%' OR key LIKE '%spam%' OR key LIKE '%dmarc%' OR key LIKE '%sequence%'").all();
console.log('=== 现有冷邮件相关知识 ===');
existing.forEach(r => console.log('[' + r.key + ']: ' + r.v.substring(0, 200)));
console.log('\nTotal:', existing.length);

db.close();
