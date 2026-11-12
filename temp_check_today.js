const db = require('better-sqlite3')('D:\\VIPB-AI-System\\data\\vipb.db');
const received = db.prepare("SELECT id, subject, from_email, created_at, account_id FROM received_emails ORDER BY created_at DESC LIMIT 5").all();
console.table(received);

const inbox = db.prepare("SELECT id, conversation_id, direction, sender_name, created_at FROM inbox_messages ORDER BY created_at DESC LIMIT 5").all();
console.table(inbox);
