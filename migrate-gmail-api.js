/**
 * 数据库迁移：为 email_accounts 添加 Gmail API 支持字段
 * 运行: node migrate-gmail-api.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'vipb.db'));

const columns = [
  { name: 'auth_type', sql: "ALTER TABLE email_accounts ADD COLUMN auth_type TEXT DEFAULT 'smtp'" },
  { name: 'oauth_credentials', sql: "ALTER TABLE email_accounts ADD COLUMN oauth_credentials TEXT DEFAULT ''" },
  { name: 'gmail_client_id', sql: "ALTER TABLE email_accounts ADD COLUMN gmail_client_id TEXT DEFAULT ''" },
  { name: 'gmail_client_secret', sql: "ALTER TABLE email_accounts ADD COLUMN gmail_client_secret TEXT DEFAULT ''" },
];

for (const col of columns) {
  try {
    db.exec(col.sql);
    console.log(`✅ Added column: ${col.name}`);
  } catch (e) {
    if (e.message.includes('duplicate column')) {
      console.log(`⏭️  Column already exists: ${col.name}`);
    } else {
      console.error(`❌ Failed to add ${col.name}:`, e.message);
    }
  }
}

// Verify
const cols = db.prepare('PRAGMA table_info(email_accounts)').all();
console.log('\nAll columns:', cols.map(c => c.name).join(', '));

const acc = db.prepare('SELECT id, email, auth_type FROM email_accounts WHERE id=25').get();
if (acc) console.log('Account 25:', JSON.stringify(acc));

db.close();
console.log('\n✅ Migration complete!');
