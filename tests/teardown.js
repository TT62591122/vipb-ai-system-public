/**
 * Jest Global Teardown - 关闭测试服务器
 */
module.exports = async function() {
  const pid = parseInt(process.env.__TEST_SERVER_PID);
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {
      // 可能已经退出
    }
  }
};
