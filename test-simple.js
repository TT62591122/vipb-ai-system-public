const http = require('http');

// 简单测试
const command = { message: '你好' };
const data = JSON.stringify(command);

console.log('发送数据:', data);

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/ai-command/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log('响应状态:', res.statusCode);
  console.log('响应头:', res.headers);
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
