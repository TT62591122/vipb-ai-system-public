/**
 * AI任务中心引擎
 * 用户自然语言指令 → 主脑AI解析意图 → 调度专家Agent → 执行系统动作 → 汇总结果
 */
const axios = require('axios');
const { decrypt } = require('./crypto-utils');
const { getAgentMemory } = require('./agent-memory');

const AGENTS = {
  sales: { name: '销售专家', icon: '🧑‍💼', description: '询盘分析·报价·客户跟进' },
  email: { name: '邮件专家', icon: '📧', description: '邮件撰写·跟进·Spam检测' },
  analytics: { name: '数据分析', icon: '📊', description: '数据报表·趋势分析·工作建议' },
  content: { name: '内容专家', icon: '📝', description: '社媒文案·产品描述·SEO内容' },
  market: { name: '市场调研', icon: '🔍', description: '市场分析·竞品调研·行业认证' },
  risk: { name: '风控专家', icon: '🛡️', description: '欺诈检测·付款风险·合规审查' }
};

const SYSTEM_ACTIONS = {
  search_customers: { description: '搜索客户', params: ['query'] },
  get_customer: { description: '获取客户详情', params: ['id'] },
  list_customers: { description: '客户列表', params: ['page', 'limit'] },
  list_email_accounts: { description: '邮箱账号列表', params: [] },
  search_emails: { description: '搜索邮件', params: ['keyword'] },
  list_products: { description: '产品列表', params: [] },
  get_product: { description: '产品详情（支持id或keyword关键词搜索型号/名称）', params: ['id', 'keyword'] },
  list_social_accounts: { description: '社媒账号列表', params: [] },
  get_dashboard_stats: { description: '仪表盘统计', params: [] },
  get_email_stats: { description: '邮件统计', params: ['period'] },
  generate_content: { description: 'AI生成内容', params: ['type', 'topic', 'language'] },
  translate: { description: '翻译', params: ['text', 'from', 'to'] },
  send_email: { description: '发送邮件给客户', params: ['to', 'subject', 'body', 'customer_id', 'from_account'] },
  schedule_email: { description: '定时发送邮件（支持明天/指定日期/延迟小时）', params: ['to', 'subject', 'body', 'customer_id', 'send_at', 'from_account'] },
  publish_tiktok: { description: '发布视频到TikTok', params: ['video_path', 'title', 'privacy_level'] }
};

class AICommandEngine {
  constructor(db) {
    this.db = db;
  }

