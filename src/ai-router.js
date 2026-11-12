/**
 * AI智能路由引擎
 * 三层架构 + 智能调度
 */

const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');

class AIRouter {
  constructor(db) {
    this.db = db;
    this.cache = new Map(); // 缓存提供商配置
    this.healthCheckInterval = null;
  }

  /**
   * 初始化路由器
   */
  async initialize() {
    console.log('🤖 初始化AI路由器...');
    
    // 加载提供商配置到缓存
    await this.loadProvidersToCache();
    
    // 启动健康检查
    this.startHealthCheck();
    
    console.log('✅ AI路由器初始化完成');
  }

  /**
   * 加载提供商到缓存
   */
  async loadProvidersToCache() {
    try {
      const rows = this.db.prepare('SELECT * FROM ai_providers WHERE is_active = 1').all();
      rows.forEach(row => {
          const provider = {
            id: row.id,
            provider_name: row.provider_name,
            provider_type: row.provider_type,
            api_base_url: row.api_base_url,
            api_key: row.api_key,
            available_models: JSON.parse(row.available_models || '[]'),
            rate_limit: row.rate_limit,
            cost_per_1k_input: row.cost_per_1k_input,
            cost_per_1k_output: row.cost_per_1k_output,
            priority: row.priority,
            is_active: row.is_active,
            health_status: row.health_status,
            group_name: row.group_name,
            display_name: row.display_name
          };
          this.cache.set(provider.id, provider);
      });
      console.log(`📦 已加载 ${this.cache.size} 个AI提供商到缓存`);
    } catch (error) {
      console.error('加载提供商失败:', error);
    }
  }

  /**
   * 核心方法：调用AI
   * @param {string} moduleName - 模块名称
   * @param {string} taskName - 任务名称
   * @param {object} variables - 变量值
   * @param {object} options - 可选参数
   */
  async callAI(moduleName, taskName, variables = {}, options = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`🎯 AI调用: ${moduleName} -> ${taskName}`);
      
      // 1. 查找任务映射
      const taskMapping = await this.getTaskMapping(moduleName, taskName);
      if (!taskMapping) {
        throw new Error(`未找到任务映射: ${moduleName}.${taskName}`);
      }

      // 2. 获取能力配置
      const capability = await this.getCapability(taskMapping.capability_id);
      if (!capability) {
        throw new Error(`未找到能力配置: ${taskMapping.capability_id}`);
      }

      // 3. 检查预算
      await this.checkBudget(capability);

      // 4. 选择提供商（智能路由）
      const provider = await this.selectProvider(capability, options);
      if (!provider) {
        throw new Error('没有可用的AI提供商');
      }

      // 5. 构建提示词
      const prompt = this.buildPrompt(taskMapping.custom_prompt, variables);

      // 6. 调用API
      const response = await this.callProviderAPI(provider, prompt, options);

      // 7. 计算成本
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;
      const totalTokens = response.usage?.total_tokens || (promptTokens + completionTokens);
      
      const cost = this.calculateCost(
        provider,
        promptTokens,
        completionTokens
      );

      // 8. 记录日志
      await this.logCall({
        provider_id: provider.id,
        capability_id: capability.id,
        module_name: moduleName,
        task_name: taskName,
        model_used: response.model || 'unknown',
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost: cost,
        response_time_ms: Date.now() - startTime,
        success: 1
      });

      // 9. 更新统计
      await this.updateStatistics(provider.id, capability.id, cost, true);

      console.log(`✅ AI调用成功: ${provider.provider_name} | 耗时: ${Date.now() - startTime}ms | 成本: $${cost.toFixed(4)}`);

