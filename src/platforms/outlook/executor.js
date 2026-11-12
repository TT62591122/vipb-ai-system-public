/**
 * OutlookExecutor - Outlook Web 平台执行器
 * 
 * 通过浏览器自动化操作 Outlook Web (outlook.live.com / outlook.office.com)
 * 模拟人工撰写和发送邮件，绕过 SMTP 限制。
 * 
 * 支持:
 *   batch_send_email — 批量发送邮件（多账号轮换、随机延迟、内容变体、附件）
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

// 内容变体同义词库，用于微调邮件内容避免完全相同
const SYNONYMS = {
  '您好': ['您好', 'Hi', '你好', '尊敬的'],
  '希望': ['希望', '期望', '期待', '盼望'],
  '合作': ['合作', '协作', '携手', '共事'],
  '联系': ['联系', '沟通', '交流', '对接'],
  '感谢': ['感谢', '谢谢', '多谢', '感恩'],
  '期待': ['期待', '盼望', '等候', '静候'],
};

class OutlookExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'outlook';
    this._ensureTable();
  }

  _ensureTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS outlook_send_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_email TEXT NOT NULL,
          recipient TEXT NOT NULL,
          subject TEXT,
          status TEXT DEFAULT 'pending',
          error_msg TEXT,
          sent_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e) { /* table exists */ }
  }

  async execute(context) {
    const { action } = context;
    const handlers = {
      batch_send_email: () => this._batchSendEmail(context),
    };
    const handler = handlers[action];
    if (!handler) throw new Error(`OutlookExecutor 不支持的 action: ${action}`);
    return await handler();
  }

  // ==================== 核心：批量发送邮件 ====================

  /**
   * context: {
   *   accounts: [{ id, email, password, type?: 'live'|'office' }],
   *   recipients: [{ email, name?, company?, vars?: {} }],
   *   template: { subject, body, attachments?: [filePath] },
   *   options?: {
   *     delayMinSec?: number,   // 最小间隔秒数 (default 60)
   *     delayMaxSec?: number,   // 最大间隔秒数 (default 180)
   *     maxPerAccount?: number, // 每账号最大发送数 (default 30)
   *     enableVariants?: bool,  // 启用内容变体 (default true)
   *   },
   *   onProgress?: fn
   * }
   */
  async _batchSendEmail(context) {
    const { accounts, recipients, template, options = {}, onProgress } = context;

    if (!accounts?.length) throw new Error('至少需要一个 Outlook 账号');
    if (!recipients?.length) throw new Error('收件人列表为空');
    if (!template?.subject || !template?.body) throw new Error('邮件模板缺少 subject 或 body');

    const delayMin = options.delayMinSec || 60;
    const delayMax = options.delayMaxSec || 180;
    const maxPerAccount = options.maxPerAccount || 30;
    const enableVariants = options.enableVariants !== false;

    // 分配收件人到账号（轮换）
    const accountQueues = accounts.map(a => ({ account: a, queue: [], sent: 0 }));
    recipients.forEach((r, i) => {
      accountQueues[i % accountQueues.length].queue.push(r);
    });

    const results = { total: recipients.length, sent: 0, failed: 0, errors: [] };

    for (const aq of accountQueues) {
      if (!aq.queue.length) continue;

      let instanceId = null;
      try {
        // 获取浏览器实例
        const inst = await this._acquireBrowser(aq.account.id || aq.account.email);
        instanceId = inst.instanceId;
        const { page } = inst;

        // 登录 Outlook Web
        await this._login(page, aq.account);

        // 逐个发送
        for (let i = 0; i < aq.queue.length && aq.sent < maxPerAccount; i++) {
          const recipient = aq.queue[i];
          try {
            const subject = this._applyTemplate(template.subject, recipient, enableVariants);
            const body = this._applyTemplate(template.body, recipient, enableVariants);

            await this._composeSend(page, {
              to: recipient.email,
              subject,
              body,
              attachments: template.attachments || [],
            });

            aq.sent++;
            results.sent++;
            this._logSend(aq.account.email, recipient.email, subject, 'sent');

            if (onProgress) {
              onProgress({ sent: results.sent, failed: results.failed, total: results.total, current: recipient.email });
            }

            // 随机延迟
            if (i < aq.queue.length - 1) {
              await this._randomDelay(delayMin, delayMax);
            }
          } catch (err) {
            results.failed++;
            results.errors.push({ email: recipient.email, error: err.message });
            this._logSend(aq.account.email, recipient.email, template.subject, 'failed', err.message);
            console.error(`❌ 发送到 ${recipient.email} 失败:`, err.message);
          }
        }
      } catch (err) {
        // 整个账号级别的错误（登录失败等）
        const remaining = aq.queue.length - aq.sent;
        results.failed += remaining;
        results.errors.push({ account: aq.account.email, error: err.message, affected: remaining });
        console.error(`❌ 账号 ${aq.account.email} 失败:`, err.message);
      } finally {
        if (instanceId) this._releaseBrowser(instanceId);
      }
    }

    return results;
  }

  // ==================== Outlook Web 操作 ====================

  async _login(page, account) {
    const baseUrl = account.type === 'office'
      ? 'https://outlook.office.com/mail/'
      : 'https://outlook.live.com/mail/';

    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._randomDelay(2, 4);

    // 检查是否已登录（cookies/session 保持）
    const currentUrl = page.url();
    if (currentUrl.includes('/mail/') && !currentUrl.includes('login')) {
      // 检查是否可以看到收件箱
      try {
        await page.waitForSelector('[aria-label="Mail"], [aria-label="邮件"], button[aria-label*="New"], button[aria-label*="新建"]', { timeout: 10000 });
        console.log(`✅ 账号 ${account.email} 已有会话，跳过登录`);
        return;
      } catch (e) { /* 需要重新登录 */ }
    }

    // Microsoft 登录流程
    console.log(`🔐 正在登录 ${account.email}...`);

    // 等待邮箱输入框
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await this._humanType(page, 'input[type="email"]', account.email);
    await this._randomDelay(0.5, 1);

    // 点击下一步
    await page.click('input[type="submit"], button[type="submit"]');
    await this._randomDelay(2, 4);

    // 等待密码输入框
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    await this._humanType(page, 'input[type="password"]', account.password);
    await this._randomDelay(0.5, 1);

    // 点击登录
    await page.click('input[type="submit"], button[type="submit"]');
    await this._randomDelay(3, 5);

    // 处理"保持登录"提示
    try {
      const staySignedIn = await page.$('input[type="submit"][value="Yes"], input[type="submit"][value="是"], #idSIButton9');
      if (staySignedIn) {
        await staySignedIn.click();
        await this._randomDelay(2, 4);
      }
    } catch (e) { /* 没有该提示 */ }

    // 等待邮箱主界面加载
    await page.waitForSelector(
      'button[aria-label*="New"], button[aria-label*="新建"], [aria-label="Mail"], [aria-label="邮件"]',
      { timeout: 30000 }
    );
    console.log(`✅ 账号 ${account.email} 登录成功`);
  }

  async _composeSend(page, { to, subject, body, attachments }) {
    // 点击"新建邮件"
    const newMailBtn = await page.$(
      'button[aria-label*="New mail"], button[aria-label*="New message"], button[aria-label*="新建邮件"], button[aria-label*="新邮件"], [data-icon-name="Compose"]'
    );
    if (!newMailBtn) {
      // 尝试用键盘快捷键
      await page.keyboard.hotkey('n');
      await this._randomDelay(1, 2);
    } else {
      await newMailBtn.click();
    }
    await this._randomDelay(1.5, 3);

    // 填写收件人
    const toField = await page.waitForSelector(
      'div[aria-label*="To"] input, input[aria-label*="To"], input[aria-label*="收件人"], div[aria-label*="收件人"] input',
      { timeout: 10000 }
    );
    await toField.click();
    await this._humanType(page, null, to, toField);
    await page.keyboard.press('Enter');
    await this._randomDelay(0.5, 1);

    // 填写主题
    const subjectField = await page.$(
      'input[aria-label*="subject"], input[aria-label*="Subject"], input[aria-label*="主题"], input[placeholder*="subject"], input[placeholder*="Subject"]'
    );
    if (subjectField) {
      await subjectField.click();
      await this._humanType(page, null, subject, subjectField);
      await this._randomDelay(0.3, 0.8);
    }

    // 填写正文
    const bodyField = await page.$(
      'div[aria-label*="Message body"], div[aria-label*="邮件正文"], div[role="textbox"][contenteditable="true"]'
    );
    if (bodyField) {
      await bodyField.click();
      await this._randomDelay(0.3, 0.8);
      // 正文可能有 HTML，使用 keyboard.type 逐字输入模拟人工
      await this._humanTypeMultiline(page, body);
    }

    // 附件
    if (attachments.length > 0) {
      await this._addAttachments(page, attachments);
    }

    await this._randomDelay(1, 2);

    // 点击发送
    const sendBtn = await page.$(
      'button[aria-label*="Send"], button[aria-label*="发送"], button[title*="Send"], button[title*="发送"]'
    );
    if (sendBtn) {
      await sendBtn.click();
    } else {
      // Ctrl+Enter 发送
      await page.keyboard.down('Control');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Control');
    }

    await this._randomDelay(2, 4);
    console.log(`📧 已发送邮件至 ${to}`);
  }

  async _addAttachments(page, attachments) {
    for (const filePath of attachments) {
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ 附件不存在: ${filePath}`);
        continue;
      }

      // 点击附件按钮
      const attachBtn = await page.$(
        'button[aria-label*="Attach"], button[aria-label*="附加"], button[aria-label*="附件"], [data-icon-name="Attach"]'
      );
      if (attachBtn) {
        await attachBtn.click();
        await this._randomDelay(0.5, 1);

        // 选择"从此计算机浏览"
        const browseBtn = await page.$(
          'button[aria-label*="Browse this computer"], button[aria-label*="浏览此计算机"], div[role="menuitem"]:has-text("Browse"), div[role="menuitem"]:has-text("浏览")'
        );
        if (browseBtn) await browseBtn.click();
      }

      // 等待 file input 并上传
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(filePath);
        await this._randomDelay(2, 5); // 等待上传完成
        console.log(`📎 已添加附件: ${path.basename(filePath)}`);
      }
    }
  }

  // ==================== 模板与变体 ====================

  _applyTemplate(template, recipient, enableVariants = true) {
    let result = template;

    // 变量替换
    const vars = { name: recipient.name || '', company: recipient.company || '', email: recipient.email, ...recipient.vars };
    for (const [key, val] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }

    // 内容变体：随机替换同义词
    if (enableVariants) {
      for (const [word, alternatives] of Object.entries(SYNONYMS)) {
        if (result.includes(word)) {
          const replacement = alternatives[Math.floor(Math.random() * alternatives.length)];
          // 只替换第一次出现，保持自然
          result = result.replace(word, replacement);
        }
      }

      // 随机添加/移除末尾标点变体
      if (Math.random() > 0.5 && result.endsWith('。')) {
        result = result.slice(0, -1);
      }

      // 随机在段落间加空行
      if (Math.random() > 0.7) {
        result = result.replace(/\n/g, '\n\n');
      }
    }

    return result;
  }

  // ==================== 工具方法 ====================

  _randomDelay(minSec, maxSec) {
    const ms = (Math.random() * (maxSec - minSec) + minSec) * 1000;
    return new Promise(r => setTimeout(r, ms));
  }

  async _humanType(page, selector, text, element = null) {
    const el = element || (selector ? await page.$(selector) : null);
    if (el && !element) await el.click();
    await this._randomDelay(0.2, 0.5);
    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 120) + 40 });
    }
  }

  async _humanTypeMultiline(page, text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const char of lines[i]) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100) + 30 });
      }
      if (i < lines.length - 1) {
        await page.keyboard.press('Enter');
        await this._randomDelay(0.2, 0.5);
      }
    }
  }

  async _humanMouseMove(page) {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 600) + 100;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  }

  // 为 mixin 提供 _humanScroll stub
  async _humanScroll(page) {
    await page.evaluate(() => window.scrollBy({ top: 200 + Math.random() * 300, behavior: 'smooth' }));
  }

  async _acquireBrowser(accountId) {
    return await this.browserPool.acquire(accountId);
  }

  _releaseBrowser(instanceId) {
    try { this.browserPool.release(instanceId); } catch (e) {}
  }

  _logSend(accountEmail, recipient, subject, status, errorMsg = null) {
    try {
      this.db.prepare(`
        INSERT INTO outlook_send_log (account_email, recipient, subject, status, error_msg)
        VALUES (?, ?, ?, ?, ?)
      `).run(accountEmail, recipient, subject, status, errorMsg);
    } catch (e) { /* ignore */ }
  }
}

// 注入拟人行为
const _OrigOutlook = OutlookExecutor;
function OutlookExecutorWrapped(db) {
  const inst = new _OrigOutlook(db);
  // 保存 Outlook 特殊的 _humanType（4参数版本），mixin不覆盖
  const specialHumanType = inst._humanType.bind(inst);
  applyHumanMixin(inst);
  // 恢复 Outlook 特殊版本（支持 element 参数）
  inst._humanType = specialHumanType;
  return inst;
}
OutlookExecutorWrapped.prototype = _OrigOutlook.prototype;

module.exports = OutlookExecutorWrapped;
