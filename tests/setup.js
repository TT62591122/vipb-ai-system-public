/**
 * Jest Global Setup - 启动测试服务器
 */
const { execSync, spawn } = require('child_process');
const http = require('http');

const PORT = process.env.TEST_PORT || 3099;

function waitForServer(port, maxMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > maxMs) return reject(new Error('Server start timeout'));
        setTimeout(check, 300);
      });
      req.end();
    };
    check();
  });
}

module.exports = async function() {
  // 启动测试服务器
  const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test', DB_PATH: ':memory:' };
  const server = spawn('node', ['server.js'], {
    cwd: __dirname + '/..',
    env,
    stdio: 'pipe',
    detached: true,
  });
  server.unref();

  // 保存PID以便teardown关闭
  process.env.__TEST_SERVER_PID = String(server.pid);
  globalThis.__TEST_SERVER_PID = server.pid;
  globalThis.__TEST_SERVER = server;

  // 等待服务器就绪
  try {
    await waitForServer(PORT);
  } catch (e) {
    server.kill();
    throw new Error('测试服务器启动失败: ' + e.message);
  }

  process.env.TEST_BASE_URL = `http://127.0.0.1:${PORT}`;
};
