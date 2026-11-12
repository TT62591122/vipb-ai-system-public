/**
 * 基础适配器类 - 所有供应商适配器都要继承此类
 */
class BaseAdapter {
  constructor(credentials) { 
    this.credentials = credentials; 
  }
  
  async send(from, to, content) { 
    throw new Error('send() not implemented'); 
  }
  
  async getBalance() { 
    return { available: 'unknown' }; 
  }
  
  async validateCredentials() { 
    throw new Error('validateCredentials() not implemented'); 
  }
  
  getProviderCode() { 
    throw new Error('getProviderCode() not implemented'); 
  }
}
module.exports = BaseAdapter;