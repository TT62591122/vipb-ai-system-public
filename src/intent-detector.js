/**
 * 统一意图识别引擎
 * - 检测客户消息中的报价/价格意图
 * - 检测询盘意图、技术咨询、投诉等
 * - 跨渠道共用（Email / WhatsApp / TikTok / LinkedIn）
 * - AI不碰报价：检测到价格意图 → 立即拦截 → 创建待办
 * 
 * ⚠️ 核心安全规则：AI永远不报价，报价必须人工处理
 */

// 价格/报价意图关键词（多语言）
const PRICING_KEYWORDS = {
  en: [
    'price', 'pricing', 'quote', 'quotation', 'how much', 'cost',
    'moq', 'minimum order', 'unit price', 'fob', 'cif', 'cfr',
    'payment terms', 'discount', 'bulk price', 'wholesale price',
    'price list', 'pricelist', 'catalogue with price', 'proforma',
    'pi', 'proforma invoice', 'best offer', 'your offer',
    'what is the price', 'send me price', 'need price', 'need quotation',
    'budget', 'rate', 'tariff', 'charge'
  ],
  zh: [
    '价格', '报价', '多少钱', '费用', '单价', '起订量',
    '最低订购', '付款方式', '折扣', '批发价', '出厂价',
    '价目表', '形式发票', '优惠', '成本'
  ],
  ar: ['سعر', 'عرض أسعار', 'كم السعر', 'تكلفة'],
  es: ['precio', 'cotización', 'cuánto cuesta', 'presupuesto'],
  pt: ['preço', 'cotação', 'quanto custa', 'orçamento'],
  fr: ['prix', 'devis', 'combien', 'tarif']
};

// 询盘意图关键词
const INQUIRY_KEYWORDS = [
  'interested in', 'looking for', 'need', 'require', 'want to buy',
  'can you supply', 'do you have', 'available', 'in stock',
  'specifications', 'spec sheet', 'datasheet', 'catalogue', 'catalog',
  'sample', 'trial order', 'test order',
  '感兴趣', '需要', '有没有', '能供应', '样品'
];

// 技术咨询关键词
const TECHNICAL_KEYWORDS = [
  'certification', 'certificate', 'iec', 'ce', 'kema', 'iso',
  'voltage', 'current', 'phase', 'frequency', 'accuracy',
  'installation', 'wiring', 'diagram', 'manual', 'warranty',
  '认证', '电压', '电流', '安装', '接线', '保修'
];

// 投诉/售后关键词
const COMPLAINT_KEYWORDS = [
  'complaint', 'problem', 'issue', 'defect', 'broken', 'damaged',
  'not working', 'malfunction', 'return', 'refund', 'replace',
  '投诉', '问题', '故障', '损坏', '退货', '退款', '换货'
];

