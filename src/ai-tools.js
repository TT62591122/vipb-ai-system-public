/**
 * AI Agent 工具系统 — Function Calling 支持
 * 
 * 所有工具只读数据库，不做任何写操作。
 * 每个查询限制返回条数，防止token爆炸。
 */

// === 工具定义（OpenAI Function Calling 格式） ===
const TOOL_DEFINITIONS = {
  get_business_stats: {
    type: 'function',
    function: {
      name: 'get_business_stats',
      description: '获取业务概览统计数据，包括客户数、询盘数、活跃交易数、今日邮件数、AI费用等',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },

  search_customers: {
    type: 'function',
    function: {
      name: 'search_customers',
      description: '搜索客户列表，可按关键词、国家、来源筛选',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（公司名/联系人/邮箱）' },
          country: { type: 'string', description: '国家筛选' },
          source: { type: 'string', description: '来源筛选（website/exhibition/referral等）' },
          limit: { type: 'number', description: '返回条数，默认10，最大20' }
        },
        required: []
      }
    }
  },

  get_customer_detail: {
    type: 'function',
    function: {
      name: 'get_customer_detail',
      description: '获取单个客户的详细信息，包括关联的交易、询盘、邮件记录',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'number', description: '客户ID' }
        },
        required: ['customer_id']
      }
    }
  },

  get_deals: {
    type: 'function',
    function: {
      name: 'get_deals',
      description: '获取交易列表，可按阶段和金额筛选',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', description: '交易阶段筛选（quoting/negotiating/order/shipping/completed/cancelled）' },
          min_amount: { type: 'number', description: '最低金额' },
          limit: { type: 'number', description: '返回条数，默认10，最大20' }
        },
        required: []
      }
    }
  },

  get_inquiries: {
    type: 'function',
    function: {
      name: 'get_inquiries',
      description: '获取询盘列表，可按状态和优先级筛选',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: '状态筛选（new/processing/replied/closed）' },
          priority: { type: 'string', description: '优先级筛选（high/normal/low）' },
          limit: { type: 'number', description: '返回条数，默认10，最大20' }
        },
        required: []
      }
    }
  },

  get_sales_pipeline: {
    type: 'function',
    function: {
      name: 'get_sales_pipeline',
      description: '获取销售漏斗统计，各阶段交易数和总金额',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },

  get_email_history: {
    type: 'function',
    function: {
      name: 'get_email_history',
      description: '获取邮件发送记录',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'number', description: '按客户ID筛选' },
          limit: { type: 'number', description: '返回条数，默认10，最大20' }
        },
        required: []
      }
    }
  },

  get_products: {
    type: 'function',
    function: {
      name: 'get_products',
      description: '获取产品列表',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '产品分类筛选' }
        },
        required: []
      }
    }
  },

  get_customer_countries: {
    type: 'function',
    function: {
      name: 'get_customer_countries',
      description: '获取客户的国家/地区分布统计',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },

  get_ai_usage: {
    type: 'function',
    function: {
      name: 'get_ai_usage',
      description: '获取AI调用统计（按天/Agent分组）',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: '查询最近N天，默认7' }
        },
        required: []
      }
    }
  }
};

// === 每个Agent可用的工具映射 ===
const AGENT_TOOLS = {
  sales:    ['get_business_stats', 'search_customers', 'get_customer_detail', 'get_deals', 'get_inquiries'],
  email:    ['search_customers', 'get_customer_detail', 'get_email_history'],
  analyst:  ['get_business_stats', 'get_deals', 'get_inquiries', 'get_sales_pipeline', 'get_ai_usage'],
  content:  ['search_customers', 'get_products'],
  research: ['get_business_stats', 'search_customers', 'get_deals', 'get_customer_countries', 'get_inquiries'],
  risk:     ['get_customer_detail', 'get_deals', 'get_customer_countries']
};

// === 工具执行器 ===
class ToolExecutor {
  constructor(db) {
    this.db = db;
  }

  /**
   * 获取指定Agent的工具定义列表（OpenAI格式）
   */
  static getToolsForAgent(agentKey) {
    const toolNames = AGENT_TOOLS[agentKey];
    if (!toolNames || toolNames.length === 0) return null;
    return toolNames.map(name => TOOL_DEFINITIONS[name]).filter(Boolean);
  }

  /**
   * 执行工具调用，返回结果
   */
  execute(toolName, argsString) {
    let args = {};
    try {
      args = typeof argsString === 'string' ? JSON.parse(argsString) : (argsString || {});
    } catch {
      return { error: '参数解析失败' };
    }

    try {
      switch (toolName) {
        case 'get_business_stats': return this._getBusinessStats();
        case 'search_customers': return this._searchCustomers(args);
        case 'get_customer_detail': return this._getCustomerDetail(args);
        case 'get_deals': return this._getDeals(args);
        case 'get_inquiries': return this._getInquiries(args);
        case 'get_sales_pipeline': return this._getSalesPipeline();
        case 'get_email_history': return this._getEmailHistory(args);
        case 'get_products': return this._getProducts(args);
        case 'get_customer_countries': return this._getCustomerCountries();
        case 'get_ai_usage': return this._getAIUsage(args);
        default: return { error: `未知工具: ${toolName}` };
      }
    } catch (err) {
      return { error: `工具执行失败: ${err.message}` };
    }
  }

  // --- 工具实现 ---

