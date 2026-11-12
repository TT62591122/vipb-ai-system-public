/**
 * ScraperEngine - 轻量级替代
 * 
 * 旧版引用4个不存在的表(scraper_config, proxy_ips, scrape_tasks, scrape_results)。
 * 此 stub 使用已有的 proxies 表，提供基础采集能力。
 * 完整多平台采集将由 src/platforms/ 架构接管（融合方案 3.1/3.2）。
 * 
 * 旧文件备份: src/deprecated/scraper-engine.js.bak
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { getProxyAgent } = require('./outbound-proxy');

class ScraperEngine {
  constructor(db) {
    this.db = db;
    this.runningTasks = new Map();
  }

  // 获取可用代理（使用 proxies 表）
  getAvailableProxy() {
    try {
      const row = this.db.prepare(
        "SELECT * FROM proxies WHERE status = 'active' ORDER BY RANDOM() LIMIT 1"
      ).get();
      
      if (!row) return null;
      
      return {
        host: row.host,
        port: row.port,
        protocol: row.protocol || 'http',
        username: row.username || '',
        password: row.password || ''
      };
    } catch (error) {
      return null;
    }
  }

  // 基础 Google 搜索采集
  async searchGoogle(query, options = {}) {
    const maxPages = options.maxPages || 3;
    const results = [];

    for (let page = 0; page < maxPages; page++) {
      try {
        const start = page * 10;
        const proxy = this.getAvailableProxy();
        
        const axiosConfig = {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        };

        // 首先检查全局出站代理配置
        const outboundAgent = getProxyAgent(this.db);
        if (outboundAgent) {
          axiosConfig.httpAgent = outboundAgent;
          axiosConfig.httpsAgent = outboundAgent;
        } else if (proxy) {
          // 如果没有出站代理，使用本地代理池
          axiosConfig.proxy = {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            auth: proxy.username ? { username: proxy.username, password: proxy.password } : undefined
          };
        }

        const response = await axios.get(
          `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${start}`,
          axiosConfig
        );

        const $ = cheerio.load(response.data);
        
        $('div.g').each((_, el) => {
          const title = $(el).find('h3').text();
          const link = $(el).find('a').attr('href');
          const snippet = $(el).find('.VwiC3b').text();
          
          if (title && link && link.startsWith('http')) {
            results.push({ title, link, snippet, source: 'google', page: page + 1 });
          }
        });

        // 防封延迟
        if (page < maxPages - 1) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
      } catch (error) {
        console.error(`Google搜索第${page + 1}页失败:`, error.message);
        break;
      }
    }

    return results;
  }

  // 基础 Alibaba 采集
  async searchAlibaba(keyword, options = {}) {
    const results = [];
    
    try {
      const proxy = this.getAvailableProxy();
      const axiosConfig = {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      // 首先检查全局出站代理配置
      const outboundAgent = getProxyAgent(this.db);
      if (outboundAgent) {
        axiosConfig.httpAgent = outboundAgent;
        axiosConfig.httpsAgent = outboundAgent;
      } else if (proxy) {
        // 如果没有出站代理，使用本地代理池
        axiosConfig.proxy = {
          host: proxy.host, port: proxy.port, protocol: proxy.protocol
        };
      }

      const response = await axios.get(
        `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keyword)}`,
        axiosConfig
      );

      const $ = cheerio.load(response.data);
      
      $('.organic-list .list-no-v2-outter').each((_, el) => {
        const title = $(el).find('.elements-title-normal__content').text().trim();
        const company = $(el).find('.search-card-e-company').text().trim();
        const link = $(el).find('a.elements-title-normal').attr('href');
        
        if (title) {
          results.push({
            title, company, link: link ? `https:${link}` : '',
            source: 'alibaba', keyword
          });
        }
      });
    } catch (error) {
      console.error('Alibaba搜索失败:', error.message);
    }

    return results;
  }

  // 执行采集任务（兼容 app.js 调用）
  async executeTask(taskId) {
    console.log(`⚠️ 采集任务 ${taskId} 需要 MatrixTaskEngine（融合方案待实现）`);
    return { success: false, message: '采集引擎升级中，请等待 MatrixTaskEngine 上线' };
  }
}

module.exports = ScraperEngine;
