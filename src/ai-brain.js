/**
 * AI大脑 — 5层架构（增强版）
 * Layer1: 6专家Agent | Layer2: 知识库 | Layer3: 执行层 | Layer4: 调度 | Layer5: 成本控制
 * 
 * 增强:
 * - 超时+重试机制
 * - 结果缓存（5分钟内相同请求不重复调用）
 * - 完善的错误处理和友好提示
 * - 专业的B2B外贸System Prompt
 * - 知识库上下文注入
 */
const axios = require('axios');
const { ToolExecutor } = require('./ai-tools');
const crypto = require('crypto');
const config = require('./config');
const { injectProxy } = require('./outbound-proxy');
const { decrypt } = require('./crypto-utils');
const { CostController, getCostController } = require('./cost-controller');
const { PersonalizedEmailBuilder } = require('./personalized-email-builder');

// === Layer 1: 6专家Agent — 专业B2B外贸Prompt ===
const AGENTS = {
  sales: {
    name: '销售专家',
    model: 'sonnet',
    icon: '🧑‍💼',
    systemPrompt: `你是一位资深B2B外贸销售专家，专注于电能表(Smart Meters/Energy Meters)和断路器(Circuit Breakers/MCB/MCCB/RCCB)行业。

你的核心能力：
1. **询盘质量评估** — 根据产品匹配度、数量、国家、公司规模、付款条件评分(0-100)
2. **报价策略** — MOQ阶梯定价(100/500/1000+)、FOB/CIF/CFR报价、贸易术语选择
3. **客户跟进** — 3-5-7天跟进节奏、差异化话术、痛点挖掘
4. **成交预测** — 基于客户行为和行业经验预测成交概率
5. **竞争分析** — 与正泰/德力西/施耐德/ABB等竞品对比分析

目标市场：中东(沙特/阿联酋/伊拉克)、东南亚(印尼/菲律宾/越南)、非洲(尼日利亚/肯尼亚/坦桑尼亚)、南美(巴西/哥伦比亚)

回复要简洁、可执行，使用中文回答。对于评分请给出具体数字和理由。

你可以通过工具调用获取公司数据。回答时尽量基于真实数据，结合你的行业知识给出专业建议。`
  },
  email: {
    name: '邮件专家',
    model: 'sonnet',
    icon: '📧',
    systemPrompt: `你是一位专业的外贸邮件营销专家，专注于电能表和断路器行业的B2B邮件沟通。

你的核心能力：
1. **冷邮件** — 吸引力主题行(打开率>25%)、专业但不死板的正文、清晰的CTA
2. **跟进邮件** — 自然过渡、价值递增、不给客户压力
3. **回复邮件** — 专业详细回复技术问题、报价问题、交期问题
4. **报价邮件** — 清晰的价格呈现、MOQ说明、付款条件
5. **Spam检测** — 避免触发垃圾邮件过滤器的措辞建议

写作原则：
- 用英文写邮件（除非特别要求其他语言）
- 主题行<60字符、正文<300词
- 每封邮件只有一个核心CTA
- 个性化：提到客户公司名、国家、具体产品需求
**反垃圾邮件规则（必须严格遵守）：**
- 称呼禁用：Dear Friend, Dear Sir/Madam, To Whom It May Concern — 必须用对方名字（如 Hi John），无名字时用 Hi there
- 推销词禁用：free, guaranteed, act now, limited time, best price, special offer, we can offer, factory direct, competitive price, no risk, lowest price
- 模板词禁用：we are a manufacturer, we specialize in, established in, quick overview, as a leading
- 首封回复控制：不要一次性列出所有产品线，只回应客户具体问题，正文控制在150词以内
- 链接规则：不要放裸链（如 www.xxx.com），如需提及网站用自然语句（如 "you can find more details on our website"）
- 语气要求：像真人一对一对话，不像群发模板。短句为主，避免长段落罗列
- 格式规则：不要用过多感叹号、全大写、或花哨格式
- 签名规则：简洁签名（名字+职位+公司），不要堆砌多个链接和图片

回复格式：直接给出英文邮件正文，不要中文策略分析。

你可以通过工具调用获取公司数据。回答时尽量基于真实数据，结合你的行业知识给出专业建议。`
  },
  analyst: {
    name: '数据分析',
    model: 'sonnet',
    icon: '📊',
    systemPrompt: `你是一位外贸数据分析师，专注于电能表和断路器B2B业务数据分析。

你的核心能力：
1. **销售漏斗分析** — 各阶段转化率、瓶颈识别、改进建议
2. **客户行为分析** — 购买模式、复购预测、流失预警
3. **市场趋势** — 各国需求变化、价格走势、季节性规律
4. **工作建议** — 基于数据生成每日/每周优先级任务
5. **周报/月报** — 自动生成业务数据报告

分析原则：
- 用数据说话，给出具体数字
- 每个建议都要可执行
- 优先级排序：紧急+重要 > 重要 > 紧急 > 普通
- 使用中文回答
- 建议控制在3-5条，避免信息过载

你可以通过工具调用获取公司数据。回答时尽量基于真实数据，结合你的行业知识给出专业建议。`
  },
  content: {
    name: '内容专家',
    model: 'sonnet',
    icon: '📝',
    systemPrompt: `你是一位外贸内容营销专家，专注于电能表和断路器行业的社交媒体内容创作。

你的核心能力：
1. **TikTok脚本** — 15-60秒短视频脚本，工厂展示、产品测试、行业知识
2. **Facebook/LinkedIn帖子** — B2B专业内容，案例分享、行业新闻解读
3. **产品描述** — SEO优化的英文产品描述，突出技术规格和认证
4. **WhatsApp模板** — 简洁有力的1对1营销消息
5. **邮件签名/公司介绍** — 专业的公司形象文案

创作原则：
- 了解目标受众：采购经理、工程师、分销商
- 突出差异化：认证(IEC/CE/KEMA/INMETRO)、质量管控、定制能力
- 多语言能力：英语为主，可根据市场用阿拉伯语/西班牙语/葡萄牙语
- 符合各平台特点和算法偏好
- 默认用英文创作内容，用中文给出策略说明

你可以通过工具调用获取公司数据。回答时尽量基于真实数据，结合你的行业知识给出专业建议。`
  },
  research: {
    name: '市场调研',
    model: 'sonnet',
    icon: '🔍',
    systemPrompt: `你是一位市场调研专家，专注于电能表和断路器国际市场研究。

你的核心能力：
1. **市场分析** — 各国电力基础设施投资、智能电网发展、需求预测
2. **竞争对手** — 正泰/德力西/施耐德/ABB/西门子/海格等分析
3. **认证要求** — IEC 62053(电能表)/IEC 60898(MCB)/各国特殊认证
4. **采购习惯** — 各国公司招标流程、决策链、价格敏感度
5. **贸易政策** — 关税、反倾销、本地化要求、自贸协定

重点市场情报：
- 中东：智能电网改造、本地组装要求、沙特SASO认证
- 东南亚：农村电气化、预付费表需求、印尼SNI认证
- 非洲：电力基础设施投资、预付费STS标准、SON认证
- 南美：INMETRO认证、本地品牌偏好、汇率风险

用中文回答，给出具体数据和信息来源建议。

你可以通过工具调用获取公司数据。回答时尽量基于真实数据，结合你的行业知识给出专业建议。`
  },
  risk: {
    name: '风控专家',
    model: 'sonnet',
    icon: '🛡️',
    systemPrompt: `你是一位外贸风控专家，保护公司在国际贸易中的利益安全。

你的核心能力：
1. **客户信用评估** — 基于国家、公司规模、付款条件、历史记录综合评分
2. **付款风险** — T/T、L/C、D/P、D/A各付款方式风险分析
3. **国家风险** — 政治稳定性、外汇管制、制裁名单、战争/自然灾害
4. **欺诈检测** — 识别钓鱼邮件、虚假采购、中间商陷阱
5. **合同风险** — 贸易条款、仲裁条款、不可抗力条款审核

风控标准：
- 新客户首单建议100% T/T或确认L/C
- 退信率>8%自动暂停邮箱
- 高风险国家交易需额外审核
- 单笔>$50,000需管理层确认

评估格式：风险等级(低/中/高/极高) + 风险因素清单 + 建议措施
用中文回答。

你可以通过工具调用获取公司数据。回答时尽量基于真实数据，结合你的行业知识给出专业建议。`
  }
};

