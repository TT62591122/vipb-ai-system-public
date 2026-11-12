/**
 * Twilio SMS适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');

class TwilioAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.accountSid = credentials.account_sid;
    this.authToken = credentials.auth_token;
  }

  getProviderCode() {
    return 'twilio';
  }

  async send(from, to, content) {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      
      const formData = new URLSearchParams();
      formData.append('From', from);
      formData.append('To', to);
      formData.append('Body', content);

      const response = await axios.post(url, formData, {
        auth: {
          username: this.accountSid,
          password: this.authToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        success: true,
        messageId: response.data.sid,
        status: response.data.status,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('Twilio发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        status: 'failed'
      };
    }
  }

  async getBalance() {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Balance.json`;
      const response = await axios.get(url, {
        auth: {
          username: this.accountSid,
          password: this.authToken
        }
      });

      return {
        available: response.data.balance,
        currency: response.data.currency,
        rawData: response.data
      };
    } catch (error) {
      console.error('Twilio查询余额失败:', error.message);
      return { available: 'unknown', error: error.message };
    }
  }

  async validateCredentials() {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}.json`;
      const response = await axios.get(url, {
        auth: {
          username: this.accountSid,
          password: this.authToken
        }
      });

      return {
        valid: true,
        accountStatus: response.data.status,
        friendlyName: response.data.friendly_name,
        dateCreated: response.data.date_created
      };
    } catch (error) {
      console.error('Twilio凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

module.exports = TwilioAdapter;