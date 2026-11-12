/**
 * Plivo SMS适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');

class PlivoAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.authId = credentials.auth_id;
    this.authToken = credentials.auth_token;
  }

  getProviderCode() {
    return 'plivo';
  }

  async send(from, to, content) {
    try {
      const url = `https://api.plivo.com/v1/Account/${this.authId}/Message/`;
      
      const payload = {
        src: from,
        dst: to,
        text: content
      };

      const auth = Buffer.from(`${this.authId}:${this.authToken}`).toString('base64');
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        messageId: response.data.message_uuid?.[0],
        status: 'queued',
        rawResponse: response.data
      };
    } catch (error) {
      console.error('Plivo发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const url = `https://api.plivo.com/v1/Account/${this.authId}/`;
      const auth = Buffer.from(`${this.authId}:${this.authToken}`).toString('base64');
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      return {
        valid: true,
        accountName: response.data.name,
        accountType: response.data.type,
        cashCredits: response.data.cash_credits,
        creditType: response.data.credit_type,
        rawData: response.data
      };
    } catch (error) {
      console.error('Plivo凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.error || error.message
      };
    }
  }
}

module.exports = PlivoAdapter;