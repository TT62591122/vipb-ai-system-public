const db = require('better-sqlite3')('data/vipb.db');

// 检查 AI 提供商配置
const row = db.prepare("SELECT value FROM settings WHERE key='ai_providers'").get();
console.log('AI Providers 配置:', row ? row.value : '未配置');

// 检查公司信息
const company = db.prepare("SELECT value FROM settings WHERE key='company_info'").get();
console.log('公司信息:', company ? company.value : '未配置');

db.close();
