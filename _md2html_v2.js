const fs = require('fs');
const { marked } = require('marked');

const md = fs.readFileSync('D:\\VIPB-AI-System\\_product_intro.md', 'utf8');
const html = marked.parse(md);

const style = `
  body { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 850px; margin: 0 auto; padding: 40px 30px; line-height: 2; color: #2c3e50; background: #fff; }
  h1 { color: #1a5276; border-bottom: 3px solid #3498db; padding-bottom: 15px; font-size: 28px; text-align: center; }
  h2 { color: #2980b9; border-bottom: 2px solid #e8e8e8; padding-bottom: 8px; margin-top: 50px; font-size: 22px; }
  h3 { color: #34495e; margin-top: 25px; font-size: 18px; }
  table { border-collapse: collapse; width: 100%; margin: 15px 0; }
  th, td { border: 1px solid #ddd; padding: 10px 14px; text-align: left; font-size: 14px; }
  th { background: #3498db; color: white; }
  tr:nth-child(even) { background: #f8f9fa; }
  tr:hover { background: #ebf5fb; }
  code { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-family: Consolas, monospace; color: #e74c3c; }
  blockquote { border-left: 4px solid #3498db; margin: 15px 0; padding: 10px 20px; background: #ebf5fb; border-radius: 0 8px 8px 0; }
  ul, ol { padding-left: 25px; }
  li { margin: 6px 0; }
  hr { border: none; border-top: 2px solid #eee; margin: 40px 0; }
  @media print { body { max-width: 100%; } }
`;

const fullHtml = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>VIPB AI System 产品介绍手册</title><style>' + style + '</style></head><body>' + html + '</body></html>';

fs.writeFileSync('D:\\VIPB-AI-System-产品介绍手册.html', fullHtml, 'utf8');
console.log('Done! Size:', fullHtml.length, 'bytes');
