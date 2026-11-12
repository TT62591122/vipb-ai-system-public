/**
 * Agent v1.2 数据库迁移脚本
 * 创建4张新表 + 扩展pending_actions表
 * 
 * 运行方式: node migrations/migrate-agent-v1.js
 */
const path = require('path');
const { initDatabase } = require(path.join(__dirname, '..', 'src', 'database'));

const db = initDatabase();

console.log('[MIGRATE] Agent v1.2 数据库迁移开始...');

// ========== 1. agent_experiences（动态经验库）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_experiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT 'email',
    situation TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT,
    result_sentiment TEXT DEFAULT 'neutral',
    lesson TEXT,
    confidence REAL DEFAULT 0.5,
    times_applied INTEGER DEFAULT 0,
    is_valid INTEGER DEFAULT NULL,
    source TEXT DEFAULT 'agent_auto',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
console.log('[MIGRATE] ✅ agent_experiences 表已创建');

// ========== 2. agent_customer_profiles（客户画像）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_customer_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL UNIQUE,
    language_preference TEXT,
    communication_style TEXT,
    interests TEXT,
    best_contact_time TEXT,
    response_pattern TEXT,
    deal_stage TEXT,
    reply_rate REAL DEFAULT 0,
    avg_reply_hours REAL DEFAULT 0,
    total_interactions INTEGER DEFAULT 0,
    last_positive_at TEXT,
    notes TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );
`);
console.log('[MIGRATE] ✅ agent_customer_profiles 表已创建');

// ========== 3. agent_strategies（策略库）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    target_segment TEXT,
    rules TEXT,
    performance TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
console.log('[MIGRATE] ✅ agent_strategies 表已创建');

// ========== 4. agent_action_log（操作日志 + 操作锁基础）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    triggered_by TEXT DEFAULT 'agent',
    target_customer_id INTEGER,
    decision_reason TEXT,
    decision_score REAL,
    action_detail TEXT,
    result TEXT,
    status TEXT DEFAULT 'planned',
    experience_extracted INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
console.log('[MIGRATE] ✅ agent_action_log 表已创建');

// ========== 5. 索引 ==========
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_action_log_created ON agent_action_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_action_log_customer ON agent_action_log(target_customer_id);
  CREATE INDEX IF NOT EXISTS idx_agent_action_log_type ON agent_action_log(action_type);
  CREATE INDEX IF NOT EXISTS idx_agent_action_log_status ON agent_action_log(status);
  CREATE INDEX IF NOT EXISTS idx_agent_experiences_category ON agent_experiences(category);
  CREATE INDEX IF NOT EXISTS idx_agent_experiences_confidence ON agent_experiences(confidence);
  CREATE INDEX IF NOT EXISTS idx_agent_customer_profiles_cid ON agent_customer_profiles(customer_id);
`);
console.log('[MIGRATE] ✅ 索引已创建');

// ========== 6. 扩展 pending_actions 表 ==========
// 添加 source 字段
try {
  db.prepare("SELECT source FROM pending_actions LIMIT 1").get();
  console.log('[MIGRATE] ⏭️ pending_actions.source 字段已存在');
} catch {
  db.exec("ALTER TABLE pending_actions ADD COLUMN source TEXT DEFAULT 'manual'");
  console.log('[MIGRATE] ✅ pending_actions.source 字段已添加');
}

// 添加 auto_expire_at 字段
try {
  db.prepare("SELECT auto_expire_at FROM pending_actions LIMIT 1").get();
  console.log('[MIGRATE] ⏭️ pending_actions.auto_expire_at 字段已存在');
} catch {
  db.exec("ALTER TABLE pending_actions ADD COLUMN auto_expire_at TEXT");
  console.log('[MIGRATE] ✅ pending_actions.auto_expire_at 字段已添加');
}

// ========== 7. 归档表（90天归档用）==========
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_action_log_archive (
    id INTEGER PRIMARY KEY,
    action_type TEXT NOT NULL,
    triggered_by TEXT,
    target_customer_id INTEGER,
    decision_reason TEXT,
    decision_score REAL,
    action_detail TEXT,
    result TEXT,
    status TEXT,
    experience_extracted INTEGER,
    cost REAL,
    created_at TEXT
  );
`);
console.log('[MIGRATE] ✅ agent_action_log_archive 归档表已创建');

// ========== 8. 添加 agent 模块开关 ==========
try {
  const row = db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
  if (row) {
    const switches = JSON.parse(row.value);
    if (!('agent' in switches)) {
      switches.agent = false; // 默认关闭，第二期才开启
      db.prepare("UPDATE settings SET value=? WHERE key='module_switches'").run(JSON.stringify(switches));
      console.log('[MIGRATE] ✅ 模块开关已添加 agent=false（默认关闭）');
    } else {
      console.log('[MIGRATE] ⏭️ agent 模块开关已存在');
    }
  }
} catch (e) {
  console.error('[MIGRATE] ⚠️ 模块开关更新失败:', e.message);
}

// ========== 9. 初始化 Agent 成本上限设置 ==========
try {
  const existing = db.prepare("SELECT value FROM settings WHERE key='agent_cost_limits'").get();
  if (!existing) {
    const defaults = {
      per_scan: 0.50,
      daily: 2.00,
      monthly: 30.00
    };
    db.prepare("INSERT INTO settings (key, value) VALUES ('agent_cost_limits', ?)").run(JSON.stringify(defaults));
    console.log('[MIGRATE] ✅ Agent 成本上限已初始化');
  } else {
    console.log('[MIGRATE] ⏭️ Agent 成本上限设置已存在');
  }
} catch (e) {
  console.error('[MIGRATE] ⚠️ Agent 成本上限设置失败:', e.message);
}

// ========== 10. 初始化 Agent 巡检间隔设置 ==========
try {
  const existing = db.prepare("SELECT value FROM settings WHERE key='agent_scan_interval'").get();
  if (!existing) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('agent_scan_interval', '2')").run(); // 默认2小时
    console.log('[MIGRATE] ✅ Agent 巡检间隔已初始化（默认2小时）');
  } else {
    console.log('[MIGRATE] ⏭️ Agent 巡检间隔设置已存在');
  }
} catch (e) {
  console.error('[MIGRATE] ⚠️ Agent 巡检间隔设置失败:', e.message);
}

console.log('\n[MIGRATE] ✅✅✅ Agent v1.2 数据库迁移完成！');
console.log('[MIGRATE] 新建表: agent_experiences, agent_customer_profiles, agent_strategies, agent_action_log, agent_action_log_archive');
console.log('[MIGRATE] 扩展表: pending_actions (+source, +auto_expire_at)');
console.log('[MIGRATE] 新设置: agent_cost_limits, agent_scan_interval, module_switches.agent');
