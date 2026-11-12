const axios = require('axios');
const crypto = require('crypto');
const { injectProxy } = require('./outbound-proxy');

class OAuthManager {
  constructor(db) {
    this.db = db;
    this.pendingAuths = new Map(); // 存储待处理的授权
  }

  // ==================== Facebook OAuth ====================
  
  getFacebookAuthUrl(config) {
    const state = crypto.randomBytes(16).toString('hex');
    const scopes = [
      'pages_manage_posts',
      'pages_read_engagement',
      'pages_show_list',
      'public_profile'
    ];
    
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.redirectUri || 'http://localhost:3000/oauth/facebook/callback',
      state: state,
      scope: scopes.join(','),
      response_type: 'code'
    });
    
    this.pendingAuths.set(state, { platform: 'facebook', timestamp: Date.now() });
    
    return {
      url: `https://www.facebook.com/v18.0/dialog/oauth?${params}`,
      state: state
    };
  }

  async handleFacebookCallback(code, config) {
    try {
      // 1. 交换短期token
      const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', 
        injectProxy(this.db, {
          params: {
            client_id: config.appId,
            client_secret: config.appSecret,
            redirect_uri: config.redirectUri || 'http://localhost:3000/oauth/facebook/callback',
            code: code
          }
        })
      );

      const shortToken = tokenResponse.data.access_token;

      // 2. 交换长期token（60天）
      const longTokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', 
        injectProxy(this.db, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: config.appId,
            client_secret: config.appSecret,
            fb_exchange_token: shortToken
          }
        })
      );

      const accessToken = longTokenResponse.data.access_token;
      const expiresIn = longTokenResponse.data.expires_in;

      // 3. 获取用户信息
      const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', 
        injectProxy(this.db, {
          params: {
            access_token: accessToken,
            fields: 'id,name,email'
          }
        })
      );

      // 4. 获取用户管理的页面
      const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', 
        injectProxy(this.db, {
          params: { access_token: accessToken }
        })
      );

      return {
        success: true,
        platform: 'facebook',
        accessToken: accessToken,
        expiresIn: expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        user: userResponse.data,
        pages: pagesResponse.data.data
      };

    } catch (error) {
      console.error('Facebook OAuth失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  // ==================== TikTok OAuth ====================
  
  getTikTokAuthUrl(config) {
    const csrfState = crypto.randomBytes(16).toString('hex');
    const scopes = [
      'user.info.basic',
      'video.publish',
      'video.upload'
    ];
    
    const params = new URLSearchParams({
      client_key: config.clientKey,
      scope: scopes.join(','),
      response_type: 'code',
      redirect_uri: config.redirectUri || 'http://localhost:3000/oauth/tiktok/callback',
      state: csrfState
    });
    
    this.pendingAuths.set(csrfState, { platform: 'tiktok', timestamp: Date.now() });
    
    return {
      url: `https://www.tiktok.com/v2/auth/authorize/?${params}`,
      state: csrfState
    };
  }

  async handleTikTokCallback(code, config) {
    try {
      const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', 
        new URLSearchParams({
          client_key: config.clientKey,
          client_secret: config.clientSecret,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: config.redirectUri || 'http://localhost:3000/oauth/tiktok/callback'
        }),
        injectProxy(this.db, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      const data = response.data.data;

      return {
        success: true,
        platform: 'tiktok',
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        openId: data.open_id,
        scope: data.scope
      };

    } catch (error) {
      console.error('TikTok OAuth失败:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  async refreshTikTokToken(refreshToken, config) {
    try {
      const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key: config.clientKey,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }),
        injectProxy(this.db, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      const data = response.data.data;

      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString()
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== 数据库操作 ====================

  async saveCredentials(platform, credentials) {
    try {
      // 使用 social_accounts 表替代不存在的 account_credentials
      const existing = this.db.prepare('SELECT id FROM social_accounts WHERE platform = ?').get(platform);
      
      if (existing) {
        this.db.prepare(
          'UPDATE social_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, account_name = ?, updated_at = CURRENT_TIMESTAMP WHERE platform = ?'
        ).run(
          credentials.accessToken,
          credentials.refreshToken || '',
          credentials.expiresAt,
          credentials.accountName || credentials.user?.name || '',
          platform
        );
      } else {
        this.db.prepare(
          'INSERT INTO social_accounts (platform, account_name, access_token, refresh_token, token_expires_at, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          platform,
          credentials.accountName || credentials.user?.name || '',
          credentials.accessToken,
          credentials.refreshToken || '',
          credentials.expiresAt,
          'active'
        );
      }
      
      return { success: true };
      
    } catch (error) {
      console.error('保存凭证失败:', error);
      return { success: false, error: error.message };
    }
  }

  async getCredentials(platform) {
    try {
      const row = this.db.prepare('SELECT * FROM social_accounts WHERE platform = ? AND status = ?').get(platform, 'active');
      
      if (!row) {
        return null;
      }
      
      return {
        id: row.id,
        platform: row.platform,
        accountName: row.account_name,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        tokenExpiresAt: row.token_expires_at,
        isActive: row.status === 'active'
      };
      
    } catch (error) {
      console.error('获取凭证失败:', error);
      return null;
    }
  }
}

module.exports = OAuthManager;
