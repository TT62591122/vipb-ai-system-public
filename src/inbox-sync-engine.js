/**
 * P1-7 聚合私信客服引擎 (Inbox Sync Engine)
 * 定时轮询 Facebook/Instagram/TikTok/LinkedIn/Twitter 私信
 * 统一写入 inbox_conversations + inbox_messages
 */

const EventEmitter = require('events');
const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');

const SUPPORTED_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'linkedin', 'twitter'];
const DEFAULT_POLL_INTERVAL = 60000; // 60s

class InboxSyncEngine extends EventEmitter {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;
    this.timers = {};           // platform -> intervalId
    this.activePlatforms = [];  // currently syncing platforms
    this.lastSyncTime = {};     // platform -> ISO timestamp
    this._initSyncState();
  }

  _initSyncState() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_sync_state (
        platform TEXT PRIMARY KEY,
        last_cursor TEXT DEFAULT '',
        last_sync_at DATETIME,
        status TEXT DEFAULT 'idle',
        error TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // ========== 同步控制 ==========

  /** 启动指定平台的私信同步 */
  startSync(platforms = SUPPORTED_PLATFORMS) {
    const toSync = platforms.filter(p => SUPPORTED_PLATFORMS.includes(p));
    for (const platform of toSync) {
      if (this.timers[platform]) continue; // already running

      this._updateSyncStatus(platform, 'running');
      // immediate first poll, then interval
      this._pollPlatform(platform);
      this.timers[platform] = setInterval(() => this._pollPlatform(platform), this.pollInterval);
      this.activePlatforms.push(platform);
    }
    this.emit('sync:started', { platforms: toSync });
    return { started: toSync };
  }

  /** 停止所有同步 */
  stopSync() {
    for (const platform of Object.keys(this.timers)) {
      clearInterval(this.timers[platform]);
      this._updateSyncStatus(platform, 'idle');
    }
    this.timers = {};
    this.activePlatforms = [];
    this.emit('sync:stopped');
    return { stopped: true };
  }

  // ========== 平台轮询 ==========

  async _pollPlatform(platform) {
    try {
      const cursor = this._getCursor(platform);
      const messages = await this._fetchMessages(platform, cursor);

      for (const msg of messages) {
        this._ingestMessage(platform, msg);
      }

      if (messages.length > 0) {
        const newCursor = messages[messages.length - 1].id || '';
        this._saveCursor(platform, newCursor);
        this.emit('sync:newMessages', { platform, count: messages.length });
      }

      this.lastSyncTime[platform] = new Date().toISOString();
      this._updateSyncStatus(platform, 'running');
    } catch (err) {
      console.error(`[InboxSync] ${platform} poll error:`, err.message);
      this._updateSyncStatus(platform, 'error', err.message);
      this.emit('sync:error', { platform, error: err.message });
    }
  }

  /** 从平台 API 拉取私信 — 各平台适配器 */
  async _fetchMessages(platform, cursor) {
    const fetcher = this._getFetcher(platform);
    if (!fetcher) return [];
    return await fetcher(cursor);
  }

  _getFetcher(platform) {
    const fetchers = {
      facebook: (cursor) => this._fetchFacebook(cursor),
      instagram: (cursor) => this._fetchInstagram(cursor),
      tiktok: (cursor) => this._fetchTikTok(cursor),
      linkedin: (cursor) => this._fetchLinkedIn(cursor),
      twitter: (cursor) => this._fetchTwitter(cursor),
    };
    return fetchers[platform];
  }

  // ---- 平台适配器：接入真实 API ----

  /** 获取平台第一个active账号的access_token */
  _getToken(platform) {
    const accounts = this._getAccounts(platform);
    if (!accounts.length) return null;
    const account = accounts[0];
    return { token: account.access_token, accountId: account.id, account };
  }

  async _fetchFacebook(cursor) {
    const auth = this._getToken('facebook');
    if (!auth || !auth.token) return [];
    try {
      // Facebook Graph API - Page Conversations
      const url = cursor
        ? `https://graph.facebook.com/v18.0/me/conversations?fields=messages{message,from,created_time}&limit=25&after=${cursor}`
        : 'https://graph.facebook.com/v18.0/me/conversations?fields=messages{message,from,created_time}&limit=25';
      const res = await axios.get(url, injectProxy(this.db, {
        params: { access_token: auth.token },
        timeout: 15000
      }, auth.accountId));
      const conversations = res.data?.data || [];
      const messages = [];
      for (const conv of conversations) {
        for (const msg of (conv.messages?.data || [])) {
          messages.push({
            id: msg.id,
            platform_msg_id: msg.id,
            thread_id: conv.id,
            sender_id: msg.from?.id,
            sender_name: msg.from?.name || msg.from?.id,
            content: msg.message || '',
            direction: 'in',
            metadata: { conversation_id: conv.id, created_time: msg.created_time }
          });
        }
      }
      return messages;
    } catch (e) {
      console.error('[InboxSync] Facebook fetch failed:', e.message);
      return [];
    }
  }

  async _fetchInstagram(cursor) {
    const auth = this._getToken('instagram');
    if (!auth || !auth.token) return [];
    try {
      // Instagram Messaging via Graph API (需要 instagram_manage_messages 权限)
      const url = cursor
        ? `https://graph.facebook.com/v18.0/me/conversations?platform=instagram&fields=messages{message,from,created_time}&limit=25&after=${cursor}`
        : 'https://graph.facebook.com/v18.0/me/conversations?platform=instagram&fields=messages{message,from,created_time}&limit=25';
      const res = await axios.get(url, injectProxy(this.db, {
        params: { access_token: auth.token },
        timeout: 15000
      }, auth.accountId));
      const conversations = res.data?.data || [];
      const messages = [];
      for (const conv of conversations) {
        for (const msg of (conv.messages?.data || [])) {
          messages.push({
            id: msg.id,
            platform_msg_id: msg.id,
            thread_id: conv.id,
            sender_id: msg.from?.id,
            sender_name: msg.from?.username || msg.from?.name || msg.from?.id,
            content: msg.message || '',
            direction: 'in',
            metadata: { conversation_id: conv.id, created_time: msg.created_time }
          });
        }
      }
      return messages;
    } catch (e) {
      console.error('[InboxSync] Instagram fetch failed:', e.message);
      return [];
    }
  }

  async _fetchTikTok(cursor) {
    const auth = this._getToken('tiktok');
    if (!auth || !auth.token) return [];
    try {
      // TikTok Business API - Direct Messages (v2)
      const url = 'https://open.tiktokapis.com/v2/dm/conversation/list/';
      const res = await axios.post(url, { cursor: cursor || '' },
        injectProxy(this.db, {
          headers: { 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          timeout: 15000
        }, auth.accountId)
      );
      const conversations = res.data?.data?.conversations || [];
      const messages = [];
      for (const conv of conversations) {
        const latestMsg = conv.latest_message;
        if (latestMsg) {
          messages.push({
            id: latestMsg.msg_id || conv.conversation_id,
            platform_msg_id: latestMsg.msg_id,
            thread_id: conv.conversation_id,
            sender_id: latestMsg.sender_id,
            sender_name: conv.participant?.display_name || latestMsg.sender_id,
            content: latestMsg.content || '',
            direction: 'in',
            metadata: { conversation_id: conv.conversation_id, create_time: latestMsg.create_time }
          });
        }
      }
      return messages;
    } catch (e) {
      console.error('[InboxSync] TikTok fetch failed:', e.message);
      return [];
    }
  }

  async _fetchLinkedIn(cursor) {
    const auth = this._getToken('linkedin');
    if (!auth || !auth.token) return [];
    try {
      // LinkedIn Messaging API (需要 w_member_social scope)
      const url = 'https://api.linkedin.com/v2/conversations?q=criteria&start=0&count=25';
      const res = await axios.get(url, injectProxy(this.db, {
        headers: { 'Authorization': `Bearer ${auth.token}`, 'LinkedIn-Version': '202304' },
        timeout: 15000
      }, auth.accountId));
      const elements = res.data?.elements || [];
      const messages = [];
      for (const conv of elements) {
        const lastEvent = conv.events?.[0];
        if (lastEvent?.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent']) {
          const msgEvent = lastEvent.eventContent['com.linkedin.voyager.messaging.event.MessageEvent'];
          messages.push({
            id: lastEvent.dashEntityUrn || conv.entityUrn,
            platform_msg_id: lastEvent.dashEntityUrn,
            thread_id: conv.entityUrn,
            sender_id: lastEvent.from?.['com.linkedin.voyager.messaging.MessagingMember']?.miniProfile?.publicIdentifier,
            sender_name: lastEvent.from?.['com.linkedin.voyager.messaging.MessagingMember']?.miniProfile?.firstName || '',
            content: msgEvent.body || msgEvent.attributedBody?.text || '',
            direction: 'in',
            metadata: { conversation_urn: conv.entityUrn, created_at: lastEvent.createdAt }
          });
        }
      }
      return messages;
    } catch (e) {
      console.error('[InboxSync] LinkedIn fetch failed:', e.message);
      return [];
    }
  }

  async _fetchTwitter(cursor) {
    const auth = this._getToken('twitter');
    if (!auth || !auth.token) return [];
    try {
      // Twitter/X DM API v2
      const url = cursor
        ? `https://api.twitter.com/2/dm_events?dm_event.fields=dm_conversation_id,text,sender_id,created_at&max_results=50&pagination_token=${cursor}`
        : 'https://api.twitter.com/2/dm_events?dm_event.fields=dm_conversation_id,text,sender_id,created_at&max_results=50';
      const res = await axios.get(url, injectProxy(this.db, {
        headers: { 'Authorization': `Bearer ${auth.token}` },
        timeout: 15000
      }, auth.accountId));
      const events = res.data?.data || [];
      return events.map(ev => ({
        id: ev.id,
        platform_msg_id: ev.id,
        thread_id: ev.dm_conversation_id,
        sender_id: ev.sender_id,
        sender_name: ev.sender_id,
        content: ev.text || '',
        direction: 'in',
        metadata: { dm_conversation_id: ev.dm_conversation_id, created_at: ev.created_at }
      }));
    } catch (e) {
      console.error('[InboxSync] Twitter fetch failed:', e.message);
      return [];
    }
  }

  /** 获取平台已配置的社媒账号 */
  _getAccounts(platform) {
    try {
      return this.db.prepare(
        "SELECT * FROM social_accounts WHERE platform=? AND status='active'"
      ).all(platform);
    } catch {
      return [];
    }
  }

  // ========== 消息写入 ==========

  _ingestMessage(platform, msg) {
    const channelId = msg.thread_id || msg.sender_id || msg.id;

    // getOrCreateConversation
    let conv = this.db.prepare(
      'SELECT * FROM inbox_conversations WHERE channel=? AND channel_id=?'
    ).get(platform, channelId);

    if (!conv) {
      const r = this.db.prepare(`INSERT INTO inbox_conversations 
        (channel, channel_id, contact_name, metadata) VALUES (?,?,?,?)`)
        .run(platform, channelId, msg.sender_name || channelId, JSON.stringify(msg.metadata || {}));
      conv = { id: r.lastInsertRowid };
    }

    // dedup by platform msg id
    if (msg.platform_msg_id) {
      const exists = this.db.prepare(
        "SELECT id FROM inbox_messages WHERE conversation_id=? AND json_extract(metadata,'$.platform_msg_id')=?"
      ).get(conv.id, msg.platform_msg_id);
      if (exists) return;
    }

    const direction = msg.direction || 'in';

    this.db.prepare(`INSERT INTO inbox_messages 
      (conversation_id, channel, direction, sender_name, content, content_type, media_url, metadata)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(conv.id, platform, direction, msg.sender_name || '',
        msg.content || '', msg.content_type || 'text',
        msg.media_url || null, JSON.stringify({ platform_msg_id: msg.platform_msg_id, ...(msg.metadata || {}) }));

    // update conversation summary
    this.db.prepare(`UPDATE inbox_conversations SET 
      last_message=?, last_message_at=datetime('now'), last_direction=?,
      unread_count = CASE WHEN ?='in' THEN unread_count+1 ELSE unread_count END,
      status = CASE WHEN status='closed' THEN 'open' ELSE status END,
      contact_name = COALESCE(NULLIF(?, ''), contact_name),
      updated_at=datetime('now')
      WHERE id=?`)
      .run((msg.content || '').substring(0, 200), direction, direction, msg.sender_name || '', conv.id);

    this.emit('message:new', { platform, conversationId: conv.id, message: msg });
  }

  // ========== 发送回复 ==========

  async sendReply(conversationId, message, options = {}) {
    const conv = this.db.prepare('SELECT * FROM inbox_conversations WHERE id=?').get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    const platform = conv.channel;

    // 支持快捷回复模板
    let content = message;
    if (options.cannedResponseId) {
      const canned = this.db.prepare('SELECT * FROM inbox_canned_responses WHERE id=?').get(options.cannedResponseId);
      if (canned) {
        content = canned.content;
        this.db.prepare('UPDATE inbox_canned_responses SET use_count=use_count+1 WHERE id=?').run(canned.id);
      }
    }

    // 调用平台发送 API
    const result = await this._sendToPlatform(platform, conv.channel_id, content, options);

    // 写入本地消息记录
    this.db.prepare(`INSERT INTO inbox_messages 
      (conversation_id, channel, direction, sender_name, content, content_type, metadata)
      VALUES (?,?,'out','me',?,?,?)`)
      .run(conv.id, platform, content, options.content_type || 'text', JSON.stringify({ send_result: result }));

    this.db.prepare(`UPDATE inbox_conversations SET 
      last_message=?, last_message_at=datetime('now'), last_direction='out', updated_at=datetime('now')
      WHERE id=?`)
      .run(content.substring(0, 200), conv.id);

    this.emit('message:sent', { platform, conversationId, content });
    return { success: true, platform, conversationId };
  }

  async _sendToPlatform(platform, channelId, content, options) {
    // 路由到各平台发送接口
    const senders = {
      facebook: () => this._sendFacebook(channelId, content, options),
      instagram: () => this._sendInstagram(channelId, content, options),
      tiktok: () => this._sendTikTok(channelId, content, options),
      linkedin: () => this._sendLinkedIn(channelId, content, options),
      twitter: () => this._sendTwitter(channelId, content, options),
      whatsapp: () => this._sendWhatsApp(channelId, content, options),
      email: () => this._sendEmail(channelId, content, options),
    };
    const sender = senders[platform];
    if (!sender) throw new Error(`Unsupported platform: ${platform}`);
    return await sender();
  }

  // ---- 平台发送适配器 ----
  async _sendFacebook(recipientId, content) {
    const auth = this._getToken('facebook');
    if (!auth || !auth.token) return { status: 'failed', note: 'Facebook 未配置access_token' };
    try {
      const res = await axios.post('https://graph.facebook.com/v18.0/me/messages',
        { recipient: { id: recipientId }, message: { text: content } },
        injectProxy(this.db, { params: { access_token: auth.token }, timeout: 15000 }, auth.accountId)
      );
      return { status: 'sent', messageId: res.data?.message_id };
    } catch (e) {
      return { status: 'failed', error: e.message };
    }
  }

  async _sendInstagram(recipientId, content) {
    const auth = this._getToken('instagram');
    if (!auth || !auth.token) return { status: 'failed', note: 'Instagram 未配置access_token' };
    try {
      const res = await axios.post('https://graph.facebook.com/v18.0/me/messages',
        { recipient: { id: recipientId }, message: { text: content } },
        injectProxy(this.db, { params: { access_token: auth.token }, timeout: 15000 }, auth.accountId)
      );
      return { status: 'sent', messageId: res.data?.message_id };
    } catch (e) {
      return { status: 'failed', error: e.message };
    }
  }

  async _sendTikTok(recipientId, content) {
    const auth = this._getToken('tiktok');
    if (!auth || !auth.token) return { status: 'failed', note: 'TikTok 未配置access_token' };
    try {
      await axios.post('https://open.tiktokapis.com/v2/dm/message/send/',
        { conversation_id: recipientId, content: { text: content } },
        injectProxy(this.db, {
          headers: { 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          timeout: 15000
        }, auth.accountId)
      );
      return { status: 'sent' };
    } catch (e) {
      return { status: 'failed', error: e.message };
    }
  }

  async _sendLinkedIn(recipientId, content) {
    const auth = this._getToken('linkedin');
    if (!auth || !auth.token) return { status: 'failed', note: 'LinkedIn 未配置access_token' };
    try {
      await axios.post('https://api.linkedin.com/v2/messages',
        { recipients: [recipientId], body: content, subject: '' },
        injectProxy(this.db, {
          headers: { 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'application/json', 'LinkedIn-Version': '202304' },
          timeout: 15000
        }, auth.accountId)
      );
      return { status: 'sent' };
    } catch (e) {
      return { status: 'failed', error: e.message };
    }
  }

  async _sendTwitter(recipientId, content) {
    const auth = this._getToken('twitter');
    if (!auth || !auth.token) return { status: 'failed', note: 'Twitter 未配置access_token' };
    try {
      const res = await axios.post('https://api.twitter.com/2/dm_conversations/with/' + recipientId + '/messages',
        { text: content },
        injectProxy(this.db, {
          headers: { 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          timeout: 15000
        }, auth.accountId)
      );
      return { status: 'sent', messageId: res.data?.data?.dm_event_id };
    } catch (e) {
      return { status: 'failed', error: e.message };
    }
  }

  async _sendWhatsApp(recipientId, content) {
    // 委托给WhatsApp模块
    console.log(`[InboxSync] WhatsApp send → 请使用WhatsApp模块: ${recipientId}`);
    return { status: 'pending', note: '请通过WhatsApp模块发送' };
  }

  async _sendEmail(recipientId, content) {
    // 委托给Email模块
    console.log(`[InboxSync] Email send → 请使用邮件模块: ${recipientId}`);
    return { status: 'pending', note: '请通过邮件模块发送' };
  }

  // ========== 查询接口 ==========

  /** 获取各平台未读数 */
  getUnreadCount() {
    const rows = this.db.prepare(`
      SELECT channel, SUM(unread_count) as unread 
      FROM inbox_conversations WHERE status != 'closed'
      GROUP BY channel
    `).all();

    const result = {};
    let total = 0;
    for (const row of rows) {
      result[row.channel] = row.unread;
      total += row.unread;
    }
    result.total = total;
    return result;
  }

  /** 标记会话已读 */
  markAsRead(conversationId) {
    this.db.prepare("UPDATE inbox_conversations SET unread_count=0, updated_at=datetime('now') WHERE id=?")
      .run(conversationId);
    this.db.prepare("UPDATE inbox_messages SET read_at=datetime('now') WHERE conversation_id=? AND read_at IS NULL")
      .run(conversationId);
    return { success: true };
  }

  // ========== 同步状态管理 ==========

  _getCursor(platform) {
    const row = this.db.prepare('SELECT last_cursor FROM inbox_sync_state WHERE platform=?').get(platform);
    return row ? row.last_cursor : '';
  }

  _saveCursor(platform, cursor) {
    this.db.prepare(`INSERT OR REPLACE INTO inbox_sync_state 
      (platform, last_cursor, last_sync_at, updated_at) 
      VALUES (?, ?, datetime('now'), datetime('now'))`)
      .run(platform, cursor);
  }

  _updateSyncStatus(platform, status, error = '') {
    this.db.prepare(`INSERT OR REPLACE INTO inbox_sync_state 
      (platform, last_cursor, last_sync_at, status, error, updated_at) 
      VALUES (?, COALESCE((SELECT last_cursor FROM inbox_sync_state WHERE platform=?), ''), 
        datetime('now'), ?, ?, datetime('now'))`)
      .run(platform, platform, status, error);
  }

  /** 获取同步状态概览 */
  getSyncStatus() {
    const rows = this.db.prepare('SELECT * FROM inbox_sync_state').all();
    return {
      active: this.activePlatforms,
      platforms: rows,
      lastSync: this.lastSyncTime,
    };
  }
}

module.exports = InboxSyncEngine;
