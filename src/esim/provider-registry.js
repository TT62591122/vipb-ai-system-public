/**
 * 供应商适配器注册表
 */
const fs = require('fs');
const path = require('path');

class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this._scanAdapters();
  }

  /**
   * 扫描adapters目录，自动注册所有适配器
   */
  _scanAdapters() {
    const adaptersDir = path.join(__dirname, 'adapters');
    
    if (!fs.existsSync(adaptersDir)) {
      console.warn('📁 adapters目录不存在:', adaptersDir);
      return;
    }

    const files = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.js') && f !== 'base-adapter.js');
    
    for (const file of files) {
      try {
        const adapterPath = path.join(adaptersDir, file);
        const AdapterClass = require(adapterPath);
        
        if (AdapterClass && typeof AdapterClass === 'function') {
          // 创建临时实例获取provider code
          const tempInstance = new AdapterClass({});
          const providerCode = tempInstance.getProviderCode();
          
          if (providerCode) {
            this.adapters.set(providerCode, AdapterClass);
            console.log(`✅ 注册适配器: ${providerCode} (${file})`);
          } else {
            console.warn(`⚠️ 跳过适配器 ${file}: 未实现 getProviderCode()`);
          }
        }
      } catch (error) {
        console.error(`❌ 加载适配器 ${file} 失败:`, error.message);
      }
    }
  }

  /**
   * 获取适配器实例
   * @param {string} providerCode - 供应商代码
   * @param {object} credentials - 凭证信息
   * @returns {BaseAdapter} 适配器实例
   */
  getAdapter(providerCode, credentials) {
    const AdapterClass = this.adapters.get(providerCode);
    if (!AdapterClass) {
      throw new Error(`未找到供应商适配器: ${providerCode}`);
    }
    return new AdapterClass(credentials);
  }

  /**
   * 获取所有已注册的供应商代码
   * @returns {string[]} 供应商代码列表
   */
  getProviderCodes() {
    return Array.from(this.adapters.keys());
  }

  /**
   * 检查供应商是否存在
   * @param {string} providerCode - 供应商代码
   * @returns {boolean} 是否存在
   */
  hasProvider(providerCode) {
    return this.adapters.has(providerCode);
  }

  /**
   * 获取所有供应商信息（用于API返回）
   */
  getProvidersInfo() {
    const providers = [];
    for (const [code, AdapterClass] of this.adapters) {
      try {
        const tempInstance = new AdapterClass({});
        providers.push({
          code,
          name: this._getProviderName(code),
          adapter: AdapterClass.name
        });
      } catch (e) {
        providers.push({
          code,
          name: this._getProviderName(code),
          adapter: 'Unknown'
        });
      }
    }
    return providers;
  }

  /**
   * 获取供应商显示名称
   */
  _getProviderName(code) {
    const names = {
      'twilio': 'Twilio',
      'telnyx': 'Telnyx',
      'vonage': 'Vonage',
      'plivo': 'Plivo',
      'africas-talking': 'Africa\'s Talking',
      'termii': 'Termii',
      'aliyun': '阿里云通信',
      'tencent': '腾讯云SMS'
    };
    return names[code] || code;
  }
}

// 创建单例实例
const registry = new ProviderRegistry();
module.exports = registry;