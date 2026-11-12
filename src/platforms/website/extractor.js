/**
 * 独立站联系方式提取执行器
 * 
 * 从网站中提取邮箱、电话、WhatsApp、社媒链接等联系方式
 */

const axios = require('axios');
const cheerio = require('cheerio');

class WebsiteContactExtractor {
  constructor(db) {
    this.db = db;
  }

  async execute(context) {
    const { action } = context;
    switch (action) {
      case 'extract_contacts':
        return await this.extractContacts(context);
      case 'extract_from_urls':
        return await this.extractFromUrls(context);
      default:
        throw new Error(`不支持的动作: ${action}`);
    }
  }

  async extractContacts(context) {
    const { inputData, sourceData, onProgress, onItem, onCollected, intervalMin, intervalMax } = context;
    
    // 从上游任务获取网站列表，或从输入参数获取
    let urls = [];
    if (sourceData && sourceData.length > 0) {
      urls = sourceData.filter(d => d.website).map(d => ({ url: d.website, name: d.display_name }));
    } else if (inputData.urls) {
      urls = inputData.urls.map(u => typeof u === 'string' ? { url: u, name: '' } : u);
    } else {
      throw new Error('缺少网站URL列表');
    }

    console.log(`🌐 独立站联系方式提取: ${urls.length} 个网站`);

    let processed = 0, success = 0, failed = 0;

    for (const site of urls) {
      try {
        const contacts = await this._extractFromSite(site.url);
        processed++;

        if (contacts.emails.length > 0 || contacts.phones.length > 0) {
          success++;
          
          onCollected({
            data_type: 'contact',
            external_id: site.url,
            display_name: site.name || contacts.companyName || '',
            profile_url: site.url,
            email: contacts.emails[0] || '',
            phone: contacts.phones[0] || '',
            website: site.url,
            country: contacts.country || '',
            raw: contacts
          });
        } else {
          failed++;
        }

        onItem({
          target: site.url,
          success: contacts.emails.length > 0 || contacts.phones.length > 0,
          result: contacts
        });
        onProgress(processed, success, failed);

      } catch (error) {
        processed++;
        failed++;
        onItem({ target: site.url, success: false, result: { error: error.message } });
        onProgress(processed, success, failed);
      }

      // 随机延迟
      if (processed < urls.length) {
        const delay = ((intervalMin || 2) + Math.random() * ((intervalMax || 5) - (intervalMin || 2))) * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.log(`✅ 联系方式提取完成: ${success}/${processed}`);
    return { total: processed, success, failed };
  }

  async extractFromUrls(context) {
    return this.extractContacts(context);
  }

  // ==================== 核心提取逻辑 ====================

  async _extractFromSite(url) {
    const result = {
      emails: [],
      phones: [],
      whatsapp: [],
      socialLinks: {},
      companyName: '',
      address: '',
      country: ''
    };

    try {
      // 规范化 URL
      if (!url.startsWith('http')) url = 'https://' + url;

      // 获取首页
      const homePage = await this._fetchPage(url);
      if (homePage) {
        this._extractFromHtml(homePage, url, result);
      }

      // 尝试常见联系页面
      const contactPaths = ['/contact', '/contact-us', '/about', '/about-us', '/impressum', '/kontakt'];
      for (const path of contactPaths) {
        try {
          const contactPage = await this._fetchPage(new URL(path, url).href);
          if (contactPage) {
            this._extractFromHtml(contactPage, url, result);
          }
        } catch (e) { /* 页面不存在，继续 */ }
      }

      // 去重
      result.emails = [...new Set(result.emails)].filter(e => !e.includes('example.com') && !e.includes('wixpress'));
      result.phones = [...new Set(result.phones)];
      result.whatsapp = [...new Set(result.whatsapp)];

    } catch (error) {
      result.error = error.message;
    }

    return result;
  }

  async _fetchPage(url) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        maxRedirects: 3
      });
      return response.data;
    } catch (e) {
      return null;
    }
  }

  _extractFromHtml(html, baseUrl, result) {
    const $ = cheerio.load(html);
    const text = $('body').text();

    // 提取邮箱
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailRegex) || [];
    // 也从 mailto 链接提取
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href');
      const email = href.replace('mailto:', '').split('?')[0];
      if (email) emails.push(email);
    });
    result.emails.push(...emails);

    // 提取电话
    const phoneRegex = /(?:\+?\d{1,4}[\s\-\.]?)?\(?\d{1,4}\)?[\s\-\.]?\d{2,4}[\s\-\.]?\d{2,4}[\s\-\.]?\d{0,4}/g;
    const phones = text.match(phoneRegex) || [];
    $('a[href^="tel:"]').each((_, el) => {
      const href = $(el).attr('href');
      phones.push(href.replace('tel:', ''));
    });
    result.phones.push(...phones.filter(p => p.replace(/\D/g, '').length >= 7));

    // 提取 WhatsApp
    $('a[href*="wa.me"], a[href*="whatsapp"]').each((_, el) => {
      const href = $(el).attr('href');
      const match = href.match(/(\d{10,15})/);
      if (match) result.whatsapp.push(match[1]);
    });

    // 提取社媒链接
    const socialPlatforms = {
      facebook: /facebook\.com\/[^\s"'<>]+/,
      instagram: /instagram\.com\/[^\s"'<>]+/,
      twitter: /(?:twitter|x)\.com\/[^\s"'<>]+/,
      linkedin: /linkedin\.com\/(?:company|in)\/[^\s"'<>]+/,
      youtube: /youtube\.com\/(?:@|channel\/|c\/)[^\s"'<>]+/,
      tiktok: /tiktok\.com\/@[^\s"'<>]+/
    };

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      for (const [platform, regex] of Object.entries(socialPlatforms)) {
        if (regex.test(href) && !result.socialLinks[platform]) {
          result.socialLinks[platform] = href;
        }
      }
    });

    // 提取公司名
    if (!result.companyName) {
      const title = $('title').text().trim();
      const ogTitle = $('meta[property="og:title"]').attr('content');
      result.companyName = ogTitle || title.split(/[|\-–—]/)[0].trim();
    }

    // 提取地址
    const addressPatterns = $('[itemtype*="PostalAddress"], [class*="address"], [id*="address"]');
    if (addressPatterns.length > 0) {
      result.address = addressPatterns.first().text().trim().substring(0, 200);
    }
  }
}

module.exports = WebsiteContactExtractor;
