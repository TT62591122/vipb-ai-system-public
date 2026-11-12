const Database = require('better-sqlite3');
const db = new Database('D:/VIPB-AI-System/data/vipb.db');

const kbRows = db.prepare("SELECT category, key, value FROM knowledge_base WHERE category IN ('trade_methodology','product_smart_meter','product_circuit_breaker')").all();
console.log('知识库条目总数:', kbRows.length);
const cats = {};
kbRows.forEach(r => { cats[r.category] = (cats[r.category]||0)+1; });
console.log('按category分布:', JSON.stringify(cats, null, 2));

// 验证注入逻辑
const grouped = {};
kbRows.forEach(r => {
  if (!grouped[r.category]) grouped[r.category] = [];
  try { grouped[r.category].push(`[${r.key}]: ${JSON.stringify(JSON.parse(r.value))}`); }
  catch { grouped[r.category].push(`[${r.key}]: ${r.value}`); }
});
const parts = [];
if (grouped.trade_methodology) parts.push('### 外贸方法论\n' + grouped.trade_methodology.join('\n'));
if (grouped.product_smart_meter) parts.push('### 电能表产品知识\n' + grouped.product_smart_meter.join('\n'));
const tradeKnowledgeBlock = parts.length ? '\n## 外贸与产品知识库\n' + parts.join('\n\n') : '';
console.log('\n注入块字符数:', tradeKnowledgeBlock.length);
console.log('注入块预览（前300字）:', tradeKnowledgeBlock.substring(0, 300));
db.close();
