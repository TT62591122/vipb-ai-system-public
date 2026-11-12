const { initDatabase } = require('./src/database');
const fs = require('fs');
const db = initDatabase();

// 读取新知识文件
const newKnowledge = fs.readFileSync('C:\\Users\\Mls\\.openclaw\\workspace\\memory\\trade-knowledge.md', 'utf8');

// 读取现有知识库
const rows = db.prepare('SELECT id, category, key, value FROM knowledge_base ORDER BY id').all();

// 提取现有知识的关键词和主题
const existingTopics = new Set();
rows.forEach(r => {
  let val = r.value;
  // 提取所有英文关键词和中文主题词
  const words = val.match(/[a-zA-Z_]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
  words.forEach(w => existingTopics.add(w.toLowerCase()));
});

// 新知识的各章节
const sections = newKnowledge.split(/^## /m).slice(1);

console.log('=== 细粒度查重分析 ===\n');

sections.forEach(section => {
  const title = section.split('\n')[0].trim();
  const content = section;
  
  console.log(`\n【${title}】`);
  
  // 提取该章节的子知识点
  const subPoints = content.split(/^### /m).slice(1);
  
  subPoints.forEach(sp => {
    const subTitle = sp.split('\n')[0].trim();
    const subContent = sp;
    
    // 检查关键概念是否已存在
    const keyTerms = subContent.match(/[A-Z]{2,}|[\u4e00-\u9fff]{4,}/g) || [];
    const matchCount = keyTerms.filter(t => existingTopics.has(t.toLowerCase())).length;
    const totalTerms = keyTerms.length || 1;
    const overlapRatio = matchCount / totalTerms;
    
    // 逐行检查细节
    const lines = subContent.split('\n').filter(l => l.trim().startsWith('-'));
    let newDetails = [];
    let existingDetails = [];
    
    lines.forEach(line => {
      const lineTerms = line.match(/[a-zA-Z]{3,}|[\u4e00-\u9fff]{3,}/g) || [];
      const lineMatches = lineTerms.filter(t => existingTopics.has(t.toLowerCase())).length;
      if (lineMatches / (lineTerms.length || 1) > 0.5) {
        existingDetails.push(line.trim().substring(0, 80));
      } else {
        newDetails.push(line.trim().substring(0, 80));
      }
    });
    
    const status = overlapRatio > 0.6 ? '⚠️ 大部分已有' : overlapRatio > 0.3 ? '🔄 部分重叠' : '✅ 新知识';
    console.log(`  ${status} ${subTitle}`);
    if (newDetails.length > 0) {
      console.log(`    新增知识点(${newDetails.length}条):`);
      newDetails.slice(0, 5).forEach(d => console.log(`      + ${d}`));
      if (newDetails.length > 5) console.log(`      ... 还有${newDetails.length - 5}条`);
    }
    if (existingDetails.length > 0) {
      console.log(`    已有知识点(${existingDetails.length}条): 跳过`);
    }
  });
});
