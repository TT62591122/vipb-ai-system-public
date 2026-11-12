/**
 * Agent Learner — 主动学习引擎
 * 
 * 定期分析邮件数据，自动发现有效策略并写入策略库
 * 设有最小样本门槛，数据不够不分析，避免噪音
 */

const { getAgentMemory } = require('./agent-memory');

class AgentLearner {
  constructor(db) {
    this.db = db;
    this.memory = getAgentMemory(db);
    // 最小样本门槛
    this.MIN_SENT_EMAILS = 50;
    this.MIN_CUSTOMERS = 10;
    this.MIN_REPLIES = 5;
  }

  /**
   * 执行一次主动学习分析
   * @returns {object} 学习结果
   */
  analyze() {
    // 检查数据量是否达到最小门槛
    const dataCheck = this._checkDataSufficiency();
    if (!dataCheck.sufficient) {
      return { skipped: true, reason: dataCheck.reason, metrics: dataCheck.metrics };
    }

    const insights = [];

    // 1. 分析邮件主题行效果
    const subjectInsights = this._analyzeSubjectLines();
    insights.push(...subjectInsights);

    // 2. 分析发送时间效果
    const timeInsights = this._analyzeSendTiming();
    insights.push(...timeInsights);

    // 3. 分析国家/地区响应差异
    const regionInsights = this._analyzeRegionResponse();
    insights.push(...regionInsights);

    // 4. 分析邮件类型效果（冷开发 vs 跟进 vs 回复）
    const typeInsights = this._analyzeEmailTypes();
    insights.push(...typeInsights);

    // 将有价值的洞察写入策略库（draft状态，需用户确认）
    let strategiesCreated = 0;
    for (const insight of insights) {
      if (insight.confidence >= 0.6) { // 置信度60%以上才写入
        const existing = this._findSimilarStrategy(insight.category, insight.key);
        if (!existing) {
          this.memory.addStrategy({
            name: insight.name,
            category: insight.category,
            rules: JSON.stringify(insight.rules),
            status: 'draft', // 默认草稿，需用户确认
            source: 'auto_learned',
            description: insight.description
          });
          strategiesCreated++;
        }
      }
    }

    return {
      skipped: false,
      insights: insights.length,
      strategiesCreated,
      details: insights.map(i => ({ name: i.name, confidence: i.confidence, description: i.description }))
    };
  }

  // ========== 数据充分性检查 ==========

  _checkDataSufficiency() {
    const sentEmails = this.db.prepare("SELECT COUNT(*) as c FROM emails WHERE direction='outbound' AND status='sent'").get()?.c || 0;
    const customers = this.db.prepare("SELECT COUNT(*) as c FROM customers").get()?.c || 0;
    const replies = this.db.prepare("SELECT COUNT(*) as c FROM received_emails").get()?.c || 0;

    const metrics = { sentEmails, customers, replies, required: { sentEmails: this.MIN_SENT_EMAILS, customers: this.MIN_CUSTOMERS, replies: this.MIN_REPLIES } };

    if (sentEmails < this.MIN_SENT_EMAILS) {
      return { sufficient: false, reason: `发送邮件${sentEmails}封，需至少${this.MIN_SENT_EMAILS}封`, metrics };
    }
    if (customers < this.MIN_CUSTOMERS) {
      return { sufficient: false, reason: `客户${customers}个，需至少${this.MIN_CUSTOMERS}个`, metrics };
    }
    if (replies < this.MIN_REPLIES) {
      return { sufficient: false, reason: `收到回复${replies}封，需至少${this.MIN_REPLIES}封`, metrics };
    }
    return { sufficient: true, metrics };
  }

  // ========== 主题行分析 ==========

