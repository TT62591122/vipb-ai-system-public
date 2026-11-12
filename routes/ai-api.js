/**
 * AI API路由（增强版）
 * - 通用对话
 * - Dashboard建议
 * - 邮件生成
 * - 内容生成
 * - 询盘分析
 * - 风险评估
 * - AI统计
 * - 连接测试
 */
const router = require('express').Router();
const { AIBrain } = require('../src/ai-brain');

// 通用AI对话
router.post('/chat', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const { agent, message, history } = req.body;
    if (!message || !message.trim()) {
      return res.json({ success: false, error: '请输入消息内容' });
    }
    const result = await brain.chat(agent || 'sales', message, history || []);
    res.json(result);
  } catch (err) {
    console.error('[AI Chat Error]', err.message);
    res.json({ success: false, error: '服务器错误: ' + err.message });
  }
});

// Dashboard AI建议
router.post('/dashboard-suggestions', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const result = await brain.getDashboardSuggestions();
    res.json(result);
  } catch (err) {
    console.error('[AI Dashboard Error]', err.message);
    res.json({ success: false, error: '获取AI建议失败: ' + err.message });
  }
});

// 生成邮件
router.post('/generate-email', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const { type, customer_id, context } = req.body;

    // 如果指定了客户ID，查询客户信息
    let customer;
    if (customer_id) {
      customer = req.app.locals.db.prepare('SELECT * FROM customers WHERE id=?').get(customer_id);
    }
    if (!customer) {
      // 如果没有具体客户，用一个默认的
      customer = {
        company: context?.company || 'Target Company',
        country: context?.country || 'Global',
        contact_name: context?.contact_name || 'Sir/Madam',
        email: context?.email || ''
      };
    }

    const result = await brain.generateEmail(type || 'cold', customer, context || {});
    res.json(result);
  } catch (err) {
    console.error('[AI Email Error]', err.message);
    res.json({ success: false, error: '生成邮件失败: ' + err.message });
  }
});

// 生成社媒内容
router.post('/generate-content', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const { platform, topic } = req.body;
    if (!platform || !topic) {
      return res.json({ success: false, error: '请指定平台和主题' });
    }
    const result = await brain.generateContent(platform, topic);
    res.json(result);
  } catch (err) {
    console.error('[AI Content Error]', err.message);
    res.json({ success: false, error: '生成内容失败: ' + err.message });
  }
});

// 分析询盘
router.post('/analyze-inquiry', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const brain = new AIBrain(db);
    const { inquiry_id } = req.body;

    if (!inquiry_id) {
      return res.json({ success: false, error: '请指定询盘ID' });
    }

    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id=?').get(inquiry_id);
    if (!inquiry) {
      return res.json({ success: false, error: '询盘不存在' });
    }

    const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(inquiry.customer_id);
    if (!customer) {
      return res.json({ success: false, error: '关联的客户不存在' });
    }

    const result = await brain.analyzeInquiry(inquiry, customer);
    if (result.success) {
      db.prepare("UPDATE inquiries SET ai_analysis=?, updated_at=datetime('now') WHERE id=?")
        .run(result.result, inquiry_id);
    }
    res.json(result);
  } catch (err) {
    console.error('[AI Analyze Error]', err.message);
    res.json({ success: false, error: '分析询盘失败: ' + err.message });
  }
});

// 风险评估
router.post('/assess-risk', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const result = await brain.assessRisk(req.body);
    res.json(result);
  } catch (err) {
    console.error('[AI Risk Error]', err.message);
    res.json({ success: false, error: '风险评估失败: ' + err.message });
  }
});

// 产品AI描述生成
router.post('/generate-product-description', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const { name, category, specs, targetMarket } = req.body;
    const prompt = `为以下产品生成SEO优化的英文描述:\n\n产品名: ${name || '未指定'}\n类别: ${category || '未指定'}\n规格: ${JSON.stringify(specs || {})}\n目标市场: ${targetMarket || '全球'}\n\n要求:\n- 英文撰写，200-400词\n- 突出技术规格和认证\n- SEO关键词自然融入\n- 结尾加采购引导CTA`;
    const result = await brain.callAgent('content', prompt);
    res.json(result);
  } catch (err) {
    console.error('[AI Product Error]', err.message);
    res.json({ success: false, error: '生成产品描述失败: ' + err.message });
  }
});

// AI统计
router.get('/stats', (req, res) => {
  try {
    const db = req.app.locals.db;
    const brain = new AIBrain(db);
    res.json({
      success: true,
      stats: brain.getQuickStats(),
      agents: Object.entries(brain.getAgents()).map(([k, v]) => ({
        key: k, name: v.name, icon: v.icon, model: v.model
      })),
      todayCost: brain.costController.getTodayCost(),
      monthCost: brain.costController.getMonthCost()
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// AI连接测试
router.post('/test-connection', async (req, res) => {
  try {
    const brain = new AIBrain(req.app.locals.db);
    const provider = brain._getProvider();
    if (!provider) {
      return res.json({ success: false, error: '未配置AI Provider' });
    }
    // 发一个简短测试消息
    const result = await brain.callAgent('sales', '请回复"连接测试成功"这5个字。', { noCache: true, maxTokens: 50 });
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