      return {
        success: true,
        content: response.choices[0].message.content,
        provider: provider.provider_name,
        model: response.model || 'unknown',
        tokens: totalTokens,
        cost: cost,
        response_time: Date.now() - startTime
      };

    } catch (error) {
      console.error(`❌ AI调用失败: ${error.message}`);

      // 尝试故障转移
      if (options.enableFallback !== false) {
        console.log('🔄 尝试故障转移...');
        return await this.fallbackCall(moduleName, taskName, variables, options, error);
      }

      // 记录失败日志
      await this.logCall({
        module_name: moduleName,
        task_name: taskName,
        success: 0,
        error_message: error.message,
        response_time_ms: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * 故障转移
   */
  async fallbackCall(moduleName, taskName, variables, options, originalError) {
    try {
      const taskMapping = await this.getTaskMapping(moduleName, taskName);
      const capability = await this.getCapability(taskMapping.capability_id);
      
      // 获取备用提供商列表
      const fallbackProviders = JSON.parse(capability.fallback_providers || '[]');
      
      for (const fallbackProviderId of fallbackProviders) {
        try {
          console.log(`🔄 尝试备用提供商: ${fallbackProviderId}`);
          
          const provider = this.cache.get(fallbackProviderId);
          if (!provider || provider.health_status === 'offline') {
            continue;
          }

          const prompt = this.buildPrompt(taskMapping.custom_prompt, variables);
          const response = await this.callProviderAPI(provider, prompt, options);
          
          const promptTokens = response.usage?.prompt_tokens || 0;
          const completionTokens = response.usage?.completion_tokens || 0;
          const totalTokens = response.usage?.total_tokens || (promptTokens + completionTokens);
          const cost = this.calculateCost(provider, promptTokens, completionTokens);

          // 记录成功的故障转移
          await this.logCall({
            provider_id: provider.id,
            capability_id: capability.id,
            module_name: moduleName,
            task_name: taskName,
            model_used: response.model || 'unknown',
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            cost: cost,
            response_time_ms: 0,
            success: 1,
            fallback_used: 1,
            fallback_provider_id: provider.id
          });

          console.log(`✅ 故障转移成功: ${provider.provider_name}`);

          return {
            success: true,
            content: response.choices[0].message.content,
            provider: provider.provider_name,
            model: response.model || 'unknown',
            tokens: totalTokens,
            cost: cost,
            fallback: true
          };

        } catch (fallbackError) {
          console.log(`❌ 备用提供商失败: ${fallbackError.message}`);
          continue;
        }
      }

      throw new Error(`所有提供商都失败了。原始错误: ${originalError.message}`);

    } catch (error) {
      throw error;
    }
  }

  /**
   * 智能选择提供商
   */
  async selectProvider(capability, options = {}) {
    // 获取主提供商
    let provider = this.cache.get(capability.primary_provider_id);
    
    // 检查健康状态
    if (provider && provider.health_status === 'online') {
      return provider;
    }

    // 如果主提供商不可用，尝试备用
    const fallbackProviders = JSON.parse(capability.fallback_providers || '[]');
    for (const providerId of fallbackProviders) {
      provider = this.cache.get(providerId);
      if (provider && provider.health_status === 'online') {
        console.log(`⚠️ 主提供商不可用，使用备用: ${provider.provider_name}`);
        return provider;
      }
    }

    return null;
  }

  /**
   * 调用提供商API
   */
  async callProviderAPI(provider, prompt, options = {}) {
    try {
      const model = options.model || provider.available_models[0] || 'gpt-3.5-turbo';
      
      const response = await axios.post(
        `${provider.api_base_url}/chat/completions`,
        {
          model: model,
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 2000
        },
        injectProxy(this.db, {
          headers: {
            'Authorization': `Bearer ${provider.api_key}`,
            'Content-Type': 'application/json'
          },
          timeout: options.timeout || 30000
        })
      );

      return response.data;

    } catch (error) {
      if (error.response) {
        throw new Error(`API错误: ${error.response.status} - ${error.response.data.error?.message || '未知错误'}`);
      } else if (error.request) {
        throw new Error('网络错误: 无法连接到API');
      } else {
        throw new Error(`请求错误: ${error.message}`);
      }
    }
  }

  /**
   * 构建提示词
   */
  buildPrompt(template, variables) {
    let prompt = template;
    
    // 替换变量
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      prompt = prompt.replace(regex, value);
    }

    return prompt;
  }

  /**
   * 计算成本
   */
  calculateCost(provider, inputTokens, outputTokens) {
    const inputCost = (inputTokens / 1000) * provider.cost_per_1k_input;
    const outputCost = (outputTokens / 1000) * provider.cost_per_1k_output;
    return inputCost + outputCost;
  }

  /**
   * 检查预算
   */
  async checkBudget(capability) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const row = this.db.prepare(`
        SELECT SUM(cost) as daily_cost 
        FROM ai_call_logs 
        WHERE capability_id = ? 
        AND DATE(created_at) = ?
      `).get(capability.id, today);

      const dailyCost = row?.daily_cost || 0;

      if (dailyCost >= capability.daily_budget) {
        throw new Error(`预算超限: 今日已用 $${dailyCost.toFixed(2)}, 预算 $${capability.daily_budget}`);
      }

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 记录调用日志
   */
  async logCall(logData) {
    try {
      const fields = Object.keys(logData).join(', ');
      const placeholders = Object.keys(logData).map(() => '?').join(', ');
      const values = Object.values(logData);

      this.db.prepare(
        `INSERT INTO ai_call_logs (${fields}) VALUES (${placeholders})`
      ).run(...values);
    } catch (error) {
      console.error('记录日志失败:', error);
    }
  }

  /**
   * 更新统计信息
   */
  async updateStatistics(providerId, capabilityId, cost, success) {
    try {
      // 更新提供商统计
      this.db.prepare(`
        UPDATE ai_providers 
        SET total_calls = total_calls + 1,
            total_cost = total_cost + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cost, providerId);

      // 更新能力统计
      this.db.prepare(`
        UPDATE ai_capabilities 
        SET total_calls = total_calls + 1,
            total_cost = total_cost + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cost, capabilityId);

    } catch (error) {
      console.error('更新统计失败:', error);
    }
  }

  /**
   * 获取任务映射
   */
  async getTaskMapping(moduleName, taskName) {
    try {
      const row = this.db.prepare(`
        SELECT * FROM module_task_mappings 
        WHERE module_name = ? AND task_name = ? AND is_active = 1
      `).get(moduleName, taskName);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        module_name: row.module_name,
        task_name: row.task_name,
        task_description: row.task_description,
        capability_id: row.capability_id,
        quality_mode: row.quality_mode,
        custom_prompt: row.custom_prompt,
        available_variables: row.available_variables
      };
    } catch (error) {
      console.error('获取任务映射失败:', error);
      return null;
    }
  }

  /**
   * 获取能力配置
   */
  async getCapability(capabilityId) {
    try {
      const row = this.db.prepare(`
        SELECT * FROM ai_capabilities WHERE id = ? AND is_active = 1
      `).get(capabilityId);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        capability_name: row.capability_name,
        capability_type: row.capability_type,
        description: row.description,
        primary_provider_id: row.primary_provider_id,
        fallback_providers: row.fallback_providers,
        quality_mode: row.quality_mode,
        max_cost_per_call: row.max_cost_per_call,
        daily_budget: row.daily_budget
      };
    } catch (error) {
      console.error('获取能力配置失败:', error);
      return null;
    }
  }

  /**
   * 健康检查
   */
  startHealthCheck() {
    // 临时禁用健康检查，避免崩溃
    console.log('⚠️  健康检查已临时禁用（调试模式）');
    return;
    
    // 每5分钟检查一次
    this.healthCheckInterval = setInterval(async () => {
      console.log('🏥 执行提供商健康检查...');
      
      for (const [providerId, provider] of this.cache.entries()) {
        try {
          const startTime = Date.now();
          
          // 简单的健康检查：调用models接口
          await axios.get(`${provider.api_base_url}/models`,
            injectProxy(this.db, {
              headers: {
                'Authorization': `Bearer ${provider.api_key}`
              },
              timeout: 5000
            })
          );

          const responseTime = Date.now() - startTime;

          // 更新健康状态
          this.db.prepare(`
            UPDATE ai_providers 
            SET health_status = 'online',
                last_check_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(providerId);

          provider.health_status = 'online';

          // 记录健康日志
          this.db.prepare(`
            INSERT INTO provider_health_logs (provider_id, status, response_time_ms)
            VALUES (?, 'online', ?)
          `).run(providerId, responseTime);

          console.log(`✅ ${provider.provider_name}: 在线 (${responseTime}ms)`);

        } catch (error) {
          // 更新为离线状态
          this.db.prepare(`
            UPDATE ai_providers 
            SET health_status = 'offline',
                last_check_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(providerId);

          provider.health_status = 'offline';

          // 记录健康日志
          this.db.prepare(`
            INSERT INTO provider_health_logs (provider_id, status, error_message)
            VALUES (?, 'offline', ?)
          `).run(providerId, error.message);

          console.log(`❌ ${provider.provider_name}: 离线 - ${error.message}`);
        }
      }
    }, 5 * 60 * 1000); // 5分钟
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * 测试提供商连接
   * @param {number} providerId - 提供商ID
   */
  async testProvider(providerId) {
    try {
      const provider = this.cache.get(providerId);
      if (!provider) {
        // 如果缓存中没有，从数据库加载
        const dbRow = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId);
        if (!dbRow) {
          throw new Error('提供商不存在');
        }
        const providerData = {
          id: dbRow.id,
          provider_name: dbRow.provider_name,
          api_base_url: dbRow.api_base_url,
          api_key: dbRow.api_key,
          available_models: JSON.parse(dbRow.available_models || '[]')
        };
        
        const startTime = Date.now();
        
        // 选择第一个可用模型进行测试
        let testModel = providerData.available_models[0] || 'gpt-3.5-turbo';
        
        // 发送测试请求
        const response = await axios.post(
          `${providerData.api_base_url}/chat/completions`,
          {
            model: testModel,
            messages: [
              { role: 'user', content: 'Hello' }
            ],
            max_tokens: 5
          },
          injectProxy(this.db, {
            headers: {
              'Authorization': `Bearer ${providerData.api_key}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          })
        );

        const responseTime = Date.now() - startTime;

        // 更新健康状态
        this.db.prepare(
          `UPDATE ai_providers SET 
           health_status = 'online',
           last_check_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(providerId);

        return {
          success: true,
          response_time: responseTime,
          model: testModel,
          message: '连接成功'
        };
      }

      const startTime = Date.now();
      
      // 选择第一个可用模型进行测试
      let testModel = provider.available_models[0] || 'gpt-3.5-turbo';
      
      // 发送测试请求
      const response = await axios.post(
        `${provider.api_base_url}/chat/completions`,
        {
          model: testModel,
          messages: [
            { role: 'user', content: 'Hello' }
          ],
          max_tokens: 5
        },
        injectProxy(this.db, {
          headers: {
            'Authorization': `Bearer ${provider.api_key}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        })
      );

      const responseTime = Date.now() - startTime;

      // 更新健康状态
      this.db.prepare(
        `UPDATE ai_providers SET 
         health_status = 'online',
         last_check_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(providerId);
      
      // 更新缓存
      provider.health_status = 'online';

      return {
        success: true,
        response_time: responseTime,
        model: testModel,
        message: '连接成功'
      };

    } catch (error) {
      // 更新为离线状态
      this.db.prepare(
        `UPDATE ai_providers SET 
         health_status = 'offline',
         last_check_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(providerId);

      return {
        success: false,
        error: error.message,
        message: '连接失败: ' + error.message
      };
    }
  }

  /**
   * 获取统计信息
   */
  async getStatistics(period = 'today') {
    try {
      let dateFilter = '';
      
      if (period === 'today') {
        dateFilter = `DATE(created_at) = DATE('now')`;
      } else if (period === 'week') {
        dateFilter = `DATE(created_at) >= DATE('now', '-7 days')`;
      } else if (period === 'month') {
        dateFilter = `DATE(created_at) >= DATE('now', '-30 days')`;
      }

      // 总体统计
      const totalRow = this.db.prepare(`
        SELECT 
          COUNT(*) as total_calls,
          SUM(cost) as total_cost,
          AVG(response_time_ms) as avg_response_time,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / MAX(COUNT(*), 1) as success_rate
        FROM ai_call_logs
        WHERE ${dateFilter}
      `).get();

      // 各提供商统计
      const providerRows = this.db.prepare(`
        SELECT 
          p.provider_name,
          COUNT(l.id) as calls,
          SUM(l.cost) as cost,
          AVG(l.response_time_ms) as avg_time,
          SUM(CASE WHEN l.success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(l.id) as success_rate
        FROM ai_call_logs l
        JOIN ai_providers p ON l.provider_id = p.id
        WHERE ${dateFilter}
        GROUP BY p.id
        ORDER BY calls DESC
      `).all();

      // 各模块统计
      const moduleRows = this.db.prepare(`
        SELECT 
          module_name,
          COUNT(*) as calls,
          SUM(cost) as cost
        FROM ai_call_logs
        WHERE ${dateFilter}
        GROUP BY module_name
        ORDER BY calls DESC
      `).all();

      return {
        total: totalRow || { total_calls: 0, total_cost: 0, avg_response_time: 0, success_rate: 0 },
        providers: providerRows,
        modules: moduleRows
      };

    } catch (error) {
      console.error('获取统计失败:', error);
      return null;
    }
  }
}

module.exports = AIRouter;
