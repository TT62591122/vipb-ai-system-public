/**
 * 独立站客服 Widget
 * 
 * 可嵌入任意网站的在线聊天组件
 * - 前端 Widget（JavaScript 嵌入代码）
 * - 后端 WebSocket 消息处理
 * - 与统一收件箱集成
 */

const express = require('express');

function createWidgetRouter(db, io) {
  const router = express.Router();

  // Widget 配置
  router.get('/config', (req, res) => {
    try {
    const siteId = req.query.site_id;
    if (!siteId) return res.status(400).json({ error: 'Missing site_id' });

    const config = db.prepare('SELECT * FROM widget_configs WHERE site_id = ?').get(siteId);
    if (!config) return res.status(404).json({ error: 'Widget not configured' });

    res.json({
      site_id: config.site_id,
      company_name: config.company_name,
      welcome_message: config.welcome_message,
      theme_color: config.theme_color,
      position: config.position,
      avatar_url: config.avatar_url,
      auto_reply: config.auto_reply_enabled === 1
    });
    } catch(e) { console.error('[Widget] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 发送消息
  router.post('/message', (req, res) => {
    try {
    const { site_id, visitor_id, message, visitor_name, visitor_email } = req.body;
    if (!site_id || !message) return res.status(400).json({ error: 'Missing fields' });

    const finalVisitorId = visitor_id || `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // 查找或创建会话
    let conversation = db.prepare(
      'SELECT * FROM inbox_conversations WHERE platform = ? AND external_id = ?'
    ).get('widget', `${site_id}:${finalVisitorId}`);

    if (!conversation) {
      db.prepare(`
        INSERT INTO inbox_conversations (platform, external_id, contact_name, contact_email, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run('widget', `${site_id}:${finalVisitorId}`, visitor_name || 'Website Visitor', visitor_email || '');

      conversation = db.prepare(
        'SELECT * FROM inbox_conversations WHERE platform = ? AND external_id = ?'
      ).get('widget', `${site_id}:${finalVisitorId}`);
    }

    // 保存消息
    db.prepare(`
      INSERT INTO inbox_messages (conversation_id, direction, content, sender_name, created_at)
      VALUES (?, 'inbound', ?, ?, CURRENT_TIMESTAMP)
    `).run(conversation.id, message, visitor_name || 'Visitor');

    // 更新会话
    db.prepare('UPDATE inbox_conversations SET updated_at = CURRENT_TIMESTAMP, unread_count = unread_count + 1 WHERE id = ?')
      .run(conversation.id);

    // WebSocket 通知
    if (io) {
      io.emit('widget:message', {
        conversationId: conversation.id,
        visitorId: finalVisitorId,
        siteId: site_id,
        message, visitor_name
      });
    }

    // 自动回复
    const config = db.prepare('SELECT * FROM widget_configs WHERE site_id = ?').get(site_id);
    let autoReply = null;
    if (config && config.auto_reply_enabled) {
      autoReply = config.auto_reply_message || 'Thanks for your message! We\'ll get back to you shortly.';
      
      db.prepare(`
        INSERT INTO inbox_messages (conversation_id, direction, content, sender_name, created_at)
        VALUES (?, 'outbound', ?, ?, CURRENT_TIMESTAMP)
      `).run(conversation.id, autoReply, config.company_name || 'Support');
    }

    res.json({
      success: true,
      visitor_id: finalVisitorId,
      conversation_id: conversation.id,
      auto_reply: autoReply
    });
    } catch(e) { console.error('[Widget] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // 获取历史消息（访客端）
  router.get('/messages', (req, res) => {
    try {
    const { site_id, visitor_id } = req.query;
    if (!site_id || !visitor_id) return res.status(400).json({ error: 'Missing fields' });

    const conversation = db.prepare(
      'SELECT * FROM inbox_conversations WHERE platform = ? AND external_id = ?'
    ).get('widget', `${site_id}:${visitor_id}`);

    if (!conversation) return res.json({ messages: [] });

    const messages = db.prepare(
      'SELECT * FROM inbox_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100'
    ).all(conversation.id);

    res.json({ messages });
    } catch(e) { console.error('[Widget] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  // Widget 管理 API（后台）
  router.post('/configs', (req, res) => {
    try {
    const { site_id, company_name, welcome_message, theme_color, position, avatar_url, auto_reply_enabled, auto_reply_message } = req.body;

    db.prepare(`
      INSERT OR REPLACE INTO widget_configs 
      (site_id, company_name, welcome_message, theme_color, position, avatar_url, auto_reply_enabled, auto_reply_message, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      site_id, company_name || '', welcome_message || 'How can we help?',
      theme_color || '#667eea', position || 'bottom-right',
      avatar_url || '', auto_reply_enabled ? 1 : 0, auto_reply_message || ''
    );

    res.json({ success: true });
    } catch(e) { console.error('[Widget] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
}

// Widget 嵌入代码生成
function generateEmbedCode(siteId, serverUrl) {
  return `<!-- VIPB Chat Widget -->
<script>
(function(){
  var w=window,d=document,s='script';
  w.VIPBWidget={siteId:'${siteId}',serverUrl:'${serverUrl}'};
  var js=d.createElement(s);js.async=1;
  js.src='${serverUrl}/widget/widget.js';
  d.head.appendChild(js);
})();
</script>`;
}

module.exports = { createWidgetRouter, generateEmbedCode };
