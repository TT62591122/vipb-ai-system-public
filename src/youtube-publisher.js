/**
 * YouTube API 视频发布引擎
 * - OAuth2 授权（Google API）
 * - 视频上传（resumable upload）
 * - 视频元数据设置（标题、描述、标签、分类）
 * - 缩略图上传
 * - 发布状态查询
 * 
 * 需要：Google Cloud Console 创建 OAuth2 凭据
 * API: YouTube Data API v3
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { decrypt } = require('./crypto-utils');

// YouTube 视频分类ID（外贸常用）
const CATEGORIES = {
  science_tech: '28',    // Science & Technology
  education: '27',       // Education
  howto: '26',          // Howto & Style
  people_blogs: '22',   // People & Blogs
};

class YouTubePublisher {
  constructor(db) {
    this.db = db;
  }

  /**
   * 获取YouTube API配置
   */
  _getConfig() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'youtube_api'").get();
    if (!row) throw new Error('请先配置YouTube API密钥（设置→YouTube API）');
    const config = JSON.parse(row.value);
    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret ? decrypt(config.clientSecret) : '',
      redirectUri: config.redirectUri || 'http://localhost:3001/oauth/youtube/callback'
    };
  }

  /**
   * 获取已授权的access token
   */
  _getToken() {
    const account = this.db.prepare(
      "SELECT * FROM social_accounts WHERE platform = 'youtube' AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
    ).get();
    if (!account) throw new Error('请先完成YouTube授权');
    return {
      accessToken: account.access_token,
      refreshToken: account.refresh_token,
      accountId: account.id
    };
  }

  /**
   * 刷新access token
   */
  async _refreshToken(refreshToken) {
    const config = this._getConfig();
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    return response.data.access_token;
  }

  /**
   * 生成OAuth授权URL
   */
  getAuthUrl() {
    const config = this._getConfig();
    const scopes = [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.readonly'
    ];
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * 处理OAuth回调
   */
  async handleCallback(code) {
    const config = this._getConfig();
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_in } = response.data;
    
    // 获取频道信息
    const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet', mine: true },
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const channel = channelRes.data.items?.[0];
    const channelId = channel?.id || 'unknown';
    const channelTitle = channel?.snippet?.title || 'YouTube Channel';

    return { accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in, channelId, channelTitle };
  }

  /**
   * 上传视频
   * @param {string} videoPath - 本地视频文件路径
   * @param {object} metadata - { title, description, tags, categoryId, privacyStatus }
   */
  async uploadVideo(videoPath, metadata = {}) {
    if (!fs.existsSync(videoPath)) throw new Error('视频文件不存在: ' + videoPath);

    const { accessToken, refreshToken, accountId } = this._getToken();
    let token = accessToken;

    // 尝试刷新token
    try {
      token = await this._refreshToken(refreshToken);
      this.db.prepare("UPDATE social_accounts SET access_token = ?, updated_at = datetime('now') WHERE id = ?")
        .run(token, accountId);
    } catch (e) {
      console.warn('[YouTube] Token刷新失败，使用现有token:', e.message);
    }

    const fileSize = fs.statSync(videoPath).size;
    const title = metadata.title || '产品视频';
    const description = metadata.description || '';
    const tags = metadata.tags || ['smart meter', 'circuit breaker', 'electrical equipment'];
    const categoryId = metadata.categoryId || CATEGORIES.science_tech;
    const privacyStatus = metadata.privacyStatus || 'public';

    // 1. 初始化 resumable upload
    const initRes = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: { title, description, tags, categoryId },
        status: { privacyStatus, selfDeclaredMadeForKids: false }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': fileSize,
          'X-Upload-Content-Type': 'video/*'
        }
      }
    );

    const uploadUrl = initRes.headers.location;
    if (!uploadUrl) throw new Error('未获取到上传URL');

    // 2. 上传视频文件
    const videoBuffer = fs.readFileSync(videoPath);
    const uploadRes = await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Type': 'video/*',
        'Content-Length': fileSize
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const videoId = uploadRes.data?.id;
    console.log(`[YouTube] 视频上传成功: ${videoId} - ${title}`);

    return {
      success: true,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      status: uploadRes.data?.status?.uploadStatus
    };
  }

  /**
   * 获取频道视频列表
   */
  async listVideos(maxResults = 10) {
    const { accessToken } = this._getToken();
    const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', forMine: true, type: 'video', maxResults, order: 'date' },
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.data.items || [];
  }
}

module.exports = { YouTubePublisher };
