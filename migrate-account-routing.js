const db = require('better-sqlite3')('data/vipb.db');

// customers表加绑定字段
try { db.exec("ALTER TABLE customers ADD COLUMN preferred_email_account_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE customers ADD COLUMN preferred_social_accounts TEXT DEFAULT '{}'"); } catch(e) {}

// settings表加默认账号配置
const settings = [
  ['default_email_account_id', ''],
  ['default_whatsapp_account_id', ''],
  ['default_social_account_ids', '{}']
];
settings.forEach(([key, val]) => {
  const exists = db.prepare("SELECT 1 FROM settings WHERE key=?").get(key);
  if (!exists) db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, val);
});

console.log('Migration done');
db.close();