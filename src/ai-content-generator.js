/**
 * AI 社媒评论/内容生成器
 * 
 * 为群控任务生成个性化、多样化的评论和内容
 */

const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');
const { decrypt } = require('./crypto-utils');

class AIContentGenerator {
  constructor(db) {
    this.db = db;
    this.templates = this._loadTemplates();
  }

  // 生成评论（批量）
  async generateComments(context, count = 10) {
    const { platform, postContent, postUrl, language = 'en', tone = 'professional' } = context;

    // 先尝试 AI 生成
    try {
      return await this._aiGenerateComments(platform, postContent, count, language, tone);
    } catch (e) {
      // fallback 到模板
      return this._templateComments(platform, count, language);
    }
  }

  // 生成私信内容
  async generateDM(context) {
    const { platform, recipientName, recipientBio, purpose = 'outreach', language = 'en', productInfo } = context;

    try {
      return await this._aiGenerateDM(platform, recipientName, recipientBio, purpose, language, productInfo);
    } catch (e) {
      return this._templateDM(recipientName, purpose, language);
    }
  }

  // 生成帖子内容
  async generatePost(context) {
    const { platform, topic, keywords = [], language = 'en', includeHashtags = true, maxLength } = context;

    try {
      return await this._aiGeneratePost(platform, topic, keywords, language, includeHashtags, maxLength);
    } catch (e) {
      return this._templatePost(topic, platform, language);
    }
  }

  // ==================== AI 生成 ====================

  async _aiGenerateComments(platform, postContent, count, language, tone) {
    const config = this._getAIConfig();
    if (!config) throw new Error('AI未配置');

    const response = await axios.post(`${config.api_base_url}/chat/completions`, {
      model: config.model_name,
      messages: [{
        role: 'user',
        content: `Generate ${count} unique ${tone} comments for a ${platform} post.
Post content: "${postContent || 'product showcase'}"
Language: ${language}
Requirements:
- Each comment must be different and natural
- Vary length (short/medium)
- Some with emoji, some without
- No spammy language
- Relevant to the post

Return JSON array: ["comment1", "comment2", ...]`
      }],
      temperature: 0.9,
      max_tokens: 1000
    }, injectProxy(this.db, {
      headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      timeout: 20000
    }));

    return JSON.parse(response.data.choices[0].message.content);
  }

  async _aiGenerateDM(platform, name, bio, purpose, language, productInfo) {
    const config = this._getAIConfig();
    if (!config) throw new Error('AI未配置');

    const response = await axios.post(`${config.api_base_url}/chat/completions`, {
      model: config.model_name,
      messages: [{
        role: 'user',
        content: `Write a personalized ${platform} direct message.
Recipient: ${name || 'potential client'}
Their bio: ${bio || 'unknown'}
Purpose: ${purpose}
Product: ${productInfo || 'industrial products'}
Language: ${language}

Requirements:
- Natural, not salesy
- Reference their profile/bio if available
- Short (2-3 sentences)
- Include a soft call-to-action

Return just the message text.`
      }],
      temperature: 0.8,
      max_tokens: 300
    }, injectProxy(this.db, {
      headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      timeout: 15000
    }));

    return response.data.choices[0].message.content.trim();
  }

  async _aiGeneratePost(platform, topic, keywords, language, includeHashtags, maxLength) {
    const config = this._getAIConfig();
    if (!config) throw new Error('AI未配置');

    const platformLimits = { twitter: 280, instagram: 2200, tiktok: 300, facebook: 500, linkedin: 700 };
    const limit = maxLength || platformLimits[platform] || 500;

    const response = await axios.post(`${config.api_base_url}/chat/completions`, {
      model: config.model_name,
      messages: [{
        role: 'user',
        content: `Write a ${platform} post about: ${topic}
Keywords: ${keywords.join(', ')}
Language: ${language}
Max length: ${limit} chars
${includeHashtags ? 'Include 3-5 relevant hashtags' : 'No hashtags'}

Return just the post text.`
      }],
      temperature: 0.8,
      max_tokens: 500
    }, injectProxy(this.db, {
      headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      timeout: 15000
    }));

    return response.data.choices[0].message.content.trim();
  }

  // ==================== 模板 Fallback ====================

  _templateComments(platform, count, language) {
    const templates = language === 'zh' ? [
      '很棒的产品！👍', '质量看起来不错', '能发个报价吗？', '这个产品有什么认证？',
      '交货期多长？', '可以定制吗？', '非常专业 🔥', '有目录可以发吗？',
      '感兴趣，怎么联系？', '好产品，支持！', '请问最小起订量？', '做工精细👏'
    ] : [
      'Great product! 👍', 'Looks amazing quality', 'Can you share pricing?',
      'Very professional! 🔥', 'Interested, how to contact?', 'Nice work! 👏',
      'What certifications do you have?', 'MOQ please?', 'Lead time?',
      'Can you customize?', 'Looking good! 💪', 'Send catalog please'
    ];

    const result = [];
    const shuffled = [...templates].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      result.push(shuffled[i]);
    }
    return result;
  }

  _templateDM(name, purpose, language) {
    const greeting = name ? `Hi ${name}` : 'Hello';
    if (language === 'zh') {
      return `${name ? name + '你好' : '你好'}！看到你的主页觉得很感兴趣，我们是专业的产品制造商，想了解下是否有合作机会？`;
    }
    return `${greeting}! I came across your profile and found it very interesting. We're a professional manufacturer and I'd love to explore potential collaboration opportunities. Would you be open to a quick chat?`;
  }

  _templatePost(topic, platform, language) {
    if (language === 'zh') {
      return `🔥 ${topic}\n\n专业制造，品质保证！20年行业经验，值得信赖。\n\n📞 欢迎咨询\n\n#制造业 #B2B #品质 #外贸`;
    }
    return `🔥 ${topic}\n\nProfessional manufacturing with 20+ years of experience. Quality guaranteed!\n\n📞 Contact us for a free quote\n\n#Manufacturing #B2B #Quality #Export`;
  }

  _loadTemplates() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='content_templates'").get();
      return row ? JSON.parse(row.value) : {};
    } catch (e) { return {}; }
  }

  _getAIConfig() {
    try {
      try {
        const r = this.db.prepare("SELECT * FROM ai_configs WHERE module_name IN ('content','social','email') AND is_active = 1").get();
        if (r) return r;
      } catch(e) { /* 表不存在，继续 */ }
      const row = this.db.prepare("SELECT value FROM settings WHERE key='ai_provider'").get();
      if (!row) return null;
      const p = JSON.parse(row.value);
      if (!p.enabled || !p.baseUrl || !p.apiKey) return null;
      return {
        api_base_url: p.baseUrl.replace(/\/+$/, '') + '/v1',
        api_key: p.apiKey ? decrypt(p.apiKey) : '',
        model_name: p.model || 'gpt-4o-mini'
      };
    } catch (e) { return null; }
  }
}

module.exports = AIContentGenerator;