  _getAllProviders(role) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='ai_providers'").get();
      if (!row) return [];
      const data = JSON.parse(row.value);
      let providers = [];
      if (Array.isArray(data)) {
        providers = role === 'text' ? data.filter(p => p.enabled !== false && p.baseUrl && p.apiKey) : [];
      } else {
        providers = (data[role] || []).filter(p => p.enabled !== false && p.baseUrl && p.apiKey);
      }
      // 解密 apiKey
      return providers.map(p => ({ ...p, apiKey: p.apiKey ? decrypt(p.apiKey) : '' }));
    } catch (e) { return []; }
  }

  async _callAI(role, messages, options = {}) {
    const providers = this._getAllProviders(role);
    if (!providers.length) throw new Error(`没有可用的${role}引擎，请在设置中配置`);

    let lastError;
    for (const provider of providers) {
      try {
        let url = provider.baseUrl.replace(/\/+$/, '');
        const model = options.model || provider.model || 'gpt-4o';

        // Gemini原生图片生成（/v1beta/models/{model}:generateContent）
        const isGemini = model.toLowerCase().includes('gemini');
        if (role === 'vision' && isGemini) {
          const geminiUrl = url.replace(/\/v1(beta)?.*$/, '') + `/v1beta/models/${model}:generateContent`;
          const userMsgs = messages.filter(m => m.role === 'user');
          const userMsg = userMsgs[userMsgs.length - 1]; // 取最后一个user消息（当前prompt）
          const sysMsg = messages.find(m => m.role === 'system');
          // 把system信息合并到prompt中（Gemini不支持system role）
          let prompt = userMsg?.content || options.prompt || '';
          if (sysMsg?.content) {
            const companyMatch = sysMsg.content.match(/公司信息[\s\S]*?网站:\s*\S+/);
            if (companyMatch) prompt = companyMatch[0] + '\n\n' + prompt;
          }

          // 构建parts（文本 + 可选的输入图片）
          const parts = [{ text: prompt }];
          if (options.inputImage) {
            parts.push({ inline_data: { mime_type: options.inputImageMime || 'image/png', data: options.inputImage } });
          }

          const body = {
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: {
                aspectRatio: options.aspectRatio || '1:1',
                imageSize: options.imageSize || '2K'
              }
            }
          };

          const resp = await axios.post(geminiUrl, body, {
            headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
            timeout: options.timeout || 180000
          });

          // 解析Gemini响应：candidates[].content.parts[] 中找 inlineData
          const candidates = resp.data?.candidates || [];
          let imageData = null, textContent = '';
          for (const candidate of candidates) {
            for (const part of (candidate.content?.parts || [])) {
              if (part.inlineData || part.inline_data) {
                const d = part.inlineData || part.inline_data;
                imageData = { mimeType: d.mimeType || d.mime_type || 'image/png', data: d.data };
              }
              if (part.text) textContent += part.text;
            }
          }

          if (imageData) {
            const content = `![image](data:${imageData.mimeType};base64,${imageData.data})`;
            return { content, model, usage: resp.data?.usageMetadata || {}, provider: provider.name, type: 'image' };
          }
          // 没有图片则返回文本
          return { content: textContent || JSON.stringify(resp.data), model, usage: resp.data?.usageMetadata || {}, provider: provider.name };
        }

        // 非Gemini视觉引擎：OpenAI兼容的图片生成 (/v1/images/generations)
        if (role === 'vision' && options.imageGeneration) {
          if (!url.includes('/v1/images/generations')) {
            url = url.includes('/v1') ? url.replace(/\/v1.*/, '/v1/images/generations') : url + '/v1/images/generations';
          }
          const body = {
            model,
            prompt: options.prompt || (messages.find(m => m.role === 'user')?.content) || '',
            n: options.n || 1,
            size: options.size || '1024x1024'
          };
          const resp = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
            timeout: options.timeout || 120000
          });
          return {
            content: resp.data?.data?.[0]?.url || resp.data?.data?.[0]?.b64_json || JSON.stringify(resp.data),
            model: resp.data?.model || model,
            usage: resp.data?.usage || {},
            provider: provider.name,
            type: 'image'
          };
        }

        // 视频引擎：支持视频生成API（异步任务模式）
        if (role === 'video' && options.videoGeneration) {
          // 尝试 /v1/videos/generations（通用视频生成接口）
          if (!url.includes('/v1/videos')) {
            url = url.includes('/v1') ? url.replace(/\/v1.*/, '/v1/videos/generations') : url + '/v1/videos/generations';
          }
          const body = {
            model,
            prompt: options.prompt || (messages.find(m => m.role === 'user')?.content) || '',
            ...(options.videoParams || {})
          };
          const resp = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
            timeout: options.timeout || 180000
          });
          return {
            content: resp.data?.data?.[0]?.url || resp.data?.id || JSON.stringify(resp.data),
            model: resp.data?.model || model,
            usage: resp.data?.usage || {},
            provider: provider.name,
            type: 'video',
            taskId: resp.data?.id || resp.data?.task_id
          };
        }

        // 默认：标准 chat/completions（主脑/文本/视觉多模态分析/视频脚本生成）
        if (!url.includes('/v1/chat/completions')) {
          url = url.includes('/v1') ? url + '/chat/completions' : url + '/v1/chat/completions';
        }
        const body = {
          model,
          messages,
          max_tokens: options.max_tokens || 4096,
          temperature: options.temperature ?? 0.7
        };
        if (options.response_format) body.response_format = options.response_format;

        const resp = await axios.post(url, body, {
          headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
          timeout: options.timeout || 120000
        });
        return {
          content: resp.data.choices[0].message.content,
          model: resp.data.model,
          usage: resp.data.usage || {},
          provider: provider.name
        };
      } catch (err) {
        lastError = err;
        console.warn(`[AICommand] ${role} "${provider.name}" 失败: ${err.message}`);
      }
    }
    throw new Error(`所有${role}引擎均失败: ${lastError?.message}`);
  }

  _resolveEmailAccount(db, params) {
    // 第1层：指令级指定
    if (params.from_account) {
      // 支持ID或邮箱或别名
      const byId = db.prepare("SELECT * FROM email_accounts WHERE id=? AND is_active=1").get(params.from_account);
      if (byId) return byId;
      const byEmail = db.prepare("SELECT * FROM email_accounts WHERE email LIKE ? AND is_active=1").get('%' + params.from_account + '%');
      if (byEmail) return byEmail;
      // 别名匹配：企业邮箱、Gmail等
      if (/企业|enterprise|chinavipb/i.test(params.from_account)) {
        const ent = db.prepare("SELECT * FROM email_accounts WHERE email LIKE '%chinavipb%' AND is_active=1").get();
        if (ent) return ent;
      }
      if (/gmail|个人/i.test(params.from_account)) {
        const gm = db.prepare("SELECT * FROM email_accounts WHERE email LIKE '%gmail%' AND is_active=1").get();
        if (gm) return gm;
      }
    }

    // 第2层：客户绑定
    const to = params.to;
    if (to) {
      const cust = db.prepare("SELECT preferred_email_account_id FROM customers WHERE email=?").get(to);
      if (cust && cust.preferred_email_account_id) {
        const bound = db.prepare("SELECT * FROM email_accounts WHERE id=? AND is_active=1").get(cust.preferred_email_account_id);
        if (bound) return bound;
      }
    }

    // 第3层：渠道默认
    const defaultId = db.prepare("SELECT value FROM settings WHERE key='default_email_account_id'").get();
    if (defaultId && defaultId.value) {
      const def = db.prepare("SELECT * FROM email_accounts WHERE id=? AND is_active=1").get(parseInt(defaultId.value));
      if (def) return def;
    }

    // 第4层：智能轮询（现有逻辑）
    return db.prepare("SELECT * FROM email_accounts WHERE is_active=1 ORDER BY daily_sent ASC LIMIT 1").get();
  }

  async processCommand(userInput) {
    this.db.prepare("INSERT INTO ai_conversations (role, content) VALUES ('user', ?)").run(userInput);
    const task = this.db.prepare("INSERT INTO ai_tasks (user_input, status, started_at) VALUES (?, 'running', datetime('now'))").run(userInput);
    const taskId = task.lastInsertRowid;

    try {
      const brain = await this._callBrain(userInput);
      this.db.prepare("UPDATE ai_tasks SET parsed_intent=?, sub_tasks=?, brain_provider=? WHERE id=?")
        .run(brain.intent, JSON.stringify(brain.plan), brain.provider || '', taskId);

      const results = [];
      for (const step of brain.plan) {
        // 将前面步骤的结果注入当前步骤的参数（替换占位符引用）
        this._injectStepResults(step, results);
        const r = await this._executeStep(taskId, step);
        results.push(r);
        if (!r.success && step.critical !== false) break;
      }

      const summary = results.length === 1 && results[0].success && results[0].content
        ? results[0].content
        : await this._generateSummary(userInput, results);

      const totalCost = results.reduce((s, r) => s + (r.cost || 0), 0);
      const totalTokens = results.reduce((s, r) => s + (r.tokens || 0), 0);
      this.db.prepare("UPDATE ai_tasks SET status='completed', result=?, total_cost=?, total_tokens=?, completed_at=datetime('now') WHERE id=?")
        .run(summary, totalCost, totalTokens, taskId);
      this.db.prepare("INSERT INTO ai_conversations (role, content, task_id) VALUES ('assistant', ?, ?)").run(summary, taskId);

      return { success: true, taskId, summary, steps: results, cost: totalCost, tokens: totalTokens };
    } catch (err) {
      this.db.prepare("UPDATE ai_tasks SET status='failed', result=?, completed_at=datetime('now') WHERE id=?").run(err.message, taskId);
      const msg = `执行失败: ${err.message}`;
      this.db.prepare("INSERT INTO ai_conversations (role, content, task_id) VALUES ('assistant', ?, ?)").run(msg, taskId);
      return { success: false, taskId, error: err.message };
    }
  }

  _getCompanyInfo() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='company_info'").get();
      if (row) return JSON.parse(row.value);
    } catch (e) {}
    return null;
  }

  async _callBrain(userInput) {
    const company = this._getCompanyInfo();
    const companyBlock = company ? `\n## 公司信息（生成邮件/内容时必须使用）
- 公司英文名: ${company.name || ''}
- 公司中文名: ${company.name_cn || ''}
- 产品: ${company.products || ''}
- 目标市场: ${company.markets || ''}
- 电话/WhatsApp: ${company.phone || ''}
- 网站: ${company.website || ''}
` : '';

    // 获取可用邮箱账号列表
    const emailAccounts = this.db.prepare("SELECT id, email, auth_type FROM email_accounts WHERE is_active=1").all();
    const accountList = emailAccounts.map(a => `  - ID:${a.id} ${a.email} (${a.auth_type === 'gmail_api' ? 'Gmail API企业邮箱' : 'SMTP'})`).join('\n');

    // 双层知识注入：从agent-memory读取动态经验+客户画像+策略
    let knowledgeBlock = '';
    try {
      const memory = getAgentMemory(this.db);
      if (memory) {
        knowledgeBlock = memory.buildKnowledgeInjection({ taskType: null, keywords: null });
      }
    } catch (e) {
      console.warn('[AICommand] 知识注入失败:', e.message);
    }

    // 外贸方法论+产品知识注入（来自knowledge_base表）
    let tradeKnowledgeBlock = '';
    try {
      const kbRows = this.db.prepare("SELECT category, key, value FROM knowledge_base WHERE category IN ('trade_methodology','product_smart_meter','product_circuit_breaker')").all();
      if (kbRows.length > 0) {
        const grouped = {};
        kbRows.forEach(r => {
          if (!grouped[r.category]) grouped[r.category] = [];
          try { grouped[r.category].push(`[${r.key}]: ${JSON.stringify(JSON.parse(r.value))}`); }
          catch { grouped[r.category].push(`[${r.key}]: ${r.value}`); }
        });
        const parts = [];
        if (grouped.trade_methodology) parts.push('### 外贸方法论\n' + grouped.trade_methodology.join('\n'));
        if (grouped.product_smart_meter) parts.push('### 电能表产品知识\n' + grouped.product_smart_meter.join('\n'));
        if (grouped.product_circuit_breaker) parts.push('### 断路器产品知识\n' + grouped.product_circuit_breaker.join('\n'));
        if (parts.length) tradeKnowledgeBlock = '\n## 外贸与产品知识库\n' + parts.join('\n\n');
      }
    } catch (e) {
      console.warn('[AICommand] 外贸知识注入失败:', e.message);
    }

    const systemPrompt = `你是VIPB AI系统的主脑，负责理解用户指令并制定执行计划。
${companyBlock}${knowledgeBlock ? '\n' + knowledgeBlock : ''}${tradeKnowledgeBlock}
## 可用专家Agent
${Object.entries(AGENTS).map(([k, v]) => `- ${v.icon} ${v.name}(${k}): ${v.description}`).join('\n')}

## 可用系统动作
${Object.entries(SYSTEM_ACTIONS).map(([k, v]) => `- ${k}: ${v.description}`).join('\n')}

## 可用邮箱账号
${accountList || '  (暂无可用邮箱账号)'}

用户说"企业邮箱"指chinavipb.com的账号，说"Gmail"指gmail.com的账号。
send_email的from_account参数可填邮箱地址、账号ID、或"企业邮箱"/"Gmail"等别名。不指定则自动选择。

## 输出格式（严格JSON）
{
  "intent": "一句话描述用户意图",
  "plan": [
    { "step": 1, "agent": "agent名", "engine": "text|video|vision", "action": "动作名或ai_generate", "params": {}, "description": "做什么" }
  ]
}

如果只是问答/生成内容，action用"ai_generate"，params里放{"prompt":"具体prompt"}。

## 【核心规则】宣传图片生成
当需要为产品生成宣传图/推销图/海报时，必须遵守：
1. 第一步必须先用 get_product 获取产品信息和真实产品图片路径
2. 生成图片的步骤中，params必须包含 "reference_image": "{{step1.data.images}}"，系统会自动读取产品真实图片作为参考输入
3. prompt中必须明确说明"基于提供的产品实物图片进行设计"，禁止让AI凭空生成产品外观
4. 这样确保宣传图中的产品外观与公司真实产品一致

## 【核心规则】邮件图片处理
当邮件需要包含宣传图/产品图时：
1. send_email 和 schedule_email 的 params 中使用 "inline_images" 数组（不是 attachments）
2. 格式：{"inline_images": ["{{step2.content中的图片路径}}"]}，或直接引用 "inline_images": ["{{stepN.image_path}}"]
3. 系统会自动将图片内嵌到邮件HTML正文中（客户打开邮件直接看到图片，无需下载附件）

【重要】当ai_generate步骤的输出将用于send_email或schedule_email的body时，prompt必须明确要求：
- 只输出纯邮件正文内容，不要加任何说明性文字（如"以下是邮件文案"、"请确认"、"需要我修改吗"等）
- 不要在正文中重复Subject行
- 直接从称呼（Dear/Hi/您好）开始，到签名结束
后续步骤需要引用前面步骤的结果时，在params中使用 {{stepN.content}} 或 {{stepN.data.字段名}} 占位符，例如：
- step3的body参数引用step2生成的文案：{"body": "{{step2.content}}"}
- step4引用step1获取的产品名：{"subject": "{{step1.data.name}} - Special Offer"}
只输出JSON。`;

    // 读取最近对话历史（最多10轮），让主脑有上下文记忆
    const recentConvos = this.db.prepare(
      "SELECT role, content FROM ai_conversations ORDER BY id DESC LIMIT 20"
    ).all().reverse();

    const historyMessages = recentConvos
      .filter(c => c.role === 'user' || c.role === 'assistant')
      .map(c => ({ role: c.role, content: c.content.substring(0, 1500) }));

    const resp = await this._callAI('brain', [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userInput }
    ], { temperature: 0.3 });

    try {
      // 尝试提取JSON（可能被markdown包裹）
      let jsonStr = resp.content;
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1];
      const parsed = JSON.parse(jsonStr.trim());
      return { intent: parsed.intent || userInput, plan: parsed.plan || [], provider: resp.provider };
    } catch (e) {
      return {
        intent: userInput,
        plan: [{ step: 1, agent: 'content', engine: 'text', action: 'ai_generate', params: { prompt: userInput }, description: '直接回答' }],
        provider: resp.provider
      };
    }
  }

  /**
   * 将前面步骤的结果注入当前步骤的参数
   * 替换 {{stepN...}} 占位符为实际结果内容
   * 同时将前面步骤的结果作为上下文附加到 ai_generate 的 prompt 中
   */
  _injectStepResults(step, previousResults) {
    if (!previousResults.length) return;

    // 构建步骤结果映射（保留完整结果对象）
    const resultObjs = {};
    previousResults.forEach((r, idx) => {
      resultObjs[idx + 1] = r;
    });

    // 递归替换字符串中的 {{stepN.path}} 占位符
    const replacePlaceholders = (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(/\{\{step(\d+)(\.[\w.]+)?\}\}/gi, (match, stepNum, path) => {
        const num = parseInt(stepNum);
        const result = resultObjs[num];
        if (!result) return match;
        
        if (!path) {
          // {{stepN}} — 返回 content 或 data 的 JSON
          return result.content || (result.data ? JSON.stringify(result.data) : result.error || match);
        }
        
        // {{stepN.content}} / {{stepN.data.name}} 等路径解析
        const keys = path.substring(1).split('.');
        let val = result;
        for (const key of keys) {
          if (val && typeof val === 'object' && key in val) {
            val = val[key];
          } else {
            return match; // 路径无效，保留原始占位符
          }
        }
        return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      });
    };

    // 替换 params 中所有字符串值
    if (step.params) {
      for (const key of Object.keys(step.params)) {
        step.params[key] = replacePlaceholders(step.params[key]);
      }
    }
    step.description = replacePlaceholders(step.description || '');

    // 对于 ai_generate 步骤，将前面步骤的结果作为上下文注入 prompt
    if (step.action === 'ai_generate' && previousResults.length > 0) {
      const context = previousResults
        .filter(r => r.success && r.content)
        .map(r => `[Step${r.step}结果]: ${r.content.substring(0, 2000)}`)
        .join('\n\n');
      if (context && step.params?.prompt) {
        step.params.prompt = `前置步骤结果：\n${context}\n\n当前任务：${step.params.prompt}`;
      }
    }
  }

  async _executeStep(taskId, step) {
    const rec = this.db.prepare(
      "INSERT INTO ai_task_steps (task_id, step_order, agent, engine, action, input, status, started_at) VALUES (?,?,?,?,?,?,'running',datetime('now'))"
    ).run(taskId, step.step, step.agent || 'content', step.engine || 'text', step.action, JSON.stringify(step.params || {}));
    const stepId = rec.lastInsertRowid;

    try {
      let result;
      if (step.action === 'ai_generate' || step.action === 'generate_content') {
        // generate_content 和 ai_generate 都走 _aiGenerate，保留step中指定的engine
        result = await this._aiGenerate(step);
      } else if (SYSTEM_ACTIONS[step.action]) {
        result = await this._executeSystemAction(step.action, step.params || {});
      } else {
        result = { success: false, error: `未知动作: ${step.action}` };
      }
      this.db.prepare("UPDATE ai_task_steps SET status=?, output=?, cost=?, tokens=?, completed_at=datetime('now') WHERE id=?")
        .run(result.success ? 'completed' : 'failed', JSON.stringify(result).substring(0, 50000), result.cost || 0, result.tokens || 0, stepId);
      return { ...result, step: step.step, description: step.description };
    } catch (err) {
      this.db.prepare("UPDATE ai_task_steps SET status='failed', output=?, completed_at=datetime('now') WHERE id=?")
        .run(JSON.stringify({ error: err.message }), stepId);
      return { success: false, error: err.message, step: step.step, description: step.description };
    }
  }

  async _aiGenerate(step) {
    const engine = step.engine || 'text';
    const prompt = step.params?.prompt || step.description;
    const agentInfo = AGENTS[step.agent] || AGENTS.content;
    const company = this._getCompanyInfo();
    const companyCtx = company ? `\n\n公司信息（生成内容时必须使用正确的公司名称）：
公司英文名: ${company.name || ''}, 公司中文名: ${company.name_cn || ''}, 产品: ${company.products || ''}, 目标市场: ${company.markets || ''}, WhatsApp: ${company.phone || ''}, 网站: ${company.website || ''}` : '';

    // 双层知识注入
    let knowledgeCtx = '';
    try {
      const memory = getAgentMemory(this.db);
      if (memory) {
        const taskType = step.action === 'send_email' || step.action === 'schedule_email' ? 'send_email' : null;
        knowledgeCtx = memory.buildKnowledgeInjection({ taskType, keywords: (prompt || '').substring(0, 100) });
      }
    } catch (e) { /* 知识注入失败不影响主流程 */ }

    // 如果有reference_image参数，读取产品真实图片作为参考输入
    let inputImageOptions = {};
    if (engine === 'vision' && step.params?.reference_image) {
      try {
        const fs = require('fs');
        const path = require('path');
        let imgPaths = step.params.reference_image;
        // 解析图片路径（可能是JSON数组字符串）
        if (typeof imgPaths === 'string') {
          try { imgPaths = JSON.parse(imgPaths); } catch(e) { imgPaths = [imgPaths]; }
        }
        if (!Array.isArray(imgPaths)) imgPaths = [imgPaths];
        // 取第一张有效图片
        for (const imgUrl of imgPaths) {
          const relPath = imgUrl.replace(/^\//, '');
          const fullPath = path.join(__dirname, '..', 'data', relPath);
          if (fs.existsSync(fullPath)) {
            const imgBuffer = fs.readFileSync(fullPath);
            const ext = path.extname(fullPath).toLowerCase();
            const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
            inputImageOptions = {
              inputImage: imgBuffer.toString('base64'),
              inputImageMime: mimeMap[ext] || 'image/jpeg'
            };
            console.log(`[AI] 使用产品真实图片作为参考: ${fullPath} (${(imgBuffer.length/1024).toFixed(1)}KB)`);
            break;
          }
        }
      } catch(e) {
        console.warn('[AI] 读取参考图片失败:', e.message);
      }
    }

    // 读取最近对话历史，让内容生成引擎也有上下文记忆
    const recentConvos = this.db.prepare(
      "SELECT role, content FROM ai_conversations ORDER BY id DESC LIMIT 10"
    ).all().reverse()
      .filter(c => c.role === 'user' || c.role === 'assistant')
      .map(c => ({ role: c.role, content: c.content.substring(0, 800) }));

    const resp = await this._callAI(engine === 'brain' ? 'text' : engine, [
      { role: 'system', content: `你是VIPB AI系统的${agentInfo.name}。请根据要求完成任务。用中文回答（除非用户要求其他语言）。${companyCtx}${knowledgeCtx}` },
      ...(engine === 'vision' ? [] : recentConvos),  // vision引擎不注入对话历史，避免干扰图片生成
      { role: 'user', content: prompt }
    ], inputImageOptions);

    // 如果是图片生成，提取base64并保存到文件
    let content = resp.content;
    if (engine === 'vision' && content) {
      const imgMatch = content.match(/data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)/);
      if (imgMatch) {
        try {
          const fs = require('fs');
          const path = require('path');
          const ext = imgMatch[1] === 'jpeg' ? 'jpg' : imgMatch[1];
          const filename = `ai_generated_${Date.now()}.${ext}`;
          const imgDir = path.join(__dirname, '..', 'data', 'product-images');
          if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
          const filePath = path.join(imgDir, filename);
          fs.writeFileSync(filePath, Buffer.from(imgMatch[2], 'base64'));
          const fileUrl = `/product-images/${filename}`;
          content = `图片已生成并保存: ${fileUrl}\n\n原始prompt: ${prompt}`;
          console.log(`[AI] 图片已保存: ${filePath} (${(Buffer.from(imgMatch[2], 'base64').length/1024).toFixed(1)}KB)`);
          // 返回结果中包含图片路径，方便后续步骤引用
          return { success: true, content, image_path: fileUrl, image_full_path: filePath, provider: resp.provider, cost: this._cost(resp.usage), tokens: resp.usage?.total_tokens || 0 };
        } catch (imgErr) {
          console.error('[AI] 图片保存失败:', imgErr.message);
        }
      }
    }

    return { success: true, content, provider: resp.provider, cost: this._cost(resp.usage), tokens: resp.usage?.total_tokens || 0 };
  }

  async _executeSystemAction(action, params) {
    const db = this.db;
    switch (action) {
      case 'search_customers': {
        const q = `%${params.query || ''}%`;
        const rows = db.prepare("SELECT id,company,contact_name,email,phone,country,stage FROM customers WHERE company LIKE ? OR contact_name LIKE ? OR email LIKE ? LIMIT 20").all(q, q, q);
        return { success: true, data: rows, count: rows.length };
      }
      case 'get_customer': {
        const row = db.prepare("SELECT * FROM customers WHERE id=?").get(params.id);
        return row ? { success: true, data: row } : { success: false, error: '客户不存在' };
      }
      case 'list_customers': {
        const limit = params.limit || 20, page = params.page || 1;
        const rows = db.prepare("SELECT id,company,contact_name,email,country,stage FROM customers ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, (page - 1) * limit);
        const total = db.prepare("SELECT COUNT(*) as c FROM customers").get().c;
        return { success: true, data: rows, total };
      }
      case 'list_email_accounts': {
        const rows = db.prepare("SELECT id,email,display_name,smtp_host,is_active,daily_sent,daily_limit FROM email_accounts").all();
        return { success: true, data: rows };
      }
      case 'search_emails': {
        const q = `%${params.keyword || ''}%`;
        const rows = db.prepare("SELECT id,to_addr,subject,status,sent_at FROM emails WHERE subject LIKE ? OR to_addr LIKE ? ORDER BY created_at DESC LIMIT 20").all(q, q);
        return { success: true, data: rows, count: rows.length };
      }
      case 'list_products': {
        const rows = db.prepare("SELECT id,name,model,category,price_100 as price,currency FROM products ORDER BY created_at DESC LIMIT 50").all();
        return { success: true, data: rows };
      }
      case 'get_product': {
        let row;
        if (params.id) {
          row = db.prepare("SELECT * FROM products WHERE id=?").get(params.id);
        } else if (params.keyword) {
          row = db.prepare("SELECT * FROM products WHERE model LIKE ? OR name LIKE ?").get(`%${params.keyword}%`, `%${params.keyword}%`);
        }
        return row ? { success: true, data: row } : { success: false, error: `产品不存在 (搜索: ${params.id || params.keyword})` };
      }
      case 'list_social_accounts': {
        try {
          const rows = db.prepare("SELECT id,platform,display_name,status FROM social_accounts WHERE status='active'").all();
          return { success: true, data: rows };
        } catch (e) { return { success: true, data: [], note: '社媒账号表未创建' }; }
      }
      case 'get_dashboard_stats': {
        const customers = db.prepare("SELECT COUNT(*) as c FROM customers").get().c;
        const emails_sent = db.prepare("SELECT COUNT(*) as c FROM emails WHERE status='sent'").get().c;
        const products = db.prepare("SELECT COUNT(*) as c FROM products").get().c;
        return { success: true, data: { customers, emails_sent, products } };
      }
      case 'get_email_stats': {
        const days = params.period === '30d' ? 30 : params.period === '1d' ? 1 : 7;
        const stats = db.prepare(`SELECT status, COUNT(*) as count FROM emails WHERE created_at > datetime('now', '-${days} days') GROUP BY status`).all();
        return { success: true, data: stats, period: params.period || '7d' };
      }
      case 'generate_content':
      case 'translate':
        return await this._aiGenerate({ engine: 'text', agent: 'content', params: { prompt: JSON.stringify(params) } });
      case 'send_email': {
        // 真正发送邮件
        const { EmailSender } = require('./email-sender');
        const to = params.to;
        const subject = params.subject || '你好';
        const body = this._cleanEmailBody(params.body || '你好');
        if (!to) return { success: false, error: '缺少收件人邮箱地址' };

        // 查找客户ID
        let customerId = params.customer_id || null;
        if (!customerId && to) {
          const cust = db.prepare("SELECT id FROM customers WHERE email=?").get(to);
          if (cust) customerId = cust.id;
        }

        // 获取发件账号
        const account = this._resolveEmailAccount(db, params);
        if (!account) return { success: false, error: '没有可用的发件邮箱账号，请先在设置中配置' };

        // 处理图片和附件
        // inline_images: 内嵌到邮件正文（客户直接看到）
        // attachments: 作为附件下载
        const fs = require('fs');
        const pathMod = require('path');
        let inlineImagesJson = null;
        let attachmentsJson = null;
        
        // 解析图片路径的辅助函数
        const resolveImagePath = (p) => {
          if (!p) return null;
          // 从AI生成结果中提取路径
          const pathMatch = p.match(/\/product-images\/[^\s"']+/);
          if (pathMatch) p = pathMatch[0];
          const filePath = p.startsWith('/') ? pathMod.join(__dirname, '..', 'data', p) : p;
          return fs.existsSync(filePath) ? filePath : null;
        };

        // 内嵌图片（优先）
        const inlineImages = params.inline_images || params.inlineImages;
        if (inlineImages) {
          const paths = (Array.isArray(inlineImages) ? inlineImages : [inlineImages])
            .map(resolveImagePath).filter(Boolean);
          if (paths.length > 0) inlineImagesJson = JSON.stringify(paths);
        }
        
        // 普通附件
        if (params.attachments && Array.isArray(params.attachments)) {
          const paths = params.attachments.map(resolveImagePath).filter(Boolean);
          if (paths.length > 0) attachmentsJson = JSON.stringify(paths);
        }
        
        // 兼容：单个图片参数，默认作为内嵌图片
        const singleImage = params.image || params.image_path || params.attachment;
        if (singleImage && !inlineImagesJson && !attachmentsJson) {
          const resolved = resolveImagePath(singleImage);
          if (resolved) inlineImagesJson = JSON.stringify([resolved]);
        }

        // 插入邮件记录
        const result = db.prepare(
          "INSERT INTO emails (customer_id, account_id, direction, from_addr, to_addr, subject, body, attachments, inline_images, status) VALUES (?,?,?,?,?,?,?,?,?,?)"
        ).run(customerId, account.id, 'outbound', account.email, to, subject, body, attachmentsJson, inlineImagesJson, 'queued');
        const emailId = result.lastInsertRowid;

        // 尝试立即发送
        try {
          const sender = new EmailSender(db);
          const sendResult = await sender.sendEmail(emailId);
          sender.closeAll();
          if (sendResult.success) {
            // 自动绑定：首次联系客户时记住用的哪个账号
            if (customerId && account) {
              const cust = db.prepare("SELECT preferred_email_account_id FROM customers WHERE id=?").get(customerId);
              if (cust && !cust.preferred_email_account_id) {
                db.prepare("UPDATE customers SET preferred_email_account_id=? WHERE id=?").run(account.id, customerId);
              }
            }
            // 被动学习：记录发送经验 + 操作日志
            try {
              const memory = getAgentMemory(db);
              if (memory) {
                memory.extractEmailExperience({ to, subject, body, customerId, success: true });
                memory.logAction({ action_type: 'auto_email', triggered_by: 'user', target_customer_id: customerId, action_detail: `发送邮件: ${subject}`, result: '发送成功', status: 'executed' });
                if (customerId) memory.updateProfileHardData(customerId);
              }
            } catch (e) { console.warn('[AICommand] 被动学习记录失败:', e.message); }
            return { success: true, data: { emailId, to, subject, status: 'sent' }, content: `邮件已成功发送至 ${to}` };
          } else {
            // 被动学习：记录失败经验
            try {
              const memory = getAgentMemory(db);
              if (memory) memory.extractEmailExperience({ to, subject, body, customerId, success: false, error: sendResult.error });
            } catch (e) { /* ignore */ }
            return { success: false, error: `邮件发送失败: ${sendResult.error}`, data: { emailId, to, subject, status: 'failed' } };
          }
        } catch (e) {
          return { success: false, error: `邮件发送异常: ${e.message}`, data: { emailId, to, subject, status: 'error' } };
        }
      }
      case 'schedule_email': {
        // 定时发送邮件
        const { EmailSender } = require('./email-sender');
        const to = params.to;
        const subject = params.subject || '你好';
        const body = this._cleanEmailBody(params.body || '你好');
        if (!to) return { success: false, error: '缺少收件人邮箱地址' };

        // 解析发送时间
        let sendAt = params.send_at || params.scheduled || 'tomorrow 09:00';
        const now = new Date();
        if (sendAt === 'tomorrow' || sendAt.includes('明天')) {
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          sendAt = tomorrow.toISOString();
        } else if (sendAt.includes('h') || sendAt.includes('小时')) {
          const hours = parseInt(sendAt) || 1;
          sendAt = new Date(now.getTime() + hours * 3600000).toISOString();
        } else {
          try { sendAt = new Date(sendAt).toISOString(); } catch (e) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            sendAt = tomorrow.toISOString();
          }
        }

        // 查找客户ID
        let customerId = params.customer_id || null;
        if (!customerId && to) {
          const cust = db.prepare("SELECT id FROM customers WHERE email=?").get(to);
          if (cust) customerId = cust.id;
        }

        const account = this._resolveEmailAccount(db, params);
        if (!account) return { success: false, error: '没有可用的发件邮箱账号' };

        // 插入邮件记录（状态为scheduled，带定时时间）
        const result = db.prepare(
          "INSERT INTO emails (customer_id, account_id, direction, from_addr, to_addr, subject, body, status, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,'scheduled',?,datetime('now'))"
        ).run(customerId, account.id, 'outbound', account.email, to, subject, body, sendAt);
        const emailId = result.lastInsertRowid;

        const sendDate = new Date(sendAt);
        const dateStr = `${sendDate.getFullYear()}-${String(sendDate.getMonth()+1).padStart(2,'0')}-${String(sendDate.getDate()).padStart(2,'0')} ${String(sendDate.getHours()).padStart(2,'0')}:${String(sendDate.getMinutes()).padStart(2,'0')}`;
        return { success: true, data: { emailId, to, subject, scheduledAt: sendAt }, content: `邮件已安排在 ${dateStr} 发送给 ${to}` };
      }
      case 'publish_tiktok': {
        const SocialPublisher = require('./social-publisher');
        const OAuthManager = require('./oauth-manager');
        const oauthMgr = new OAuthManager(db);
        const publisher = new SocialPublisher(db, oauthMgr);
        const videoPath = params.video_path;
        if (!videoPath) return { success: false, error: '缺少 video_path 参数' };
        const fs = require('fs');
        if (!fs.existsSync(videoPath)) return { success: false, error: '视频文件不存在: ' + videoPath };
        const result = await publisher.publishToTikTok(videoPath, {
          title: params.title || '产品视频',
          privacyLevel: params.privacy_level || 'PUBLIC_TO_EVERYONE'
        });
        return { success: true, data: result, content: `视频已发布到TikTok: ${params.title || videoPath}` };
      }
      default:
        return { success: false, error: `动作 ${action} 暂未实现` };
    }
  }

  // 清洗AI生成的邮件body，去除不应该发给客户的说明性文字
  _cleanEmailBody(body) {
    if (!body || typeof body !== 'string') return body;
    let cleaned = body;
    
    // 去除开头的AI说明性文字（中文或英文，到第一个 --- 分隔线或正文开始）
    // 常见模式："以下是...邮件文案：" "Here is the email draft:" "我来逐步执行" 等
    cleaned = cleaned.replace(/^[\s\S]*?(?:以下是[^：:]*[：:]|Here (?:is|are)[^:]*:|邮件文案[^：:]*[：:]|我来逐步[^：:]*[：:])\s*\n*/i, '');
    
    // 去除 --- 分隔线（markdown水平线）
    cleaned = cleaned.replace(/^-{3,}\s*\n*/gm, '');
    cleaned = cleaned.replace(/\n*-{3,}\s*$/gm, '');
    
    // 去除内嵌的 **Subject: xxx** 行（真正的subject已经在邮件标题里了）
    cleaned = cleaned.replace(/^\*{0,2}Subject\s*[:：]\s*[^\n]*\*{0,2}\s*\n*/im, '');
    
    // 去除AI步骤标记（"**第一步：xxx**" "**第二步：xxx**" 等）及其后续说明
    cleaned = cleaned.replace(/^\*{0,2}第[一二三四五六七八九十\d]+步[：:][^\n]*\*{0,2}\s*\n*/gm, '');
    
    // 去除邮件正文签名之后的AI废话
    // 找到签名块（Best Regards等 + 公司信息），截掉签名后面的中文AI废话
    const signaturePattern = /([\s\S]*?(?:Best Regards|Sincerely|Kind Regards|Warm Regards|Best wishes|Regards)[,\s]*\n[^\n]*\n(?:[^\n]*\n)*?[^\n]*www\.[^\s\n]+[^\n]*)\s*\n+([\s\S]*)/i;
    const sigMatch = cleaned.match(signaturePattern);
    if (sigMatch) {
      const afterSig = sigMatch[2];
      // 只有签名后面包含中文或AI指令性文字时才截断
      if (/[\u4e00-\u9fff]|请注意|第[一二三四五六七八九十\d]+步|发送邮件|文案已|图片路径|API调用|工具权限/.test(afterSig)) {
        cleaned = sigMatch[1];
      }
    }
    
    // 去除结尾的AI说明性文字
    cleaned = cleaned.replace(/\n*(?:邮件文案已[^\n]*|请确认[^\n]*|需要我[^\n]*|如需修改[^\n]*|以上是[^\n]*|Hope this helps[^\n]*|Let me know[^\n]*|如果你需要[^\n]*|宣传单图片已[^\n]*|请注意[：:][^\n]*|现在立即[^\n]*|附带宣传[^\n]*|如果你的[^\n]*|或者告诉我[^\n]*)\s*$/gim, '');
    
    // 去除文件路径引用（不应该出现在邮件里）
    cleaned = cleaned.replace(/`?\/product-images\/[^\s`]*`?/g, '');
    
    // 去除markdown加粗标记 **text** → text
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    
    // 清理多余空行（超过2个连续空行压缩为2个）
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // 去除首尾空白
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  async _generateSummary(userInput, results) {
    try {
      let tradeCtx = '';
      try {
        const kbRows = this.db.prepare("SELECT key, value FROM knowledge_base WHERE category IN ('trade_methodology','product_smart_meter')").all();
        if (kbRows.length > 0) tradeCtx = '\n外贸知识背景：' + kbRows.map(r => `[${r.key}]${r.value}`).join(' | ').substring(0, 800);
      } catch (e) {}
      const resp = await this._callAI('brain', [
        { role: 'system', content: '你是专业B2B外贸AI助手，根据任务执行结果，用简洁中文给用户汇总报告。' + tradeCtx },
        { role: 'user', content: `指令: ${userInput}\n结果:\n${results.map(r => `- ${r.description}: ${r.success ? '✅' : '❌'} ${(r.content || r.error || JSON.stringify(r.data || '')).substring(0, 300)}`).join('\n')}` }
      ], { max_tokens: 1024 });
      return resp.content;
    } catch (e) {
      return `${results.filter(r => r.success).length}步成功, ${results.filter(r => !r.success).length}步失败\n${results.map(r => `${r.success ? '✅' : '❌'} ${r.description}`).join('\n')}`;
    }
  }

  _cost(usage) {
    if (!usage) return 0;
    return Math.round(((usage.prompt_tokens || 0) / 1000 * 0.002 + (usage.completion_tokens || 0) / 1000 * 0.004) * 10000) / 10000;
  }

  getConversations(limit = 50) {
    return this.db.prepare("SELECT * FROM ai_conversations ORDER BY created_at DESC LIMIT ?").all(limit).reverse();
  }
  clearConversations() { this.db.prepare("DELETE FROM ai_conversations").run(); }
  getTasks(limit = 20) { return this.db.prepare("SELECT * FROM ai_tasks ORDER BY created_at DESC LIMIT ?").all(limit); }
  getTaskDetail(taskId) {
    const task = this.db.prepare("SELECT * FROM ai_tasks WHERE id=?").get(taskId);
    if (!task) return null;
    task.steps = this.db.prepare("SELECT * FROM ai_task_steps WHERE task_id=? ORDER BY step_order").all(taskId);
    return task;
  }
}

module.exports = { AICommandEngine, AGENTS, SYSTEM_ACTIONS };
