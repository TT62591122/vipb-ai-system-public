/**
 * 短信引擎核心类 - 负责eSIM号码管理与安全短信通知
 */
const registry = require('./provider-registry');

class SmsEngine {
  constructor(db) {
    this.db = db;
    this.registry = registry;
    this.MAX_SMS_PER_DAY = 20;
  }

  // 获取主人号码
  getMasterPhone() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='master_phone'").get();
    return row ? row.value : null;
  }

  // 设置主人号码
  setMasterPhone(phone) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('master_phone', ?, datetime('now'))").run(phone);
  }

  // 发送短信（核心安全方法）
  async sendSms(phoneId, content) {
    // 1. 获取主人号码
    const masterPhone = this.getMasterPhone();
    if (!masterPhone) throw new Error('未设置主人号码');

    // 2. 获取号码信息
    const phone = this.db.prepare('SELECT * FROM phone_numbers WHERE id=?').get(phoneId);
    if (!phone) throw new Error('号码不存在');
    if (!phone.sms_enabled) throw new Error('该号码未启用短信');

    // 3. 频率限制
    if (phone.sms_today >= this.MAX_SMS_PER_DAY) throw new Error('今日发送已达上限');

    // 4. 目标只能是主人号码（硬编码安全校验）
    const targetPhone = masterPhone;

    // 5. 获取供应商信息
    const provider = this.db.prepare('SELECT * FROM esim_providers WHERE id=?').get(phone.esim_provider_id);
    if (!provider) throw new Error('供应商不存在');

    // 6. 解密凭证
    const { decrypt } = require('../crypto-utils');
    let creds;
    try {
      const raw = phone.credentials;
      creds = JSON.parse(raw && raw.startsWith('ENC:') ? decrypt(raw.slice(4)) : raw || '{}');
    } catch(e) { 
      console.error('凭证解密失败:', e.message);
      throw new Error('凭证解密失败'); 
    }

    // 7. 调用adapter发送
    const adapter = this.registry.getAdapter(provider.code, creds);
    const result = await adapter.send(phone.number, targetPhone, content);

    // 8. 记录日志
    this.db.prepare('INSERT INTO sms_logs (phone_id,direction,from_number,to_number,content,status,provider_msg_id) VALUES (?,?,?,?,?,?,?)')
      .run(phoneId, 'out', phone.number, targetPhone, content, result.success ? 'sent' : 'failed', result.messageId || '');

    // 9. 更新计数
    this.db.prepare("UPDATE phone_numbers SET sms_today=sms_today+1, last_sms_at=datetime('now') WHERE id=?").run(phoneId);

    return result;
  }

  // 处理入站短信（webhook调用）
  handleIncoming(phoneId, fromNumber, content) {
    const masterPhone = this.getMasterPhone();

    // 安全：只处理主人号码或验证码格式
    const isFromMaster = fromNumber === masterPhone;
    const verificationCode = this._extractCode(content);

    if (!isFromMaster && !verificationCode) {
      // 静默丢弃
      this.db.prepare('INSERT INTO sms_logs (phone_id,direction,from_number,content,status) VALUES (?,?,?,?,?)')
        .run(phoneId, 'in', fromNumber, '[BLOCKED]', 'blocked');
      return { handled: false, reason: 'blocked' };
    }

    // 记录
    this.db.prepare('INSERT INTO sms_logs (phone_id,direction,from_number,content,status) VALUES (?,?,?,?,?)')
      .run(phoneId, 'in', fromNumber, content, 'received');

    if (verificationCode) {
      return { handled: true, type: 'verification_code', code: verificationCode, from: fromNumber };
    }
    return { handled: true, type: 'master_message', content, from: fromNumber };
  }

  // 等待验证码（供executor调用）
  async waitForCode(phoneId, options = {}) {
    const { timeout = 120000, retryInterval = 3000, platform } = options;
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const log = this.db.prepare(
        "SELECT * FROM sms_logs WHERE phone_id=? AND direction='in' AND status='received' AND created_at > datetime('now', '-3 minutes') ORDER BY id DESC LIMIT 1"
      ).get(phoneId);
      if (log) {
        const code = this._extractCode(log.content);
        if (code) return code;
      }
      await new Promise(r => setTimeout(r, retryInterval));
    }
    throw new Error(`等待验证码超时 (${timeout/1000}秒)`);
  }

  // 提取验证码
  _extractCode(text) {
    if (!text) return null;
    const patterns = [
      /(\d{4,8})\s*(is your|est votre|是您的)/i,
      /code[:\s]+(\d{4,8})/i,
      /验证码[：:\s]*(\d{4,8})/,
      /G-(\d{4,8})/,
      /\b(\d{6})\b/
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // 每日重置计数（由定时器调用）
  resetDailyCount() {
    this.db.prepare("UPDATE phone_numbers SET sms_today=0 WHERE sms_today>0").run();
    console.log('📱 eSIM短信每日计数已重置');
  }

  // 验证供应商凭证
  async validateProviderCredentials(providerCode, credentials) {
    try {
      const adapter = this.registry.getAdapter(providerCode, credentials);
      const result = await adapter.validateCredentials();
      return {
        valid: result.valid || false,
        data: result
      };
    } catch (error) {
      console.error(`供应商凭证验证失败 (${providerCode}):`, error.message);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // 批量导入eSIM号码
  async batchImportEsimNumbers(phoneData) {
    const { encrypt } = require('../crypto-utils');
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const data of phoneData) {
      try {
        // 查找供应商ID
        const provider = this.db.prepare('SELECT id FROM esim_providers WHERE code = ?').get(data.provider_code);
        if (!provider) {
          throw new Error(`供应商不存在: ${data.provider_code}`);
        }

        // 加密凭证
        const encryptedCreds = 'ENC:' + encrypt(JSON.stringify(data.credentials || {}));

        this.db.prepare(`
          INSERT INTO phone_numbers (number, country, platform, provider, type, esim_provider_id, credentials, sms_enabled, notes)
          VALUES (?, ?, ?, ?, 'esim', ?, ?, ?, ?)
        `).run(
          data.number,
          data.country,
          'esim',
          data.provider_name || data.provider_code,
          provider.id,
          encryptedCreds,
          data.sms_enabled || 0,
          data.notes || ''
        );

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          number: data.number,
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = SmsEngine;