  _analyzeSubjectLines() {
    const insights = [];
    try {
      // 统计有回复的邮件 vs 无回复的邮件的主题行特征
      const replied = this.db.prepare(`
        SELECT e.subject FROM emails e
        WHERE e.direction='outbound' AND e.status='sent'
          AND EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at)
        LIMIT 200
      `).all();

      const unreplied = this.db.prepare(`
        SELECT e.subject FROM emails e
        WHERE e.direction='outbound' AND e.status='sent'
          AND NOT EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at)
        LIMIT 200
      `).all();

      if (replied.length >= 3 && unreplied.length >= 3) {
        const repliedAvgLen = replied.reduce((s, r) => s + (r.subject || '').length, 0) / replied.length;
        const unrepliedAvgLen = unreplied.reduce((s, r) => s + (r.subject || '').length, 0) / unreplied.length;

        // 主题行长度差异
        if (Math.abs(repliedAvgLen - unrepliedAvgLen) > 10) {
          const betterLen = repliedAvgLen < unrepliedAvgLen ? '短' : '长';
          insights.push({
            name: `主题行长度策略`,
            category: 'email_subject',
            key: 'subject_length',
            confidence: Math.min(0.8, replied.length / 20),
            rules: { optimal_length: Math.round(repliedAvgLen), direction: betterLen },
            description: `有回复的邮件主题行平均${Math.round(repliedAvgLen)}字符，${betterLen}主题行效果更好（基于${replied.length}封有回复邮件分析）`
          });
        }

        // 检查问号/数字等特征
        const repliedHasQuestion = replied.filter(r => (r.subject || '').includes('?')).length / replied.length;
        const unrepliedHasQuestion = unreplied.filter(r => (r.subject || '').includes('?')).length / unreplied.length;
        if (repliedHasQuestion > unrepliedHasQuestion + 0.15) {
          insights.push({
            name: '主题行问句策略',
            category: 'email_subject',
            key: 'subject_question',
            confidence: Math.min(0.7, replied.length / 25),
            rules: { use_question: true },
            description: `含问号的主题行回复率更高（${(repliedHasQuestion * 100).toFixed(0)}% vs ${(unrepliedHasQuestion * 100).toFixed(0)}%）`
          });
        }
      }
    } catch (e) {
      console.warn('[AgentLearner] 主题行分析失败:', e.message);
    }
    return insights;
  }

  // ========== 发送时间分析 ==========

  _analyzeSendTiming() {
    const insights = [];
    try {
      // 按小时统计回复率
      const hourStats = this.db.prepare(`
        SELECT 
          CAST(strftime('%H', e.sent_at) AS INTEGER) as hour,
          COUNT(*) as total,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at) THEN 1 ELSE 0 END) as replied
        FROM emails e
        WHERE e.direction='outbound' AND e.status='sent' AND e.sent_at IS NOT NULL
        GROUP BY hour
        HAVING total >= 3
        ORDER BY hour
      `).all();

      if (hourStats.length >= 4) {
        const withRate = hourStats.map(h => ({ ...h, rate: h.replied / h.total }));
        const bestHour = withRate.reduce((a, b) => a.rate > b.rate ? a : b);
        const worstHour = withRate.reduce((a, b) => a.rate < b.rate ? a : b);

        if (bestHour.rate - worstHour.rate > 0.1 && bestHour.total >= 5) {
          insights.push({
            name: '最佳发送时间策略',
            category: 'send_timing',
            key: 'best_hour',
            confidence: Math.min(0.75, bestHour.total / 15),
            rules: { best_hour: bestHour.hour, best_rate: bestHour.rate, worst_hour: worstHour.hour },
            description: `${bestHour.hour}点发送回复率最高(${(bestHour.rate * 100).toFixed(0)}%)，${worstHour.hour}点最低(${(worstHour.rate * 100).toFixed(0)}%)，基于${hourStats.reduce((s, h) => s + h.total, 0)}封邮件`
          });
        }
      }
    } catch (e) {
      console.warn('[AgentLearner] 发送时间分析失败:', e.message);
    }
    return insights;
  }

  // ========== 地区响应分析 ==========

