const dns = require('dns').promises;
const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');

class FraudValidator {
  constructor(db) {
    this.db = db;
    this.freeDomains = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
      '163.com', 'qq.com', '126.com', 'sina.com', 'yeah.net',
      'sohu.com', 'tom.com', 'foxmail.com'
    ];
  }

  // 1. 邮箱MX记录验证
  async validateEmail(email) {
    const validation = {
      email: email,
      valid: false,
      isFreeEmail: false,
      mxRecords: [],
      riskLevel: 'unknown',
      riskReasons: []
    };

    try {
      const domain = email.split('@')[1];
      
      if (!domain) {
        validation.riskLevel = 'high';
        validation.riskReasons.push('邮箱格式错误');
        return validation;
      }
      
      // 检查是否为免费邮箱
      validation.isFreeEmail = this.freeDomains.includes(domain.toLowerCase());
      
      // MX记录验证
      try {
        const mxRecords = await dns.resolveMx(domain);
        validation.mxRecords = mxRecords.map(r => r.exchange);
        validation.valid = mxRecords.length > 0;
      } catch (error) {
        validation.valid = false;
        validation.riskReasons.push('MX记录无效或不存在');
      }
      
      // 风险评估
      if (!validation.valid) {
        validation.riskLevel = 'high';
        validation.riskReasons.push('邮箱MX记录无效');
      } else if (validation.isFreeEmail) {
        validation.riskLevel = 'medium';
        validation.riskReasons.push('使用免费邮箱');
      } else {
        validation.riskLevel = 'low';
      }
      
    } catch (error) {
      validation.error = error.message;
      validation.riskLevel = 'high';
      validation.riskReasons.push('验证过程出错');
    }

    return validation;
  }

  // 2. 域名年龄检查
  async checkDomainAge(domain) {
    try {
      // 使用WHOIS API检查域名注册时间
      // 这里使用简化版本，实际可以对接WHOIS API
      const response = await axios.get(`https://www.whoisxmlapi.com/whoisserver/WhoisService`, 
        injectProxy(this.db, {
          params: {
            apiKey: process.env.WHOIS_API_KEY || 'demo',
            domainName: domain,
            outputFormat: 'JSON'
          },
          timeout: 5000
        })
      ).catch(() => null);

      if (response && response.data) {
        const createdDate = response.data.WhoisRecord?.createdDate;
        if (createdDate) {
          const age = Math.floor((Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24 * 365));
          return {
            age: age,
            createdDate: createdDate,
            isNew: age < 1
          };
        }
      }

      return { age: null, isNew: false };
    } catch (error) {
      return { age: null, error: error.message };
    }
  }

  // 3. 公司注册验证（OpenCorporates API）
  async validateCompanyRegistration(companyName, country) {
    try {
      const response = await axios.get('https://api.opencorporates.com/v0.4/companies/search', 
        injectProxy(this.db, {
          params: {
            q: companyName,
            jurisdiction_code: country?.toLowerCase(),
            api_token: process.env.OPENCORPORATES_API_KEY || ''
          },
          timeout: 10000
        })
      );

      if (response.data.results.companies && response.data.results.companies.length > 0) {
        const company = response.data.results.companies[0].company;
        return {
          verified: true,
          registrationNumber: company.company_number,
          incorporationDate: company.incorporation_date,
          status: company.current_status,
          address: company.registered_address_in_full,
          jurisdiction: company.jurisdiction_code
        };
      }

      return { 
        verified: false, 
        reason: '未找到注册信息' 
      };
      
    } catch (error) {
      return { 
        verified: false, 
        error: error.message 
      };
    }
  }

  // 4. 采购历史分析
  async analyzePurchaseHistory(customerId) {
    try {
      // 使用 deals 表替代不存在的 purchase_history 表
      const history = this.db.prepare(
        'SELECT * FROM deals WHERE customer_id = ? ORDER BY created_at DESC'
      ).all(customerId);
      
      const analysis = {
        totalOrders: history.length,
        totalValue: 0,
        avgOrderValue: 0,
        paymentSuccessRate: 0,
        riskIndicators: []
      };

      if (history.length > 0) {
        analysis.totalValue = history.reduce((sum, h) => sum + parseFloat(h.value || 0), 0);
        analysis.avgOrderValue = analysis.totalValue / history.length;
        
        const successfulPayments = history.filter(h => h.stage === 'won').length;
        analysis.paymentSuccessRate = (successfulPayments / history.length) * 100;
        
        // 风险指标
        if (analysis.paymentSuccessRate < 50) {
          analysis.riskIndicators.push('支付成功率低于50%');
        }
        
        if (history.length > 5 && analysis.totalValue === 0) {
          analysis.riskIndicators.push('多次询价但从未下单');
        }

        // 检查最近订单
        const recentOrders = history.slice(0, 3);
        const recentFailed = recentOrders.filter(h => h.stage === 'lost').length;
        if (recentFailed >= 2) {
          analysis.riskIndicators.push('最近订单多次失败');
        }
      }

      return analysis;
      
    } catch (error) {
      return {
        totalOrders: 0,
        error: error.message
      };
    }
  }

  // 5. 综合风险评估
  async comprehensiveRiskAssessment(customerData) {
    const assessment = {
      customerId: customerData.id,
      riskScore: 0,
      riskLevel: 'low',
      checks: {},
      recommendations: []
    };

    // 邮箱验证（权重40%）
    if (customerData.email) {
      assessment.checks.email = await this.validateEmail(customerData.email);
      
      if (assessment.checks.email.riskLevel === 'high') {
        assessment.riskScore += 40;
      } else if (assessment.checks.email.riskLevel === 'medium') {
        assessment.riskScore += 20;
      }
    } else {
      assessment.riskScore += 30;
      assessment.recommendations.push('缺少邮箱信息');
    }

    // 域名年龄检查（权重15%）
    if (customerData.email) {
      const domain = customerData.email.split('@')[1];
      assessment.checks.domainAge = await this.checkDomainAge(domain);
      
      if (assessment.checks.domainAge.isNew) {
        assessment.riskScore += 15;
        assessment.recommendations.push('域名注册时间较短');
      }
    }

    // 公司注册验证（权重30%）
    if (customerData.company_name && customerData.country) {
      assessment.checks.registration = await this.validateCompanyRegistration(
        customerData.company_name,
        customerData.country
      );
      
      if (!assessment.checks.registration.verified) {
        assessment.riskScore += 30;
        assessment.recommendations.push('未找到公司注册信息');
      }
    } else {
      assessment.riskScore += 20;
      assessment.recommendations.push('缺少公司信息');
    }

    // 采购历史分析（权重15%）
    assessment.checks.purchaseHistory = await this.analyzePurchaseHistory(customerData.id);
    
    if (assessment.checks.purchaseHistory.riskIndicators.length > 0) {
      assessment.riskScore += 15;
      assessment.recommendations.push(...assessment.checks.purchaseHistory.riskIndicators);
    }

    // 最终风险等级
    if (assessment.riskScore >= 60) {
      assessment.riskLevel = 'high';
      assessment.recommendations.push('建议：要求预付款或信用证');
    } else if (assessment.riskScore >= 30) {
      assessment.riskLevel = 'medium';
      assessment.recommendations.push('建议：小额试单或部分预付');
    } else {
      assessment.riskLevel = 'low';
      assessment.recommendations.push('风险较低，可正常交易');
    }

    return assessment;
  }

  // 6. 保存验证结果
  async saveValidationResult(customerId, assessment) {
    try {
      // validation_logs 表不存在，记录到 activity_log
      this.db.prepare(
        `INSERT INTO activity_log (action, entity_type, entity_id, details, created_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        'fraud_validation',
        'customer',
        customerId,
        JSON.stringify(assessment)
      );

      // 更新客户风险等级（customers 表有 notes 字段可存风险信息）
      this.db.prepare(
        'UPDATE customers SET notes = ? WHERE id = ?'
      ).run(
        JSON.stringify({ riskLevel: assessment.riskLevel, riskScore: assessment.riskScore }),
        customerId
      );
    } catch (error) {
      console.error('保存验证结果失败:', error);
    }
  }
}

module.exports = FraudValidator;
