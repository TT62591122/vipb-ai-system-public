/**
 * Google Maps 采集执行器
 * 
 * 支持的 actions:
 * - collect_businesses: 按关键词+地区搜索商家
 * - collect_contacts: 提取商家联系方式（电话/邮箱/网站）
 * - collect_reviews: 采集商家评价
 */

const cheerio = require('cheerio');
const axios = require('axios');

class GoogleMapsExecutor {
  constructor(db, browserPool) {
    this.db = db;
    this.browserPool = browserPool;
  }

  async execute(context) {
    const { action } = context;

    switch (action) {
      case 'collect_businesses':
        return await this.collectBusinesses(context);
      case 'collect_contacts':
        return await this.collectContacts(context);
      case 'collect_reviews':
        return await this.collectReviews(context);
      default:
        throw new Error(`Google Maps 不支持的动作: ${action}`);
    }
  }

  // ==================== 搜索商家 ====================

  async collectBusinesses(context) {
    const { taskId, inputData, onProgress, onItem, onCollected, intervalMin, intervalMax } = context;
    const { keyword, location, maxResults = 100, language = 'en' } = inputData;

    if (!keyword) throw new Error('缺少搜索关键词 (keyword)');
    if (!location) throw new Error('缺少搜索地区 (location)');

    const searchQuery = `${keyword} in ${location}`;
    console.log(`🗺️ Google Maps 搜索: "${searchQuery}"`);

    let browser, page;
    let processed = 0, success = 0, failed = 0;

    try {
      // 获取浏览器实例
      if (this.browserPool) {
        const instance = await this.browserPool.acquire('google-maps-scraper');
        browser = instance.browser;
        page = await browser.newPage();
      } else {
        // fallback: 直接用 puppeteer
        const puppeteer = require('puppeteer-extra');
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        page = await browser.newPage();
      }

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // 打开 Google Maps
      const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=${language}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // 等待搜索结果加载
      await this._sleep(3000);

      // 滚动加载更多结果
      const results = [];
      let lastCount = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 20;

      while (results.length < maxResults && scrollAttempts < maxScrollAttempts) {
        // 尝试获取结果列表
        const items = await page.evaluate(() => {
          const elements = document.querySelectorAll('[role="feed"] > div > div > a[href*="/maps/place/"]');
          return Array.from(elements).map(el => {
            const parent = el.closest('[role="feed"] > div');
            return {
              name: el.getAttribute('aria-label') || '',
              url: el.href || '',
              rating: parent?.querySelector('[role="img"]')?.getAttribute('aria-label') || '',
            };
          }).filter(item => item.name && item.url);
        });

        // 处理新发现的结果
        for (const item of items) {
          if (results.length >= maxResults) break;
          if (results.some(r => r.url === item.url)) continue;

          results.push(item);
          processed++;
          success++;

          onCollected({
            data_type: 'contact',
            external_id: item.url,
            display_name: item.name,
            profile_url: item.url,
            bio: item.rating,
            raw: item
          });

          onItem({
            target: item.url,
            success: true,
            result: { name: item.name, url: item.url }
          });

          onProgress(processed, success, failed);
        }

        // 如果没有新结果，继续滚动
        if (results.length === lastCount) {
          scrollAttempts++;
        } else {
          scrollAttempts = 0;
          lastCount = results.length;
        }

        // 滚动加载更多
        await page.evaluate(() => {
          const feed = document.querySelector('[role="feed"]');
          if (feed) feed.scrollTop = feed.scrollHeight;
        });

        await this._randomDelay(intervalMin || 2, intervalMax || 5);
      }

      console.log(`✅ Google Maps 采集完成: ${results.length} 个商家`);
      return { total: results.length };

    } catch (error) {
      console.error('Google Maps 采集失败:', error.message);
      throw error;
    } finally {
      if (page) await page.close().catch(() => {});
      if (this.browserPool) {
        // release back to pool
      } else if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  // ==================== 提取联系方式 ====================

  async collectContacts(context) {
    const { taskId, inputData, sourceData, onProgress, onItem, onCollected, intervalMin, intervalMax } = context;
    
    // 从上游任务或直接输入获取商家URL列表
    let businessUrls = [];
    if (sourceData && sourceData.length > 0) {
      businessUrls = sourceData.map(d => ({ name: d.display_name, url: d.profile_url }));
    } else if (inputData.urls) {
      businessUrls = inputData.urls;
    } else {
      throw new Error('缺少商家URL列表 (urls 或上游任务)');
    }

    console.log(`📇 提取联系方式: ${businessUrls.length} 个商家`);

    let browser, page;
    let processed = 0, success = 0, failed = 0;

    try {
      if (this.browserPool) {
        const instance = await this.browserPool.acquire('google-maps-contacts');
        browser = instance.browser;
        page = await browser.newPage();
      } else {
        const puppeteer = require('puppeteer-extra');
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        page = await browser.newPage();
      }

      for (const biz of businessUrls) {
        try {
          await page.goto(biz.url, { waitUntil: 'networkidle2', timeout: 20000 });
          await this._sleep(2000);

          // 提取联系信息
          const contact = await page.evaluate(() => {
            const getText = (selector) => {
              const el = document.querySelector(selector);
              return el ? el.textContent.trim() : '';
            };

            // 从页面中提取信息
            const allText = document.body.innerText;
            
            // 提取电话
            const phoneMatch = allText.match(/[\+]?[(]?[0-9]{1,4}[)]?[-\s\./0-9]{7,15}/);
            
            // 提取网站
            const websiteEl = document.querySelector('a[data-item-id="authority"]') || 
                              document.querySelector('a[href*="http"][data-tooltip*="website"]');
            
            // 提取地址
            const addressEl = document.querySelector('[data-item-id="address"]') ||
                              document.querySelector('button[data-item-id="address"]');

            return {
              phone: phoneMatch ? phoneMatch[0] : '',
              website: websiteEl ? websiteEl.href : '',
              address: addressEl ? addressEl.textContent.trim() : '',
            };
          });

          // 如果有网站，尝试从网站提取邮箱
          let email = '';
          if (contact.website) {
            try {
              const siteRes = await axios.get(contact.website, { timeout: 10000 });
              const emailMatch = siteRes.data.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              email = emailMatch ? emailMatch[0] : '';
            } catch (e) { /* 网站访问失败，跳过 */ }
          }

          processed++;
          success++;

          onCollected({
            data_type: 'contact',
            external_id: biz.url,
            display_name: biz.name,
            profile_url: biz.url,
            email: email,
            phone: contact.phone,
            website: contact.website,
            country: contact.address,
            raw: { ...contact, email }
          });

          onItem({ target: biz.url, success: true, result: { ...contact, email } });
          onProgress(processed, success, failed);

        } catch (error) {
          processed++;
          failed++;
          onItem({ target: biz.url, success: false, result: { error: error.message } });
          onProgress(processed, success, failed);
        }

        await this._randomDelay(intervalMin || 5, intervalMax || 15);
      }

      console.log(`✅ 联系方式提取完成: ${success}/${processed}`);
      return { total: processed, success, failed };

    } finally {
      if (page) await page.close().catch(() => {});
      if (!this.browserPool && browser) await browser.close().catch(() => {});
    }
  }

  // ==================== 采集评价 ====================

  async collectReviews(context) {
    const { inputData, onProgress, onItem, onCollected, intervalMin, intervalMax } = context;
    const { url, maxReviews = 50 } = inputData;

    if (!url) throw new Error('缺少商家URL (url)');

    console.log(`⭐ 采集评价: ${url}`);

    let browser, page;
    let processed = 0, success = 0, failed = 0;

    try {
      if (this.browserPool) {
        const instance = await this.browserPool.acquire('google-maps-reviews');
        browser = instance.browser;
        page = await browser.newPage();
      } else {
        const puppeteer = require('puppeteer-extra');
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        page = await browser.newPage();
      }

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await this._sleep(2000);

      // 点击评价标签
      const reviewTab = await page.$('button[aria-label*="review"], button[aria-label*="评价"]');
      if (reviewTab) {
        await reviewTab.click();
        await this._sleep(2000);
      }

      // 滚动加载评价
      let reviews = [];
      let scrollAttempts = 0;

      while (reviews.length < maxReviews && scrollAttempts < 10) {
        const newReviews = await page.evaluate(() => {
          const elements = document.querySelectorAll('[data-review-id]');
          return Array.from(elements).map(el => {
            const authorEl = el.querySelector('.d4r55');
            const ratingEl = el.querySelector('[role="img"]');
            const textEl = el.querySelector('.wiI7pd');
            const timeEl = el.querySelector('.rsqaWe');

            return {
              author: authorEl?.textContent?.trim() || '',
              rating: ratingEl?.getAttribute('aria-label') || '',
              text: textEl?.textContent?.trim() || '',
              time: timeEl?.textContent?.trim() || '',
              reviewId: el.getAttribute('data-review-id') || ''
            };
          });
        });

        for (const review of newReviews) {
          if (reviews.length >= maxReviews) break;
          if (reviews.some(r => r.reviewId === review.reviewId)) continue;

          reviews.push(review);
          processed++;
          success++;

          onCollected({
            data_type: 'comment',
            external_id: review.reviewId,
            username: review.author,
            display_name: review.author,
            bio: review.text,
            raw: review
          });

          onItem({ target: review.reviewId, success: true, result: review });
          onProgress(processed, success, failed);
        }

        if (newReviews.length === 0) scrollAttempts++;
        
        // 滚动
        await page.evaluate(() => {
          const container = document.querySelector('.m6QErb.DxyBCb');
          if (container) container.scrollTop = container.scrollHeight;
        });

        await this._randomDelay(intervalMin || 2, intervalMax || 5);
      }

      console.log(`✅ 评价采集完成: ${reviews.length} 条`);
      return { total: reviews.length };

    } finally {
      if (page) await page.close().catch(() => {});
      if (!this.browserPool && browser) await browser.close().catch(() => {});
    }
  }

  // ==================== 工具方法 ====================

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _randomDelay(minSec, maxSec) {
    const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
    return this._sleep(ms);
  }
}

module.exports = GoogleMapsExecutor;