class IntentDetector {
  constructor(db) {
    this.db = db;
    this._ensureTable();
    // 预编译所有价格关键词为正则
    this._pricingPatterns = [];
    for (const [lang, words] of Object.entries(PRICING_KEYWORDS)) {
      for (const word of words) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 中文/阿拉伯语不需要词边界
        const regex = /^[a-z]/.test(word) 
          ? new RegExp(`\\b${escaped}\\b`, 'i')
          : new RegExp(escaped, 'i');
        this._pricingPatterns.push({ regex, word, lang });
      }
    }
  }

  _ensureTable() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS intent_detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      source_id TEXT,
      customer_id INTEGER,
      customer_email TEXT,
      message_text TEXT,
      intent TEXT NOT NULL,
      confidence REAL,
      matched_keywords TEXT,
      handled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    
    // 索引
    try {
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_intent_channel ON intent_detections(channel)').run();
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_intent_handled ON intent_detections(handled)').run();
    } catch(e) {}
  }

  /**
   * 检测消息意图
   * @param {string} text - 消息文本
   * @param {object} context - { channel, sourceId, customerId, customerEmail }
   * @returns {{ intent: string, confidence: number, isPricing: boolean, matchedKeywords: string[], shouldBlock: boolean }}
   */
  detect(text, context = {}) {
    if (!text || typeof text !== 'string') {
      return { intent: 'unknown', confidence: 0, isPricing: false, matchedKeywords: [], shouldBlock: false };
    }

    const normalizedText = text.toLowerCase().trim();
    
    // 1. 价格意图检测（最高优先级）
    const pricingMatches = [];
    for (const p of this._pricingPatterns) {
      if (p.regex.test(normalizedText)) {
        pricingMatches.push(p.word);
      }
    }
    
    if (pricingMatches.length > 0) {
      const confidence = Math.min(0.5 + pricingMatches.length * 0.15, 1.0);
      const result = {
        intent: 'pricing',
        confidence,
        isPricing: true,
        matchedKeywords: pricingMatches,
        shouldBlock: true // ⚠️ AI必须停止自动回复
      };
      
      // 记录到数据库
      this._log(result, text, context);
      return result;
    }

    // 2. 投诉意图
    const complaintMatches = this._matchKeywords(normalizedText, COMPLAINT_KEYWORDS);
    if (complaintMatches.length > 0) {
      const result = {
        intent: 'complaint',
        confidence: Math.min(0.5 + complaintMatches.length * 0.2, 1.0),
        isPricing: false,
        matchedKeywords: complaintMatches,
        shouldBlock: true // 投诉也需要人工处理
      };
      this._log(result, text, context);
      return result;
    }

    // 3. 询盘意图
    const inquiryMatches = this._matchKeywords(normalizedText, INQUIRY_KEYWORDS);
    if (inquiryMatches.length > 0) {
      return {
        intent: 'inquiry',
        confidence: Math.min(0.4 + inquiryMatches.length * 0.15, 0.95),
        isPricing: false,
        matchedKeywords: inquiryMatches,
        shouldBlock: false // 询盘可以AI初步回复
      };
    }

    // 4. 技术咨询
    const techMatches = this._matchKeywords(normalizedText, TECHNICAL_KEYWORDS);
    if (techMatches.length > 0) {
      return {
        intent: 'technical',
        confidence: Math.min(0.4 + techMatches.length * 0.15, 0.95),
        isPricing: false,
        matchedKeywords: techMatches,
        shouldBlock: false
      };
    }

    // 5. 通用/闲聊
    return {
      intent: 'general',
      confidence: 0.3,
      isPricing: false,
      matchedKeywords: [],
      shouldBlock: false
    };
  }

  _matchKeywords(text, keywords) {
    const matches = [];
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = /^[a-z]/.test(kw)
        ? new RegExp(`\\b${escaped}\\b`, 'i')
        : new RegExp(escaped, 'i');
      if (regex.test(text)) matches.push(kw);
    }
    return matches;
  }

  _log(result, text, context) {
    try {
      this.db.prepare(`INSERT INTO intent_detections 
        (channel, source_id, customer_id, customer_email, message_text, intent, confidence, matched_keywords)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          context.channel || 'unknown',
          context.sourceId || null,
          context.customerId || null,
          context.customerEmail || null,
          text.substring(0, 500),
          result.intent,
          result.confidence,
          JSON.stringify(result.matchedKeywords)
        );
    } catch (e) {
      console.error('[IntentDetector] 日志写入失败:', e.message);
    }
  }

  /**
   * 获取未处理的价格意图
   */
  getPendingPricingIntents(limit = 50) {
    return this.db.prepare(
      "SELECT * FROM intent_detections WHERE intent = 'pricing' AND handled = 0 ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  }

  /**
   * 标记为已处理
   */
  markHandled(id) {
    this.db.prepare("UPDATE intent_detections SET handled = 1 WHERE id = ?").run(id);
  }
}

module.exports = { IntentDetector };
