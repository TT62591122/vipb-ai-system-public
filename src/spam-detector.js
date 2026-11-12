/**
 * 邮件垃圾词检测引擎
 * - 中英文垃圾词库（外贸场景优化）
 * - 权重评分（不同词不同扣分）
 * - 结构分析（全大写比例、感叹号密度、链接数量）
 * - 建议替换词
 * 
 * 用法：
 *   const detector = new SpamDetector();
 *   const result = detector.analyze(subject, body);
 *   // { score: 0-100, level: 'safe'|'warning'|'danger', issues: [...], suggestions: [...] }
 */

// 垃圾词库：[词/正则, 权重(1-10), 建议替换]
const SPAM_WORDS = [
  // === 高危（权重8-10）===
  ['free', 8, 'complimentary / no-cost'],
  ['100% free', 10, null],
  ['act now', 9, 'at your earliest convenience'],
  ['limited time', 8, 'current promotion'],
  ['buy now', 9, 'place your order'],
  ['click here', 8, 'visit our page / learn more'],
  ['congratulations', 9, null],
  ['you have been selected', 10, null],
  ['winner', 10, null],
  ['urgent', 8, 'time-sensitive'],
  ['make money', 10, null],
  ['earn extra', 9, null],
  ['double your', 9, null],
  ['no obligation', 8, null],
  ['risk-free', 8, 'with our guarantee'],
  ['guarantee', 7, 'assurance'],
  ['lowest price', 9, 'competitive pricing'],
  ['best price', 7, 'competitive pricing'],
  ['cheap', 8, 'cost-effective / affordable'],
  ['discount', 6, 'special pricing'],
  ['save big', 8, 'cost savings'],
  ['order now', 8, 'place your order'],
  ['call now', 8, 'contact us'],
  ['apply now', 7, 'submit your application'],
  ['no credit check', 10, null],
  ['cash bonus', 10, null],
  
  // === 中危（权重4-7）===
  ['special offer', 5, 'exclusive opportunity'],
  ['limited offer', 6, 'current opportunity'],
  ['exclusive deal', 5, 'partnership opportunity'],
  ['don\'t miss', 5, 'we\'d like to share'],
  ['once in a lifetime', 7, null],
  ['amazing', 4, 'impressive / notable'],
  ['incredible', 4, 'remarkable'],
  ['unbelievable', 5, null],
  ['dear friend', 6, 'Dear [Name]'],
  ['to whom it may concern', 4, 'Dear [Name/Title]'],
  ['as seen on', 5, null],
  ['no hidden', 5, null],
  ['100% satisfaction', 6, null],
  ['money back', 5, 'refund policy'],
  ['while supplies last', 6, 'subject to availability'],
  ['promotional', 4, null],
  
  // === 外贸B2B常见陷阱 ===
  ['lowest moq', 6, 'flexible MOQ'],
  ['factory direct', 5, 'manufacturer pricing'],
  ['wholesale', 4, 'bulk pricing'],
  ['dropship', 5, null],
  ['best quality', 5, 'high-quality / certified'],
  ['top quality', 4, 'premium quality'],
  ['#1', 5, 'leading'],
  ['number one', 5, 'leading'],
];

// 中文垃圾词
const SPAM_WORDS_CN = [
  ['免费', 8, null],
  ['立即购买', 9, null],
  ['限时优惠', 7, null],
  ['点击这里', 8, null],
  ['恭喜', 8, null],
  ['中奖', 10, null],
  ['赚钱', 10, null],
  ['最低价', 8, '有竞争力的价格'],
  ['全网最低', 9, null],
];

class SpamDetector {
  constructor() {
    // 预编译正则
    this._patterns = SPAM_WORDS.map(([word, weight, suggestion]) => ({
      regex: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
      word, weight, suggestion
    }));
    this._patternsCN = SPAM_WORDS_CN.map(([word, weight, suggestion]) => ({
      regex: new RegExp(word, 'gi'),
      word, weight, suggestion
    }));
  }

