/**
 * eSIM号码管理API路由
 */
const express = require('express');
const router = express.Router();
const { encrypt, decrypt } = require('../src/crypto-utils');

/**
 * 号码格式标准化（E.164）
 * 去除空格、横线、括号，保留+和数字
 * @param {string} number 原始号码
 * @returns {string} 标准化后的号码
 */
function normalizePhoneNumber(number) {
  if (!number) return '';
  // 去除空格、横线、括号、点
  let cleaned = number.replace(/[\s\-\(\)\.]/g, '');
  // 确保以+开头
  if (!cleaned.startsWith('+') && /^\d/.test(cleaned)) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

/**
 * 校验号码格式（E.164: +国家码+号码，总长度5-20）
 * @param {string} number 标准化后的号码
 * @returns {string|null} 错误信息，null表示合法
 */
function validatePhoneNumber(number) {
  if (!number) return '号码不能为空';
  if (!/^\+\d{4,19}$/.test(number)) return '号码格式不合法，应为E.164格式（如+8613800138000）';
  if (number.length > 20) return '号码过长（最多20位）';
  return null;
}

// GET /api/esim/providers - 获取所有供应商列表
router.get('/providers', (req, res) => {
  try {
    const db = req.app.locals.db;
    const providers = db.prepare('SELECT * FROM esim_providers ORDER BY name').all();
    res.json({ success: true, providers });
  } catch (error) {
    console.error('获取供应商列表失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/providers - 添加自定义供应商
router.post('/providers', (req, res) => {
  try {
    const { name, code, countries, config_fields, website } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, error: '供应商名称和代码必填' });
    }

    const db = req.app.locals.db;
    const result = db.prepare(`
      INSERT INTO esim_providers (name, code, countries, config_fields, website, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(name, code, JSON.stringify(countries || []), JSON.stringify(config_fields || []), website || '');

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('添加供应商失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/esim/providers/:id - 更新供应商
router.put('/providers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, countries, config_fields, website, status } = req.body;

    const db = req.app.locals.db;
    const result = db.prepare(`
      UPDATE esim_providers 
      SET name = COALESCE(?, name),
          countries = COALESCE(?, countries),
          config_fields = COALESCE(?, config_fields),
          website = COALESCE(?, website),
          status = COALESCE(?, status)
      WHERE id = ?
    `).run(
      name,
      countries ? JSON.stringify(countries) : undefined,
      config_fields ? JSON.stringify(config_fields) : undefined,
      website,
      status,
      id
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('更新供应商失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/esim/providers/:id - 删除供应商
router.delete('/providers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = req.app.locals.db;

    // 检查是否有号码使用此供应商
    const usage = db.prepare('SELECT COUNT(*) as count FROM phone_numbers WHERE esim_provider_id = ?').get(id);
    if (usage.count > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `有${usage.count}个号码使用此供应商，请先删除或转移这些号码` 
      });
    }

    const result = db.prepare('DELETE FROM esim_providers WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('删除供应商失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/esim/phones - 获取所有eSIM号码（JOIN esim_providers）
router.get('/phones', (req, res) => {
  try {
    const db = req.app.locals.db;
    const phones = db.prepare(`
      SELECT pn.*, ep.name as provider_name, ep.code as provider_code, ep.countries
      FROM phone_numbers pn
      LEFT JOIN esim_providers ep ON pn.esim_provider_id = ep.id
      WHERE pn.type = 'esim' OR pn.esim_provider_id IS NOT NULL
      ORDER BY pn.id DESC
    `).all();

    res.json({ success: true, phones });
  } catch (error) {
    console.error('获取eSIM号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/phones - 添加eSIM号码（凭证加密存储）
router.post('/phones', (req, res) => {
  try {
    const { number: rawNumber, country, provider_id, credentials, sms_enabled, notes } = req.body;
    if (!rawNumber || !provider_id) {
      return res.status(400).json({ success: false, error: '号码和供应商必填' });
    }

    // 号码标准化 & 校验
    const number = normalizePhoneNumber(rawNumber);
    const numErr = validatePhoneNumber(number);
    if (numErr) return res.status(400).json({ success: false, error: numErr });

    // 检查重复
    const db = req.app.locals.db;
    const existing = db.prepare("SELECT id FROM phone_numbers WHERE number = ?").get(number);
    if (existing) return res.status(409).json({ success: false, error: `号码${number}已存在` });

    // 加密凭证
    const encryptedCreds = 'ENC:' + encrypt(JSON.stringify(credentials || {}));

    const result = db.prepare(`
      INSERT INTO phone_numbers (number, country, platform, provider, type, esim_provider_id, credentials, sms_enabled, notes)
      VALUES (?, ?, 'esim', 'esim', 'esim', ?, ?, ?, ?)
    `).run(number, country, provider_id, encryptedCreds, sms_enabled ? 1 : 0, notes || '');

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('添加eSIM号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/phones/batch-import - 批量导入eSIM号码
router.post('/phones/batch-import', (req, res) => {
  try {
    const { phones } = req.body;
    if (!Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ success: false, error: '请提供号码数组' });
    }

    // 限制一次最多导入100个号码
    if (phones.length > 100) {
      return res.status(400).json({ success: false, error: '一次最多导入100个号码' });
    }

    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    const results = smsEngine.batchImportEsimNumbers(phones);
    res.json({ success: true, results });
  } catch (error) {
    console.error('批量导入号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/esim/phones/:id - 更新eSIM号码
router.put('/phones/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { number, country, provider_id, credentials, sms_enabled, notes } = req.body;

    const db = req.app.locals.db;
    
    let encryptedCreds;
    if (credentials) {
      encryptedCreds = 'ENC:' + encrypt(JSON.stringify(credentials));
    }

    const result = db.prepare(`
      UPDATE phone_numbers 
      SET number = COALESCE(?, number),
          country = COALESCE(?, country),
          esim_provider_id = COALESCE(?, esim_provider_id),
          credentials = COALESCE(?, credentials),
          sms_enabled = COALESCE(?, sms_enabled),
          notes = COALESCE(?, notes),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      number,
      country,
      provider_id,
      encryptedCreds,
      sms_enabled,
      notes,
      id
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '号码不存在' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('更新eSIM号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/esim/phones/:id - 删除eSIM号码
router.delete('/phones/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = req.app.locals.db;

    const result = db.prepare('DELETE FROM phone_numbers WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '号码不存在' });
    }

    // 同时删除相关日志
    db.prepare('DELETE FROM sms_logs WHERE phone_id = ?').run(id);

    res.json({ success: true });
  } catch (error) {
    console.error('删除eSIM号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/phones/:id/test - 测试发送短信
router.post('/phones/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: '短信内容不能为空' });
    }

    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    const result = await smsEngine.sendSms(id, content);
    res.json(result);
  } catch (error) {
    console.error('测试发送短信失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/phones/:id/validate - 验证供应商凭证
router.post('/phones/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;
    const db = req.app.locals.db;
    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    let providerCode, creds;

    if (id === '0' && req.body.provider_id && req.body.credentials) {
      // 添加前验证：直接用请求体中的供应商和凭证
      const provider = db.prepare('SELECT * FROM esim_providers WHERE id = ?').get(req.body.provider_id);
      if (!provider) return res.status(404).json({ success: false, error: '供应商不存在' });
      providerCode = provider.code;
      creds = req.body.credentials;
    } else {
      // 已有号码验证：从数据库读取
      const phone = db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(id);
      if (!phone) return res.status(404).json({ success: false, error: '号码不存在' });
      if (!phone.esim_provider_id) return res.status(400).json({ success: false, error: '该号码未关联供应商' });

      const provider = db.prepare('SELECT * FROM esim_providers WHERE id = ?').get(phone.esim_provider_id);
      if (!provider) return res.status(404).json({ success: false, error: '供应商不存在' });
      providerCode = provider.code;

      try {
        const raw = phone.credentials;
        creds = JSON.parse(raw && raw.startsWith('ENC:') ? decrypt(raw.slice(4)) : raw || '{}');
      } catch(e) {
        return res.status(400).json({ success: false, error: '凭证解密失败' });
      }
    }

    const result = await smsEngine.validateProviderCredentials(providerCode, creds);
    res.json(result);
  } catch (error) {
    console.error('验证凭证失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/esim/master-phone - 获取主人号码
router.get('/master-phone', (req, res) => {
  try {
    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    const masterPhone = smsEngine.getMasterPhone();
    res.json({ success: true, masterPhone });
  } catch (error) {
    console.error('获取主人号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/esim/master-phone - 设置主人号码
router.put('/master-phone', (req, res) => {
  try {
    const { phone: rawPhone } = req.body;
    if (!rawPhone) {
      return res.status(400).json({ success: false, error: '主人号码不能为空' });
    }

    // 号码标准化 & 校验
    const phone = normalizePhoneNumber(rawPhone);
    const numErr = validatePhoneNumber(phone);
    if (numErr) return res.status(400).json({ success: false, error: numErr });

    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    smsEngine.setMasterPhone(phone);
    res.json({ success: true });
  } catch (error) {
    console.error('设置主人号码失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/esim/logs - 获取短信日志（支持分页和筛选）
router.get('/logs', (req, res) => {
  try {
    const { phone_id, direction, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const db = req.app.locals.db;
    
    let whereClause = 'WHERE 1=1';
    let params = [];

    if (phone_id) {
      whereClause += ' AND phone_id = ?';
      params.push(phone_id);
    }

    if (direction) {
      whereClause += ' AND direction = ?';
      params.push(direction);
    }

    const logs = db.prepare(`
      SELECT sl.*, pn.number as phone_number
      FROM sms_logs sl
      LEFT JOIN phone_numbers pn ON sl.phone_id = pn.id
      ${whereClause}
      ORDER BY sl.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`SELECT COUNT(*) as count FROM sms_logs ${whereClause}`).get(...params).count;

    res.json({ success: true, logs, total, page, limit });
  } catch (error) {
    console.error('获取短信日志失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/incoming/:phoneId - 入站短信webhook
router.post('/incoming/:phoneId', (req, res) => {
  try {
    const { phoneId } = req.params;
    const { from, content } = req.body;

    if (!from || !content) {
      return res.status(400).json({ success: false, error: '发件人和内容必填' });
    }

    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    const result = smsEngine.handleIncoming(phoneId, from, content);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('处理入站短信失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/send - 发送短信（指定phoneId和content）
router.post('/send', async (req, res) => {
  try {
    const { phone_id, content } = req.body;

    if (!phone_id || !content) {
      return res.status(400).json({ success: false, error: '手机ID和内容必填' });
    }

    const smsEngine = req.app.locals.smsEngine;
    if (!smsEngine) {
      return res.status(500).json({ success: false, error: '短信引擎未初始化' });
    }

    const result = await smsEngine.sendSms(phone_id, content);
    res.json(result);
  } catch (error) {
    console.error('发送短信失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/esim/phones/parse-qr - 解析二维码图片
// POST /api/esim/phones/parse-qr - 解析前端传来的LPA字符串
// 前端用jsQR解码二维码图片得到LPA字符串，发到这里解析结构化数据
router.post('/phones/parse-qr', express.json(), (req, res) => {
  try {
    const { lpaString } = req.body;
    
    if (!lpaString) {
      return res.status(400).json({ success: false, error: 'LPA字符串不能为空' });
    }

    // 解析LPA格式: LPA:1$<SM-DP+ address>$<activation code>
    const lpaPattern = /^LPA:1\$([^\$]+)\$([^\$]+)$/;
    const match = lpaString.match(lpaPattern);
    
    if (!match) {
      return res.status(400).json({ 
        success: false, 
        error: '无效的LPA格式，应为: LPA:1$<服务器地址>$<激活码>' 
      });
    }

    const activationServer = match[1];
    const activationCode = match[2];

    // 根据SM-DP+地址尝试推断供应商
    const db = req.app.locals.db;
    const providers = db.prepare("SELECT id, name, code FROM esim_providers WHERE status = 'active'").all();
    
    let matchedProvider = null;
    const serverLower = activationServer.toLowerCase();
    for (const p of providers) {
      if (serverLower.includes(p.code)) {
        matchedProvider = p;
        break;
      }
    }

    res.json({
      success: true,
      data: {
        lpa: lpaString,
        activation_server: activationServer,
        activation_code: activationCode,
        suggested_provider: matchedProvider ? { id: matchedProvider.id, name: matchedProvider.name, code: matchedProvider.code } : null
      }
    });
  } catch (error) {
    console.error('解析LPA失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;