/**
 * 数据库初始化 — 首次启动自动建表
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'vipb.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

function initDatabase() {
  const dataDir = path.dirname(DB_PATH);
  if (DB_PATH !== ':memory:' && !fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 建表
  db.exec(`
    -- 客户表
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT,
      contact_name TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      country TEXT,
      source TEXT DEFAULT 'manual',
      lead_score INTEGER DEFAULT 0,
      stage TEXT DEFAULT 'new',
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      ai_summary TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 询盘表
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id),
      subject TEXT,
      content TEXT,
      product TEXT,
      quantity TEXT,
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'new',
      ai_score REAL DEFAULT 0,
      ai_analysis TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 交易/订单表 (看板)
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id),
      inquiry_id INTEGER REFERENCES inquiries(id),
      title TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      stage TEXT DEFAULT 'inquiry',
      products TEXT DEFAULT '[]',
      quote_data TEXT DEFAULT '{}',
      pi_number TEXT,
      shipping_info TEXT DEFAULT '{}',
      payment_info TEXT DEFAULT '{}',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 邮件记录
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      account_id INTEGER,
      direction TEXT DEFAULT 'outbound',
      from_addr TEXT,
      to_addr TEXT,
      subject TEXT,
      body TEXT,
      status TEXT DEFAULT 'draft',
      sequence_id INTEGER,
      sequence_step INTEGER,
      opened INTEGER DEFAULT 0,
      clicked INTEGER DEFAULT 0,
      bounced INTEGER DEFAULT 0,
      spam_score REAL DEFAULT 0,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 邮件序列(自动化)
    CREATE TABLE IF NOT EXISTS email_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      steps TEXT DEFAULT '[]',
      target_industry TEXT,
      is_active INTEGER DEFAULT 1,
      stats TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 邮件账号
    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      display_name TEXT,
      smtp_host TEXT,
      smtp_port INTEGER DEFAULT 587,
      smtp_user TEXT,
      smtp_pass TEXT,
      imap_host TEXT,
      imap_port INTEGER DEFAULT 993,
      warmup_stage TEXT DEFAULT 'week1',
      daily_sent INTEGER DEFAULT 0,
      daily_limit INTEGER DEFAULT 40,
      health_score REAL DEFAULT 100,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- WhatsApp消息
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      phone TEXT,
      direction TEXT DEFAULT 'outbound',
      content TEXT,
      media_url TEXT,
      status TEXT DEFAULT 'sent',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 社媒内容
    CREATE TABLE IF NOT EXISTS social_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT,
      content TEXT,
      media_urls TEXT DEFAULT '[]',
      status TEXT DEFAULT 'draft',
      scheduled_at DATETIME,
      published_at DATETIME,
      engagement TEXT DEFAULT '{}',
      leads_collected INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 社媒线索
    CREATE TABLE IF NOT EXISTS social_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT,
      post_id INTEGER,
      username TEXT,
      profile_url TEXT,
      message TEXT,
      status TEXT DEFAULT 'new',
      customer_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 账号环境
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      platform TEXT,
      proxy_id INTEGER,
      fingerprint TEXT DEFAULT '{}',
      cookies TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      health_score REAL DEFAULT 100,
      last_used DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 代理IP池
    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'residential',
      host TEXT,
      port INTEGER,
      username TEXT,
      password TEXT,
      country TEXT,
      provider TEXT,
      is_alive INTEGER DEFAULT 1,
      speed_ms INTEGER,
      last_checked DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 接码号码
    CREATE TABLE IF NOT EXISTS phone_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL CHECK(length(number) BETWEEN 1 AND 30),
      country TEXT,
      platform TEXT,
      provider TEXT,
      type TEXT DEFAULT 'temp',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(number)
    );

    -- eSIM供应商表
    CREATE TABLE IF NOT EXISTS esim_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      countries TEXT DEFAULT '[]',
      config_fields TEXT DEFAULT '[]',
      website TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 短信日志表
    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_id INTEGER,
      direction TEXT DEFAULT 'out',
      from_number TEXT,
      to_number TEXT,
      content TEXT,
      status TEXT,
      provider_msg_id TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 产品库
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      category TEXT,
      model TEXT,
      description TEXT,
      ai_description TEXT,
      specs TEXT DEFAULT '{}',
      price_100 REAL,
      price_500 REAL,
      price_1000 REAL,
      moq INTEGER DEFAULT 100,
      currency TEXT DEFAULT 'USD',
      images TEXT DEFAULT '[]',
      certifications TEXT DEFAULT '[]',
      video_script TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- AI调用日志
    CREATE TABLE IF NOT EXISTS ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT,
      model TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      task TEXT,
      result TEXT,
      cached INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- AI知识库
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      key TEXT,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 设置表
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 活动日志/Timeline
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT,
      entity_id INTEGER,
      action TEXT,
      details TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 定时任务
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      cron TEXT,
      handler TEXT,
      params TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      last_run DATETIME,
      next_run DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ========== 索引优化 ==========
  db.exec(`
    -- 客户表索引（email用UNIQUE索引，见下方单独处理）
    CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage);
    CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country);
    CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at);
    CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);

    -- 询盘表索引
    CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id);
    CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
    CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);

    -- 交易表索引
    CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals(customer_id);
    CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
    CREATE INDEX IF NOT EXISTS idx_deals_created ON deals(created_at);
    CREATE INDEX IF NOT EXISTS idx_deals_updated ON deals(updated_at);

    -- 邮件表索引
    CREATE INDEX IF NOT EXISTS idx_emails_customer ON emails(customer_id);
    CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id);
    CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
    CREATE INDEX IF NOT EXISTS idx_emails_sent ON emails(sent_at);
    CREATE INDEX IF NOT EXISTS idx_emails_created ON emails(created_at);

    -- 社媒内容索引
    CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
    CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);

    -- 社媒线索索引
    CREATE INDEX IF NOT EXISTS idx_social_leads_platform ON social_leads(platform);
    CREATE INDEX IF NOT EXISTS idx_social_leads_status ON social_leads(status);

    -- 产品表索引
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

    -- AI日志索引
    CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_agent ON ai_logs(agent);

    -- 活动日志索引
    CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);

    -- 邮件账号索引
    CREATE INDEX IF NOT EXISTS idx_email_accounts_active ON email_accounts(is_active);

    -- 浏览器配置索引
    CREATE INDEX IF NOT EXISTS idx_browser_profiles_platform ON browser_profiles(platform);

    -- 知识库索引
    CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_base_key ON knowledge_base(key);
  `);

  // 确保 activity_log 表有 user_id 和 ip_address 列（M4 审计日志增强）
  try {
    db.prepare("SELECT user_id FROM activity_log LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE activity_log ADD COLUMN user_id TEXT DEFAULT 'system'");
  }
  try {
    db.prepare("SELECT ip_address FROM activity_log LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE activity_log ADD COLUMN ip_address TEXT DEFAULT 'unknown'");
  }

  // 千人千面邮件生成所需的客户画像字段。只在缺失时添加，避免影响旧库。
  const customerProfileColumns = [
    { name: 'industry', type: 'TEXT DEFAULT ""' },
    { name: 'customer_type', type: 'TEXT DEFAULT ""' },
    { name: 'main_needs', type: 'TEXT DEFAULT ""' },
    { name: 'interested_products', type: 'TEXT DEFAULT ""' },
    { name: 'language_preference', type: 'TEXT DEFAULT ""' },
    { name: 'communication_style', type: 'TEXT DEFAULT ""' },
    { name: 'website', type: 'TEXT DEFAULT ""' },
    { name: 'target_market', type: 'TEXT DEFAULT ""' }
  ];
  const customerCols = db.prepare("PRAGMA table_info(customers)").all().map(c => c.name);
  for (const col of customerProfileColumns) {
    if (!customerCols.includes(col.name)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  // ==================== 矩阵任务框架三表 ====================
  db.exec(`
    CREATE TABLE IF NOT EXISTS matrix_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      platform TEXT NOT NULL,
      action TEXT NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 5,
      account_ids TEXT DEFAULT '[]',
      input_data TEXT DEFAULT '{}',
      input_source_task_id INTEGER,
      schedule_type TEXT DEFAULT 'immediate',
      scheduled_at DATETIME,
      cron_expression TEXT,
      max_concurrency INTEGER DEFAULT 1,
      interval_min_sec INTEGER DEFAULT 30,
      interval_max_sec INTEGER DEFAULT 120,
      daily_limit INTEGER DEFAULT 0,
      time_window_start INTEGER DEFAULT 8,
      time_window_end INTEGER DEFAULT 21,
      total_items INTEGER DEFAULT 0,
      processed_items INTEGER DEFAULT 0,
      success_items INTEGER DEFAULT 0,
      failed_items INTEGER DEFAULT 0,
      output_data TEXT DEFAULT '[]',
      output_file TEXT,
      created_by TEXT DEFAULT 'manual',
      started_at DATETIME,
      completed_at DATETIME,
      error_log TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matrix_task_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      account_id INTEGER,
      target TEXT,
      action_data TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      result TEXT DEFAULT '{}',
      error TEXT,
      executed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collected_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      platform TEXT,
      data_type TEXT,
      external_id TEXT,
      username TEXT,
      display_name TEXT,
      profile_url TEXT,
      avatar_url TEXT,
      bio TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      country TEXT,
      gender TEXT,
      age_range TEXT,
      followers_count INTEGER,
      following_count INTEGER,
      posts_count INTEGER,
      engagement_rate REAL,
      is_active INTEGER DEFAULT 1,
      last_active_at DATETIME,
      raw_data TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(platform, data_type, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mt_status ON matrix_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_mt_platform ON matrix_tasks(platform);
    CREATE INDEX IF NOT EXISTS idx_mt_type ON matrix_tasks(task_type);
    CREATE INDEX IF NOT EXISTS idx_mti_task ON matrix_task_items(task_id);
    CREATE INDEX IF NOT EXISTS idx_mti_status ON matrix_task_items(status);
    CREATE INDEX IF NOT EXISTS idx_cd_platform ON collected_data(platform);
    CREATE INDEX IF NOT EXISTS idx_cd_type ON collected_data(data_type);
    CREATE INDEX IF NOT EXISTS idx_cd_task ON collected_data(task_id);

    -- 客户邮箱唯一索引（先删除旧的非UNIQUE索引，再建UNIQUE索引）
  `);
  db.exec("DROP INDEX IF EXISTS idx_customers_email");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique ON customers(email) WHERE email IS NOT NULL AND email != ''");
  db.exec(`

    -- 客服 Widget 配置
    CREATE TABLE IF NOT EXISTS widget_configs (
      site_id TEXT PRIMARY KEY,
      company_name TEXT,
      welcome_message TEXT DEFAULT 'How can we help?',
      theme_color TEXT DEFAULT '#667eea',
      position TEXT DEFAULT 'bottom-right',
      avatar_url TEXT,
      auto_reply_enabled INTEGER DEFAULT 1,
      auto_reply_message TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 跟进计划 & 跟进日志
  db.exec(`
    CREATE TABLE IF NOT EXISTS followup_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id),
      step INTEGER DEFAULT 1,
      delay_days INTEGER DEFAULT 3,
      template_id INTEGER,
      status TEXT DEFAULT 'active',
      next_run_at DATETIME,
      last_run_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS followup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER REFERENCES followup_plans(id),
      customer_id INTEGER,
      step INTEGER,
      action TEXT,
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_followup_plans_customer ON followup_plans(customer_id);
    CREATE INDEX IF NOT EXISTS idx_followup_plans_status ON followup_plans(status);
    CREATE INDEX IF NOT EXISTS idx_followup_logs_plan ON followup_logs(plan_id);
  `);

  // P3-19 直播转播表
  db.exec(`
    CREATE TABLE IF NOT EXISTS restream_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      source_url TEXT NOT NULL,
      targets TEXT DEFAULT '[]',
      status TEXT DEFAULT 'idle',
      overlay_config TEXT DEFAULT '{}',
      scheduled_at DATETIME,
      started_at DATETIME,
      stopped_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS restream_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      target_platform TEXT,
      event TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 告警表
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT DEFAULT 'info',
      message TEXT,
      data TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 收件人退信黑名单
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      reason TEXT,
      bounced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // P3-18 AI数字人/克隆翻译
  db.exec(`
    CREATE TABLE IF NOT EXISTS digital_humans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar_url TEXT,
      voice_id TEXT,
      voice_provider TEXT DEFAULT 'edge-tts',
      settings TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS digital_human_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_id INTEGER,
      title TEXT,
      video_path TEXT,
      language TEXT,
      duration REAL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ========== phone_numbers 数据完整性约束 ==========
  // 添加唯一索引（防止重复号码）
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_numbers_number ON phone_numbers(number)`);
  } catch (e) {
    // 如果已有重复数据导致创建失败，记录警告
    console.warn('⚠️ phone_numbers唯一索引创建失败（可能有重复数据）:', e.message);
  }

  // ========== eSIM相关表初始化 ==========
  // 为phone_numbers表添加eSIM相关字段
  const esimColumns = [
    { name: 'esim_provider_id', type: 'INTEGER' },
    { name: 'credentials', type: 'TEXT' },
    { name: 'sms_enabled', type: 'INTEGER DEFAULT 0' },
    { name: 'last_sms_at', type: 'DATETIME' },
    { name: 'sms_today', type: 'INTEGER DEFAULT 0' },
    { name: 'notes', type: 'TEXT' }
  ];
  
  for (const col of esimColumns) {
    try {
      db.prepare(`SELECT ${col.name} FROM phone_numbers LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE phone_numbers ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  // 插入预置供应商数据
  const presetProviders = [
    { 
      name: 'Twilio', 
      code: 'twilio',
      countries: '["US","GB","NG","AU","CA","DE","FR","JP","BR","MX","IN","SG","AE","ZA"]',
      config_fields: '[{"key":"account_sid","label":"Account SID","type":"text"},{"key":"auth_token","label":"Auth Token","type":"password"}]',
      website: 'https://www.twilio.com'
    },
    { 
      name: 'Telnyx', 
      code: 'telnyx',
      countries: '["US","GB","CA","AU","DE","FR","NL","SE","PL"]',
      config_fields: '[{"key":"api_key","label":"API Key","type":"password"}]',
      website: 'https://telnyx.com'
    },
    { 
      name: 'Vonage', 
      code: 'vonage',
      countries: '["US","GB","AU","DE","FR","ES","IT","NL","SG","HK"]',
      config_fields: '[{"key":"api_key","label":"API Key","type":"text"},{"key":"api_secret","label":"API Secret","type":"password"}]',
      website: 'https://www.vonage.com'
    },
    { 
      name: 'Plivo', 
      code: 'plivo',
      countries: '["US","CA","GB","AU","DE","FR"]',
      config_fields: '[{"key":"auth_id","label":"Auth ID","type":"text"},{"key":"auth_token","label":"Auth Token","type":"password"}]',
      website: 'https://www.plivo.com'
    },
    { 
      name: 'Africa\'s Talking', 
      code: 'africas-talking',
      countries: '["NG","KE","UG","TZ","RW","ET","GH","ZA","CI","SN","MW","BJ"]',
      config_fields: '[{"key":"username","label":"Username","type":"text"},{"key":"api_key","label":"API Key","type":"password"}]',
      website: 'https://africastalking.com'
    },
    { 
      name: 'Termii', 
      code: 'termii',
      countries: '["NG","GH","KE","ZA","CI"]',
      config_fields: '[{"key":"api_key","label":"API Key","type":"password"}]',
      website: 'https://termii.com'
    },
    { 
      name: '阿里云通信', 
      code: 'aliyun',
      countries: '["CN"]',
      config_fields: '[{"key":"access_key_id","label":"AccessKey ID","type":"text"},{"key":"access_key_secret","label":"AccessKey Secret","type":"password"},{"key":"sign_name","label":"签名名称","type":"text"},{"key":"template_code","label":"模板Code","type":"text"}]',
      website: 'https://www.aliyun.com/product/sms'
    },
    { 
      name: '腾讯云SMS', 
      code: 'tencent',
      countries: '["CN"]',
      config_fields: '[{"key":"secret_id","label":"SecretId","type":"text"},{"key":"secret_key","label":"SecretKey","type":"password"},{"key":"app_id","label":"AppID","type":"text"},{"key":"sign_name","label":"签名","type":"text"},{"key":"template_id","label":"模板ID","type":"text"}]',
      website: 'https://cloud.tencent.com/product/sms'
    }
  ];

  for (const provider of presetProviders) {
    db.prepare(`
      INSERT OR IGNORE INTO esim_providers (name, code, countries, config_fields, website, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(provider.name, provider.code, provider.countries, provider.config_fields, provider.website);
  }

  console.log('📊 数据库索引已创建/确认');
  console.log('📱 eSIM表及预置供应商已初始化');
  console.log('💾 数据库初始化完成');
  return db;
}

module.exports = { initDatabase, DB_PATH };
