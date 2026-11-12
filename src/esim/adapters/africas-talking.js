/**
 * Africa's Talking SMS适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');

class AfricasTalkingAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.username = credentials.username;
    this.apiKey = credentials.api_key;
  }

  getProviderCode() {
    return 'africas-talking';
  }

  async send(from, to, content) {
    try {
      const url = 'https://api.africastalking.com/version1/messaging';
      
      const formData = new URLSearchParams();
      formData.append('username', this.username);
      formData.append('to', to);
      formData.append('message', content);
      if (from) {
        formData.append('from', from);
      }

      const response = await axios.post(url, formData, {
        headers: {
          'apiKey': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });

      const message = response.data.SMSMessageData?.Recipients?.[0];
      return {
        success: message?.status === 'Success',
        messageId: message?.messageId,
        status: message?.status,
        cost: message?.cost,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('Africa\'s Talking发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.SMSMessageData?.Message || error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const url = 'https://api.africastalking.com/version1/user';
      
      const response = await axios.get(url, {
        params: {
          username: this.username
        },
        headers: {
          'apiKey': this.apiKey,
          'Accept': 'application/json'
        }
      });

      return {
        valid: true,
        balance: response.data.UserData?.balance,
        userId: response.data.UserData?.userId,
        rawData: response.data
      };
    } catch (error) {
      console.error('Africa\'s Talking凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.errorMessage || error.message
      };
    }
  }
}

module.exports = AfricasTalkingAdapter;