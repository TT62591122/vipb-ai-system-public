const http = require('http');

// 用自然语言给系统 AI 下命令
const command = {
  message: '请用 user@example.com 这个邮箱账号，给客户 customer@example.com 发一封针对非洲客户的开发信，主题要专业，内容要包含我们的产品优势、非洲市场针对性、以及行动号召。写好后直接发送。'
};

const data = JSON.stringify(command);

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/ai-command/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('系统 AI 回复:', body);
  });
});

req.on('error', (e) => {
  console.error('请求错误:', e.message);
});

req.write(data);
req.end();
