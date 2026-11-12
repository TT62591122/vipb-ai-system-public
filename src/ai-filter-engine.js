/**
 * AI 筛选引擎 - 性别/年龄/行业等智能筛选
 * 
 * 作为 MatrixTaskEngine 的 filter 类型任务执行
 * 对 collected_data 中的用户数据进行 AI 分析
 */

const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');

class AIFilterEngine {
  constructor(db) {
    this.db = db;
  }

  async execute(context) {
    const { action } = context;

    switch (action) {
      case 'filter_gender':
        return await this.filterGender(context);
      case 'filter_age':
        return await this.filterAge(context);
      case 'filter_industry':
        return await this.filterIndustry(context);
      case 'filter_engagement':
        return await this.filterEngagement(context);
      case 'filter_custom':
        return await this.filterCustom(context);
      default:
        throw new Error(`不支持的筛选动作: ${action}`);
    }
  }

  // ==================== 性别筛选 ====================

  async filterGender(context) {
    const { inputData, sourceData, onProgress, onItem, onCollected } = context;
    const targetGender = inputData.gender || 'male'; // male | female | any
    
    const data = sourceData || this._getSourceData(inputData);
    if (!data || data.length === 0) throw new Error('无数据可筛选');

    console.log(`🔬 性别筛选: 目标=${targetGender}, 数据量=${data.length}`);

    let processed = 0, success = 0, failed = 0;

    // 批量处理（每批50个，减少API调用）
    const batchSize = 50;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      try {
        const results = await this._inferGenderBatch(batch);
        
        for (let j = 0; j < batch.length; j++) {
          processed++;
          const item = batch[j];
          const inferred = results[j] || { gender: 'unknown', confidence: 0 };

          // 更新 collected_data
          if (inferred.gender !== 'unknown') {
            this.db.prepare('UPDATE collected_data SET gender = ? WHERE id = ?')
              .run(inferred.gender, item.id);
          }

          // 检查是否匹配目标
          const matches = targetGender === 'any' || inferred.gender === targetGender;
          
          if (matches) {
            success++;
            onCollected({
              ...item,
              gender: inferred.gender,
              data_type: item.data_type,
              external_id: item.external_id,
              username: item.username,
              display_name: item.display_name,
              profile_url: item.profile_url,
              raw: { ...JSON.parse(item.raw_data || '{}'), gender_inference: inferred }
            });
          } else {
            failed++;
          }

          onItem({
            target: item.external_id || item.username,
            success: matches,
            result: inferred
          });
          onProgress(processed, success, failed);
        }
      } catch (error) {
        // 批次失败，逐个用规则推断
        for (const item of batch) {
          processed++;
          const inferred = this._inferGenderByName(item.display_name || item.username || '');
          
          if (inferred.gender !== 'unknown') {
            this.db.prepare('UPDATE collected_data SET gender = ? WHERE id = ?')
              .run(inferred.gender, item.id);
          }

          const matches = targetGender === 'any' || inferred.gender === targetGender;
          if (matches) success++;
          else failed++;
          
          onItem({ target: item.external_id, success: matches, result: inferred });
          onProgress(processed, success, failed);
        }
      }
    }

