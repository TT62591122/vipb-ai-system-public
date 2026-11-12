/**
 * AlertEngine - 主动告警通知引擎
 * 支持: console日志、webhook通知、写入alerts表
 */
const https = require('https');
const http = require('http');

class AlertEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.webhookUrl = options.webhookUrl || process.env.ALERT_WEBHOOK_URL || null;
  }

  /**
   * 发送告警
   * @param {'info'|'warning'|'critical'} level
   * @param {string} message
   * @param {object} data
   */
  alert(level, message, data = {}) {
    // 1. Console日志
    const prefix = { info: 'ℹ️', warning: '⚠️', critical: '🚨' }[level] || 'ℹ️';
    console.log(`${prefix} [ALERT:${level.toUpperCase()}] ${message}`, data);

    // 2. 写入alerts表
    try {
      this.db.prepare(
        `INSERT INTO alerts (level, message, data, created_at) VALUES (?, ?, ?, datetime('now'))`
      ).run(level, message, JSON.stringify(data));
    } catch (err) {
      console.error('[AlertEngine] 写入alerts表失败:', err.message);
    }

    // 3. Webhook通知 (critical和warning)
    if (this.webhookUrl && (level === 'critical' || level === 'warning')) {
      this._sendWebhook(level, message, data);
    }
  }

  _sendWebhook(level, message, data) {
    try {
      const payload = JSON.stringify({
        level,
        message,
        data,
        timestamp: new Date().toISOString(),
        source: 'VIPB-AI-System'
      });

      const url = new URL(this.webhookUrl);
      const mod = url.protocol === 'https:' ? https : http;

      const req = mod.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        if (res.statusCode >= 400) {
          console.error(`[AlertEngine] Webhook返回 ${res.statusCode}`);
        }
      });

      req.on('error', (err) => {
        console.error('[AlertEngine] Webhook请求失败:', err.message);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.error('[AlertEngine] Webhook发送异常:', err.message);
    }
  }
}

module.exports = AlertEngine;
