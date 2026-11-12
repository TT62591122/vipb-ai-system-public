const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');

class AIOptimizer {
  constructor(db) {
    this.db = db;
    this.isRunning = false;
  }

  // ==================== 数据收集 ====================

  async collectEmailMetrics() {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const row = this.db.prepare(`
        SELECT 
          COUNT(*) as total_sent,
          SUM(CASE WHEN opened = 1 THEN 1 ELSE 0 END) as total_opened,
          SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END) as total_replied
        FROM email_campaigns 
        WHERE DATE(created_at) = ?
      `).get(yesterday);

      if (row) {
        return {
          totalSent: row.total_sent || 0,
          totalOpened: row.total_opened || 0,
          totalReplied: row.total_replied || 0,
          openRate: row.total_sent > 0 ? (row.total_opened / row.total_sent) * 100 : 0,
          replyRate: row.total_sent > 0 ? (row.total_replied / row.total_sent) * 100 : 0
        };
      }

      return { totalSent: 0, openRate: 0, replyRate: 0 };
    } catch (error) {
      console.error('收集邮件数据失败:', error);
      return { totalSent: 0, openRate: 0, replyRate: 0 };
    }
  }

  async collectVideoMetrics() {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // publish_history 不存在，使用 social_execution_log 替代
      const row = this.db.prepare(`
        SELECT 
          COUNT(*) as total_videos,
          0 as total_views,
          0 as total_likes,
          0 as avg_views
        FROM social_execution_log 
        WHERE DATE(executed_at) = ? AND action_type = 'publish_video'
      `).get(yesterday);

      if (row) {
        return {
          totalVideos: row.total_videos || 0,
          totalViews: row.total_views || 0,
          totalLikes: row.total_likes || 0,
          avgViews: row.avg_views || 0,
          engagementRate: 0
        };
      }

      return { totalVideos: 0, totalViews: 0, engagementRate: 0 };
    } catch (error) {
      console.error('收集视频数据失败:', error);
      return { totalVideos: 0, totalViews: 0, engagementRate: 0 };
    }
  }

  async collectCustomerMetrics() {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const row = this.db.prepare(`
        SELECT 
          COUNT(*) as total_customers,
          SUM(CASE WHEN level = 'hot' THEN 1 ELSE 0 END) as hot_customers,
          SUM(CASE WHEN level = 'warm' THEN 1 ELSE 0 END) as warm_customers
        FROM customers 
        WHERE DATE(created_at) = ?
      `).get(yesterday);

      if (row) {
        return {
          totalCustomers: row.total_customers || 0,
          hotCustomers: row.hot_customers || 0,
          warmCustomers: row.warm_customers || 0,
          conversionRate: row.total_customers > 0 ? ((row.hot_customers + row.warm_customers) / row.total_customers) * 100 : 0
        };
      }

      return { totalCustomers: 0, conversionRate: 0 };
    } catch (error) {
      console.error('收集客户数据失败:', error);
      return { totalCustomers: 0, conversionRate: 0 };
    }
  }

  // ==================== AI分析与优化 ====================

  async analyzeAndOptimize() {
    console.log('🤖 开始AI分析与优化...');

    try {
      const emailMetrics = await this.collectEmailMetrics();
      const videoMetrics = await this.collectVideoMetrics();
      const customerMetrics = await this.collectCustomerMetrics();

      console.log('📊 数据收集完成:');
      console.log('  - 邮件打开率:', emailMetrics.openRate.toFixed(2) + '%');
      console.log('  - 视频互动率:', videoMetrics.engagementRate.toFixed(2) + '%');
      console.log('  - 客户转化率:', customerMetrics.conversionRate.toFixed(2) + '%');

      const currentVersions = await this.getCurrentVersions();

      const needsOptimization = this.checkIfNeedsOptimization(
        emailMetrics, videoMetrics, customerMetrics, currentVersions
      );

      if (!needsOptimization) {
        console.log('✅ 当前性能良好，无需优化');
        return { success: true, message: '性能良好，无需优化' };
      }

      const optimizations = await this.generateOptimizations(emailMetrics, videoMetrics, customerMetrics);
      await this.saveOptimizations(optimizations);
      await this.startABTests(optimizations);

      console.log('✅ AI优化完成');
      return { success: true, optimizations };

    } catch (error) {
      console.error('AI分析失败:', error);
      return { success: false, error: error.message };
    }
  }

  checkIfNeedsOptimization(emailMetrics, videoMetrics, customerMetrics, currentVersions) {
    const thresholds = { emailOpenRate: 20, videoEngagement: 2, customerConversion: 10 };
    return (
      emailMetrics.openRate < thresholds.emailOpenRate ||
      videoMetrics.engagementRate < thresholds.videoEngagement ||
      customerMetrics.conversionRate < thresholds.customerConversion
    );
  }

  async generateOptimizations(emailMetrics, videoMetrics, customerMetrics) {
    try {
      const config = this.db.prepare(
        'SELECT * FROM ai_configs WHERE module_name = ? AND is_active = 1'
      ).get('email');
      
      if (!config) {
        console.log('⚠️ 未配置AI，使用默认优化策略');
        return this.getDefaultOptimizations();
      }

      const prompt = `
作为外贸营销专家，请根据以下数据分析并提供优化建议：

邮件营销数据：打开率 ${emailMetrics.openRate.toFixed(2)}%，回复率 ${emailMetrics.replyRate.toFixed(2)}%
视频营销数据：平均观看 ${videoMetrics.avgViews}，互动率 ${videoMetrics.engagementRate.toFixed(2)}%
客户转化数据：转化率 ${customerMetrics.conversionRate.toFixed(2)}%

请提供JSON格式优化建议，包含 email(subjectLines/openingLines/cta)、video(titles/hashtags/hooks)、customer(greetings/questions/closings)。`;

      const response = await axios.post(
        `${config.api_base_url}/chat/completions`,
        {
          model: config.model_name,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        },
        injectProxy(this.db, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.api_key}`
          },
          timeout: 30000
        })
      );

      const aiResponse = response.data.choices[0].message.content;
      return JSON.parse(aiResponse);

    } catch (error) {
      console.error('AI生成优化失败:', error.message);
      return this.getDefaultOptimizations();
    }
  }

  getDefaultOptimizations() {
    return {
      email: {
        subjectLines: ["🎯 专业电能表制造商 - 质量保证", "💡 节能解决方案 - 立即咨询", "🏆 20年经验 - 值得信赖的合作伙伴"],
        openingLines: ["您好！我们是专业的电能表制造商，拥有20年行业经验。", "感谢您的关注！我们提供高质量的电气设备解决方案。"],
        cta: ["点击回复获取产品目录", "立即咨询获取优惠报价"]
      },
      video: {
        titles: ["🔥 专业电能表制造 | 20年经验", "💡 智能电能表 | 高精度测量", "🏭 工厂实拍 | 质量保证"],
        hashtags: ["#电能表", "#智能制造", "#外贸", "#B2B"],
        hooks: ["你知道如何选择高质量的电能表吗？", "20年制造经验告诉你..."]
      },
      customer: {
        greetings: ["您好！很高兴为您服务。", "感谢您的咨询！我们会尽快回复。"],
        questions: ["请问您对哪类产品感兴趣？", "您的目标市场是哪里？"],
        closings: ["期待与您合作！", "如有任何问题，随时联系我们。"]
      }
    };
  }

  async saveOptimizations(optimizations) {
    try {
      const version = `v${Date.now()}`;
      const stmt = this.db.prepare(
        'INSERT INTO optimization_versions (module, version, content, performance_score, is_active) VALUES (?, ?, ?, ?, ?)'
      );
      
      stmt.run('email', version, JSON.stringify(optimizations.email), 0, 0);
      stmt.run('video', version, JSON.stringify(optimizations.video), 0, 0);
      stmt.run('customer', version, JSON.stringify(optimizations.customer), 0, 0);

      console.log(`✅ 保存优化版本: ${version}`);
    } catch (error) {
      console.error('保存优化失败:', error);
    }
  }

  async startABTests(optimizations) {
    try {
      const currentVersions = await this.getCurrentVersions();
      const newVersions = await this.getLatestVersions();

      const stmt = this.db.prepare(
        'INSERT INTO ab_tests (module, version_a, version_b, status) VALUES (?, ?, ?, ?)'
      );

      for (const module of ['email', 'video', 'customer']) {
        if (currentVersions[module] && newVersions[module]) {
          stmt.run(module, currentVersions[module].id, newVersions[module].id, 'running');
        }
      }

      console.log('✅ A/B测试已启动');
    } catch (error) {
      console.error('启动A/B测试失败:', error);
    }
  }

  async getCurrentVersions() {
    const versions = {};
    const stmt = this.db.prepare(
      'SELECT * FROM optimization_versions WHERE module = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1'
    );
    
    for (const module of ['email', 'video', 'customer']) {
      const row = stmt.get(module);
      if (row) {
        versions[module] = {
          id: row.id,
          version: row.version,
          content: JSON.parse(row.content),
          score: row.performance_score
        };
      }
    }
    return versions;
  }

  async getLatestVersions() {
    const versions = {};
    const stmt = this.db.prepare(
      'SELECT * FROM optimization_versions WHERE module = ? ORDER BY created_at DESC LIMIT 1'
    );
    
    for (const module of ['email', 'video', 'customer']) {
      const row = stmt.get(module);
      if (row) {
        versions[module] = {
          id: row.id,
          version: row.version,
          content: JSON.parse(row.content),
          score: row.performance_score
        };
      }
    }
    return versions;
  }

  // ==================== 性能监控与自动回退 ====================

  async monitorAndRollback() {
    console.log('📊 监控性能...');

    try {
      const tests = this.db.prepare('SELECT * FROM ab_tests WHERE status = ?').all('running');
      
      if (tests.length === 0) {
        console.log('没有正在运行的A/B测试');
        return;
      }

      for (const test of tests) {
        const scoreA = await this.calculatePerformanceScore(test.module, test.version_a);
        const scoreB = await this.calculatePerformanceScore(test.module, test.version_b);

        console.log(`${test.module} - 版本A: ${scoreA.toFixed(2)}, 版本B: ${scoreB.toFixed(2)}`);

        if (scoreB < scoreA * 0.8) {
          console.log(`⚠️ ${test.module} 新版本性能下降，自动回退`);
          await this.rollbackVersion(test.module, test.version_a);
          this.db.prepare('UPDATE ab_tests SET status = ?, winner = ? WHERE id = ?')
            .run('completed', test.version_a, test.id);
        } else if (scoreB > scoreA * 1.1) {
          console.log(`✅ ${test.module} 新版本性能提升，启用新版本`);
          await this.activateVersion(test.module, test.version_b);
          this.db.prepare('UPDATE ab_tests SET status = ?, winner = ? WHERE id = ?')
            .run('completed', test.version_b, test.id);
        }
      }

    } catch (error) {
      console.error('性能监控失败:', error);
    }
  }

  async calculatePerformanceScore(module, versionId) {
    try {
      const row = this.db.prepare(
        'SELECT AVG(metric_value) as avg_score FROM performance_metrics WHERE module = ? AND version_id = ?'
      ).get(module, versionId);
      return row?.avg_score || 0;
    } catch (error) {
      return 0;
    }
  }

  async rollbackVersion(module, versionId) {
    try {
      this.db.prepare('UPDATE optimization_versions SET is_active = 0 WHERE module = ?').run(module);
      this.db.prepare('UPDATE optimization_versions SET is_active = 1 WHERE id = ?').run(versionId);
      console.log(`✅ ${module} 已回退到版本 ${versionId}`);
    } catch (error) {
      console.error('版本回退失败:', error);
    }
  }

  async activateVersion(module, versionId) {
    try {
      this.db.prepare('UPDATE optimization_versions SET is_active = 0 WHERE module = ?').run(module);
      this.db.prepare('UPDATE optimization_versions SET is_active = 1 WHERE id = ?').run(versionId);
      console.log(`✅ ${module} 已启用版本 ${versionId}`);
    } catch (error) {
      console.error('版本启用失败:', error);
    }
  }
}

module.exports = AIOptimizer;