  /**
   * 分析邮件内容
   * @param {string} subject 
   * @param {string} body 
   * @returns {{ score: number, level: string, issues: Array, suggestions: Array }}
   */
  analyze(subject, body) {
    const fullText = `${subject || ''} ${body || ''}`;
    const issues = [];
    const suggestions = [];
    let totalPenalty = 0;

    // 1. 垃圾词检测
    for (const p of [...this._patterns, ...this._patternsCN]) {
      const matches = fullText.match(p.regex);
      if (matches) {
        const count = matches.length;
        const penalty = p.weight * count;
        totalPenalty += penalty;
        issues.push({
          type: 'spam_word',
          word: p.word,
          count,
          penalty,
          inSubject: subject ? p.regex.test(subject) : false
        });
        if (p.suggestion) {
          suggestions.push(`"${p.word}" → ${p.suggestion}`);
        }
      }
    }

    // 2. 主题行检测（主题中的垃圾词加倍扣分）
    if (subject) {
      const subjectUpper = subject.replace(/[^a-zA-Z]/g, '');
      if (subjectUpper.length > 5 && subjectUpper === subjectUpper.toUpperCase()) {
        totalPenalty += 15;
        issues.push({ type: 'all_caps_subject', penalty: 15 });
        suggestions.push('主题行避免全大写，改用正常大小写');
      }
      if ((subject.match(/!/g) || []).length > 1) {
        totalPenalty += 8;
        issues.push({ type: 'excessive_exclamation_subject', penalty: 8 });
        suggestions.push('主题行最多用1个感叹号');
      }
      if (/RE:|FW:/i.test(subject) && !subject.includes('Re:')) {
        totalPenalty += 10;
        issues.push({ type: 'fake_reply', penalty: 10 });
        suggestions.push('不要伪造回复/转发标记');
      }
    }

    // 3. 正文结构分析
    if (body) {
      // 全大写比例
      const letters = body.replace(/[^a-zA-Z]/g, '');
      if (letters.length > 20) {
        const upperRatio = (letters.replace(/[^A-Z]/g, '').length) / letters.length;
        if (upperRatio > 0.5) {
          totalPenalty += 10;
          issues.push({ type: 'high_caps_ratio', ratio: upperRatio.toFixed(2), penalty: 10 });
          suggestions.push('正文大写字母比例过高，建议降到30%以下');
        }
      }

      // 感叹号密度
      const exclamations = (body.match(/!/g) || []).length;
      if (exclamations > 3) {
        const penalty = Math.min(exclamations * 2, 15);
        totalPenalty += penalty;
        issues.push({ type: 'excessive_exclamation', count: exclamations, penalty });
        suggestions.push(`正文有${exclamations}个感叹号，建议减少到2个以内`);
      }

      // 链接数量
      const links = (body.match(/https?:\/\//g) || []).length;
      if (links > 3) {
        const penalty = (links - 3) * 5;
        totalPenalty += penalty;
        issues.push({ type: 'too_many_links', count: links, penalty });
        suggestions.push(`正文有${links}个链接，建议减少到3个以内`);
      }

      // 图文比例（纯图片无文字）
      const imgCount = (body.match(/<img/gi) || []).length;
      const textLength = body.replace(/<[^>]+>/g, '').trim().length;
      if (imgCount > 0 && textLength < 100) {
        totalPenalty += 12;
        issues.push({ type: 'low_text_ratio', penalty: 12 });
        suggestions.push('邮件文字内容太少，图片太多，建议增加文字描述');
      }
    }

    // 计算最终分数（100分起扣）
    const score = Math.max(0, 100 - totalPenalty);
    let level;
    if (score >= 80) level = 'safe';
    else if (score >= 50) level = 'warning';
    else level = 'danger';

    return { score, level, issues, suggestions };
  }
}

module.exports = { SpamDetector };
