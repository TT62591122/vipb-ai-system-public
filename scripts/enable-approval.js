// 改动1：开启人工审批
const db = require('better-sqlite3')('./data/vipb.db');

const old = db.prepare("SELECT value FROM settings WHERE key='email_auto_reply'").get();
console.log('OLD:', old.value);

const cfg = JSON.parse(old.value);
cfg.require_approval = true;

db.prepare("UPDATE settings SET value=?, updated_at=datetime('now') WHERE key='email_auto_reply'").run(JSON.stringify(cfg));

const newVal = db.prepare("SELECT value FROM settings WHERE key='email_auto_reply'").get();
console.log('NEW:', newVal.value);

db.close();
console.log('✅ require_approval 已开启');