  _getBusinessStats() {
    return {
      customers: this._safeGet("SELECT COUNT(*) as c FROM customers")?.c || 0,
      newInquiries: this._safeGet("SELECT COUNT(*) as c FROM inquiries WHERE status='new'")?.c || 0,
      activeDeals: this._safeGet("SELECT COUNT(*) as c FROM deals WHERE stage NOT IN ('completed','cancelled')")?.c || 0,
      totalDealValue: this._safeGet("SELECT COALESCE(SUM(amount),0) as s FROM deals WHERE stage NOT IN ('completed','cancelled')")?.s || 0,
      emailsSentToday: this._safeGet("SELECT COUNT(*) as c FROM emails WHERE date(sent_at)=date('now')")?.c || 0,
      completedDeals: this._safeGet("SELECT COUNT(*) as c FROM deals WHERE stage='completed'")?.c || 0,
      completedValue: this._safeGet("SELECT COALESCE(SUM(amount),0) as s FROM deals WHERE stage='completed'")?.s || 0
    };
  }

  _searchCustomers(args) {
    const limit = Math.min(args.limit || 10, 20);
    let sql = 'SELECT id, company, contact_name, email, country, source, lead_score, created_at FROM customers WHERE 1=1';
    const params = [];

    if (args.query) {
      sql += " AND (company LIKE ? OR contact_name LIKE ? OR email LIKE ?)";
      const q = `%${args.query}%`;
      params.push(q, q, q);
    }
    if (args.country) {
      sql += " AND country LIKE ?";
      params.push(`%${args.country}%`);
    }
    if (args.source) {
      sql += " AND source = ?";
      params.push(args.source);
    }
    sql += ` ORDER BY lead_score DESC, created_at DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params);
  }

  _getCustomerDetail(args) {
    if (!args.customer_id) return { error: '需要customer_id参数' };
    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(args.customer_id);
    if (!customer) return { error: '客户不存在' };

    customer.deals = this._safeAll('SELECT id, title, amount, stage, created_at FROM deals WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10', args.customer_id);
    customer.inquiries = this._safeAll('SELECT id, subject, product, status, priority, created_at FROM inquiries WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10', args.customer_id);
    customer.recent_emails = this._safeAll('SELECT id, subject, status, sent_at FROM emails WHERE customer_id = ? ORDER BY sent_at DESC LIMIT 5', args.customer_id);
    return customer;
  }

  _getDeals(args) {
    const limit = Math.min(args.limit || 10, 20);
    let sql = 'SELECT d.id, d.title, d.amount, d.stage, d.created_at, c.company, c.country FROM deals d LEFT JOIN customers c ON d.customer_id = c.id WHERE 1=1';
    const params = [];

    if (args.stage) {
      sql += ' AND d.stage = ?';
      params.push(args.stage);
    }
    if (args.min_amount) {
      sql += ' AND d.amount >= ?';
      params.push(args.min_amount);
    }
    sql += ` ORDER BY d.created_at DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params);
  }

  _getInquiries(args) {
    const limit = Math.min(args.limit || 10, 20);
    let sql = 'SELECT i.id, i.subject, i.product, i.quantity, i.status, i.priority, i.created_at, c.company, c.country FROM inquiries i LEFT JOIN customers c ON i.customer_id = c.id WHERE 1=1';
    const params = [];

    if (args.status) {
      sql += ' AND i.status = ?';
      params.push(args.status);
    }
    if (args.priority) {
      sql += ' AND i.priority = ?';
      params.push(args.priority);
    }
    sql += ` ORDER BY i.created_at DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params);
  }

  _getSalesPipeline() {
    const stages = this._safeAll("SELECT stage, COUNT(*) as count, COALESCE(SUM(amount),0) as total_value FROM deals GROUP BY stage ORDER BY CASE stage WHEN 'quoting' THEN 1 WHEN 'negotiating' THEN 2 WHEN 'order' THEN 3 WHEN 'shipping' THEN 4 WHEN 'completed' THEN 5 WHEN 'cancelled' THEN 6 ELSE 7 END");
    return { stages, summary: { total_deals: stages.reduce((s, r) => s + r.count, 0), total_value: stages.reduce((s, r) => s + r.total_value, 0) } };
  }

  _getEmailHistory(args) {
    const limit = Math.min(args.limit || 10, 20);
    let sql = 'SELECT e.id, e.to_addr as "to", e.subject, e.status, e.sent_at FROM emails e WHERE 1=1';
    const params = [];

    if (args.customer_id) {
      sql += ' AND e.customer_id = ?';
      params.push(args.customer_id);
    }
    sql += ` ORDER BY e.sent_at DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params);
  }

  _getProducts(args) {
    let sql = 'SELECT id, name, model, category, price_100 as price, moq, description FROM products WHERE 1=1';
    const params = [];
    if (args.category) {
      sql += ' AND category LIKE ?';
      params.push(`%${args.category}%`);
    }
    sql += ' ORDER BY name LIMIT 20';
    return this.db.prepare(sql).all(...params);
  }

  _getCustomerCountries() {
    return this._safeAll("SELECT country, COUNT(*) as count, ROUND(AVG(lead_score),1) as avg_score FROM customers WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY count DESC LIMIT 20");
  }

  _getAIUsage(args) {
    const days = Math.min(args.days || 7, 30);
    return this._safeAll(`SELECT date(created_at) as date, agent, COUNT(*) as calls, SUM(prompt_tokens + completion_tokens) as total_tokens FROM ai_usage_log WHERE created_at >= datetime('now', '-${days} days') GROUP BY date(created_at), agent ORDER BY date DESC`);
  }

  // --- 安全查询辅助 ---

  _safeGet(sql, ...params) {
    try { return this.db.prepare(sql).get(...params); }
    catch { return null; }
  }

  _safeAll(sql, ...params) {
    try { return this.db.prepare(sql).all(...params); }
    catch { return []; }
  }
}

module.exports = { ToolExecutor, TOOL_DEFINITIONS, AGENT_TOOLS };
