/**
 * 初始化用户表和初始管理员账号
 */
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'vipb.db');

async function initUsers() {
  const db = new Database(DB_PATH);
  
  // 创建用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // 检查是否已有管理员
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  
  if (!adminExists) {
    // 创建初始管理员账号（2026-11-05 安全整改：不再使用写死的默认口令）
    // 口令来源：环境变量 INITIAL_ADMIN_PASSWORD；未设置时随机生成并在控制台打印一次
    const crypto = require('crypto');
    const envPassword = process.env.INITIAL_ADMIN_PASSWORD;
    const generated = !envPassword;
    const initialPassword = envPassword || crypto.randomBytes(12).toString('base64url');
    const hashedPassword = await bcrypt.hash(initialPassword, 10);
    db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)')
      .run('admin', hashedPassword, null, 'admin');
    if (generated) {
      console.log(`✅ 初始管理员账号已创建: admin / ${initialPassword}（随机生成、仅打印这一次，请立即保存并在首次登录后修改）`);
    } else {
      console.log('✅ 初始管理员账号已创建: admin（口令取自环境变量 INITIAL_ADMIN_PASSWORD）');
    }
  } else {
    console.log('✅ 用户表已存在');
  }
  
  db.close();
}

// 如果直接运行此脚本
if (require.main === module) {
  initUsers().then(() => {
    console.log('用户初始化完成');
    process.exit(0);
  }).catch(err => {
    console.error('用户初始化失败:', err);
    process.exit(1);
  });
}

module.exports = { initUsers };
