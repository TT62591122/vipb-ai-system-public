const Database = require('better-sqlite3');
const db = new Database('./data/vipb.db');

// 修复id=30的草稿
const result = db.prepare("UPDATE emails SET direction='outbound', source='auto_reply' WHERE id=30 AND status='draft'").run();
console.log('修复id=30:', result.changes > 0 ? '成功' : '未找到或已非draft状态');

// 验证
const row = db.prepare("SELECT id, direction, source, status, to_addr, subject FROM emails WHERE id=30").get();
console.log('验证:', JSON.stringify(row));

db.close();
