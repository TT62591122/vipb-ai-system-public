/**
 * SEO 引擎 — 站内/站外SEO优化工具
 * 
 * - 页面SEO分析（meta/heading/alt/速度）
 * - 关键词研究（通过搜索引擎suggest）
 * - 内容优化建议（AI生成）
 * - 外链建设（社媒矩阵反向链接）
 * - 站点地图生成
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { getProxyAgent, injectProxy } = require('./outbound-proxy');
const { decrypt } = require('./crypto-utils');

class SEOEngine {
  constructor(db) {
    this.db = db;
  }

  // ==================== 页面SEO分析 ====================

  async analyzePage(url) {
    const html = await this._fetch(url);
    if (!html) throw new Error('无法访问页面');
    
    const $ = cheerio.load(html);
    const issues = [];
    const score = { total: 100 };

    // Title
    const title = $('title').text().trim();
    if (!title) { issues.push({ severity: 'critical', type: 'title', message: '缺少 <title> 标签' }); score.total -= 15; }
    else if (title.length < 30) { issues.push({ severity: 'warning', type: 'title', message: `标题太短 (${title.length}字符, 建议30-60)` }); score.total -= 5; }
    else if (title.length > 60) { issues.push({ severity: 'warning', type: 'title', message: `标题太长 (${title.length}字符, 建议30-60)` }); score.total -= 3; }

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    if (!metaDesc) { issues.push({ severity: 'critical', type: 'meta', message: '缺少 meta description' }); score.total -= 10; }
    else if (metaDesc.length < 80) { issues.push({ severity: 'warning', type: 'meta', message: `描述太短 (${metaDesc.length}字符, 建议120-160)` }); score.total -= 3; }

    // H1
    const h1s = $('h1');
    if (h1s.length === 0) { issues.push({ severity: 'critical', type: 'heading', message: '缺少 H1 标签' }); score.total -= 10; }
    else if (h1s.length > 1) { issues.push({ severity: 'warning', type: 'heading', message: `多个 H1 标签 (${h1s.length}个, 建议1个)` }); score.total -= 5; }

    // Images without alt
    const imagesNoAlt = $('img:not([alt]), img[alt=""]').length;
    const totalImages = $('img').length;
    if (imagesNoAlt > 0) {
      issues.push({ severity: 'warning', type: 'image', message: `${imagesNoAlt}/${totalImages} 张图片缺少 alt 属性` });
      score.total -= Math.min(imagesNoAlt * 2, 10);
    }

    // Canonical
    if (!$('link[rel="canonical"]').length) {
      issues.push({ severity: 'info', type: 'canonical', message: '缺少 canonical 标签' }); score.total -= 3;
    }

    // Open Graph
    if (!$('meta[property="og:title"]').length) {
      issues.push({ severity: 'info', type: 'og', message: '缺少 Open Graph 标签' }); score.total -= 2;
    }

    // Links
    const internalLinks = $('a[href^="/"], a[href^="' + url + '"]').length;
    const externalLinks = $('a[href^="http"]').length - internalLinks;

    // Structured data
    const hasStructuredData = $('script[type="application/ld+json"]').length > 0;

    // Mobile viewport
    const hasViewport = $('meta[name="viewport"]').length > 0;
    if (!hasViewport) { issues.push({ severity: 'critical', type: 'mobile', message: '缺少 viewport meta 标签' }); score.total -= 10; }

    score.total = Math.max(0, score.total);

    return {
      url,
      score: score.total,
      title: { text: title, length: title.length },
      metaDescription: { text: metaDesc, length: metaDesc.length },
      headings: {
        h1: h1s.length, h2: $('h2').length, h3: $('h3').length
      },
      images: { total: totalImages, missingAlt: imagesNoAlt },
      links: { internal: internalLinks, external: externalLinks },
      hasCanonical: !!$('link[rel="canonical"]').length,
      hasOpenGraph: !!$('meta[property="og:title"]').length,
      hasStructuredData,
      hasViewport,
      issues,
      wordCount: $('body').text().split(/\s+/).length
    };
  }

  // ==================== 关键词研究 ====================

  async researchKeywords(seed, language = 'en', country = 'us') {
    const suggestions = [];

    // Google Suggest
    try {
      const prefixes = ['', 'how to ', 'best ', 'cheap ', 'buy ', 'wholesale '];
      for (const prefix of prefixes) {
        const query = prefix + seed;
        const agent = getProxyAgent(this.db);
        const axiosConfig = { params: { client: 'firefox', q: query, hl: language, gl: country }, timeout: 5000 };
        if (agent) {
          axiosConfig.httpAgent = agent;
          axiosConfig.httpsAgent = agent;
        }
        const res = await axios.get('https://suggestqueries.google.com/complete/search', axiosConfig);
        if (res.data && res.data[1]) {
          suggestions.push(...res.data[1].map(s => ({ keyword: s, source: 'google_suggest', prefix })));
        }
      }
    } catch (e) { /* Google suggest 不可用 */ }

    // 去重
    const unique = [...new Map(suggestions.map(s => [s.keyword.toLowerCase(), s])).values()];

    // AI估算关键词数据
    const config = this._getAIConfig();
    if (config && unique.length > 0) {
      try {
        const keywordList = unique.slice(0, 30).map(k => k.keyword); // 最多30个
        const prompt = `You are an SEO expert. Estimate the following metrics for each keyword in the "${seed}" niche (industry: electrical equipment, smart meters, circuit breakers, B2B foreign trade).

Keywords: ${JSON.stringify(keywordList)}

For each keyword, estimate:
- volume: monthly search volume (integer, realistic estimate based on B2B niche)
- difficulty: SEO difficulty score 0-100 (higher = harder to rank)
- cpc: estimated CPC in USD (realistic for B2B industrial keywords)
- trend: trend direction ("↑" rising, "↓" declining, "→" stable)

Return ONLY a JSON array, one object per keyword, in the same order:
[{"keyword":"...","volume":1200,"difficulty":45,"cpc":2.50,"trend":"→"}, ...]

Be realistic. B2B industrial keywords typically have volume 100-50000, CPC $1-15, difficulty 30-70.`;

        const response = await axios.post(`${config.api_base_url}/chat/completions`, {
          model: config.model_name,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3
        }, injectProxy(this.db, {
          headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }));

        const content = response.data.choices?.[0]?.message?.content || '';
        // 提取JSON数组（可能被markdown代码块包裹）
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const estimates = JSON.parse(jsonMatch[0]);
          // 合并数据到unique数组
          for (let i = 0; i < Math.min(estimates.length, unique.length); i++) {
            const est = estimates[i];
            if (est) {
              unique[i].volume = est.volume || 0;
              unique[i].difficulty = est.difficulty || 0;
              unique[i].cpc = est.cpc || 0;
              unique[i].trend = est.trend || '-';
            }
          }
        }
      } catch (e) {
        // AI估算失败，保持原有数据（全0），不影响功能
        console.log('[SEO] AI关键词估算失败:', e.message);
      }
    }

    return {
      seed,
      totalSuggestions: unique.length,
      keywords: unique.slice(0, 50),
      longTail: unique.filter(s => s.keyword.split(' ').length >= 4),
      questions: unique.filter(s => /^(how|what|why|when|where|which|who|can|do|is)/i.test(s.keyword))
    };
  }

  // ==================== AI内容优化 ====================

  async optimizeContent(content, targetKeyword, options = {}) {
    const config = this._getAIConfig();
    if (!config) {
      return this._basicOptimization(content, targetKeyword);
    }

    try {
      const response = await axios.post(`${config.api_base_url}/chat/completions`, {
        model: config.model_name,
        messages: [{
          role: 'user',
          content: `Optimize this content for SEO. Target keyword: "${targetKeyword}"
Language: ${options.language || 'en'}

Content:
${content.substring(0, 3000)}

Return JSON:
{
  "optimizedTitle": "...",
  "optimizedDescription": "... (max 160 chars)",
  "suggestedHeadings": ["H2: ...", "H2: ..."],
  "keywordDensity": "current % and recommendation",
  "improvements": ["suggestion 1", "suggestion 2"],
  "optimizedContent": "first 500 chars of improved content..."
}`
        }],
        temperature: 0.5, max_tokens: 1000
      }, {
        headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
        timeout: 30000
      });

      return JSON.parse(response.data.choices[0].message.content);
    } catch (e) {
      return this._basicOptimization(content, targetKeyword);
    }
  }

  _basicOptimization(content, keyword) {
    const words = content.split(/\s+/);
    const keywordCount = content.toLowerCase().split(keyword.toLowerCase()).length - 1;
    const density = ((keywordCount / words.length) * 100).toFixed(1);

    return {
      optimizedTitle: `${keyword} - Complete Guide ${new Date().getFullYear()}`,
      optimizedDescription: `Learn everything about ${keyword}. Expert tips, best practices and professional advice. Updated ${new Date().getFullYear()}.`,
      keywordDensity: `${density}% (recommended: 1-3%)`,
      improvements: [
        density < 1 ? `增加关键词 "${keyword}" 的使用频率` : null,
        density > 3 ? `减少关键词堆砌，当前密度 ${density}% 过高` : null,
        '添加内链到相关页面',
        '使用结构化数据标记',
        '优化图片 alt 标签包含关键词'
      ].filter(Boolean)
    };
  }

  // ==================== 站点地图生成 ====================

  async generateSitemap(baseUrl, pages) {
    const urls = pages.map(page => {
      const loc = page.url.startsWith('http') ? page.url : `${baseUrl}${page.url}`;
      return `  <url>
    <loc>${this._escapeXml(loc)}</loc>
    <lastmod>${page.lastmod || new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>${page.changefreq || 'weekly'}</changefreq>
    <priority>${page.priority || '0.5'}</priority>
  </url>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  }

  // ==================== 批量SEO检查 ====================

  async batchAnalyze(urls) {
    const results = [];
    for (const url of urls) {
      try {
        const analysis = await this.analyzePage(url);
        results.push(analysis);
      } catch (e) {
        results.push({ url, error: e.message, score: 0 });
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    const avgScore = results.reduce((s, r) => s + (r.score || 0), 0) / results.length;
    return {
      totalPages: results.length,
      averageScore: Math.round(avgScore),
      results,
      commonIssues: this._findCommonIssues(results)
    };
  }

  _findCommonIssues(results) {
    const issueCounts = {};
    for (const r of results) {
      for (const issue of (r.issues || [])) {
        const key = issue.type;
        issueCounts[key] = (issueCounts[key] || 0) + 1;
      }
    }
    return Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count, percentage: Math.round(count / results.length * 100) }));
  }

  // ==================== 工具方法 ====================

  async _fetch(url) {
    try {
      const agent = getProxyAgent(this.db);
      const axiosConfig = {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VIPBBot/1.0)' }
      };
      if (agent) {
        axiosConfig.httpAgent = agent;
        axiosConfig.httpsAgent = agent;
      }
      const res = await axios.get(url, axiosConfig);
      return res.data;
    } catch (e) { return null; }
  }

  _escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _getAIConfig() {
    try {
      // 优先从ai_configs表读取（如果存在）
      try {
        const r = this.db.prepare("SELECT * FROM ai_configs WHERE module_name IN ('seo','content') AND is_active = 1").get();
        if (r) return r;
      } catch(e) { /* 表不存在，继续 */ }
      // 回退到settings表的ai_provider配置
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

module.exports = SEOEngine;