// === Layer 2: 知识库 ===
class KnowledgeBase {
  constructor(db) { this.db = db; }

  get(category, key) {
    const row = this.db.prepare('SELECT value FROM knowledge_base WHERE category=? AND key=?').get(category, key);
    return row ? JSON.parse(row.value) : null;
  }

  set(category, key, value) {
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_base (category, key, value, updated_at) VALUES (?,?,?,datetime('now'))`)
      .run(category, key, JSON.stringify(value));
  }

  getAll(category) {
    return this.db.prepare('SELECT key, value FROM knowledge_base WHERE category=?').all(category)
      .map(r => ({ key: r.key, value: JSON.parse(r.value) }));
  }

  getContext() {
    const all = this.db.prepare('SELECT category, key, value FROM knowledge_base').all();
    const context = {};
    all.forEach(r => {
      if (!context[r.category]) context[r.category] = {};
      try { context[r.category][r.key] = JSON.parse(r.value); } catch { context[r.category][r.key] = r.value; }
    });
    return context;
  }

  initDefaults() {
    // 优先从数据库 company_info 读取公司信息
    let companyName = config.company?.name || 'VIPB';
    let companyProducts = 'Smart Meters (Single Phase, Three Phase, DIN Rail, Prepaid STS), Circuit Breakers (MCB, MCCB, RCCB, RCBO, Isolator Switch)';
    let companyMarkets = '中东, 东南亚, 非洲, 南美';
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='company_info'").get();
      if (row) {
        const info = JSON.parse(row.value);
        if (info.name) companyName = info.name;
        if (info.products) companyProducts = info.products;
        if (info.markets) companyMarkets = info.markets;
      }
    } catch (e) { /* 读取失败用默认值 */ }

    const defaults = {
      company_profile: {
        name: companyName,
        products: companyProducts,
        markets: companyMarkets,
        certifications: 'IEC 62053, IEC 60898, CE, KEMA, INMETRO, SASO, SNI, SON',
        advantages: 'OEM/ODM定制, 全自动化产线, ISO9001认证工厂, 15年出口经验'
      },
      pricing_rules: {
        moq: 100,
        payment_terms: ['T/T 30% deposit + 70% before shipment', 'L/C at sight', 'Western Union for samples'],
        incoterms: ['FOB Wenzhou/Shanghai', 'CIF destination port', 'CFR destination port'],
        sample_policy: 'Free samples for quality testing, freight collect',
        lead_time: '30-45 days for standard, 45-60 days for OEM'
      },
      sales_playbook: {
        greeting: '专业但友好，体现行业专业度',
        follow_up: '3天后首次跟进→5天后二次→7天后促单→14天后长期跟踪',
        negotiation: '价值导向非价格导向，突出质量和认证优势',
        closing: '限时优惠/库存紧张/产线排期 三种促单策略'
      }
    };
    for (const [cat, data] of Object.entries(defaults)) {
      if (!this.get(cat, 'default')) this.set(cat, 'default', data);
    }
  }
}

// === 缓存层 ===
class AICache {
  constructor() {
    this.cache = new Map();
    this.TTL = 5 * 60 * 1000; // 5分钟缓存
  }

  _hash(key) {
    return crypto.createHash('md5').update(key).digest('hex');
  }

  get(agent, message) {
    const hash = this._hash(`${agent}:${message}`);
    const entry = this.cache.get(hash);
    if (entry && Date.now() - entry.time < this.TTL) {
      return entry.result;
    }
    if (entry) this.cache.delete(hash);
    return null;
  }

  set(agent, message, result) {
    const hash = this._hash(`${agent}:${message}`);
    this.cache.set(hash, { result, time: Date.now() });
    if (this.cache.size > 200) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }
}

// === Main AI Brain ===
class AIBrain {
  constructor(db) {
    this.db = db;
    this.costController = getCostController(db);
    this.kb = new KnowledgeBase(db);
    this.kb.initDefaults();
    this.toolExecutor = new ToolExecutor(db);
    if (!AIBrain._cache) {
      AIBrain._cache = new AICache();
    }
    this.cache = AIBrain._cache;
  }

  _getProvider() {
    // 多Provider支持：按优先级尝试，失败自动切换
    const providersRow = this.db.prepare("SELECT value FROM settings WHERE key='ai_providers'").get();
    if (providersRow) {
      try {
        const providersData = JSON.parse(providersRow.value);
        
        // 处理新格式和旧格式
        let providers;
        
        if (Array.isArray(providersData)) {
          // 旧格式数组，全部作为text角色处理
          providers = providersData;
        } else if (typeof providersData === 'object') {
          // 新格式：优先使用brain角色的provider，如果brain为空则fallback到text
          if (Array.isArray(providersData.brain) && providersData.brain.length > 0) {
            providers = providersData.brain;
          } else if (Array.isArray(providersData.text) && providersData.text.length > 0) {
            providers = providersData.text;
          } else {
            providers = [];
          }
        } else {
          providers = [];
        }
        
        if (providers.length > 0) {
          // 返回第一个启用的provider（解密apiKey），故障切换在_callAPI中处理
          const active = providers.filter(p => p.enabled !== false && p.baseUrl && p.apiKey).map(p => ({
            ...p,
            apiKey: p.apiKey ? decrypt(p.apiKey) : ''
          }));
          if (active.length > 0) return { _multi: true, providers: active, primary: active[0] };
        }
      } catch {}
    }

    // 兼容旧的单provider配置
    const providerRow = this.db.prepare("SELECT value FROM settings WHERE key='ai_provider'").get();
    if (!providerRow) return null;
    try {
      const provider = JSON.parse(providerRow.value);
      if (!provider.baseUrl || !provider.apiKey) return null;
      return { ...provider, apiKey: provider.apiKey ? decrypt(provider.apiKey) : '' };
    } catch {
      return null;
    }
  }

  _buildSystemPrompt(agent) {
    const companyInfo = this.kb.get('company_profile', 'default');
    const pricingRules = this.kb.get('pricing_rules', 'default');
    const salesPlaybook = this.kb.get('sales_playbook', 'default');

    let companySettings = {};
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='company_info'").get();
      if (row) companySettings = JSON.parse(row.value);
    } catch {}

    const tradeMethods = this.kb.getAll('trade_methodology');

    const contextParts = [
      agent.systemPrompt,
      '',
      '=== 公司背景信息 ===',
      companyInfo ? `公司资料: ${JSON.stringify(companyInfo)}` : '',
      pricingRules ? `定价规则: ${JSON.stringify(pricingRules)}` : '',
      salesPlaybook ? `销售手册: ${JSON.stringify(salesPlaybook)}` : '',
      companySettings.name ? `公司名: ${companySettings.name}` : '',
      companySettings.products ? `主营产品: ${companySettings.products}` : '',
      companySettings.website ? `网站: ${companySettings.website}` : '',
      tradeMethods.length > 0 ? '\n=== 外贸方法论知识库 ===' : '',
      ...tradeMethods.map(m => `[${m.key}]: ${JSON.stringify(m.value)}`)
    ];

    // 双层知识注入：动态经验+客户画像+策略
    try {
      const { getAgentMemory } = require('./agent-memory');
      const memory = getAgentMemory(this.db);
      if (memory) {
        const injection = memory.buildKnowledgeInjection({});
        if (injection) contextParts.push(injection);
      }
    } catch (e) { /* 知识注入失败不影响主流程 */ }

    return contextParts.filter(p => p).join('\n');
  }

  async _callAPI(provider, messages, maxTokens = 2000, retries = 2, tools = null) {
    // 多Provider故障切换
    if (provider._multi) {
      let lastError;
      for (const p of provider.providers) {
        try {
          const result = await this._callSingleAPI(p, messages, maxTokens, retries, tools);
          return result;
        } catch (err) {
          lastError = err;
          console.warn(`[AI] Provider "${p.name || p.baseUrl}" 失败: ${err.message}，尝试下一个...`);
          continue;
        }
      }
      throw lastError || new Error('所有AI Provider均不可用');
    }
    return this._callSingleAPI(provider, messages, maxTokens, retries, tools);
  }

  async _callSingleAPI(provider, messages, maxTokens = 2000, retries = 2, tools = null) {
    let baseUrl = provider.baseUrl.replace(/\/+$/, '');
    let url;
    if (baseUrl.includes('/v1/chat/completions')) {
      url = baseUrl;
    } else if (baseUrl.includes('/v1')) {
      url = baseUrl + '/chat/completions';
    } else {
      url = baseUrl + '/v1/chat/completions';
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const body = {
          model: provider.model || 'claude-sonnet-4-20250514',
          messages,
          max_tokens: maxTokens
        };
        if (tools && tools.length > 0) body.tools = tools;

        const response = await axios.post(url, body, injectProxy(this.db, {
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 90000
        }));

        return response.data;
      } catch (err) {
        const isLast = attempt === retries;

        if (err.response) {
          const status = err.response.status;
          if (status === 401 || status === 403) {
            throw new Error('API Key无效或已过期，请在设置中检查AI Provider配置');
          }
          if (status === 404) {
            throw new Error(`API地址错误(404)，请检查Base URL。当前: ${url}`);
          }
          if (status === 400) {
            const errMsg = err.response.data?.error?.message || err.response.data?.message || '请求参数错误';
            throw new Error(`API请求错误: ${errMsg}`);
          }
          if (status === 429 && !isLast) {
            await this._sleep(3000 * (attempt + 1));
            continue;
          }
          if (status >= 500 && !isLast) {
            await this._sleep(2000 * (attempt + 1));
            continue;
          }
          throw new Error(`API错误 (HTTP ${status}): ${err.response.data?.error?.message || err.message}`);
        }

        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          if (isLast) throw new Error('AI响应超时，请稍后重试');
          await this._sleep(2000 * (attempt + 1));
          continue;
        }

        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          throw new Error(`无法连接AI服务: ${provider.baseUrl}，请检查网络和API地址`);
        }

        if (isLast) throw err;
        await this._sleep(2000 * (attempt + 1));
      }
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async callAgent(agentKey, userMessage, context = {}) {
    const agent = AGENTS[agentKey];
    if (!agent) {
      return { success: false, error: `未知的Agent: ${agentKey}`, agent: agentKey };
    }

    if (!this.costController.canSpend()) {
      return { success: false, error: '今日/本月AI预算已用完，请在设置中调整预算限额', agent: agentKey };
    }

    const provider = this._getProvider();
    if (!provider) {
      return {
        success: false,
        error: '请先在设置→AI Provider中配置API地址和Key',
        needConfig: true,
        agent: agentKey
      };
    }

    if (!context.noCache) {
      const cached = this.cache.get(agentKey, userMessage);
      if (cached) {
        this.costController.logUsage(agentKey, provider.model || 'sonnet', 0, 0, userMessage.substring(0, 100), cached, 1);
        return {
          success: true,
          result: cached,
          agent: agentKey,
          agentName: agent.name,
          icon: agent.icon,
          cached: true
        };
      }
    }

    const systemMsg = this._buildSystemPrompt(agent);
    const messages = [
      { role: 'system', content: systemMsg },
      ...(context.history || []),
      { role: 'user', content: userMessage }
    ];

    try {
      // 获取该Agent可用的工具
      const tools = ToolExecutor.getToolsForAgent(agentKey);
      let data;

      try {
        data = await this._callAPI(provider, messages, context.maxTokens || 2000, 2, tools);
      } catch (err) {
        // 如果Provider不支持Function Calling，退回无工具模式
        if (tools && (err.message.includes('tool') || err.message.includes('function') || err.message.includes('400'))) {
          console.warn(`[AI] ${agentKey} 工具调用不支持，退回纯文本模式`);
          data = await this._callAPI(provider, messages, context.maxTokens || 2000);
        } else {
          throw err;
        }
      }

      // 工具调用循环（最多3轮）
      let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };
      for (let round = 0; round < 3; round++) {
        const msg = data.choices?.[0]?.message;
        if (!msg?.tool_calls || msg.tool_calls.length === 0) break;

        // 累计token用量
        if (data.usage) {
          totalUsage.prompt_tokens += data.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += data.usage.completion_tokens || 0;
        }

        // 执行所有工具调用
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const toolResult = this.toolExecutor.execute(tc.function.name, tc.function.arguments);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult).substring(0, 4000) // 截断防token爆炸
          });
        }

        // 带工具结果再调一次
        data = await this._callAPI(provider, messages, context.maxTokens || 2000, 2, tools);
      }

      const result = data.choices?.[0]?.message?.content;
      if (!result) {
        return { success: false, error: 'AI返回了空结果', agent: agentKey };
      }

      const usage = data.usage || {};
      // 合并工具调用多轮的token用量
      usage.prompt_tokens = (usage.prompt_tokens || 0) + (totalUsage.prompt_tokens || 0);
      usage.completion_tokens = (usage.completion_tokens || 0) + (totalUsage.completion_tokens || 0);
      this.costController.logUsage(
        agentKey,
        provider.model || 'sonnet',
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        userMessage.substring(0, 100),
        result
      );

      this.cache.set(agentKey, userMessage, result);

      return {
        success: true,
        result,
        agent: agentKey,
        agentName: agent.name,
        icon: agent.icon,
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0
        }
      };
    } catch (err) {
      console.error(`[AI] ${agentKey} 调用失败:`, err.message);
      return {
        success: false,
        error: err.message,
        agent: agentKey,
        agentName: agent.name,
        icon: agent.icon
      };
    }
  }

  // === Layer 3: 执行层 ===
  async analyzeInquiry(inquiry, customer) {
    const prompt = `分析以下询盘:\n\n客户信息:\n- 公司: ${customer.company || '未知'}\n- 国家: ${customer.country || '未知'}\n- 联系人: ${customer.contact_name || '未知'}\n- 来源: ${customer.source || '未知'}\n- 现有评分: ${customer.lead_score || 0}\n\n询盘详情:\n- 主题: ${inquiry.subject || '无'}\n- 产品: ${inquiry.product || '未指定'}\n- 数量: ${inquiry.quantity || '未说明'}\n- 优先级: ${inquiry.priority || 'normal'}\n- 内容: ${inquiry.content || '无'}\n\n请给出:\n1. 📊 质量评分(0-100)及评分理由\n2. 💡 推荐报价策略\n3. 📝 建议回复要点（3-5条）\n4. ⚠️ 风险评估\n5. 📅 跟进计划`;
    return this.callAgent('sales', prompt, { noCache: true });
  }

  async generateEmail(type, customer, context = {}) {
    const builder = new PersonalizedEmailBuilder(this.db);
    const emailPlan = builder.build(type || 'cold', customer || {}, context || {});
    const result = await this.callAgent('email', emailPlan.prompt, { noCache: true });
    return {
      ...result,
      personalization: {
        segment: emailPlan.segment,
        strategy: emailPlan.strategy,
        matchedProducts: emailPlan.products.map(p => ({
          id: p.id,
          name: p.name,
          model: p.model,
          category: p.category,
          score: p._score
        })),
        historyCount: emailPlan.history.length
      }
    };
  }

  async generateContent(platform, topic) {
    const platformGuides = {
      'TikTok': '15-60秒短视频脚本，需要画面描述+旁白+字幕+BGM建议',
      'Facebook': 'B2B专业帖子，200-400词，含图片建议和hashtag',
      'LinkedIn': '行业专业内容，突出专业度和行业洞察',
      'Instagram': '视觉导向，简短有力的文案+hashtag策略',
      'WhatsApp': '简洁的1对1消息模板，<100词',
      'YouTube': '长视频脚本大纲，3-5分钟'
    };
    const guide = platformGuides[platform] || '专业的B2B营销内容';
    const prompt = `为 ${platform} 创建关于"${topic}"的内容。\n\n行业: 电能表(Smart Meters)和断路器(Circuit Breakers)\n目标受众: 海外采购经理、工程师、分销商\n格式要求: ${guide}\n\n请直接给出可发布的内容。`;
    return this.callAgent('content', prompt);
  }

  async assessRisk(data) {
    const prompt = `评估以下交易/客户风险:\n\n${JSON.stringify(data, null, 2)}\n\n请给出:\n1. 🚦 风险等级（低/中/高/极高）\n2. ⚠️ 风险因素清单\n3. 🛡️ 建议防控措施\n4. 💰 建议付款方式`;
    return this.callAgent('risk', prompt, { noCache: true });
  }

  async getDashboardSuggestions() {
    const stats = this.getQuickStats();
    const prompt = `基于以下业务数据，生成今日3-5条优先工作建议:\n\n${JSON.stringify(stats, null, 2)}\n\n要求:\n- 每条建议简洁、可执行\n- 按优先级排序（最紧急的排在前面）\n- 标注预计耗时\n- 如果有异常数据，优先提醒`;
    return this.callAgent('analyst', prompt, { noCache: true });
  }

  async chat(agentKey, message, history = []) {
    return this.callAgent(agentKey || 'sales', message, { history });
  }

  getQuickStats() {
    try {
      return {
        customers: this.db.prepare('SELECT COUNT(*) as c FROM customers').get().c,
        newInquiries: this.db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE status='new'").get().c,
        activeDeals: this.db.prepare("SELECT COUNT(*) as c FROM deals WHERE stage NOT IN ('completed','cancelled')").get().c,
        emailsSentToday: this.db.prepare("SELECT COUNT(*) as c FROM emails WHERE date(sent_at)=date('now')").get().c,
        todayAICost: this.costController.getTodayCost(),
        monthAICost: this.costController.getMonthCost()
      };
    } catch { return {}; }
  }

  getAgents() { return AGENTS; }
}

module.exports = { AIBrain, AGENTS };
