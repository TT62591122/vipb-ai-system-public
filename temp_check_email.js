const db = require('better-sqlite3')('D:\\VIPB-AI-System\\data\\vipb.db');
const email = db.prepare("SELECT id, status, to_addr, sent_at FROM emails WHERE id=22").get();
console.log(email);
