/**
 * Vonage (Nexmo) SMS适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');

class VonageAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.apiKey = credentials.api_key;
    this.apiSecret = credentials.api_secret;
  }

  getProviderCode() {
    return 'vonage';
  }

  async send(from, to, content) {
    try {
      const url = 'https://rest.nexmo.com/sms/json';
      
      const payload = {
        from: from,
        to: to,
        text: content,
        api_key: this.apiKey,
        api_secret: this.apiSecret
      };

      const response = await axios.post(url, new URLSearchParams(payload), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const message = response.data.messages?.[0];
      return {
        success: message?.status === '0',
        messageId: message?.['message-id'],
        status: message?.status,
        statusText: message?.['status-text'],
        rawResponse: response.data
      };
    } catch (error) {
      console.error('Vonage发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const url = 'https://rest.nexmo.com/account/get-balance';
      const response = await axios.get(url, {
        params: {
          api_key: this.apiKey,
          api_secret: this.apiSecret
        }
      });

      return {
        valid: true,
        balance: response.data.value,
        currency: response.data.currency,
        autoReload: response.data.autoReload
      };
    } catch (error) {
      console.error('Vonage凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.['error-code-label'] || error.message
      };
    }
  }
}

module.exports = VonageAdapter;