/**
 * 阿里云短信适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');
const crypto = require('crypto');

class AliyunSmsAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.accessKeyId = credentials.access_key_id;
    this.accessKeySecret = credentials.access_key_secret;
    this.signName = credentials.sign_name;
    this.templateCode = credentials.template_code;
  }

  getProviderCode() {
    return 'aliyun';
  }

  /**
   * 阿里云API签名计算
   */
  _signRequest(params, method = 'GET') {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    const stringToSign = `${method}&${encodeURIComponent('/')}&${encodeURIComponent(sortedParams)}`;
    
    const sign = crypto.createHmac('sha1', this.accessKeySecret + '&')
      .update(stringToSign)
      .digest('base64');

    return sign;
  }

  async send(from, to, content) {
    try {
      const params = {
        Action: 'SendSms',
        Format: 'JSON',
        Version: '2017-05-25',
        AccessKeyId: this.accessKeyId,
        SignatureMethod: 'HMAC-SHA1',
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        SignatureVersion: '1.0',
        SignatureNonce: Date.now() + Math.random().toString(),
        RegionId: 'cn-hangzhou',
        PhoneNumbers: to,
        SignName: this.signName,
        TemplateCode: this.templateCode,
        TemplateParam: JSON.stringify({ code: content.slice(0, 6) }) // 假设内容是验证码
      };

      if (from) {
        params.OutId = from; // 使用from作为外部流水号
      }

      params.Signature = this._signRequest(params);
      
      const url = 'https://dysmsapi.aliyuncs.com/';
      const response = await axios.get(url, { params });

      return {
        success: response.data.Code === 'OK',
        messageId: response.data.BizId,
        status: response.data.Code,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('阿里云短信发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.Message || error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const params = {
        Action: 'QuerySendDetails',
        Format: 'JSON',
        Version: '2017-05-25',
        AccessKeyId: this.accessKeyId,
        SignatureMethod: 'HMAC-SHA1',
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        SignatureVersion: '1.0',
        SignatureNonce: Date.now() + Math.random().toString(),
        RegionId: 'cn-hangzhou',
        PhoneNumber: '13800000000', // 测试用号码
        SendDate: new Date().toISOString().split('T')[0],
        PageSize: '1'
      };

      params.Signature = this._signRequest(params);
      
      const url = 'https://dysmsapi.aliyuncs.com/';
      const response = await axios.get(url, { params });

      return {
        valid: response.data.Code === 'OK',
        error: response.data.Message,
        rawData: response.data
      };
    } catch (error) {
      console.error('阿里云凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.Message || error.message
      };
    }
  }
}

module.exports = AliyunSmsAdapter;