/**
 * Telnyx SMS适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');

class TelnyxAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.apiKey = credentials.api_key;
  }

  getProviderCode() {
    return 'telnyx';
  }

  async send(from, to, content) {
    try {
      const url = 'https://api.telnyx.com/v2/messages';
      
      const payload = {
        from: from,
        to: to,
        text: content,
        messaging_profile_id: credentials.messaging_profile_id || undefined
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        messageId: response.data.data.id,
        status: response.data.data.status,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('Telnyx发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors?.[0]?.detail || error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const url = 'https://api.telnyx.com/v2/phone_numbers';
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        valid: true,
        hasNumbers: response.data.data.length > 0,
        numberCount: response.data.data.length,
        rawData: response.data
      };
    } catch (error) {
      console.error('Telnyx凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.errors?.[0]?.detail || error.message
      };
    }
  }
}

module.exports = TelnyxAdapter;