  _analyzeRegionResponse() {
    const insights = [];
    try {
      const regionStats = this.db.prepare(`
        SELECT c.country,
          COUNT(DISTINCT e.id) as sent,
          COUNT(DISTINCT re.id) as replied
        FROM customers c
        JOIN emails e ON e.customer_id = c.id AND e.direction='outbound' AND e.status='sent'
        LEFT JOIN received_emails re ON re.customer_id = c.id AND re.received_at > e.sent_at
        WHERE c.country IS NOT NULL AND c.country != ''
        GROUP BY c.country
        HAVING sent >= 3
        ORDER BY sent DESC
        LIMIT 20
      `).all();

      if (regionStats.length >= 3) {
        const withRate = regionStats.map(r => ({ ...r, rate: r.replied / r.sent }));
        const bestRegion = withRate.reduce((a, b) => a.rate > b.rate ? a : b);
        const avgRate = withRate.reduce((s, r) => s + r.rate, 0) / withRate.length;

        if (bestRegion.rate > avgRate + 0.1 && bestRegion.sent >= 5) {
          insights.push({
            name: `高响应地区策略`,
            category: 'region',
            key: 'best_region',
            confidence: Math.min(0.7, bestRegion.sent / 10),
            rules: { best_region: bestRegion.country, rate: bestRegion.rate, regions: withRate.slice(0, 5) },
            description: `${bestRegion.country}回复率最高(${(bestRegion.rate * 100).toFixed(0)}%)，建议优先开发该地区客户`
          });
        }
      }
    } catch (e) {
      console.warn('[AgentLearner] 地区分析失败:', e.message);
    }
    return insights;
  }

  // ========== 邮件类型分析 ==========

  _analyzeEmailTypes() {
    const insights = [];
    try {
      // 首封邮件 vs 跟进邮件的回复率
      const firstEmails = this.db.prepare(`
        SELECT e.customer_id, e.id,
          CASE WHEN EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at) THEN 1 ELSE 0 END as got_reply
        FROM emails e
        WHERE e.direction='outbound' AND e.status='sent'
          AND NOT EXISTS (SELECT 1 FROM emails e2 WHERE e2.customer_id = e.customer_id AND e2.direction='outbound' AND e2.status='sent' AND e2.sent_at < e.sent_at)
      `).all();

      const followUps = this.db.prepare(`
        SELECT e.customer_id, e.id,
          CASE WHEN EXISTS (SELECT 1 FROM received_emails re WHERE re.customer_id = e.customer_id AND re.received_at > e.sent_at) THEN 1 ELSE 0 END as got_reply
        FROM emails e
        WHERE e.direction='outbound' AND e.status='sent'
          AND EXISTS (SELECT 1 FROM emails e2 WHERE e2.customer_id = e.customer_id AND e2.direction='outbound' AND e2.status='sent' AND e2.sent_at < e.sent_at)
      `).all();

      if (firstEmails.length >= 5 && followUps.length >= 5) {
        const firstRate = firstEmails.filter(e => e.got_reply).length / firstEmails.length;
        const followRate = followUps.filter(e => e.got_reply).length / followUps.length;

        if (Math.abs(firstRate - followRate) > 0.05) {
          const better = firstRate > followRate ? '首封邮件' : '跟进邮件';
          insights.push({
            name: '邮件类型效果策略',
            category: 'email_type',
            key: 'type_effectiveness',
            confidence: Math.min(0.7, (firstEmails.length + followUps.length) / 30),
            rules: { first_rate: firstRate, followup_rate: followRate, better },
            description: `${better}回复率更高（首封${(firstRate * 100).toFixed(0)}% vs 跟进${(followRate * 100).toFixed(0)}%），基于${firstEmails.length + followUps.length}封邮件`
          });
        }
      }
    } catch (e) {
      console.warn('[AgentLearner] 邮件类型分析失败:', e.message);
    }
    return insights;
  }

  // ========== 工具方法 ==========

  _findSimilarStrategy(category, key) {
    try {
      return this.db.prepare(
        "SELECT id FROM agent_strategies WHERE category = ? AND name LIKE ? AND source = 'auto_learned' LIMIT 1"
      ).get(category, `%${key}%`);
    } catch { return null; }
  }
}

module.exports = { AgentLearner };
