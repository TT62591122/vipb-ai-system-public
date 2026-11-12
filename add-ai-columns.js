/**
 * 临时脚本：给deals表添加AI相关字段
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'vipb.db');
const db = new Database(DB_PATH);

try {
  // 检查字段是否已存在
  const columns = db.prepare("PRAGMA table_info(deals)").all();
  const hasAiGenerated = columns.some(c => c.name === 'ai_generated');
  const hasAiAnalysis = columns.some(c => c.name === 'ai_analysis');
  
  if (!hasAiGenerated) {
    db.exec('ALTER TABLE deals ADD COLUMN ai_generated INTEGER DEFAULT 0');
    console.log('✅ 添加字段 ai_generated');
  } else {
    console.log('⏭️  字段 ai_generated 已存在');
  }
  
  if (!hasAiAnalysis) {
    db.exec('ALTER TABLE deals ADD COLUMN ai_analysis TEXT DEFAULT ""');
    console.log('✅ 添加字段 ai_analysis');
  } else {
    console.log('⏭️  字段 ai_analysis 已存在');
  }
  
  console.log('✅ 数据库更新完成');
} catch (err) {
  console.error('❌ 错误:', err.message);
} finally {
  db.close();
}
