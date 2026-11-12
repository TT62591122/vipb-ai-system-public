const http = require('http');

const command = { message: '你好，测试 AI 命令' };
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

console.log('发送请求...');
const req = http.request(options, (res) => {
  console.log('响应状态:', res.statusCode);
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('响应内容:', body);
  });
});

req.on('error', (e) => {
  console.error('请求错误:', e.message);
});

req.write(data);
req.end();
