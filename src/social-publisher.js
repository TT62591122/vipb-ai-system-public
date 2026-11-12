const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { injectProxy } = require('./outbound-proxy');

class SocialPublisher {
  constructor(oauthManager, db) {
    this.oauthManager = oauthManager;
    this.db = db;
  }

  // ==================== Facebook发布 ====================
  
  async publishToFacebook(videoPath, options = {}) {
    try {
      const credentials = await this.oauthManager.getCredentials('facebook');
      
      if (!credentials) {
        throw new Error('请先完成Facebook授权');
      }

      const accessToken = credentials.accessToken;
      const pageId = options.pageId;
      const accountId = options.accountId || null; // 账号级代理

      if (!pageId) {
        throw new Error('请指定要发布的Facebook页面ID');
      }

      console.log('开始上传视频到Facebook...');

      // 1. 初始化上传
      const initResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/videos`,
        {
          upload_phase: 'start',
          file_size: fs.statSync(videoPath).size
        },
        injectProxy(this.db, {
          params: { access_token: accessToken }
        }, accountId)
      );

      const videoId = initResponse.data.video_id;
      const uploadSessionId = initResponse.data.upload_session_id;

      // 2. 上传视频文件
      const formData = new FormData();
      formData.append('upload_phase', 'transfer');
      formData.append('upload_session_id', uploadSessionId);
      formData.append('video_file_chunk', fs.createReadStream(videoPath));

      await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/videos`,
        formData,
        injectProxy(this.db, {
          params: { access_token: accessToken },
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }, accountId)
      );

      // 3. 完成上传并发布
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/videos`,
        {
          upload_phase: 'finish',
          upload_session_id: uploadSessionId,
          title: options.title || '产品视频',
          description: options.caption || '',
          published: true
        },
        injectProxy(this.db, {
          params: { access_token: accessToken }
        }, accountId)
      );

      console.log('✅ Facebook发布成功');

      return {
        success: true,
        platform: 'facebook',
        videoId: videoId,
        postId: publishResponse.data.id,
        message: 'Facebook发布成功'
      };

    } catch (error) {
      console.error('Facebook发布失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  // ==================== TikTok发布 ====================
  
  async publishToTikTok(videoPath, options = {}) {
    try {
      const credentials = await this.oauthManager.getCredentials('tiktok');
      
      if (!credentials) {
        throw new Error('请先完成TikTok授权');
      }

      const accessToken = credentials.accessToken;
      const accountId = options.accountId || null; // 账号级代理

      console.log('开始上传视频到TikTok...');

      // 1. 初始化上传
      const initResponse = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          post_info: {
            title: options.title || '产品视频',
            privacy_level: options.privacyLevel || 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: fs.statSync(videoPath).size,
            chunk_size: 10000000,
            total_chunk_count: Math.ceil(fs.statSync(videoPath).size / 10000000)
          }
        },
        injectProxy(this.db, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }, accountId)
      );

      const publishId = initResponse.data.data.publish_id;
      const uploadUrl = initResponse.data.data.upload_url;

      // 2. 上传视频文件
      const videoBuffer = fs.readFileSync(videoPath);
      const chunkSize = 10000000;
      const totalChunks = Math.ceil(videoBuffer.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, videoBuffer.length);
        const chunk = videoBuffer.slice(start, end);

        await axios.put(uploadUrl, chunk, 
          injectProxy(this.db, {
            headers: {
              'Content-Range': `bytes ${start}-${end - 1}/${videoBuffer.length}`,
              'Content-Type': 'video/mp4'
            }
          }, accountId)
        );

        console.log(`上传进度: ${i + 1}/${totalChunks}`);
      }

      // 3. 检查发布状态
      let status = 'PROCESSING';
      let attempts = 0;
      const maxAttempts = 30;

      while (status === 'PROCESSING' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const statusResponse = await axios.post(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          { publish_id: publishId },
          injectProxy(this.db, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }, accountId)
        );

        status = statusResponse.data.data.status;
        attempts++;
      }

      if (status === 'PUBLISH_COMPLETE') {
        console.log('✅ TikTok发布成功');
        return {
          success: true,
          platform: 'tiktok',
          publishId: publishId,
          message: 'TikTok发布成功'
        };
      } else {
        throw new Error(`发布状态异常: ${status}`);
      }

    } catch (error) {
      console.error('TikTok发布失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  // ==================== 发布记录 ====================

  async savePublishRecord(videoId, platform, result) {
    try {
      this.db.prepare(
        `INSERT INTO social_execution_log (account_id, action_type, platform, status, details, executed_at) 
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        videoId || 0,
        'publish_video',
        platform,
        result.success ? 'success' : 'failed',
        JSON.stringify({ postId: result.postId || result.publishId || '' })
      );
    } catch (error) {
      console.error('保存发布记录失败:', error);
    }
  }

  // ==================== 防封号策略 ====================

  async checkPublishLimit(platform) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const row = this.db.prepare(
        `SELECT COUNT(*) as count FROM social_execution_log 
         WHERE platform = ? AND DATE(executed_at) = ? AND status = 'success' AND action_type = 'publish_video'`
      ).get(platform, today);

      const todayCount = row ? row.count : 0;

      // 优先从数据库防封规则读取，后备用默认值
      const defaultLimits = { facebook: 5, tiktok: 3 };
      let limit = defaultLimits[platform] || 5;
      try {
        const ruleRow = this.db.prepare("SELECT value FROM settings WHERE key='antiban_rules'").get();
        if (ruleRow) {
          const rules = JSON.parse(ruleRow.value);
          const platformRules = rules[platform];
          if (platformRules?.sending?.max_daily_posts) {
            limit = platformRules.sending.max_daily_posts;
          }
        }
      } catch (e) { /* 读取失败用默认值 */ }

      if (todayCount >= limit) {
        return {
          allowed: false,
          message: `今日${platform}发布次数已达上限（${limit}次）`
        };
      }

      return {
        allowed: true,
        remaining: limit - todayCount
      };

    } catch (error) {
      console.error('检查发布限制失败:', error);
      return { allowed: true };
    }
  }
}

module.exports = SocialPublisher;
