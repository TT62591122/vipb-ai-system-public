const db = require('better-sqlite3')('D:\\VIPB-AI-System\\data\\vipb.db');
db.prepare('UPDATE emails SET account_id=27, status=\'queued\' WHERE id=22').run();
console.log('Updated to use gmail_api account and re-queued');
