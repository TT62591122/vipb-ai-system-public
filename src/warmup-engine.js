/**
 * 邮件预热引擎（独立通道）
 * - 不走 email-sender.js，独立SMTP连接
 * - 模拟真实邮件往来（自发自收 / 互发）
 * - 逐步提升发信域名信誉
 * - 预热阶段管理（week1-5+）
 * - 自动打开/回复预热邮件
 * 
 * ⚠️ 这是独立通道，不影响正常业务邮件发送
 */
const nodemailer = require('nodemailer');
const { decrypt } = require('./crypto-utils');

// 预热邮件模板（模拟真实商务往来）
const WARMUP_TEMPLATES = [
  { subject: 'Meeting follow-up', body: 'Hi,\n\nThank you for the meeting today. I wanted to follow up on the points we discussed.\n\nPlease let me know if you have any questions.\n\nBest regards' },
  { subject: 'Quick question about the project', body: 'Hi,\n\nI had a quick question about the timeline for the upcoming project. Could you share the latest schedule?\n\nThanks!' },
  { subject: 'Document review request', body: 'Hi,\n\nCould you please review the attached document and provide your feedback by end of week?\n\nThank you for your time.' },
  { subject: 'Re: Quarterly report', body: 'Thanks for sending this over. I\'ve reviewed the numbers and everything looks good.\n\nLet me know if you need anything else.' },
  { subject: 'Lunch next week?', body: 'Hi,\n\nWould you be available for lunch next Tuesday or Wednesday? I\'d love to catch up.\n\nBest' },
  { subject: 'Invoice #2024-{n}', body: 'Hi,\n\nPlease find the invoice for this month\'s services. Payment is due within 30 days.\n\nThank you for your business.' },
  { subject: 'Team update - Week {n}', body: 'Hi team,\n\nHere\'s a quick update on what we accomplished this week:\n\n- Completed phase 1 review\n- Started planning for Q2\n- Updated documentation\n\nHave a great weekend!' },
  { subject: 'Re: Product specifications', body: 'Thanks for the detailed specs. I\'ve forwarded them to our engineering team for review.\n\nWe should have feedback by Thursday.' },
  { subject: 'Conference registration', body: 'Hi,\n\nJust wanted to confirm that I\'ve registered for the upcoming industry conference. Looking forward to seeing you there.\n\nBest regards' },
  { subject: 'Happy holidays!', body: 'Hi,\n\nWishing you and your family a wonderful holiday season. Looking forward to working together in the new year!\n\nWarm regards' },
];

// 预热阶段配置
const WARMUP_STAGES = {
  week1: { dailyLimit: 2, replyRate: 1.0 },
  week2: { dailyLimit: 5, replyRate: 0.8 },
  week3: { dailyLimit: 10, replyRate: 0.6 },
  week4: { dailyLimit: 15, replyRate: 0.5 },
  week5plus: { dailyLimit: 20, replyRate: 0.4 },
};

