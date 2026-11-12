const fs = require('fs');
const { marked } = require('marked');

const md = fs.readFileSync('D:\\VIPB-AI-System\\VIPB-Architecture-Full.md', 'utf8');
const html = marked.parse(md);

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>VIPB-AI-System 完整架构文档</title>
<style>
  body { font-family: 'Microsoft YaHei', SimHei, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
  h1 { color: #1a5276; border-bottom: 3px solid #2980b9; padding-bottom: 10px; }
  h2 { color: #2c3e50; border-bottom: 2px solid #bdc3c7; padding-bottom: 6px; margin-top: 40px; }
  h3 { color: #34495e; margin-top: 25px; }
  h4 { color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 13px; }
  th { background: #2c3e50; color: white; }
  tr:nth-child(even) { background: #f9f9f9; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: Consolas, monospace; font-size: 13px; }
  pre { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; color: inherit; }
  blockquote { border-left: 4px solid #3498db; margin: 10px 0; padding: 5px 15px; background: #ebf5fb; }
  ul { padding-left: 20px; }
  li { margin: 3px 0; }
  details { margin: 10px 0; padding: 10px; background: #fafafa; border: 1px solid #eee; border-radius: 5px; }
  summary { cursor: pointer; font-weight: bold; color: #2980b9; }
  @media print { body { max-width: 100%; } }
</style>
</head>
<body>
${html}
</body>
</html>`;

fs.writeFileSync('D:\\VIPB-AI-System-Architecture.html', fullHtml, 'utf8');
console.log('Done! HTML size:', fullHtml.length, 'bytes');
