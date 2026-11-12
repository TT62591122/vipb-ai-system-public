const db = require('better-sqlite3')('D:\\VIPB-AI-System\\data\\vipb.db');
const brake = db.prepare("SELECT * FROM settings WHERE key LIKE '%emergency%' OR key LIKE '%brake%'").all();
console.table(brake);