class WarmupEngine {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS email_warmup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      to_addr TEXT,
      from_addr TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS email_warmup_config (
      account_id INTEGER PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      stage TEXT DEFAULT 'week1',
      started_at TEXT DEFAULT (datetime('now')),
      partner_email TEXT,
      daily_sent_today INTEGER DEFAULT 0,
      last_sent_date TEXT
    )`).run();
  }

  /**
   * 为账号启用预热
   */
  enable(accountId, partnerEmail = null) {
    this.db.prepare(`INSERT OR REPLACE INTO email_warmup_config 
      (account_id, enabled, stage, started_at, partner_email, daily_sent_today, last_sent_date)
      VALUES (?, 1, 'week1', datetime('now'), ?, 0, NULL)`)
      .run(accountId, partnerEmail);
    console.log(`[WarmupEngine] 账号#${accountId} 预热已启用`);
  }

  /**
   * 禁用预热
   */
  disable(accountId) {
    this.db.prepare("UPDATE email_warmup_config SET enabled = 0 WHERE account_id = ?").run(accountId);
  }

  /**
   * 获取预热状态
   */
  getStatus(accountId) {
    const config = this.db.prepare("SELECT * FROM email_warmup_config WHERE account_id = ?").get(accountId);
    if (!config) return null;
    
    const todaySent = this._getTodaySentCount(accountId);
    const stage = this._calculateStage(config.started_at);
    const stageConfig = WARMUP_STAGES[stage] || WARMUP_STAGES.week5plus;
    
    return {
      ...config,
      currentStage: stage,
      todaySent,
      dailyLimit: stageConfig.dailyLimit,
      remaining: Math.max(0, stageConfig.dailyLimit - todaySent)
    };
  }

  /**
   * 执行一轮预热发送
   */
  async runWarmup() {
    const configs = this.db.prepare(
      "SELECT wc.*, ea.email, ea.smtp_host, ea.smtp_port, ea.smtp_user, ea.smtp_pass, ea.display_name FROM email_warmup_config wc JOIN email_accounts ea ON wc.account_id = ea.id WHERE wc.enabled = 1"
    ).all();

    const results = [];
    for (const config of configs) {
      try {
        const stage = this._calculateStage(config.started_at);
        const stageConfig = WARMUP_STAGES[stage] || WARMUP_STAGES.week5plus;
        const todaySent = this._getTodaySentCount(config.account_id);
        
        if (todaySent >= stageConfig.dailyLimit) {
          results.push({ accountId: config.account_id, status: 'limit_reached', todaySent });
          continue;
        }

        // 选择预热目标
        const targetEmail = config.partner_email || config.email; // 自发自收
        const template = WARMUP_TEMPLATES[Math.floor(Math.random() * WARMUP_TEMPLATES.length)];
        const subject = template.subject
          .replace('{n}', Math.floor(Math.random() * 100) + 1);
        const body = template.body;

        // 独立SMTP连接（不走email-sender）
        const transporter = nodemailer.createTransport({
          host: config.smtp_host,
          port: config.smtp_port || 587,
          secure: config.smtp_port === 465,
          auth: {
            user: config.smtp_user || config.email,
            pass: decrypt(config.smtp_pass)
          },
          tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
          from: `"${config.display_name || 'Warmup'}" <${config.email}>`,
          to: targetEmail,
          subject,
          text: body
        });

        // 记录日志
        this.db.prepare(`INSERT INTO email_warmup_log 
          (account_id, direction, to_addr, from_addr, subject, status)
          VALUES (?, 'outbound', ?, ?, ?, 'sent')`)
          .run(config.account_id, targetEmail, config.email, subject);

        // 更新阶段
        if (stage !== config.stage) {
          this.db.prepare("UPDATE email_warmup_config SET stage = ? WHERE account_id = ?")
            .run(stage, config.account_id);
        }

        results.push({ accountId: config.account_id, status: 'sent', to: targetEmail, subject });
        
        // 随机间隔（30s-120s）
        await new Promise(r => setTimeout(r, 30000 + Math.random() * 90000));
      } catch (e) {
        this.db.prepare(`INSERT INTO email_warmup_log 
          (account_id, direction, to_addr, from_addr, subject, status, error)
          VALUES (?, 'outbound', ?, ?, 'warmup', 'failed', ?)`)
          .run(config.account_id, config.partner_email || config.email, config.email, e.message);
        results.push({ accountId: config.account_id, status: 'error', error: e.message });
      }
    }
    return results;
  }

  _calculateStage(startedAt) {
    if (!startedAt) return 'week1';
    const days = Math.floor((Date.now() - new Date(startedAt + 'Z').getTime()) / (1000 * 60 * 60 * 24));
    if (days < 7) return 'week1';
    if (days < 14) return 'week2';
    if (days < 21) return 'week3';
    if (days < 28) return 'week4';
    return 'week5plus';
  }

  _getTodaySentCount(accountId) {
    const row = this.db.prepare(
      "SELECT COUNT(*) as c FROM email_warmup_log WHERE account_id = ? AND direction = 'outbound' AND status = 'sent' AND date(created_at) = date('now')"
    ).get(accountId);
    return row?.c || 0;
  }

  /**
   * 获取预热统计
   */
  getStats(accountId, days = 14) {
    return this.db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as sent, 
             SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
      FROM email_warmup_log 
      WHERE account_id = ? AND direction = 'outbound' AND created_at > datetime('now', '-${days} days')
      GROUP BY date(created_at) ORDER BY day
    `).all(accountId);
  }
}

module.exports = { WarmupEngine };
