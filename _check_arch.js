const { initDatabase } = require('./src/database');
const db = initDatabase();

// 所有表
const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== 所有表 (' + allTables.length + ') ===');
console.log(allTables.map(t => t.name).join(', '));

// 知识库表
const knowledgeTables = allTables.filter(t => t.name.includes('knowledge'));
console.log('\n=== 知识库相关表 ===');
knowledgeTables.forEach(t => {
  const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
  const cols = db.prepare('PRAGMA table_info(' + t.name + ')').all().map(c => c.name);
  console.log(t.name + ': ' + count.c + '条, 字段: [' + cols.join(', ') + ']');
  const rows = db.prepare('SELECT * FROM ' + t.name + ' LIMIT 2').all();
  rows.forEach(r => console.log('  样本:', JSON.stringify(r).substring(0, 300)));
});

// AI/Agent相关表
const aiTables = allTables.filter(t => /ai|brain|agent|prompt|template|email_template/.test(t.name));
console.log('\n=== AI/Agent相关表 ===');
aiTables.forEach(t => {
  const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
  const cols = db.prepare('PRAGMA table_info(' + t.name + ')').all().map(c => c.name);
  console.log(t.name + ': ' + count.c + '条, 字段: [' + cols.join(', ') + ']');
});

// 模块开关
try {
  const modules = db.prepare("SELECT key, value FROM settings WHERE key LIKE '%module%' OR key LIKE '%enable%' OR key LIKE '%brain%'").all();
  console.log('\n=== 模块开关设置 ===');
  modules.forEach(m => console.log(m.key + ' = ' + m.value));
} catch(e) { console.log('settings查询失败:', e.message); }

// 产品表
const productTables = allTables.filter(t => /product|catalog/.test(t.name));
console.log('\n=== 产品相关表 ===');
productTables.forEach(t => {
  const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
  console.log(t.name + ': ' + count.c + '条');
});

// 邮件相关表
const emailTables = allTables.filter(t => /email|template/.test(t.name));
console.log('\n=== 邮件相关表 ===');
emailTables.forEach(t => {
  const count = db.prepare('SELECT COUNT(*) as c FROM ' + t.name).get();
  console.log(t.name + ': ' + count.c + '条');
});
