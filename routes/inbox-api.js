/**
 * 统一收件箱 API
 */
const router = require('express').Router();
const { AICommandEngine } = require('../src/ai-command-engine');

// 对话列表
router.get('/conversations', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.json({ data: [], pagination: {} });
  res.json(inbox.getConversations({
    channel: req.query.channel,
    status: req.query.status || 'open',
    assigned_to: req.query.assigned_to,
    priority: req.query.priority,
    unread_only: req.query.unread === '1',
    search: req.query.search,
    label: req.query.label,
    category: req.query.category || 'customer',
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 30,
  }));
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 对话消息
router.get('/conversations/:id/messages', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.json([]);
  res.json(inbox.getMessages(parseInt(req.params.id), parseInt(req.query.limit) || 50, req.query.before ? parseInt(req.query.before) : null));
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// AI 建议
router.get('/conversations/:id/ai-suggest', async (req, res) => {
  try {
    const inbox = req.app.locals.inbox;
    if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });

    // AICommandEngine 不是全局实例，需要按需创建
    const { AICommandEngine } = require('../src/ai-command-engine');
    const aiEngine = new AICommandEngine(req.app.locals.db);

    const conversationId = parseInt(req.params.id);
    if (isNaN(conversationId)) {
        return res.status(400).json({ success: false, error: '无效的会话ID' });
    }

    // 获取最近5条消息作为AI上下文
    const rawMessages = await inbox.getMessages(conversationId, 5);

    // 获取会话详情
    const conversation = inbox.db.prepare('SELECT * FROM inbox_conversations WHERE id=?').get(conversationId);

    if (!conversation) {
      return res.status(404).json({ success: false, error: '会话不存在' });
    }

    // 转换消息格式
    const messages = rawMessages.map(msg => ({
      role: msg.direction === 'in' ? 'user' : 'assistant',
      content: msg.content
    }));

    let companyBlock = '';
    const company = aiEngine._getCompanyInfo();
    if (company) {
      companyBlock = `
## 公司信息（请参考生成邮件/内容）
- 公司英文名: ${company.name || ''}
- 公司中文名: ${company.name_cn || ''}
- 产品: ${company.products || ''}
- 目标市场: ${company.markets || ''}
`;
    }

    const systemPrompt = `你是一个外贸业务专家，请根据以下会话历史，为我提供一个简洁专业的英文回复建议。请注意，回复内容应直接、有效，避免客套，直击业务核心。如果邮件包含系统信息、验证码、推广内容，你应识别并建议忽略。如果对话是客户询盘，请尝试给出报价或下一步的行动建议。
当前会话信息：
- 渠道: ${conversation.channel || ''}
- 联系人: ${conversation.contact_name || ''}
- 主题: ${conversation.subject || ''}
${companyBlock}
`;
    
    // 构建最终发送给AI的messages
    const aiMessages = [{ role: 'system', content: systemPrompt }, ...messages, { role: 'user', content: '请根据以上对话，提供一个专业的英文回复建议。' }];

    const options = {
      max_tokens: 500,
      temperature: 0.5
    };

    const aiResponse = await aiEngine._callAI('text', aiMessages, options);

    if (aiResponse && aiResponse.content) {
      res.json({ success: true, suggestion: aiResponse.content });
    } else {
      console.warn('[Inbox] AI建议：未能获取有效的AI回复', aiResponse);
      res.status(500).json({ success: false, error: 'AI建议获取失败：未能获取有效的AI回复' });
    }

  } catch (e) {
    console.error('[Inbox] AI建议获取失败:', e.message, e.stack);
    res.status(500).json({ success: false, error: 'AI建议获取失败: ' + e.message });
  }
});

// 回复消息（通过inbox-sync-engine发送+记录）
router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const inboxSync = req.app.locals.inboxSync;
    const inbox = req.app.locals.inbox;
    if (!inboxSync && !inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });

    const conversationId = parseInt(req.params.id);
    const { message, content_type } = req.body;
    if (!message) return res.status(400).json({ success: false, error: '消息内容不能为空' });

    if (inboxSync) {
      // 优先用inboxSync（会调用平台发送API + 写入outgoing消息）
      const result = await inboxSync.sendReply(conversationId, message, { content_type });
      return res.json(result);
    }

    // 降级：只写入本地记录（不实际发送）
    const conv = inbox.db.prepare('SELECT * FROM inbox_conversations WHERE id=?').get(conversationId);
    if (!conv) return res.status(404).json({ success: false, error: '对话不存在' });
    inbox.receiveMessage(conv.channel, conv.channel_id, {
      direction: 'out', sender_name: 'Me', content: message, content_type: content_type || 'text'
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[Inbox] 回复失败:', e.message);
    res.status(500).json({ success: false, error: '回复失败: ' + e.message });
  }
});

// 标记已读
router.post('/conversations/:id/read', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });
  inbox.markRead(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 更新对话
router.put('/conversations/:id', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });
  inbox.updateConversation(parseInt(req.params.id), req.body);
  res.json({ success: true });
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 关闭对话
router.post('/conversations/:id/close', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });
  inbox.closeConversation(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 发送消息（统一出口）
router.post('/send', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });
  const { conversation_id, content, content_type } = req.body;
  if (!conversation_id || !content) return res.status(400).json({ success: false, error: '缺少参数' });

  const conv = inbox.db.prepare('SELECT * FROM inbox_conversations WHERE id=?').get(conversation_id);
  if (!conv) return res.status(404).json({ success: false, error: '对话不存在' });

  // 写入统一收件箱
  const msg = inbox.receiveMessage(conv.channel, conv.channel_id, {
    direction: 'out',
    sender_name: 'Me',
    content,
    content_type: content_type || 'text',
  });

  // TODO: 根据channel调用对应的发送引擎（WhatsApp/Email/LinkedIn）
  // 目前先记录，实际发送需要各渠道引擎配合

  res.json({ success: true, message: msg });
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 快捷回复
router.get('/canned', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.json([]);
  res.json(inbox.getCannedResponses(req.query.channel));
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/canned', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });
  const id = inbox.addCannedResponse(req.body);
  res.json({ success: true, id });
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/canned/:id', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.status(500).json({ success: false, error: '收件箱未初始化' });
  inbox.deleteCannedResponse(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 统计
router.get('/stats', (req, res) => {
  try {
  const inbox = req.app.locals.inbox;
  if (!inbox) return res.json({});
  res.json(inbox.getStats());
  } catch(e) { console.error('[Inbox] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
