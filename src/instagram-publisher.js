/**
 * Instagram Graph API 发布引擎
 * - 通过 Facebook/Meta Business Suite 授权
 * - 图片/视频/Reels 发布
 * - 轮播图发布
 * - 发布状态查询
 * 
 * 前提：需要 Facebook Business 账号 + Instagram Professional 账号
 * API: Instagram Graph API (via Meta)
 */
const fs = require('fs');
const axios = require('axios');
const { decrypt } = require('./crypto-utils');

class InstagramPublisher {
  constructor(db) {
    this.db = db;
  }

  _getConfig() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'instagram_api'").get();
    if (!row) throw new Error('请先配置Instagram API（设置页面）');
    const config = JSON.parse(row.value);
    return {
      appId: config.appId,
      appSecret: config.appSecret ? decrypt(config.appSecret) : '',
      redirectUri: config.redirectUri || 'http://localhost:3001/oauth/instagram/callback'
    };
  }

  _getToken() {
    const account = this.db.prepare(
      "SELECT * FROM social_accounts WHERE platform = 'instagram' AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
    ).get();
    if (!account) throw new Error('请先完成Instagram授权');
    return {
      accessToken: account.access_token,
      igUserId: account.platform_user_id,
      accountId: account.id
    };
  }

  /**
   * 生成OAuth授权URL
   */
  getAuthUrl() {
    const config = this._getConfig();
    const scopes = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement';
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.redirectUri,
      scope: scopes,
      response_type: 'code'
    });
    return `https://www.facebook.com/v18.0/dialog/oauth?${params}`;
  }

  /**
   * 处理OAuth回调
   */
  async handleCallback(code) {
    const config = this._getConfig();
    
    // 1. 换取短期token
    const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code
      }
    });
    const shortToken = tokenRes.data.access_token;

    // 2. 换取长期token
    const longTokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortToken
      }
    });
    const longToken = longTokenRes.data.access_token;

    // 3. 获取关联的Instagram Business账号
    const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: longToken }
    });
    const page = pagesRes.data.data?.[0];
    if (!page) throw new Error('未找到关联的Facebook Page');

    const igRes = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
      params: { fields: 'instagram_business_account', access_token: page.access_token || longToken }
    });
    const igAccountId = igRes.data.instagram_business_account?.id;
    if (!igAccountId) throw new Error('未找到关联的Instagram Business账号');

    return {
      accessToken: longToken,
      pageAccessToken: page.access_token,
      igUserId: igAccountId,
      pageName: page.name
    };
  }

  /**
   * 发布图片
   * @param {string} imageUrl - 图片URL（必须是公网可访问的URL）
   * @param {string} caption - 图片描述
   */
  async publishImage(imageUrl, caption = '') {
    const { accessToken, igUserId } = this._getToken();

    // 1. 创建媒体容器
    const createRes = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media`, null, {
      params: { image_url: imageUrl, caption, access_token: accessToken }
    });
    const containerId = createRes.data.id;

    // 2. 发布
    const publishRes = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, null, {
      params: { creation_id: containerId, access_token: accessToken }
    });

    return { success: true, mediaId: publishRes.data.id, containerId };
  }

  /**
   * 发布视频/Reels
   * @param {string} videoUrl - 视频URL（公网可访问）
   * @param {string} caption
   * @param {string} mediaType - 'REELS' 或 'VIDEO'
   */
  async publishVideo(videoUrl, caption = '', mediaType = 'REELS') {
    const { accessToken, igUserId } = this._getToken();

    // 1. 创建媒体容器
    const createRes = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media`, null, {
      params: {
        video_url: videoUrl,
        caption,
        media_type: mediaType,
        access_token: accessToken
      }
    });
    const containerId = createRes.data.id;

    // 2. 等待视频处理完成（轮询）
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status === 'IN_PROGRESS' && attempts < 30) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await axios.get(`https://graph.facebook.com/v18.0/${containerId}`, {
        params: { fields: 'status_code', access_token: accessToken }
      });
      status = statusRes.data.status_code;
      attempts++;
    }

    if (status !== 'FINISHED') {
      throw new Error(`视频处理失败: ${status}`);
    }

    // 3. 发布
    const publishRes = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, null, {
      params: { creation_id: containerId, access_token: accessToken }
    });

    return { success: true, mediaId: publishRes.data.id, containerId };
  }

  /**
   * 发布轮播图
   * @param {string[]} imageUrls - 图片URL数组（2-10张）
   * @param {string} caption
   */
  async publishCarousel(imageUrls, caption = '') {
    if (!imageUrls || imageUrls.length < 2) throw new Error('轮播图至少需要2张图片');
    if (imageUrls.length > 10) throw new Error('轮播图最多10张图片');

    const { accessToken, igUserId } = this._getToken();

    // 1. 为每张图创建子容器
    const childIds = [];
    for (const url of imageUrls) {
      const res = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media`, null, {
        params: { image_url: url, is_carousel_item: true, access_token: accessToken }
      });
      childIds.push(res.data.id);
    }

    // 2. 创建轮播容器
    const carouselRes = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media`, null, {
      params: {
        media_type: 'CAROUSEL',
        caption,
        children: childIds.join(','),
        access_token: accessToken
      }
    });

    // 3. 发布
    const publishRes = await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, null, {
      params: { creation_id: carouselRes.data.id, access_token: accessToken }
    });

    return { success: true, mediaId: publishRes.data.id };
  }
}

module.exports = { InstagramPublisher };
