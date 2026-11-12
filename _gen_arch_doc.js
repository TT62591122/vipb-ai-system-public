const fs = require('fs');
const path = require('path');
const BASE = 'D:\\VIPB-AI-System';

let md = '';
function add(text) { md += text + '\n'; }
function readHead(file, lines = 30) {
  try {
    const content = fs.readFileSync(path.join(BASE, file), 'utf8');
    return content.split('\n').slice(0, lines).join('\n');
  } catch(e) { return '[无法读取]'; }
}
function getExports(file) {
  try {
    const content = fs.readFileSync(path.join(BASE, file), 'utf8');
    const exports = [];
    const classMatch = content.match(/class\s+(\w+)/);
    if (classMatch) exports.push('class ' + classMatch[1]);
    const methodMatches = content.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g);
    if (methodMatches) {
      methodMatches.slice(0, 20).forEach(m => {
        const name = m.match(/(?:async\s+)?(\w+)\s*\(/);
        if (name && !['if','for','while','switch','catch','function','constructor'].includes(name[1])) {
          exports.push(name[1] + '()');
        }
      });
    }
    const lines = content.split('\n').length;
    return { exports: [...new Set(exports)], lines, size: content.length };
  } catch(e) { return { exports: [], lines: 0, size: 0 }; }
}
function getRoutes(file) {
  try {
    const content = fs.readFileSync(path.join(BASE, 'routes', file), 'utf8');
    const routes = [];
    const matches = content.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"](.*?)['"]/g);
    for (const m of matches) routes.push(`${m[1].toUpperCase()} ${m[2]}`);
    return { routes, lines: content.split('\n').length };
  } catch(e) { return { routes: [], lines: 0 }; }
}

// ============ 1. 项目概览 ============
add('# VIPB-AI-System 完整架构文档');
add(`\n> 自动生成于 ${new Date().toISOString().slice(0,10)}`);
add('\n## 1. 项目概览\n');
add('- **技术栈**: Node.js + Express + better-sqlite3 + Socket.IO + EJS + Puppeteer');
add('- **启动**: `node server.js` 或 `pm2 start ecosystem.config.js`');
add('- **端口**: 3001 (默认)');
add('- **数据库**: SQLite (`data/vipb.db`)');
add('- **入口**: `server.js`\n');

// 目录结构
add('### 目录结构\n```');
const dirs = ['config', 'data', 'logs', 'migrations', 'public', 'public/js', 'routes', 'scripts', 'src', 'src/platforms', 'src/esim', 'src/human', 'tests', 'views', 'views/partials'];
dirs.forEach(d => {
  try {
    const files = fs.readdirSync(path.join(BASE, d)).filter(f => !f.startsWith('.') && f !== 'node_modules');
    add(`${d}/ (${files.length} files)`);
  } catch(e) {}
});
add('```\n');

