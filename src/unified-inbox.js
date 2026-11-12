/**
 * 多渠道统一收件箱 (Unified Inbox)
 * 聚合 WhatsApp / Email / LinkedIn / Facebook 所有对话到一个视图
 */

class UnifiedInbox {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this._initTables();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        channel_id TEXT,
        customer_id INTEGER,
        contact_name TEXT,
        contact_avatar TEXT DEFAULT '',
        last_message TEXT DEFAULT '',
        last_message_at DATETIME,
        last_direction TEXT DEFAULT 'in',
        unread_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        priority TEXT DEFAULT 'normal',
        assigned_to TEXT,
        labels TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel, channel_id)
      );

      CREATE TABLE IF NOT EXISTS inbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        direction TEXT DEFAULT 'in',
        sender_name TEXT,
        content TEXT,
        content_type TEXT DEFAULT 'text',
        media_url TEXT,
        metadata TEXT DEFAULT '{}',
        read_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES inbox_conversations(id)
      );

      CREATE TABLE IF NOT EXISTS inbox_canned_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shortcut TEXT UNIQUE,
        title TEXT,
        content TEXT,
        channel TEXT DEFAULT 'all',
        language TEXT DEFAULT 'en',
        use_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_inbox_conv_channel ON inbox_conversations(channel);
      CREATE INDEX IF NOT EXISTS idx_inbox_conv_status ON inbox_conversations(status);
      CREATE INDEX IF NOT EXISTS idx_inbox_conv_customer ON inbox_conversations(customer_id);
      CREATE INDEX IF NOT EXISTS idx_inbox_conv_updated ON inbox_conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inbox_msg_conv ON inbox_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_inbox_msg_created ON inbox_messages(created_at);
    `);

    // === 任务2: 添加 category 字段 ===
    try {
      // 检查 category 列是否已存在
      const cols = this.db.prepare("PRAGMA table_info(inbox_conversations)").all();
      const hasCategory = cols.some(c => c.name === 'category');
      if (!hasCategory) {
        this.db.exec(`ALTER TABLE inbox_conversations ADD COLUMN category TEXT DEFAULT NULL`);
        console.log('[Inbox] 已添加 category 字段');
      }
    } catch (e) {
      console.error('[Inbox] 添加 category 字段失败:', e.message);
    }

    // 对已有数据进行一次性分类
    this._classifyExistingConversations();

    // 同步已发送邮件到收件箱（一次性迁移）
    this._syncSentEmailsToInbox();
  }

  /** 将emails表中已发送的邮件同步到inbox_messages（历史数据迁移） */
  _syncSentEmailsToInbox() {
    try {
      // 查找已发送但未同步到inbox的邮件
      const sentEmails = this.db.prepare(`
        SELECT e.id, e.to_addr, e.subject, e.body, e.account_id, e.sent_at, e.customer_id,
               ea.email as from_email
        FROM emails e
        LEFT JOIN email_accounts ea ON e.account_id = ea.id
        WHERE e.status = 'sent'
        AND NOT EXISTS (
          SELECT 1 FROM inbox_messages im 
          WHERE im.metadata LIKE '%"email_id":' || e.id || '%' 
          AND im.direction = 'out'
        )
      `).all();

      if (sentEmails.length === 0) return;

      let synced = 0;
      for (const email of sentEmails) {
        const channelId = `email:${email.to_addr}:${email.account_id || 0}`;
        const conv = this.db.prepare('SELECT id FROM inbox_conversations WHERE channel_id=?').get(channelId);
        if (conv) {
          this.db.prepare(`INSERT INTO inbox_messages 
            (conversation_id, channel, direction, sender_name, content, content_type, metadata, created_at)
            VALUES (?, 'email', 'out', ?, ?, 'text', ?, ?)`)
            .run(conv.id, email.from_email || 'Me', 
              `📧 ${email.subject}\n\n${email.body}`,
              JSON.stringify({ email_id: email.id }),
              email.sent_at || new Date().toISOString());
          synced++;
        }
      }
      if (synced > 0) {
        console.log(`[Inbox] 已同步 ${synced} 封已发送邮件到收件箱`);
      }
    } catch (e) {
      console.warn('[Inbox] 同步已发送邮件失败:', e.message);
    }
  }

  /** 对已有的未分类对话进行自动分类 */
  _classifyExistingConversations() {
    try {
      const unclassified = this.db.prepare(
        "SELECT id, channel, channel_id, customer_id, contact_name, last_message FROM inbox_conversations WHERE category IS NULL"
      ).all();

      if (unclassified.length === 0) return;

      const updateStmt = this.db.prepare("UPDATE inbox_conversations SET category=? WHERE id=?");
      let count = 0;
      for (const conv of unclassified) {
        const cat = this._classifyConversation(conv.channel, conv.channel_id, conv.contact_name, conv.last_message, conv.customer_id);
        updateStmt.run(cat, conv.id);
        count++;
      }
      if (count > 0) {
        console.log(`[Inbox] 已对 ${count} 条对话自动分类`);
      }
    } catch (e) {
      console.error('[Inbox] 分类已有对话失败:', e.message);
    }
  }

  /** 
   * 自动分类对话
   * @returns {'customer'|'system'|'promotion'|'verification'|'unknown'}
   */
  _classifyConversation(channel, channelId, contactName, content, customerId) {
    // 已关联CRM客户 → customer
    if (customerId) return 'customer';

    // 仅对 email 渠道做细化分类，其他渠道默认 customer
    if (channel !== 'email') return 'customer';

    // 从 channel_id 提取发件人邮箱
    // channel_id格式：email:对方邮箱:我方账号ID
    let senderEmail = '';
    if (channelId) {
      const parts = channelId.split(':');
      if (parts.length >= 2) {
        senderEmail = parts[1].toLowerCase();
      }
    }
    const senderLocal = senderEmail.split('@')[0] || '';
    const senderDomain = senderEmail.split('@')[1] || '';
    const contactLower = (contactName || '').toLowerCase();
    const contentLower = (content || '').toLowerCase();

    // === system 类 ===
    const systemPrefixes = ['mailer-daemon', 'postmaster', 'no-reply', 'noreply', 'notification', 'alert'];
    if (systemPrefixes.some(p => senderLocal.startsWith(p))) return 'system';
    if (senderDomain === 'accounts.google.com') return 'system';
    // delivery notification 特征
    if (contactLower.includes('mail delivery') || contactLower.includes('mailer-daemon') || contactLower.includes('postmaster')) return 'system';
    if (contentLower.includes('delivery status notification') || contentLower.includes('undeliverable') || contentLower.includes('delivery failure')) return 'system';

    // === verification 类 ===
    if (senderLocal.startsWith('registration')) return 'verification';
    if (contentLower.includes('验证码') || contentLower.includes('verification code') || contentLower.includes('verify your') || contentLower.includes('confirm your')) return 'verification';
    if (contentLower.includes('注册') && contentLower.includes('码')) return 'verification';

    // === promotion 类 ===
    const promoPrefixes = ['marketing', 'promo', 'newsletter'];
    if (promoPrefixes.some(p => senderLocal.startsWith(p))) return 'promotion';
    if (contentLower.includes('unsubscribe') || contentLower.includes('退订')) return 'promotion';
    if (contentLower.includes('优惠') || contentLower.includes('促销') || contentLower.includes('special offer') || contentLower.includes('discount')) return 'promotion';

    // 不匹配任何规则 → unknown
    return 'unknown';
  }

  /** 从channel_id中提取我方账号名称 */
  _resolveAccountName(channel, channelId) {
    if (!channelId) return channel;

    if (channel === 'email') {
      // 格式: email:对方邮箱:账号ID
      const parts = channelId.split(':');
      if (parts.length >= 3) {
        const accountId = parts[parts.length - 1];
        try {
          const row = this.db.prepare("SELECT email FROM email_accounts WHERE id=?").get(parseInt(accountId));
          if (row) return row.email;
        } catch (e) { /* ignore */ }
        return `账号#${accountId}`;
      }
      return channelId;
    }

    if (channel === 'whatsapp' || channel === 'whatsapp_cloud') {
      // 从channel_id或metadata提取号码
      const parts = channelId.split(':');
      if (parts.length >= 2) return parts[parts.length - 1];
      return channelId;
    }

    return channelId;
  }

  /** 从channel_id中提取对方联系人邮箱 */
  _resolveContactEmail(channel, channelId) {
    if (channel === 'email' && channelId) {
      const parts = channelId.split(':');
      if (parts.length >= 2) {
        return parts[1]; // email:对方邮箱:账号ID → 对方邮箱
      }
    }
    return '';
  }

  // ========== 对话管理 ==========

  /** 获取或创建对话 */
  getOrCreateConversation(channel, channelId, contactInfo = {}) {
    let conv = this.db.prepare('SELECT * FROM inbox_conversations WHERE channel=? AND channel_id=?')
      .get(channel, channelId);

    if (!conv) {
      const r = this.db.prepare(`INSERT INTO inbox_conversations 
        (channel, channel_id, contact_name, customer_id, metadata)
        VALUES (?,?,?,?,?)`)
        .run(channel, channelId, contactInfo.name || channelId,
          contactInfo.customer_id || null, JSON.stringify(contactInfo.metadata || {}));
      conv = this.db.prepare('SELECT * FROM inbox_conversations WHERE id=?').get(r.lastInsertRowid);
    }

    return conv;
  }

  /** 收到新消息 */
  receiveMessage(channel, channelId, message) {
    const conv = this.getOrCreateConversation(channel, channelId, {
      name: message.sender_name,
      customer_id: message.customer_id
    });

    // 写入消息
    const r = this.db.prepare(`INSERT INTO inbox_messages 
      (conversation_id, channel, direction, sender_name, content, content_type, media_url, metadata)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(conv.id, channel, message.direction || 'in', message.sender_name || '',
        message.content || '', message.content_type || 'text',
        message.media_url || null, JSON.stringify(message.metadata || {}));

    // 更新对话摘要
    this.db.prepare(`UPDATE inbox_conversations SET 
      last_message=?, last_message_at=datetime('now'), last_direction=?,
      unread_count = CASE WHEN ?='in' THEN unread_count+1 ELSE unread_count END,
      status = CASE WHEN status='closed' THEN 'open' ELSE status END,
      contact_name = COALESCE(NULLIF(?, ''), contact_name),
      updated_at=datetime('now')
      WHERE id=?`)
      .run(
        (message.content || '').substring(0, 200),
        message.direction || 'in',
        message.direction || 'in',
        message.sender_name || '',
        conv.id
      );

    // === 任务2: 自动分类 ===
    // 仅对尚未分类的或incoming消息触发分类
    if (message.direction !== 'out') {
      const currentConv = this.db.prepare('SELECT category, customer_id FROM inbox_conversations WHERE id=?').get(conv.id);
      if (!currentConv.category) {
        const cat = this._classifyConversation(
          channel, channelId,
          message.sender_name || conv.contact_name,
          message.content || '',
          message.customer_id || currentConv.customer_id
        );
        this.db.prepare('UPDATE inbox_conversations SET category=? WHERE id=?').run(cat, conv.id);
      }
    }

    const msgData = { id: r.lastInsertRowid, conversation_id: conv.id, channel, ...message };

    // 实时推送
    if (this.io) {
      this.io.emit('inbox:message', msgData);
    }

    return msgData;
  }

  /** 获取对话列表 */
  getConversations(filters = {}) {
    let where = '1=1';
    const params = [];

    if (filters.channel) { where += ' AND channel=?'; params.push(filters.channel); }
    if (filters.status) { where += ' AND status=?'; params.push(filters.status); }
    if (filters.assigned_to) { where += ' AND assigned_to=?'; params.push(filters.assigned_to); }
    if (filters.priority) { where += ' AND priority=?'; params.push(filters.priority); }
    if (filters.unread_only) { where += ' AND unread_count > 0'; }
    if (filters.search) {
      where += ' AND (contact_name LIKE ? OR last_message LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s);
    }
    if (filters.label) {
      where += " AND labels LIKE ?";
      params.push(`%"${filters.label}"%`);
    }

    // === 任务2: category 过滤 ===
    if (filters.category) {
      if (filters.category === 'customer') {
        // 客户视图：显示 customer + unknown + NULL
        where += " AND (category IN ('customer','unknown') OR category IS NULL)";
      } else if (filters.category === 'spam') {
        // 垃圾视图：显示 system + promotion + verification
        where += " AND category IN ('system','promotion','verification')";
      }
      // category='all' 时不加任何过滤
    } else {
      // 默认只显示客户+未分类
      where += " AND (category IN ('customer','unknown') OR category IS NULL)";
    }

    const page = filters.page || 1;
    const limit = filters.limit || 30;
    const offset = (page - 1) * limit;

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM inbox_conversations WHERE ${where}`).get(...params).c;
    const data = this.db.prepare(`SELECT * FROM inbox_conversations WHERE ${where} ORDER BY 
      CASE WHEN unread_count > 0 THEN 0 ELSE 1 END,
      updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    return {
      data: data.map(d => ({
        ...d,
        labels: JSON.parse(d.labels || '[]'),
        metadata: JSON.parse(d.metadata || '{}'),
        // === 任务1: 附加 account_name 和 contact_email 字段 ===
        account_name: this._resolveAccountName(d.channel, d.channel_id),
        contact_email: this._resolveContactEmail(d.channel, d.channel_id),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  /** 获取对话消息 */
  getMessages(conversationId, limit = 50, before = null) {
    let sql = 'SELECT * FROM inbox_messages WHERE conversation_id=?';
    const params = [conversationId];
    if (before) { sql += ' AND id < ?'; params.push(before); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const msgs = this.db.prepare(sql).all(...params);
    return msgs.reverse(); // 返回时间正序
  }

  /** 标记已读 */
  markRead(conversationId) {
    this.db.prepare("UPDATE inbox_conversations SET unread_count=0, updated_at=datetime('now') WHERE id=?")
      .run(conversationId);
    this.db.prepare("UPDATE inbox_messages SET read_at=datetime('now') WHERE conversation_id=? AND read_at IS NULL")
      .run(conversationId);
  }

  /** 更新对话状态/优先级/分配 */
  updateConversation(conversationId, updates) {
    const fields = [];
    const params = [];
    if (updates.status) { fields.push('status=?'); params.push(updates.status); }
    if (updates.priority) { fields.push('priority=?'); params.push(updates.priority); }
    if (updates.assigned_to !== undefined) { fields.push('assigned_to=?'); params.push(updates.assigned_to); }
    if (updates.labels) { fields.push('labels=?'); params.push(JSON.stringify(updates.labels)); }
    if (updates.customer_id) { fields.push('customer_id=?'); params.push(updates.customer_id); }
    if (fields.length === 0) return;
    fields.push("updated_at=datetime('now')");
    params.push(conversationId);
    this.db.prepare(`UPDATE inbox_conversations SET ${fields.join(',')} WHERE id=?`).run(...params);
  }

  /** 关闭对话 */
  closeConversation(conversationId) {
    this.updateConversation(conversationId, { status: 'closed' });
  }

  // ========== 快捷回复 ==========

  getCannedResponses(channel) {
    if (channel && channel !== 'all') {
      return this.db.prepare("SELECT * FROM inbox_canned_responses WHERE channel IN ('all', ?) ORDER BY use_count DESC").all(channel);
    }
    return this.db.prepare('SELECT * FROM inbox_canned_responses ORDER BY use_count DESC').all();
  }

  addCannedResponse(data) {
    const r = this.db.prepare('INSERT INTO inbox_canned_responses (shortcut,title,content,channel,language) VALUES (?,?,?,?,?)')
      .run(data.shortcut, data.title || '', data.content, data.channel || 'all', data.language || 'en');
    return r.lastInsertRowid;
  }

  deleteCannedResponse(id) {
    this.db.prepare('DELETE FROM inbox_canned_responses WHERE id=?').run(id);
  }

  // ========== 统计 ==========

  getStats() {
    return {
      totalOpen: this.db.prepare("SELECT COUNT(*) as c FROM inbox_conversations WHERE status='open'").get().c,
      totalUnread: this.db.prepare("SELECT SUM(unread_count) as c FROM inbox_conversations").get().c || 0,
      byChannel: this.db.prepare("SELECT channel, COUNT(*) as count, SUM(unread_count) as unread FROM inbox_conversations WHERE status='open' GROUP BY channel").all(),
      avgResponseTime: this._calcAvgResponseTime(),
      todayMessages: this.db.prepare("SELECT COUNT(*) as c FROM inbox_messages WHERE created_at >= date('now')").get().c,
      highPriority: this.db.prepare("SELECT COUNT(*) as c FROM inbox_conversations WHERE priority='high' AND status='open'").get().c,
    };
  }

  _calcAvgResponseTime() {
    // 简化计算：看最近50个出站消息距上一个入站消息的间隔
    try {
      const recent = this.db.prepare(`
        SELECT m1.created_at as reply_at, 
          (SELECT MAX(m2.created_at) FROM inbox_messages m2 
           WHERE m2.conversation_id=m1.conversation_id AND m2.direction='in' AND m2.created_at < m1.created_at) as msg_at
        FROM inbox_messages m1
        WHERE m1.direction='out'
        ORDER BY m1.created_at DESC LIMIT 50
      `).all();

      const diffs = recent.filter(r => r.msg_at).map(r => 
        (new Date(r.reply_at) - new Date(r.msg_at)) / 60000
      );
      if (diffs.length === 0) return null;
      return Math.round(diffs.reduce((a,b) => a+b, 0) / diffs.length);
    } catch(e) { return null; }
  }

  // ========== 同步钩子（从其他模块导入消息） ==========

  /** 从WhatsApp同步 */
  syncFromWhatsApp(waMessage) {
    return this.receiveMessage('whatsapp', waMessage.chat_id || waMessage.from, {
      direction: waMessage.is_from_me ? 'out' : 'in',
      sender_name: waMessage.sender_name || waMessage.from,
      content: waMessage.body || waMessage.content,
      content_type: waMessage.hasMedia ? 'media' : 'text',
      customer_id: waMessage.customer_id,
      metadata: { wa_msg_id: waMessage.id }
    });
  }

  /** 从Email同步 */
  syncFromEmail(emailMsg) {
    return this.receiveMessage('email', emailMsg.from || emailMsg.to, {
      direction: emailMsg.is_sent ? 'out' : 'in',
      sender_name: emailMsg.from_name || emailMsg.from,
      content: `📧 ${emailMsg.subject}\n\n${emailMsg.body || ''}`.substring(0, 2000),
      content_type: 'email',
      customer_id: emailMsg.customer_id,
      metadata: { subject: emailMsg.subject, email_id: emailMsg.id }
    });
  }

  /** 从LinkedIn同步 */
  syncFromLinkedIn(liMsg) {
    return this.receiveMessage('linkedin', liMsg.prospect_id || liMsg.from, {
      direction: liMsg.is_sent ? 'out' : 'in',
      sender_name: liMsg.sender_name,
      content: liMsg.content,
      customer_id: liMsg.customer_id,
      metadata: { prospect_id: liMsg.prospect_id }
    });
  }
}

module.exports = { UnifiedInbox };
