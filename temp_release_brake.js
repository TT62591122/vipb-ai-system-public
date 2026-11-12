const db = require('better-sqlite3')('D:\\VIPB-AI-System\\data\\vipb.db');
db.prepare("DELETE FROM settings WHERE key='emergency_brake_state'").run();
console.log('Emergency brake released');
