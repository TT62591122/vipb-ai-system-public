/**
 * 腾讯云短信适配器
 */
const BaseAdapter = require('./base-adapter');
const axios = require('axios');
const crypto = require('crypto');

class TencentSmsAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials);
    this.secretId = credentials.secret_id;
    this.secretKey = credentials.secret_key;
    this.appId = credentials.app_id;
    this.signName = credentials.sign_name;
    this.templateId = credentials.template_id;
  }

  getProviderCode() {
    return 'tencent';
  }

  /**
   * TC3-HMAC-SHA256签名计算
   */
  _signTC3(timestamp, service, payload) {
    const date = new Date(timestamp * 1000).toISOString().split('T')[0].replace(/-/g, '');
    
    // 计算签名
    const hashedRequestPayload = crypto.createHash('sha256').update(payload).digest('hex');
    const canonicalRequest = `POST\n/\n\ncontent-type:application/json\nhost:${service}.tencentcloudapi.com\n\ncontent-type;host\n${hashedRequestPayload}`;
    
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/${service}/tc3_request\n` + 
                         crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    
    // 计算签名
    const secretDate = crypto.createHmac('sha256', 'TC3' + this.secretKey).update(date).digest();
    const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
    const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
    const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
    
    return signature;
  }

  async send(from, to, content) {
    try {
      const service = 'sms';
      const timestamp = Math.floor(Date.now() / 1000);
      
      const payload = JSON.stringify({
        PhoneNumberSet: [to],
        SmsSdkAppId: this.appId,
        SignName: this.signName,
        TemplateId: this.templateId,
        TemplateParamSet: [content] // 实际应根据模板参数调整
      });

      const signature = this._signTC3(timestamp, service, payload);
      
      const url = `https://${service}.tencentcloudapi.com/`;
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `TC3-HMAC-SHA256 Credential=${this.secretId}/${new Date(timestamp * 1000).toISOString().split('T')[0].replace(/-/g, '')}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
          'Content-Type': 'application/json',
          'Host': `${service}.tencentcloudapi.com`,
          'X-TC-Action': 'SendSms',
          'X-TC-Version': '2021-01-11',
          'X-TC-Timestamp': timestamp.toString(),
          'X-TC-Region': 'ap-guangzhou'
        }
      });

      return {
        success: response.data.Response?.SendStatusSet?.[0]?.Code === 'Ok',
        messageId: response.data.Response?.SendStatusSet?.[0]?.SerialNo,
        status: response.data.Response?.SendStatusSet?.[0]?.Code,
        rawResponse: response.data
      };
    } catch (error) {
      console.error('腾讯云短信发送失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.Response?.Error?.Message || error.message,
        status: 'failed'
      };
    }
  }

  async validateCredentials() {
    try {
      const service = 'sms';
      const timestamp = Math.floor(Date.now() / 1000);
      
      const payload = JSON.stringify({
        SmsSdkAppId: this.appId,
        Limit: 1
      });

      const signature = this._signTC3(timestamp, service, payload);
      
      const url = `https://${service}.tencentcloudapi.com/`;
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `TC3-HMAC-SHA256 Credential=${this.secretId}/${new Date(timestamp * 1000).toISOString().split('T')[0].replace(/-/g, '')}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
          'Content-Type': 'application/json',
          'Host': `${service}.tencentcloudapi.com`,
          'X-TC-Action': 'DescribeSmsTemplateList',
          'X-TC-Version': '2021-01-11',
          'X-TC-Timestamp': timestamp.toString(),
          'X-TC-Region': 'ap-guangzhou'
        }
      });

      return {
        valid: response.data.Response?.Error === undefined,
        templateCount: response.data.Response?.TemplateSet?.length || 0,
        rawData: response.data
      };
    } catch (error) {
      console.error('腾讯云凭证验证失败:', error.message);
      return {
        valid: false,
        error: error.response?.data?.Response?.Error?.Message || error.message
      };
    }
  }
}

module.exports = TencentSmsAdapter;