// ============ 2. server.js 分析 ============
add('## 2. 核心入口 server.js\n');
try {
  const sjs = fs.readFileSync(path.join(BASE, 'server.js'), 'utf8');
  const sjsLines = sjs.split('\n').length;
  add(`- **文件大小**: ${sjs.length} bytes, ${sjsLines} 行\n`);
  
  // 提取require
  const requires = [];
  sjs.match(/require\(['"]\.?\/?([^'"]+)['"]\)/g)?.forEach(r => {
    const m = r.match(/require\(['"]\.?\/?([^'"]+)['"]\)/);
    if (m && !m[1].startsWith('node_modules')) requires.push(m[1]);
  });
  add('### 引入模块\n');
  requires.forEach(r => add(`- \`${r}\``));
  
  // 提取路由挂载
  add('\n### 路由挂载\n');
  const routeMounts = sjs.matchAll(/app\.use\s*\(\s*['"]([^'"]+)['"].*?require\(['"]([^'"]+)['"]\)/g);
  for (const m of routeMounts) add(`- \`${m[1]}\` → \`${m[2]}\``);
  
  // 提取定时任务
  add('\n### 定时任务 (cron)\n');
  const crons = sjs.matchAll(/cron\.schedule\s*\(\s*['"]([^'"]+)['"].*?\/\/\s*(.*?)$/gm);
  for (const m of crons) add(`- \`${m[1]}\` — ${m[2] || '(无注释)'}`);
  const cronBlocks = sjs.matchAll(/cron\.schedule\s*\(\s*['"]([^'"]+)['"]/g);
  const allCrons = [];
  for (const m of cronBlocks) allCrons.push(m[1]);
  if (allCrons.length > 0) add(`\n共 ${allCrons.length} 个定时任务`);
} catch(e) { add('读取失败: ' + e.message); }

// ============ 3. 数据库 ============
add('\n## 3. 数据库设计\n');
try {
  const schema = JSON.parse(fs.readFileSync(path.join(BASE, '_db_schema.json'), 'utf8'));
  const tables = Object.keys(schema);
  add(`共 **${tables.length}** 张表\n`);
  
  // 分类
  const categories = {
    'CRM/客户': [], '邮件': [], '社媒/社交': [], 'AI/智能': [],
    'WhatsApp': [], '任务/调度': [], '系统/配置': [], '营销/序列': [],
    '产品': [], '分析/统计': [], '安全/审计': [], '其他': []
  };
  
  tables.forEach(t => {
    const info = `| ${t} | ${schema[t].columns.length} 列 | ${schema[t].rowCount} 行 |`;
    const tl = t.toLowerCase();
    if (tl.includes('customer') || tl.includes('lead') || tl.includes('crm') || tl.includes('contact')) categories['CRM/客户'].push(info);
    else if (tl.includes('email') || tl.includes('inbox') || tl.includes('warmup') || tl.includes('unsubscri')) categories['邮件'].push(info);
    else if (tl.includes('social') || tl.includes('tiktok') || tl.includes('instagram') || tl.includes('facebook') || tl.includes('linkedin') || tl.includes('youtube') || tl.includes('twitter') || tl.includes('matrix')) categories['社媒/社交'].push(info);
    else if (tl.includes('ai_') || tl.includes('knowledge') || tl.includes('brain') || tl.includes('intent')) categories['AI/智能'].push(info);
    else if (tl.includes('whatsapp') || tl.includes('wa_')) categories['WhatsApp'].push(info);
    else if (tl.includes('task') || tl.includes('cron') || tl.includes('schedule') || tl.includes('job') || tl.includes('pending')) categories['任务/调度'].push(info);
    else if (tl.includes('setting') || tl.includes('config') || tl.includes('user') || tl.includes('session') || tl.includes('module')) categories['系统/配置'].push(info);
    else if (tl.includes('sequence') || tl.includes('campaign') || tl.includes('journey') || tl.includes('workflow') || tl.includes('quote')) categories['营销/序列'].push(info);
    else if (tl.includes('product')) categories['产品'].push(info);
    else if (tl.includes('analytics') || tl.includes('stats') || tl.includes('tracking') || tl.includes('metric')) categories['分析/统计'].push(info);
    else if (tl.includes('audit') || tl.includes('security') || tl.includes('alert') || tl.includes('fraud') || tl.includes('spam')) categories['安全/审计'].push(info);
    else categories['其他'].push(info);
  });
  
  Object.entries(categories).forEach(([cat, items]) => {
    if (items.length === 0) return;
    add(`### ${cat} (${items.length}表)\n`);
    add('| 表名 | 字段 | 数据量 |');
    add('|------|------|--------|');
    items.forEach(i => add(i));
    add('');
  });
  
  // 详细字段列表
  add('### 所有表字段详情\n');
  add('<details><summary>点击展开90张表的完整字段列表</summary>\n');
  tables.forEach(t => {
    add(`#### ${t} (${schema[t].rowCount} 行)\n`);
    add('| 字段 | 类型 | NOT NULL | PK |');
    add('|------|------|----------|-----|');
    schema[t].columns.forEach(c => {
      add(`| ${c.name} | ${c.type || '-'} | ${c.notnull ? '✓' : ''} | ${c.pk ? '✓' : ''} |`);
    });
    add('');
  });
  add('</details>\n');
} catch(e) { add('数据库schema读取失败: ' + e.message); }

// ============ 4. 路由系统 ============
add('## 4. 路由系统\n');
const routeFiles = fs.readdirSync(path.join(BASE, 'routes')).filter(f => f.endsWith('.js'));
add(`共 **${routeFiles.length}** 个路由文件\n`);

routeFiles.forEach(file => {
  const info = getRoutes(file);
  add(`### ${file} (${info.lines} 行)\n`);
  if (info.routes.length > 0) {
    info.routes.forEach(r => add(`- \`${r}\``));
  } else {
    add('- (未提取到标准路由定义)');
  }
  add('');
});

// ============ 5. 核心引擎 ============
add('## 5. 核心引擎模块\n');
const srcFiles = fs.readdirSync(path.join(BASE, 'src')).filter(f => f.endsWith('.js'));
add(`共 **${srcFiles.length}** 个核心模块\n`);

srcFiles.forEach(file => {
  const info = getExports(path.join('src', file));
  add(`### ${file} (${info.lines} 行)\n`);
  if (info.exports.length > 0) {
    add('主要方法/类: ' + info.exports.slice(0, 15).join(', '));
  }
  // 读取文件头注释
  const head = readHead(path.join('src', file), 5);
  const comment = head.match(/\/\*\*([\s\S]*?)\*\//)?.[1]?.trim() || head.match(/\/\/\s*(.*)/)?.[1] || '';
  if (comment) add('\n> ' + comment.replace(/\n/g, ' ').slice(0, 200));
  add('');
});

// ============ 6. 平台执行器 ============
add('## 6. 平台执行器\n');
const platformDirs = fs.readdirSync(path.join(BASE, 'src', 'platforms'));
add(`共 **${platformDirs.length}** 个平台\n`);

platformDirs.forEach(dir => {
  const executorPath = path.join('src', 'platforms', dir, 'executor.js');
  const altPath = path.join('src', 'platforms', dir, 'extractor.js');
  let filePath = executorPath;
  try { fs.accessSync(path.join(BASE, executorPath)); } catch { filePath = altPath; }
  const info = getExports(filePath);
  add(`### ${dir} (${info.lines} 行)`);
  if (info.exports.length > 0) add('- 方法: ' + info.exports.slice(0, 10).join(', '));
  add('');
});

// ============ 7. 视图 ============
add('## 7. 前端视图\n');
const viewFiles = fs.readdirSync(path.join(BASE, 'views')).filter(f => f.endsWith('.ejs'));
add(`共 **${viewFiles.length}** 个主页面\n`);

viewFiles.forEach(file => {
  try {
    const content = fs.readFileSync(path.join(BASE, 'views', file), 'utf8');
    const title = content.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const size = content.length;
    const tabs = content.match(/id=['"](\w+-tab)['"]/g)?.map(m => m.match(/['"](\w+-tab)['"]/)[1]) || [];
    add(`### ${file} (${(size/1024).toFixed(1)}KB)`);
    if (title) add(`- 标题: ${title}`);
    if (tabs.length > 0) add(`- Tab: ${tabs.join(', ')}`);
    add('');
  } catch(e) { add(`### ${file} — 读取失败\n`); }
});

// ============ 8. 配置 ============
add('## 8. 配置系统\n');
try {
  const configFiles = fs.readdirSync(path.join(BASE, 'config'));
  configFiles.forEach(f => {
    const info = getExports(path.join('config', f));
    add(`- \`${f}\` (${info.lines} 行)`);
  });
} catch(e) { add('config目录读取失败'); }

// ============ 9. eSIM/SMS ============
add('\n## 9. eSIM/SMS 引擎\n');
try {
  const adapters = fs.readdirSync(path.join(BASE, 'src', 'esim', 'adapters'));
  add(`共 ${adapters.length} 个适配器: ` + adapters.map(a => a.replace('.js','')).join(', '));
} catch(e) {}

// ============ 10. 人类行为模拟 ============
add('\n## 10. 人类行为模拟引擎\n');
try {
  const humanFiles = fs.readdirSync(path.join(BASE, 'src', 'human'));
  humanFiles.forEach(f => {
    const info = getExports(path.join('src', 'human', f));
    add(`- \`${f}\` (${info.lines} 行) — ${info.exports.slice(0, 8).join(', ')}`);
  });
} catch(e) {}

// ============ 写入 ============
fs.writeFileSync(path.join(BASE, 'VIPB-Architecture-Full.md'), md, 'utf8');
console.log('Done! Size:', md.length, 'bytes, Lines:', md.split('\n').length);
