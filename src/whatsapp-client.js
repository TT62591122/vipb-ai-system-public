/**
 * WhatsApp Web 客户端管理器
 * Phase 1: 基于 whatsapp-web.js 实现零成本 WhatsApp 自动化
 */
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class WhatsAppManager extends EventEmitter {
  constructor(db, io) {
    super();
    this.db = db;
    this.io = io;
    this.client = null;
    this.status = 'disconnected'; // disconnected | qr_pending | authenticated | ready | error
    this.qrCode = null;
    this.qrDataUrl = null;
    this.info = null; // 连接后的账号信息
    this.messageHandlers = [];
    this._initTables();
  }

  /** 初始化 WhatsApp 相关数据库表 */
  _initTables() {
    this.db.exec(`
      -- WhatsApp 对话表
      CREATE TABLE IF NOT EXISTS wa_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT UNIQUE,
        customer_id INTEGER,
        contact_name TEXT,
        contact_phone TEXT,
        contact_avatar TEXT,
        unread_count INTEGER DEFAULT 0,
        last_message TEXT,
        last_message_at DATETIME,
        labels TEXT DEFAULT '[]',
        is_pinned INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        assigned_to TEXT,
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- WhatsApp 消息表(增强版)
      CREATE TABLE IF NOT EXISTS wa_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        msg_id TEXT UNIQUE,
        chat_id TEXT,
        direction TEXT DEFAULT 'inbound',
        sender_name TEXT,
        sender_phone TEXT,
        content TEXT,
        media_type TEXT,
        media_url TEXT,
        media_filename TEXT,
        msg_type TEXT DEFAULT 'text',
        is_forwarded INTEGER DEFAULT 0,
        quoted_msg_id TEXT,
        status TEXT DEFAULT 'sent',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- WhatsApp 快捷回复模板
      CREATE TABLE IF NOT EXISTS wa_quick_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shortcut TEXT UNIQUE,
        title TEXT,
        content TEXT,
        category TEXT DEFAULT 'general',
        media_path TEXT,
        use_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- WhatsApp 广播列表
      CREATE TABLE IF NOT EXISTS wa_broadcast_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        contacts TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- WhatsApp 广播记录
      CREATE TABLE IF NOT EXISTS wa_broadcast_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        broadcast_id INTEGER,
        template_content TEXT,
        total_contacts INTEGER DEFAULT 0,
        sent INTEGER DEFAULT 0,
        delivered INTEGER DEFAULT 0,
        read_count INTEGER DEFAULT 0,
        replied INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- WhatsApp 自动回复规则
      CREATE TABLE IF NOT EXISTS wa_auto_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        trigger_type TEXT DEFAULT 'keyword',
        trigger_value TEXT,
        reply_content TEXT,
        reply_media TEXT,
        is_ai INTEGER DEFAULT 0,
        ai_agent TEXT,
        conditions TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        match_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_wa_conv_customer ON wa_conversations(customer_id);
      CREATE INDEX IF NOT EXISTS idx_wa_conv_phone ON wa_conversations(contact_phone);
      CREATE INDEX IF NOT EXISTS idx_wa_conv_updated ON wa_conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_chat ON wa_messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_created ON wa_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_wa_msg_direction ON wa_messages(direction);
    `);
  }

  /** 初始化并启动 WhatsApp 客户端 */
  async initialize() {
    if (this.client) {
      await this.destroy();
    }

    this.status = 'disconnected';
    this._emit('status', { status: this.status });

    const authPath = path.join(__dirname, '..', 'data', 'whatsapp-auth');
    if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process'
        ]
      }
    });

    // QR Code 事件
    this.client.on('qr', async (qr) => {
      this.status = 'qr_pending';
      this.qrCode = qr;
      try {
        this.qrDataUrl = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
      } catch (e) {
        this.qrDataUrl = null;
      }
      this._emit('qr', { qr: this.qrDataUrl });
      this._emit('status', { status: this.status });
      console.log('[WhatsApp] 📱 请扫描二维码连接');
    });

    // 认证成功
    this.client.on('authenticated', () => {
      this.status = 'authenticated';
      this.qrCode = null;
      this.qrDataUrl = null;
      this._emit('status', { status: this.status });
      console.log('[WhatsApp] ✅ 认证成功');
    });

    // 认证失败
    this.client.on('auth_failure', (msg) => {
      this.status = 'error';
      this._emit('status', { status: this.status, error: msg });
      console.error('[WhatsApp] ❌ 认证失败:', msg);
    });

    // 客户端就绪
    this.client.on('ready', async () => {
      this.status = 'ready';
      this.info = this.client.info;
      this._emit('status', { status: this.status, info: this._safeInfo() });
      console.log('[WhatsApp] 🟢 已连接:', this.info?.pushname || 'Unknown');

      // 同步最近对话
      try {
        await this._syncChats();
      } catch (e) {
        console.error('[WhatsApp] 同步对话失败:', e.message);
      }
    });

    // 断开连接
    this.client.on('disconnected', (reason) => {
      this.status = 'disconnected';
      this.info = null;
      this._emit('status', { status: this.status, reason });
      console.log('[WhatsApp] 🔴 已断开:', reason);
    });

    // 收到消息
    this.client.on('message', async (msg) => {
      await this._handleIncomingMessage(msg);
    });

    // 消息已发送确认
    this.client.on('message_ack', (msg, ack) => {
      // ack: 0=pending, 1=sent, 2=delivered, 3=read, 4=played
      const statusMap = { 0: 'pending', 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' };
      try {
        this.db.prepare('UPDATE wa_messages SET status=? WHERE msg_id=?')
          .run(statusMap[ack] || 'sent', msg.id._serialized);
      } catch (e) { /* ignore */ }
    });

    try {
      await this.client.initialize();
    } catch (err) {
      this.status = 'error';
      this._emit('status', { status: this.status, error: err.message });
      console.error('[WhatsApp] 初始化失败:', err.message);
    }
  }

  /** 断开并销毁客户端 */
  async destroy() {
    try {
      if (this.client) {
        await this.client.destroy();
        this.client = null;
      }
    } catch (e) { /* ignore */ }
    this.status = 'disconnected';
    this.info = null;
    this.qrCode = null;
    this.qrDataUrl = null;
  }

  /** 设置号码检测器（由 server.js 注入） */
  setNumberChecker(checker) {
    this.numberChecker = checker;
  }

  /** 发送文本消息（支持发前号码检测） */
  async sendMessage(chatId, content, opts = {}) {
    if (this.status !== 'ready') throw new Error('WhatsApp 未连接');
    // 发前拦截：检测号码有效性
    if (this.numberChecker && opts.checkNumber !== false) {
      const isValid = await this.numberChecker.preSendCheck(chatId);
      if (!isValid) {
        console.log(`⛔ 发送拦截: ${chatId} 非有效WhatsApp号码`);
        throw new Error(`号码 ${chatId} 不是有效的WhatsApp账号，已拦截发送`);
      }
    }
    const msg = await this.client.sendMessage(chatId, content);
    this._saveMessage(msg, 'outbound');
    this._updateConversation(chatId, content);
    return msg;
  }

  /** 发送媒体消息 */
  async sendMedia(chatId, filePath, caption) {
    if (this.status !== 'ready') throw new Error('WhatsApp 未连接');
    const media = MessageMedia.fromFilePath(filePath);
    const msg = await this.client.sendMessage(chatId, media, { caption });
    this._saveMessage(msg, 'outbound', caption);
    this._updateConversation(chatId, caption || '[媒体文件]');
    return msg;
  }

  /** 发送媒体 (从URL) */
  async sendMediaFromUrl(chatId, url, caption) {
    if (this.status !== 'ready') throw new Error('WhatsApp 未连接');
    const media = await MessageMedia.fromUrl(url);
    const msg = await this.client.sendMessage(chatId, media, { caption });
    this._saveMessage(msg, 'outbound', caption);
    this._updateConversation(chatId, caption || '[媒体文件]');
    return msg;
  }

  /** 发送产品卡片（文本格式模拟） */
  async sendProductCard(chatId, product) {
    const card = [
      `📦 *${product.name}*`,
      `型号: ${product.model || 'N/A'}`,
      `类别: ${product.category || 'N/A'}`,
      '',
      product.description || '',
      '',
      `💰 价格:`,
      product.price_100 ? `  • 100+: $${product.price_100}/台` : '',
      product.price_500 ? `  • 500+: $${product.price_500}/台` : '',
      product.price_1000 ? `  • 1000+: $${product.price_1000}/台` : '',
      product.moq ? `📋 MOQ: ${product.moq}` : '',
      product.certifications ? `🏅 认证: ${JSON.parse(product.certifications || '[]').join(', ')}` : '',
      '',
      `💬 有兴趣请直接回复，我们会尽快为您报价！`
    ].filter(Boolean).join('\n');

    return this.sendMessage(chatId, card);
  }

  /**
   * 检测号码是否注册了WhatsApp
   * @param {string} number - 号码（如 8613800138000）
   * @returns {{ exists: boolean, chatId?: string }}
   */
  async checkNumber(number) {
    if (this.status !== 'ready') throw new Error('WhatsApp 未连接');
    // Normalize: ensure @c.us suffix
    const numId = number.includes('@') ? number : `${number.replace(/[^0-9]/g, '')}@c.us`;
    try {
      const result = await this.client.isRegisteredUser(numId);
      return { exists: result, chatId: result ? numId : null };
    } catch (e) {
      console.error(`[WA] 号码检测失败 ${number}:`, e.message);
      return { exists: false, error: e.message };
    }
  }

  /**
   * 批量检测号码有效性
   * @param {string[]} numbers
   * @returns {{ valid: string[], invalid: string[], errors: string[] }}
   */
  async checkNumbers(numbers) {
    if (this.status !== 'ready') throw new Error('WhatsApp 未连接');
    const valid = [], invalid = [], errors = [];
    for (const num of numbers) {
      try {
        const result = await this.checkNumber(num);
        if (result.exists) {
          valid.push(num);
        } else {
          invalid.push(num);
        }
        // Anti-ban: small delay between checks
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (e) {
        errors.push(num);
      }
    }
    console.log(`📱 号码检测完成: ${valid.length}有效, ${invalid.length}无效, ${errors.length}错误`);
    return { valid, invalid, errors };
  }

  /** 群发广播 */
  async broadcast(broadcastId, contacts, content, delayMs = 3000) {
    const log = this.db.prepare('SELECT * FROM wa_broadcast_logs WHERE id=?').get(broadcastId);
    if (!log) throw new Error('广播记录不存在');

    this.db.prepare("UPDATE wa_broadcast_logs SET status='sending', started_at=datetime('now') WHERE id=?")
      .run(broadcastId);

    let sent = 0, failed = 0, skipped = 0;

    // 广播前批量预检号码有效性
    if (this.numberChecker) {
      console.log(`📱 广播前预检 ${contacts.length} 个号码...`);
    }

    for (const contact of contacts) {
      try {
        const chatId = contact.includes('@') ? contact : `${contact.replace(/[^0-9]/g, '')}@c.us`;

        // 广播时跳过无效号码（不抛错）
        if (this.numberChecker) {
          const isValid = await this.numberChecker.preSendCheck(chatId);
          if (!isValid) {
            skipped++;
            console.log(`⏭️ 广播跳过无效号码: ${contact}`);
            continue;
          }
        }

        await this.sendMessage(chatId, content, { checkNumber: false }); // 已检查过，不重复检查
        sent++;
        this.db.prepare('UPDATE wa_broadcast_logs SET sent=? WHERE id=?').run(sent, broadcastId);

        // 随机延迟，避免封号
        const delay = delayMs + Math.random() * 2000;
        await new Promise(r => setTimeout(r, delay));
      } catch (e) {
        failed++;
        this.db.prepare('UPDATE wa_broadcast_logs SET failed=? WHERE id=?').run(failed, broadcastId);
        console.error(`[WhatsApp] 广播发送失败 (${contact}):`, e.message);
      }
    }

    this.db.prepare("UPDATE wa_broadcast_logs SET status='completed', completed_at=datetime('now') WHERE id=?")
      .run(broadcastId);

    if (skipped > 0) console.log(`📊 广播完成: ${sent}发送 / ${skipped}跳过(无效号码) / ${failed}失败`);
    return { sent, failed, skipped, total: contacts.length };
  }

  /** 获取所有对话 */
  getConversations(filters = {}) {
    let where = '1=1';
    const params = [];

    if (filters.search) {
      where += ' AND (contact_name LIKE ? OR contact_phone LIKE ? OR last_message LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }
    if (filters.label) {
      where += " AND labels LIKE ?";
      params.push(`%${filters.label}%`);
    }
    if (filters.assigned_to) {
      where += ' AND assigned_to=?';
      params.push(filters.assigned_to);
    }
    if (filters.is_archived !== undefined) {
      where += ' AND is_archived=?';
      params.push(filters.is_archived ? 1 : 0);
    } else {
      where += ' AND is_archived=0';
    }

    const orderBy = filters.is_pinned ? 'is_pinned DESC, updated_at DESC' : 'updated_at DESC';
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    return this.db.prepare(`SELECT * FROM wa_conversations WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
  }

  /** 获取对话消息 */
  getMessages(chatId, limit = 50, offset = 0) {
    return this.db.prepare('SELECT * FROM wa_messages WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(chatId, limit, offset);
  }

  /** 获取状态信息 */
  getStatus() {
    return {
      status: this.status,
      qr: this.qrDataUrl,
      info: this._safeInfo(),
      stats: this._getStats()
    };
  }

  /** 处理收到的消息 */
  async _handleIncomingMessage(msg) {
    try {
      // 跳过群组消息和状态更新
      if (msg.from === 'status@broadcast') return;

      const chat = await msg.getChat();
      const contact = await msg.getContact();

      // 保存消息
      this._saveMessage(msg, 'inbound');

      // 更新对话
      const convData = {
        chat_id: msg.from,
        contact_name: contact.pushname || contact.name || contact.number,
        contact_phone: contact.number,
        last_message: msg.body || `[${msg.type}]`,
        unread_count: chat.unreadCount || 1
      };

      const existing = this.db.prepare('SELECT id FROM wa_conversations WHERE chat_id=?').get(msg.from);
      if (existing) {
        this.db.prepare(`UPDATE wa_conversations SET 
          contact_name=COALESCE(?,contact_name), last_message=?, 
          unread_count=unread_count+1, last_message_at=datetime('now'), updated_at=datetime('now')
          WHERE chat_id=?`)
          .run(convData.contact_name, convData.last_message, msg.from);
      } else {
        this.db.prepare(`INSERT INTO wa_conversations (chat_id,contact_name,contact_phone,last_message,last_message_at,unread_count)
          VALUES (?,?,?,?,datetime('now'),1)`)
          .run(msg.from, convData.contact_name, convData.contact_phone, convData.last_message);
      }

      // 自动关联 CRM 客户
      this._linkCustomer(msg.from, convData.contact_phone, convData.contact_name);

      // 自动回复检查
      await this._checkAutoReply(msg);

      // Socket 通知前端
      this._emit('message', {
        chat_id: msg.from,
        direction: 'inbound',
        contact_name: convData.contact_name,
        content: msg.body,
        type: msg.type,
        timestamp: msg.timestamp
      });

    } catch (e) {
      console.error('[WhatsApp] 消息处理错误:', e.message);
    }
  }

  /** 自动回复检查 */
  async _checkAutoReply(msg) {
    const rules = this.db.prepare('SELECT * FROM wa_auto_replies WHERE is_active=1').all();
    const body = (msg.body || '').toLowerCase();

    for (const rule of rules) {
      let matched = false;

      switch (rule.trigger_type) {
        case 'keyword':
          const keywords = rule.trigger_value.split(',').map(k => k.trim().toLowerCase());
          matched = keywords.some(k => body.includes(k));
          break;
        case 'regex':
          try { matched = new RegExp(rule.trigger_value, 'i').test(body); } catch (e) { }
          break;
        case 'first_message':
          const existing = this.db.prepare('SELECT COUNT(*) as c FROM wa_messages WHERE chat_id=? AND direction=?')
            .get(msg.from, 'inbound');
          matched = (existing.c <= 1);
          break;
        case 'off_hours':
          const hour = new Date().getHours();
          matched = (hour < 8 || hour >= 22);
          break;
        case 'all':
          matched = true;
          break;
      }

      if (matched) {
        this.db.prepare('UPDATE wa_auto_replies SET match_count=match_count+1 WHERE id=?').run(rule.id);

        if (rule.is_ai && rule.ai_agent) {
          // AI 自动回复 — 调用 AI Brain
          await this._aiAutoReply(msg, rule.ai_agent);
        } else {
          // 固定模板回复
          let replyContent = rule.reply_content;
          // 变量替换
          const contact = await msg.getContact();
          replyContent = replyContent
            .replace(/\{name\}/g, contact.pushname || contact.name || 'Customer')
            .replace(/\{phone\}/g, contact.number || '')
            .replace(/\{time\}/g, new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Shanghai' }));

          await this.sendMessage(msg.from, replyContent);
        }
        break; // 只匹配第一条规则
      }
    }
  }

  /** AI 自动回复 */
  async _aiAutoReply(msg, agentType) {
    try {
      const AiBrain = require('./ai-brain');
      const aiBrain = new AiBrain(this.db);

      const contact = await msg.getContact();
      const customerName = contact.pushname || contact.name || 'Customer';

      // 获取最近对话上下文
      const recentMsgs = this.db.prepare(
        'SELECT direction, content FROM wa_messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 10'
      ).all(msg.from).reverse();

      const context = recentMsgs.map(m =>
        `${m.direction === 'inbound' ? 'Customer' : 'Sales'}: ${m.content}`
      ).join('\n');

      const prompt = `You are a professional B2B sales assistant for a smart meter and circuit breaker manufacturer.
Customer name: ${customerName}
Recent conversation:
${context}

Latest message from customer: ${msg.body}

Respond professionally in the same language as the customer. Be helpful, concise, and guide them toward a purchase inquiry.
If they ask about products, mention our smart meters (prepaid/postpaid, single/three phase) and circuit breakers (MCB/MCCB/RCCB).
If they ask for pricing, collect: product type, quantity, destination country, then say you'll prepare a quotation.`;

      const result = await aiBrain.chat(prompt, 'sales');
      if (result && result.content) {
        // 延迟1-3秒模拟真人
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        await this.sendMessage(msg.from, result.content);
      }
    } catch (e) {
      console.error('[WhatsApp] AI自动回复失败:', e.message);
    }
  }

  /** 同步最近对话 */
  async _syncChats() {
    const chats = await this.client.getChats();
    let synced = 0;

    for (const chat of chats.slice(0, 100)) {
      if (chat.isGroup) continue; // 暂时跳过群组

      try {
        const contact = await chat.getContact();
        const existing = this.db.prepare('SELECT id FROM wa_conversations WHERE chat_id=?').get(chat.id._serialized);

        if (!existing) {
          this.db.prepare(`INSERT OR IGNORE INTO wa_conversations 
            (chat_id, contact_name, contact_phone, unread_count, last_message, last_message_at)
            VALUES (?,?,?,?,?,datetime('now'))`)
            .run(
              chat.id._serialized,
              contact.pushname || contact.name || contact.number,
              contact.number,
              chat.unreadCount || 0,
              chat.lastMessage?.body || '',
            );
          synced++;
        } else {
          this.db.prepare(`UPDATE wa_conversations SET 
            contact_name=COALESCE(?,contact_name),
            unread_count=?,
            last_message=COALESCE(?,last_message),
            updated_at=datetime('now')
            WHERE chat_id=?`)
            .run(
              contact.pushname || contact.name || null,
              chat.unreadCount || 0,
              chat.lastMessage?.body || null,
              chat.id._serialized
            );
        }
      } catch (e) { /* skip */ }
    }

    console.log(`[WhatsApp] 同步了 ${synced} 个新对话`);
  }

  /** 自动关联 CRM 客户 */
  _linkCustomer(chatId, phone, name) {
    if (!phone) return;
    try {
      const conv = this.db.prepare('SELECT customer_id FROM wa_conversations WHERE chat_id=?').get(chatId);
      if (conv && conv.customer_id) return; // 已关联

      // 尝试匹配电话号码
      const customer = this.db.prepare('SELECT id FROM customers WHERE phone LIKE ?').get(`%${phone.slice(-8)}%`);
      if (customer) {
        this.db.prepare('UPDATE wa_conversations SET customer_id=? WHERE chat_id=?').run(customer.id, chatId);
      }
    } catch (e) { /* ignore */ }
  }

  /** 保存消息到数据库 */
  _saveMessage(msg, direction, overrideContent) {
    try {
      this.db.prepare(`INSERT OR IGNORE INTO wa_messages 
        (msg_id, chat_id, direction, sender_name, sender_phone, content, msg_type, is_forwarded, status)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(
          msg.id?._serialized || `local_${Date.now()}`,
          direction === 'inbound' ? msg.from : msg.to,
          direction,
          msg._data?.notifyName || '',
          msg.from?.replace('@c.us', '') || '',
          overrideContent || msg.body || `[${msg.type}]`,
          msg.type || 'text',
          msg.isForwarded ? 1 : 0,
          direction === 'outbound' ? 'sent' : 'received'
        );
    } catch (e) { /* ignore duplicate */ }
  }

  /** 更新对话最新消息 */
  _updateConversation(chatId, lastMessage) {
    try {
      this.db.prepare(`UPDATE wa_conversations SET 
        last_message=?, last_message_at=datetime('now'), updated_at=datetime('now')
        WHERE chat_id=?`)
        .run(lastMessage, chatId);
    } catch (e) { /* ignore */ }
  }

  /** 统计数据 */
  _getStats() {
    try {
      return {
        totalConversations: this.db.prepare('SELECT COUNT(*) as c FROM wa_conversations').get().c,
        unreadCount: this.db.prepare('SELECT SUM(unread_count) as c FROM wa_conversations').get().c || 0,
        todayMessages: this.db.prepare("SELECT COUNT(*) as c FROM wa_messages WHERE created_at >= date('now')").get().c,
        todaySent: this.db.prepare("SELECT COUNT(*) as c FROM wa_messages WHERE direction='outbound' AND created_at >= date('now')").get().c,
        todayReceived: this.db.prepare("SELECT COUNT(*) as c FROM wa_messages WHERE direction='inbound' AND created_at >= date('now')").get().c,
      };
    } catch (e) {
      return {};
    }
  }

  /** 安全的账号信息 */
  _safeInfo() {
    if (!this.info) return null;
    return {
      pushname: this.info.pushname,
      phone: this.info.wid?.user,
      platform: this.info.platform
    };
  }

  /** 发送 Socket.IO 事件 */
  _emit(event, data) {
    if (this.io) {
      this.io.emit(`whatsapp:${event}`, data);
    }
    this.emit(event, data);
  }
}

module.exports = { WhatsAppManager };
