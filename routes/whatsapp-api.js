/**
 * WhatsApp API 路由
 * 完整的 WhatsApp 销售中心 API
 */
const router = require('express').Router();
const path = require('path');

// ========== 连接管理 ==========

/** 获取 WhatsApp 状态 */
router.get('/status', (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa) return res.json({ status: 'not_initialized', message: 'WhatsApp 模块未初始化' });
  res.json(wa.getStatus());
});

/** 启动 WhatsApp 连接 */
router.post('/connect', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa) return res.status(500).json({ error: 'WhatsApp 模块未初始化' });
  
  try {
    // 异步初始化，不阻塞响应
    wa.initialize().catch(err => console.error('[WhatsApp] 连接出错:', err.message));
    res.json({ success: true, message: '正在连接WhatsApp，请等待二维码...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 断开 WhatsApp */
router.post('/disconnect', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa) return res.status(500).json({ error: 'WhatsApp 模块未初始化' });
  
  try {
    await wa.destroy();
    res.json({ success: true, message: '已断开WhatsApp连接' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 对话管理 ==========

/** 获取对话列表 */
router.get('/conversations', (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa) return res.json([]);

  const filters = {
    search: req.query.search,
    label: req.query.label,
    assigned_to: req.query.assigned_to,
    is_archived: req.query.archived === '1' ? true : undefined,
    limit: parseInt(req.query.limit) || 50,
    offset: parseInt(req.query.offset) || 0
  };

  const conversations = wa.getConversations(filters);
  res.json(conversations);
});

/** 获取单个对话详情 + 消息 */
router.get('/conversations/:chatId', (req, res) => {
  const db = req.app.locals.db;
  const chatId = decodeURIComponent(req.params.chatId);
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const conversation = db.prepare('SELECT * FROM wa_conversations WHERE chat_id=?').get(chatId);
  if (!conversation) return res.status(404).json({ error: '对话不存在' });

  const messages = db.prepare('SELECT * FROM wa_messages WHERE chat_id=? ORDER BY created_at ASC LIMIT ? OFFSET ?')
    .all(chatId, limit, offset);

  // 标记已读
  db.prepare('UPDATE wa_conversations SET unread_count=0 WHERE chat_id=?').run(chatId);

  // 关联客户信息
  let customer = null;
  if (conversation.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id=?').get(conversation.customer_id);
  }

  res.json({ conversation, messages, customer });
});

/** 更新对话标签/分配/备注 */
router.put('/conversations/:chatId', (req, res) => {
  const db = req.app.locals.db;
  const chatId = decodeURIComponent(req.params.chatId);
  const { labels, assigned_to, notes, is_pinned, is_archived, customer_id } = req.body;

  const updates = [];
  const params = [];

  if (labels !== undefined) { updates.push('labels=?'); params.push(JSON.stringify(labels)); }
  if (assigned_to !== undefined) { updates.push('assigned_to=?'); params.push(assigned_to); }
  if (notes !== undefined) { updates.push('notes=?'); params.push(notes); }
  if (is_pinned !== undefined) { updates.push('is_pinned=?'); params.push(is_pinned ? 1 : 0); }
  if (is_archived !== undefined) { updates.push('is_archived=?'); params.push(is_archived ? 1 : 0); }
  if (customer_id !== undefined) { updates.push('customer_id=?'); params.push(customer_id); }

  if (updates.length === 0) return res.json({ success: true });

  updates.push("updated_at=datetime('now')");
  params.push(chatId);

  db.prepare(`UPDATE wa_conversations SET ${updates.join(',')} WHERE chat_id=?`).run(...params);
  res.json({ success: true });
});

// ========== 消息发送 ==========

/** 发送文本消息 */
router.post('/send', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa || wa.status !== 'ready') {
    return res.status(400).json({ error: 'WhatsApp 未连接' });
  }

  const { chat_id, phone, content } = req.body;
  const targetId = chat_id || (phone ? `${phone.replace(/[^0-9]/g, '')}@c.us` : null);
  
  if (!targetId || !content) {
    return res.status(400).json({ error: '缺少 chat_id/phone 或 content' });
  }

  try {
    // 防封检查
    const ab = req.app.locals.antiban;
    if (ab) {
      const check = ab.check('whatsapp', 'default', 'send', { content, isNewChat: !chat_id });
      if (!check.allowed) {
        return res.status(429).json({ error: check.reason, antiban: true });
      }
      // 延迟发送
      if (check.delay_ms > 0) {
        await new Promise(r => setTimeout(r, check.delay_ms));
      }
    }

    const msg = await wa.sendMessage(targetId, content);
    
    // 记录操作
    if (ab) ab.recordAction('whatsapp', 'default', 'send');
    
    req.app.locals.auditLog('whatsapp_send', 'wa_message', 0, { to: targetId, content: content.substring(0, 100) });
    res.json({ success: true, msgId: msg.id?._serialized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 发送产品卡片 */
router.post('/send-product', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  const db = req.app.locals.db;

  if (!wa || wa.status !== 'ready') {
    return res.status(400).json({ error: 'WhatsApp 未连接' });
  }

  const { chat_id, product_id } = req.body;
  if (!chat_id || !product_id) return res.status(400).json({ error: '缺少参数' });

  const product = db.prepare('SELECT * FROM products WHERE id=?').get(product_id);
  if (!product) return res.status(404).json({ error: '产品不存在' });

  try {
    await wa.sendProductCard(chat_id, product);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 快捷回复 ==========

/** 获取快捷回复列表 */
router.get('/quick-replies', (req, res) => {
  const db = req.app.locals.db;
  const category = req.query.category;
  let sql = 'SELECT * FROM wa_quick_replies';
  const params = [];
  if (category) { sql += ' WHERE category=?'; params.push(category); }
  sql += ' ORDER BY use_count DESC';
  res.json(db.prepare(sql).all(...params));
});

/** 创建快捷回复 */
router.post('/quick-replies', (req, res) => {
  const db = req.app.locals.db;
  const { shortcut, title, content, category } = req.body;
  if (!shortcut || !content) return res.status(400).json({ error: '缺少快捷键或内容' });

  try {
    const r = db.prepare('INSERT INTO wa_quick_replies (shortcut,title,content,category) VALUES (?,?,?,?)')
      .run(shortcut, title || shortcut, content, category || 'general');
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** 更新快捷回复 */
router.put('/quick-replies/:id', (req, res) => {
  const db = req.app.locals.db;
  const { shortcut, title, content, category } = req.body;
  db.prepare('UPDATE wa_quick_replies SET shortcut=COALESCE(?,shortcut),title=COALESCE(?,title),content=COALESCE(?,content),category=COALESCE(?,category) WHERE id=?')
    .run(shortcut, title, content, category, req.params.id);
  res.json({ success: true });
});

/** 删除快捷回复 */
router.delete('/quick-replies/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM wa_quick_replies WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

/** 使用快捷回复（增加计数） */
router.post('/quick-replies/:id/use', (req, res) => {
  const db = req.app.locals.db;
  const reply = db.prepare('SELECT * FROM wa_quick_replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE wa_quick_replies SET use_count=use_count+1 WHERE id=?').run(req.params.id);
  res.json({ success: true, content: reply.content });
});

// ========== 广播管理 ==========

/** 获取广播列表 */
router.get('/broadcast-lists', (req, res) => {
  const db = req.app.locals.db;
  res.json(db.prepare('SELECT * FROM wa_broadcast_lists ORDER BY created_at DESC').all());
});

/** 创建广播列表 */
router.post('/broadcast-lists', (req, res) => {
  const db = req.app.locals.db;
  const { name, description, contacts, tags } = req.body;
  const r = db.prepare('INSERT INTO wa_broadcast_lists (name,description,contacts,tags) VALUES (?,?,?,?)')
    .run(name, description || '', JSON.stringify(contacts || []), JSON.stringify(tags || []));
  res.json({ success: true, id: r.lastInsertRowid });
});

/** 更新广播列表 */
router.put('/broadcast-lists/:id', (req, res) => {
  const db = req.app.locals.db;
  const { name, description, contacts, tags } = req.body;
  db.prepare('UPDATE wa_broadcast_lists SET name=COALESCE(?,name),description=COALESCE(?,description),contacts=COALESCE(?,contacts),tags=COALESCE(?,tags) WHERE id=?')
    .run(name, description, contacts ? JSON.stringify(contacts) : null, tags ? JSON.stringify(tags) : null, req.params.id);
  res.json({ success: true });
});

/** 删除广播列表 */
router.delete('/broadcast-lists/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM wa_broadcast_lists WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

/** 发起广播 */
router.post('/broadcast', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  const db = req.app.locals.db;

  if (!wa || wa.status !== 'ready') {
    return res.status(400).json({ error: 'WhatsApp 未连接' });
  }

  const { broadcast_list_id, content, delay_ms } = req.body;
  if (!broadcast_list_id || !content) return res.status(400).json({ error: '缺少参数' });

  const list = db.prepare('SELECT * FROM wa_broadcast_lists WHERE id=?').get(broadcast_list_id);
  if (!list) return res.status(404).json({ error: '广播列表不存在' });

  const contacts = JSON.parse(list.contacts || '[]');
  if (contacts.length === 0) return res.status(400).json({ error: '广播列表为空' });

  // 创建广播记录
  const logR = db.prepare('INSERT INTO wa_broadcast_logs (broadcast_id,template_content,total_contacts,status) VALUES (?,?,?,?)')
    .run(broadcast_list_id, content, contacts.length, 'pending');

  // 异步发送
  wa.broadcast(logR.lastInsertRowid, contacts, content, delay_ms || 3000)
    .then(result => {
      req.app.locals.notify('whatsapp_broadcast', {
        message: `广播完成: 发送${result.sent}/${result.total}`,
        ...result
      });
    })
    .catch(err => console.error('[WhatsApp] 广播错误:', err.message));

  req.app.locals.auditLog('whatsapp_broadcast', 'wa_broadcast', logR.lastInsertRowid, {
    list: list.name, contacts: contacts.length
  });

  res.json({ success: true, log_id: logR.lastInsertRowid, total: contacts.length });
});

/** 获取广播记录 */
router.get('/broadcast-logs', (req, res) => {
  const db = req.app.locals.db;
  res.json(db.prepare('SELECT l.*, b.name as list_name FROM wa_broadcast_logs l LEFT JOIN wa_broadcast_lists b ON l.broadcast_id=b.id ORDER BY l.created_at DESC LIMIT 50').all());
});

// ========== 自动回复规则 ==========

/** 获取自动回复规则 */
router.get('/auto-replies', (req, res) => {
  const db = req.app.locals.db;
  res.json(db.prepare('SELECT * FROM wa_auto_replies ORDER BY created_at DESC').all());
});

/** 创建自动回复规则 */
router.post('/auto-replies', (req, res) => {
  const db = req.app.locals.db;
  const { name, trigger_type, trigger_value, reply_content, is_ai, ai_agent, conditions, is_active } = req.body;
  const r = db.prepare(`INSERT INTO wa_auto_replies (name,trigger_type,trigger_value,reply_content,is_ai,ai_agent,conditions,is_active)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, trigger_type || 'keyword', trigger_value || '', reply_content || '', is_ai ? 1 : 0, ai_agent || '', JSON.stringify(conditions || {}), is_active !== false ? 1 : 0);
  res.json({ success: true, id: r.lastInsertRowid });
});

/** 更新自动回复规则 */
router.put('/auto-replies/:id', (req, res) => {
  const db = req.app.locals.db;
  const { name, trigger_type, trigger_value, reply_content, is_ai, ai_agent, is_active } = req.body;
  db.prepare(`UPDATE wa_auto_replies SET 
    name=COALESCE(?,name), trigger_type=COALESCE(?,trigger_type), trigger_value=COALESCE(?,trigger_value),
    reply_content=COALESCE(?,reply_content), is_ai=COALESCE(?,is_ai), ai_agent=COALESCE(?,ai_agent),
    is_active=COALESCE(?,is_active)
    WHERE id=?`)
    .run(name, trigger_type, trigger_value, reply_content, is_ai !== undefined ? (is_ai ? 1 : 0) : null, ai_agent, is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id);
  res.json({ success: true });
});

/** 删除自动回复规则 */
router.delete('/auto-replies/:id', (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM wa_auto_replies WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ========== 数据统计 ==========

/** WhatsApp 统计数据 */
router.get('/stats', (req, res) => {
  const db = req.app.locals.db;
  try {
    const stats = {
      totalConversations: db.prepare('SELECT COUNT(*) as c FROM wa_conversations').get().c,
      activeConversations: db.prepare("SELECT COUNT(*) as c FROM wa_conversations WHERE updated_at >= datetime('now', '-7 days')").get().c,
      unreadCount: db.prepare('SELECT SUM(unread_count) as c FROM wa_conversations').get().c || 0,
      totalMessages: db.prepare('SELECT COUNT(*) as c FROM wa_messages').get().c,
      todayMessages: db.prepare("SELECT COUNT(*) as c FROM wa_messages WHERE created_at >= date('now')").get().c,
      todaySent: db.prepare("SELECT COUNT(*) as c FROM wa_messages WHERE direction='outbound' AND created_at >= date('now')").get().c,
      todayReceived: db.prepare("SELECT COUNT(*) as c FROM wa_messages WHERE direction='inbound' AND created_at >= date('now')").get().c,
      avgResponseTime: 0, // TODO: 计算平均响应时间
      broadcastsSent: db.prepare("SELECT COUNT(*) as c FROM wa_broadcast_logs WHERE status='completed'").get().c,
      autoRepliesActive: db.prepare('SELECT COUNT(*) as c FROM wa_auto_replies WHERE is_active=1').get().c,
      // 最近7天消息趋势
      weeklyTrend: db.prepare(`
        SELECT date(created_at) as day, 
          COUNT(*) as total,
          SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) as inbound,
          SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as outbound
        FROM wa_messages 
        WHERE created_at >= date('now', '-7 days')
        GROUP BY date(created_at)
        ORDER BY day
      `).all(),
      // 标签分布
      labelDistribution: [],
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 号码有效性检测 ==========

/** 检测单个号码 */
router.post('/check-number', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa || wa.status !== 'ready') return res.status(400).json({ error: 'WhatsApp 未连接' });
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: '请提供号码' });
  try {
    const result = await wa.checkNumber(number);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 批量检测号码 */
router.post('/check-numbers', async (req, res) => {
  const wa = req.app.locals.whatsapp;
  if (!wa || wa.status !== 'ready') return res.status(400).json({ error: 'WhatsApp 未连接' });
  const { numbers } = req.body;
  if (!numbers || !Array.isArray(numbers) || !numbers.length) {
    return res.status(400).json({ error: '请提供号码数组' });
  }
  if (numbers.length > 100) {
    return res.status(400).json({ error: '单次最多检测100个号码' });
  }
  try {
    const result = await wa.checkNumbers(numbers);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
