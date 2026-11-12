const axios = require('axios');
const yaml = require('js-yaml');
const { injectProxy } = require('./outbound-proxy');

class SubscriptionParser {
  constructor(db) {
    this.db = db;
  }

  // 解析订阅
  async parseSubscription(subId) {
    try {
      // vpn_subscriptions 表不存在，使用 proxies 表的订阅URL
      // 先检查 proxies 表是否有对应记录
      const sub = this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(subId);
      if (!sub) {
        throw new Error('订阅不存在');
      }

      const subUrl = sub.url || sub.host; // 适配字段
      console.log(`开始解析订阅: ${subUrl}`);

      // 拉取订阅内容
      const response = await axios.get(subUrl, 
        injectProxy(this.db, {
          timeout: 30000,
          headers: {
            'User-Agent': 'clash'
          }
        })
      );

      let content = response.data;
      let nodes = [];

      // 检测订阅格式
      if (content.includes('proxies:') || content.includes('port:')) {
        // Clash YAML格式
        console.log('检测到Clash格式');
        nodes = this.parseClashYAML(content);
      } else {
        // 尝试Base64格式
        console.log('尝试Base64格式');
        try {
          const decoded = Buffer.from(content, 'base64').toString('utf-8');
          nodes = this.parseBase64Content(decoded);
        } catch (error) {
          console.log('Base64解码失败，尝试直接解析');
          nodes = this.parseBase64Content(content);
        }
      }

      // 保存节点到代理表
      let savedCount = 0;
      for (const node of nodes) {
        try {
          this.db.prepare(
            'INSERT INTO proxies (name, type, host, port, protocol, username, password, country, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            node.name,
            'landing',
            node.server,
            node.port,
            node.protocol,
            node.uuid || '',
            node.password || '',
            node.country || '',
            'active'
          );
          savedCount++;
        } catch (error) {
          console.error('保存节点失败:', node.name, error.message);
        }
      }

      console.log(`订阅解析完成: 找到 ${nodes.length} 个节点，成功保存 ${savedCount} 个`);

      return { success: true, total: nodes.length, saved: savedCount };

    } catch (error) {
      console.error('订阅解析失败:', error.message);
      throw error;
    }
  }

  // 解析Clash YAML格式
  parseClashYAML(content) {
    const nodes = [];
    
    try {
      const config = yaml.load(content);
      
      if (!config.proxies || !Array.isArray(config.proxies)) {
        console.log('未找到proxies字段');
        return nodes;
      }

      console.log(`找到 ${config.proxies.length} 个代理`);

      for (const proxy of config.proxies) {
        try {
          const node = {
            name: proxy.name || 'Unknown',
            server: proxy.server,
            port: proxy.port,
            protocol: proxy.type,
            password: proxy.password,
            encryption: proxy.cipher,
            uuid: proxy.uuid,
            alterId: proxy.alterId || proxy['alter-id'] || 0,
            network: proxy.network,
            country: this.extractCountry(proxy.name)
          };

          nodes.push(node);
        } catch (error) {
          console.error('解析节点失败:', proxy.name, error.message);
        }
      }

    } catch (error) {
      console.error('解析Clash YAML失败:', error.message);
    }

    return nodes;
  }

  // 提取国家信息
  extractCountry(name) {
    const countryMap = {
      '香港': 'HK', 'HK': 'HK', 'Hong Kong': 'HK',
      '台湾': 'TW', 'TW': 'TW', 'Taiwan': 'TW',
      '日本': 'JP', 'JP': 'JP', 'Japan': 'JP',
      '新加坡': 'SG', 'SG': 'SG', 'Singapore': 'SG',
      '美国': 'US', 'US': 'US', 'USA': 'US', 'United States': 'US',
      '韩国': 'KR', 'KR': 'KR', 'Korea': 'KR',
      '英国': 'GB', 'GB': 'GB', 'UK': 'GB', 'United Kingdom': 'GB',
      '德国': 'DE', 'DE': 'DE', 'Germany': 'DE',
      '法国': 'FR', 'FR': 'FR', 'France': 'FR',
      '加拿大': 'CA', 'CA': 'CA', 'Canada': 'CA',
      '澳大利亚': 'AU', 'AU': 'AU', 'Australia': 'AU'
    };

    for (const [key, value] of Object.entries(countryMap)) {
      if (name.includes(key)) {
        return value;
      }
    }

    return '';
  }

  // 解析Base64格式的订阅内容
  parseBase64Content(content) {
    const nodes = [];
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        // Shadowsocks: ss://
        if (line.startsWith('ss://')) {
          const node = this.parseShadowsocks(line);
          if (node) nodes.push(node);
        }
        // VMess: vmess://
        else if (line.startsWith('vmess://')) {
          const node = this.parseVMess(line);
          if (node) nodes.push(node);
        }
        // Trojan: trojan://
        else if (line.startsWith('trojan://')) {
          const node = this.parseTrojan(line);
          if (node) nodes.push(node);
        }
      } catch (error) {
        console.error('解析节点失败:', line.substring(0, 50), error.message);
      }
    }

    return nodes;
  }

  // 解析Shadowsocks节点
  parseShadowsocks(uri) {
    try {
      // ss://base64编码的内容#节点名称
      const parts = uri.substring(5).split('#');
      const encoded = parts[0];
      const name = parts[1] ? decodeURIComponent(parts[1]) : 'SS节点';

      // 解码
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      // 格式: method:password@server:port
      const match = decoded.match(/^(.+?):(.+?)@(.+?):(\d+)$/);

      if (match) {
        return {
          name: name,
          protocol: 'shadowsocks',
          encryption: match[1],
          password: match[2],
          server: match[3],
          port: parseInt(match[4])
        };
      }
    } catch (error) {
      console.error('解析SS节点失败:', error.message);
    }
    return null;
  }

  // 解析VMess节点
  parseVMess(uri) {
    try {
      // vmess://base64编码的JSON
      const encoded = uri.substring(8);
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const config = JSON.parse(decoded);

      return {
        name: config.ps || config.add || 'VMess节点',
        protocol: 'vmess',
        server: config.add,
        port: parseInt(config.port),
        uuid: config.id,
        alterId: parseInt(config.aid || 0),
        network: config.net || 'tcp',
        encryption: config.scy || 'auto'
      };
    } catch (error) {
      console.error('解析VMess节点失败:', error.message);
    }
    return null;
  }

  // 解析Trojan节点
  parseTrojan(uri) {
    try {
      // trojan://password@server:port#节点名称
      const parts = uri.substring(9).split('#');
      const main = parts[0];
      const name = parts[1] ? decodeURIComponent(parts[1]) : 'Trojan节点';

      const match = main.match(/^(.+?)@(.+?):(\d+)/);

      if (match) {
        return {
          name: name,
          protocol: 'trojan',
          password: match[1],
          server: match[2],
          port: parseInt(match[3])
        };
      }
    } catch (error) {
      console.error('解析Trojan节点失败:', error.message);
    }
    return null;
  }
}

module.exports = SubscriptionParser;