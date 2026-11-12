/**
 * Termii SMS适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');

class TermiiAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.apiKey = credentials.api_key;
  }

  getProviderCode() {
    return 'termii';
  }

  async send(from, to, content) {
    try {
      const url = 'https://api.ng.termii.com/api/sms/send';
      
      const payload = {
        to: to,
        from: from || 'VIPB',
        sms: content,
        type: 'plain',
        channel: 'generic',
        api_key: this.apiKey
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        success: response.data.code === 'ok',
        messageId: response.data.message_id,
        status: response.data.code,
        statusText: response.data.message,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('Termii发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const url = 'https://api.ng.termii.com/api/check/balance';
      
      const response = await axios.get(url, {
        params: {
          api_key: this.apiKey
        }
      });

      return {
        valid: true,
        balance: response.data.balance,
        currency: response.data.currency,
        rawData: response.data
      };
    } catch (error) {
      console.error('Termii凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

module.exports = TermiiAdapter;