    console.log(`✅ 性别筛选完成: ${success}/${processed} 匹配`);
    return { total: processed, matched: success, filtered: failed };
  }

  // ==================== 年龄筛选 ====================

  async filterAge(context) {
    const { inputData, sourceData, onProgress, onItem, onCollected } = context;
    const minAge = inputData.min_age || 18;
    const maxAge = inputData.max_age || 65;
    
    const data = sourceData || this._getSourceData(inputData);
    if (!data || data.length === 0) throw new Error('无数据可筛选');

    console.log(`🔬 年龄筛选: ${minAge}-${maxAge}岁, 数据量=${data.length}`);

    let processed = 0, success = 0, failed = 0;

    const batchSize = 50;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      try {
        const results = await this._inferAgeBatch(batch);
        
        for (let j = 0; j < batch.length; j++) {
          processed++;
          const item = batch[j];
          const inferred = results[j] || { age_range: 'unknown' };

          if (inferred.age_range !== 'unknown') {
            this.db.prepare('UPDATE collected_data SET age_range = ? WHERE id = ?')
              .run(inferred.age_range, item.id);
          }

          // 解析年龄范围
          const [ageMin, ageMax] = (inferred.age_range || '0-0').split('-').map(Number);
          const matches = ageMin >= minAge && ageMax <= maxAge;
          
          if (matches) {
            success++;
            onCollected({ ...item, age_range: inferred.age_range, data_type: item.data_type, external_id: item.external_id, username: item.username, display_name: item.display_name, profile_url: item.profile_url, raw: { ...JSON.parse(item.raw_data || '{}'), age_inference: inferred } });
          } else {
            failed++;
          }

          onItem({ target: item.external_id, success: matches, result: inferred });
          onProgress(processed, success, failed);
        }
      } catch (error) {
        for (const item of batch) {
          processed++;
          failed++;
          onItem({ target: item.external_id, success: false, result: { error: error.message } });
          onProgress(processed, success, failed);
        }
      }
    }

    console.log(`✅ 年龄筛选完成: ${success}/${processed} 匹配`);
    return { total: processed, matched: success, filtered: failed };
  }

  // ==================== 行业筛选 ====================

  async filterIndustry(context) {
    const { inputData, sourceData, onProgress, onItem, onCollected } = context;
    const targetIndustries = inputData.industries || [];
    
    const data = sourceData || this._getSourceData(inputData);
    if (!data || data.length === 0) throw new Error('无数据可筛选');

    console.log(`🔬 行业筛选: ${targetIndustries.join(',')}, 数据量=${data.length}`);

    let processed = 0, success = 0, failed = 0;

    for (const item of data) {
      processed++;
      const bio = item.bio || '';
      const name = item.display_name || '';
      
      // 简单关键词匹配
      const matched = targetIndustries.some(industry => 
        bio.toLowerCase().includes(industry.toLowerCase()) ||
        name.toLowerCase().includes(industry.toLowerCase())
      );

      if (matched) {
        success++;
        onCollected({ ...item, data_type: item.data_type, external_id: item.external_id, username: item.username, display_name: item.display_name, profile_url: item.profile_url, raw: JSON.parse(item.raw_data || '{}') });
      } else {
        failed++;
      }

      onItem({ target: item.external_id, success: matched, result: { matched } });
      onProgress(processed, success, failed);
    }

    return { total: processed, matched: success, filtered: failed };
  }

  // ==================== 活跃度筛选 ====================

  async filterEngagement(context) {
    const { inputData, sourceData, onProgress, onItem, onCollected } = context;
    const minFollowers = inputData.min_followers || 0;
    const maxFollowers = inputData.max_followers || Infinity;
    const minEngagement = inputData.min_engagement_rate || 0;
    
    const data = sourceData || this._getSourceData(inputData);
    if (!data || data.length === 0) throw new Error('无数据可筛选');

    let processed = 0, success = 0, failed = 0;

    for (const item of data) {
      processed++;
      const followers = item.followers_count || 0;
      const engagement = item.engagement_rate || 0;
      
      const matched = followers >= minFollowers && followers <= maxFollowers && engagement >= minEngagement;

      if (matched) {
        success++;
        onCollected({ ...item, data_type: item.data_type, external_id: item.external_id, username: item.username, display_name: item.display_name, profile_url: item.profile_url, raw: JSON.parse(item.raw_data || '{}') });
      } else {
        failed++;
      }

      onItem({ target: item.external_id, success: matched, result: { followers, engagement } });
      onProgress(processed, success, failed);
    }

    return { total: processed, matched: success, filtered: failed };
  }

  // ==================== 自定义AI筛选 ====================

  async filterCustom(context) {
    const { inputData, sourceData, onProgress, onItem, onCollected } = context;
    const criteria = inputData.criteria || '';
    
    if (!criteria) throw new Error('缺少筛选条件 (criteria)');
    
    const data = sourceData || this._getSourceData(inputData);
    if (!data || data.length === 0) throw new Error('无数据可筛选');

    console.log(`🔬 自定义AI筛选: "${criteria}", 数据量=${data.length}`);

    let processed = 0, success = 0, failed = 0;
    const batchSize = 20;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      try {
        const config = this.db.prepare("SELECT * FROM ai_configs WHERE module_name = 'filter' AND is_active = 1").get();
        if (!config) throw new Error('AI未配置');

        const profiles = batch.map((item, idx) => 
          `[${idx}] ${item.display_name || item.username || 'unknown'} | ${item.bio || ''} | followers:${item.followers_count || 0}`
        ).join('\n');

        const response = await axios.post(`${config.api_base_url}/chat/completions`, {
          model: config.model_name,
          messages: [{ role: 'user', content: `筛选条件: ${criteria}\n\n用户列表:\n${profiles}\n\n返回符合条件的用户序号(JSON数组), 如 [0,2,5]:` }],
          temperature: 0.3, max_tokens: 500
        }, injectProxy(this.db, {
          headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }));

        const matchedIndices = JSON.parse(response.data.choices[0].message.content);
        
        for (let j = 0; j < batch.length; j++) {
          processed++;
          const matched = matchedIndices.includes(j);
          if (matched) {
            success++;
            onCollected({ ...batch[j], data_type: batch[j].data_type, external_id: batch[j].external_id, username: batch[j].username, display_name: batch[j].display_name, profile_url: batch[j].profile_url, raw: JSON.parse(batch[j].raw_data || '{}') });
          } else {
            failed++;
          }
          onItem({ target: batch[j].external_id, success: matched, result: { matched } });
          onProgress(processed, success, failed);
        }
      } catch (error) {
        for (const item of batch) {
          processed++;
          failed++;
          onItem({ target: item.external_id, success: false, result: { error: error.message } });
          onProgress(processed, success, failed);
        }
      }
    }

    return { total: processed, matched: success, filtered: failed };
  }

  // ==================== 内部方法 ====================

  _getSourceData(inputData) {
    if (inputData.source_task_id) {
      return this.db.prepare('SELECT * FROM collected_data WHERE task_id = ?').all(inputData.source_task_id);
    }
    if (inputData.platform) {
      return this.db.prepare('SELECT * FROM collected_data WHERE platform = ?').all(inputData.platform);
    }
    return this.db.prepare('SELECT * FROM collected_data').all();
  }

  async _inferGenderBatch(items) {
    // 先用规则推断，无需API
    return items.map(item => this._inferGenderByName(item.display_name || item.username || ''));
  }

  _inferGenderByName(name) {
    if (!name) return { gender: 'unknown', confidence: 0 };
    
    // 常见性别指示词
    const maleIndicators = ['mr','sir','he','his','boy','man','father','dad','king','prince','bro','guy','gentleman'];
    const femaleIndicators = ['mrs','ms','miss','she','her','girl','woman','mother','mom','queen','princess','sis','lady','madam'];
    
    const lower = name.toLowerCase();
    
    for (const w of femaleIndicators) {
      if (lower.includes(w)) return { gender: 'female', confidence: 0.7, method: 'keyword' };
    }
    for (const w of maleIndicators) {
      if (lower.includes(w)) return { gender: 'male', confidence: 0.7, method: 'keyword' };
    }
    
    return { gender: 'unknown', confidence: 0, method: 'none' };
  }

  async _inferAgeBatch(items) {
    // 基于个人简介和头像的简单推断
    return items.map(item => {
      const bio = (item.bio || '').toLowerCase();
      
      if (bio.includes('student') || bio.includes('学生')) return { age_range: '18-24' };
      if (bio.includes('ceo') || bio.includes('founder') || bio.includes('创始人')) return { age_range: '30-50' };
      if (bio.includes('retired') || bio.includes('退休')) return { age_range: '55-70' };
      if (bio.includes('parent') || bio.includes('dad') || bio.includes('mom')) return { age_range: '25-45' };
      
      return { age_range: 'unknown' };
    });
  }
}

module.exports = AIFilterEngine;
