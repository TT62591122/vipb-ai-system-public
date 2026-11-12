/**
 * B9 日志系统 — 基于 pino
 * 开发环境: pino-pretty 控制台输出
 * 生产环境: 写文件 logs/app.log + logs/error.log
 */
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const isProduction = process.env.NODE_ENV === 'production';
const logsDir = path.join(__dirname, '..', 'logs');

// 确保 logs 目录存在
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

let logger;

if (isProduction) {
  // 生产环境：多流写入文件
  const pino_multistream = require('pino').multistream;
  const appStream = fs.createWriteStream(path.join(logsDir, 'app.log'), { flags: 'a' });
  const errorStream = fs.createWriteStream(path.join(logsDir, 'error.log'), { flags: 'a' });

  const streams = [
    { level: 'debug', stream: appStream },
    { level: 'error', stream: errorStream },
  ];

  logger = pino({ level: 'debug', timestamp: pino.stdTimeFunctions.isoTime }, pino_multistream(streams));
} else {
  // 开发环境：pino-pretty 控制台输出
  const pretty = require('pino-pretty');
  logger = pino({
    level: 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
  }, pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }));
}

/**
 * 审计日志快捷方法
 * @param {string} action - 操作名称
 * @param {object} details - 详情
 */
logger.audit = function (action, details = {}) {
  this.info({ audit: true, action, ...details }, `[AUDIT] ${action}`);
};

/**
 * 劫持 console 方法，重定向到 pino
 */
function hijackConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    logger.info(args.length === 1 ? args[0] : args.join(' '));
  };
  console.error = (...args) => {
    logger.error(args.length === 1 ? args[0] : args.join(' '));
  };
  console.warn = (...args) => {
    logger.warn(args.length === 1 ? args[0] : args.join(' '));
  };

  // 保留原始方法以备不时之需
  console._originalLog = originalLog;
  console._originalError = originalError;
  console._originalWarn = originalWarn;
}

module.exports = { logger, hijackConsole };
