/**
 * Agent V2 迁移 — 自动巡检 + 决策引擎 + 自主权等级
 */
const Database = require('better-sqlite3');
const db = new Database('./data/vipb.db');

console.log('[MIGRATE-V2] 开始Agent Phase 2迁移...');

// ========== 1. agent_autonomy（自主权等级管理）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_autonomy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_level INTEGER DEFAULT 1,
    last_upgrade_at TEXT,
    last_rejected_at TEXT,
    reject_count INTEGER DEFAULT 0,
    experiences_at_last_reject INTEGER DEFAULT 0,
    experiences_required_for_retry INTEGER DEFAULT 50,
    upgrade_history TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
// 初始化一条记录
const existing = db.prepare("SELECT id FROM agent_autonomy LIMIT 1").get();
if (!existing) {
  db.prepare("INSERT INTO agent_autonomy (current_level) VALUES (1)").run();
}
console.log('[MIGRATE-V2] ✅ agent_autonomy 表已创建');

// ========== 2. agent_scan_results（巡检结果）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL,
    customer_id INTEGER,
    trigger_type TEXT NOT NULL,
    trigger_reason TEXT,
    priority TEXT DEFAULT 'medium',
    decision TEXT,
    decision_reason TEXT,
    action_type TEXT,
    action_detail TEXT,
    status TEXT DEFAULT 'pending',
    cost REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    executed_at TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON agent_scan_results(scan_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_results_status ON agent_scan_results(status);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_results_customer ON agent_scan_results(customer_id);`);
console.log('[MIGRATE-V2] ✅ agent_scan_results 表已创建');

// ========== 2.5 emails表增加source列（标记来源：agent_auto等）==========
try {
  db.exec("ALTER TABLE emails ADD COLUMN source TEXT");
  console.log('[MIGRATE-V2] ✅ emails.source 列已添加');
} catch (e) {
  // 列已存在则跳过
  if (!e.message.includes('duplicate')) console.log('[MIGRATE-V2] emails.source 已存在');
}

// ========== 3. agent_upgrade_requests（升级申请记录）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_upgrade_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_level INTEGER NOT NULL,
    to_level INTEGER NOT NULL,
    reason TEXT,
    metrics TEXT,
    status TEXT DEFAULT 'pending',
    user_response TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    responded_at TEXT
  );
`);
console.log('[MIGRATE-V2] ✅ agent_upgrade_requests 表已创建');

// ========== 4. 设置项 ==========
// 巡检规则
const scanRulesDefault = JSON.stringify({
  first_touch_hours: 24,
  follow_up_days: 3,
  inquiry_reply_hours: 2,
  hot_lead_hours: 12,
  max_actions_per_scan: 10
});
db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('agent_scan_rules', ?, datetime('now'))`).run(scanRulesDefault);

// 自主权等级升级条件
const upgradeCriteria = JSON.stringify({
  2: { min_positive_experiences: 10, min_days_active: 3, description: '草稿模式：自动生成邮件草稿，你审核后才发' },
  3: { min_positive_experiences: 50, min_reply_rate: 0.1, min_days_active: 14, description: '低风险自动：跟进老客户自动发送，新客户仍需审核' },
  4: { min_positive_experiences: 100, min_reply_rate: 0.15, min_days_active: 30, description: '高风险自动：新客户首次触达也自动发，询盘回复仍需审核' },
  5: { min_positive_experiences: 200, min_reply_rate: 0.2, min_days_active: 60, description: '完全自主：所有操作自动执行，只事后通知' }
});
db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('agent_upgrade_criteria', ?, datetime('now'))`).run(upgradeCriteria);

console.log('[MIGRATE-V2] ✅ 设置项已初始化');

console.log('[MIGRATE-V2] ✅ Phase 2迁移完成');
db.close();
