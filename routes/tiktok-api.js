/**
 * TikTok API 路由
 * 挂载到 /api/tiktok
 * 需要登录验证（已在 server.js 中通过 requireAuth 中间件保护）
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../src/auth-middleware');
const crypto = require('crypto');

// 确保上传目录存在
const uploadDir = path.join(__dirname, '..', 'uploads', 'tiktok');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置multer处理视频上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名：时间戳+随机字符串
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}_${randomStr}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 287 * 1024 * 1024, // 287MB TikTok限制
  },
  fileFilter: function (req, file, cb) {
    // 只允许视频文件
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 mp4, webm, mov 格式的视频文件'));
    }
  }
});

/**
 * 确保有效的TikTok token
 * 检查token是否过期，过期则自动刷新
 */
async function ensureValidToken(db, accountId) {
  try {
    // 从social_accounts表获取TikTok账号信息
    let account;
    if (accountId) {
      account = db.prepare(`
        SELECT id, access_token, refresh_token, token_expires_at, platform_user_id 
        FROM social_accounts 
        WHERE id = ? AND platform = 'tiktok' AND status = 'active'
      `).get(accountId);
    } else {
      account = db.prepare(`
        SELECT id, access_token, refresh_token, token_expires_at, platform_user_id 
        FROM social_accounts 
        WHERE platform = 'tiktok' AND status = 'active'
        ORDER BY updated_at DESC LIMIT 1
      `).get();
    }

    if (!account) {
      return { error: '未找到已授权的TikTok账号' };
    }

    const { access_token, refresh_token, token_expires_at, id, platform_user_id } = account;
    
    // 检查token是否过期或即将过期（5分钟内）
    const expiresAt = new Date(token_expires_at);
    const now = new Date();
    const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);

    if (!token_expires_at || expiresAt <= fiveMinutesLater) {
      console.log(`[TikTok API] Token即将过期或已过期，尝试刷新`);
      
      const OAuthManager = require('../src/oauth-manager');
      const oauthMgr = new OAuthManager(db);
      
      // 读取TikTok API配置
      const configRow = db.prepare("SELECT value FROM settings WHERE key = 'tiktok_api'").get();
      if (!configRow) {
        return { error: '请先配置TikTok API密钥' };
      }
      
      const config = JSON.parse(configRow.value);
      const { decrypt } = require('../src/crypto-utils');
      const tkConfig = {
        clientKey: config.clientKey,
        clientSecret: decrypt(config.clientSecret),
        redirectUri: config.redirectUri || 'http://localhost:3001/oauth/tiktok/callback'
      };

      const refreshResult = await oauthMgr.refreshTikTokToken(refresh_token, tkConfig);
      
      if (!refreshResult.success) {
        return { error: `Token刷新失败: ${refreshResult.error}` };
      }

      // 更新数据库中的token信息
      db.prepare(`
        UPDATE social_accounts 
        SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        refreshResult.accessToken,
        refreshResult.refreshToken,
        refreshResult.expiresAt,
        id
      );

      console.log(`[TikTok API] Token刷新成功，新token有效期至: ${refreshResult.expiresAt}`);
      return { 
        success: true, 
        accessToken: refreshResult.accessToken,
        openId: refreshResult.openId || platform_user_id
      };
    }

    return { 
      success: true, 
      accessToken: access_token,
      openId: platform_user_id
    };
  } catch (error) {
    console.error('[TikTok API] ensureValidToken错误:', error);
    return { error: `Token验证失败: ${error.message}` };
  }
}


/**
 * GET /api/tiktok/accounts
 * 获取已授权的TikTok账号列表
 */
router.get('/accounts', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const accounts = db.prepare(`
    SELECT id, platform_user_id, display_name, status, token_expires_at, updated_at
    FROM social_accounts 
    WHERE platform = 'tiktok'
    ORDER BY updated_at DESC
  `).all();
  
  const now = new Date();
  const formatted = accounts.map(a => ({
    id: a.id,
    userId: a.platform_user_id,
    displayName: a.display_name || a.platform_user_id || '未命名',
    status: a.status,
    isExpired: a.token_expires_at ? new Date(a.token_expires_at) <= now : true,
    expiresAt: a.token_expires_at,
    lastUpdated: a.updated_at
  }));
  
  res.json({ accounts: formatted });
});

/**
 * GET /api/tiktok/auth-status
 * 查询TikTok授权状态
 */
router.get('/auth-status', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const account = db.prepare(`
      SELECT id, platform_user_id, status, token_expires_at, updated_at, display_name
      FROM social_accounts 
      WHERE platform = 'tiktok' AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1
    `).get();
    const totalAccounts = db.prepare("SELECT COUNT(*) as count FROM social_accounts WHERE platform = 'tiktok' AND status = 'active'").get().count;

    if (!account) {
      return res.json({ 
        authorized: false,
        message: '未找到TikTok授权信息',
        totalAccounts: totalAccounts
      });
    }

    const { platform_user_id, status, token_expires_at, updated_at, display_name } = account;
    const isExpired = token_expires_at ? new Date(token_expires_at) <= new Date() : true;

    return res.json({
      authorized: status === 'active' && !isExpired,
      userId: platform_user_id,
      displayName: display_name || '未知用户',
      status: status,
      isExpired: isExpired,
      expiresAt: token_expires_at,
      lastUpdated: updated_at,
      totalAccounts: totalAccounts
    });
  } catch (error) {
    console.error('[TikTok API] auth-status错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tiktok/auth-url
 * 获取OAuth授权URL（后端生成，比前端直接拼更安全）
 */
router.get('/auth-url', requireAuth, (req, res) => {
  try {
    const db = req.app.locals.db;
    
    // 读取TikTok API配置
    const configRow = db.prepare("SELECT value FROM settings WHERE key = 'tiktok_api'").get();
    if (!configRow) {
      return res.status(400).json({ error: '请先配置TikTok API密钥' });
    }

    const config = JSON.parse(configRow.value);
    const clientKey = config.clientKey;
    const redirectUri = config.redirectUri || 'http://localhost:3001/oauth/tiktok/callback';
    
    // 生成随机state参数防止CSRF攻击
    const state = crypto.randomBytes(16).toString('hex');
    
    // 构建授权URL
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=user.info.basic,video.publish,video.upload,video.list,user.info.profile&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    
    res.json({ 
      authUrl: authUrl,
      state: state
    });
  } catch (error) {
    console.error('[TikTok API] auth-url错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tiktok/publish
 * 发布视频到TikTok
 */
router.post('/publish', requireAuth, upload.single('video'), async (req, res) => {
  let videoPath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传视频文件' });
    }

    const { title, privacyLevel, accountId } = req.body;
    const db = req.app.locals.db;
    
    if (!title || title.trim().length === 0) {
      // 删除已上传的文件
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '请输入视频标题' });
    }

    if (title.length > 150) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '标题不能超过150个字符' });
    }

    // 验证隐私设置
    const allowedPrivacyLevels = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
    const finalPrivacyLevel = allowedPrivacyLevels.includes(privacyLevel) ? privacyLevel : 'PUBLIC_TO_EVERYONE';

    videoPath = req.file.path;
    
    // 1. 确保token有效
    const tokenResult = await ensureValidToken(db, accountId);
    if (tokenResult.error) {
      fs.unlinkSync(videoPath);
      return res.status(401).json({ error: tokenResult.error });
    }

    // 2. 检查每日发布限制
    const SocialPublisher = require('../src/social-publisher');
    const OAuthManager = require('../src/oauth-manager');
    const oauthMgr = new OAuthManager(db);
    const publisher = new SocialPublisher(oauthMgr, db);
    
    const limitCheck = await publisher.checkPublishLimit('tiktok');
    if (!limitCheck.allowed) {
      fs.unlinkSync(videoPath);
      return res.status(429).json({ 
        error: `发布限制: ${limitCheck.message}`,
        limitInfo: limitCheck
      });
    }

    // 3. 发布视频
    console.log(`[TikTok API] 开始发布视频: ${title}, 隐私设置: ${finalPrivacyLevel}`);
    
    const publishResult = await publisher.publishToTikTok(videoPath, {
      title: title,
      privacyLevel: finalPrivacyLevel,
      accessToken: tokenResult.accessToken
    });

    // 4. 记录发布结果
    if (publishResult.success) {
      // 记录发布历史
      const publishId = crypto.randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO social_posts (platform, content, media_urls, status, published_at, engagement)
        VALUES ('tiktok', ?, ?, 'published', datetime('now'), ?)
      `).run(
        title,
        JSON.stringify([videoPath]),
        JSON.stringify({ publishId: publishResult.publishId || publishId })
      );

      // 清理上传的文件（发布成功后删除）
      try {
        fs.unlinkSync(videoPath);
      } catch (e) {
        console.warn(`[TikTok API] 清理视频文件失败: ${e.message}`);
      }

      return res.json({
        success: true,
        publishId: publishResult.publishId || publishId,
        message: '视频发布成功',
        result: publishResult
      });
    } else {
      // 发布失败，保留文件用于调试
      console.error(`[TikTok API] 发布失败:`, publishResult.error);
      return res.status(500).json({
        success: false,
        error: publishResult.error,
        message: '视频发布失败'
      });
    }
  } catch (error) {
    console.error('[TikTok API] publish错误:', error);
    
    // 清理文件
    if (videoPath && fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
      } catch (e) {
        console.warn(`[TikTok API] 清理视频文件失败: ${e.message}`);
      }
    }
    
    res.status(500).json({ error: error.message });
  }
});


/**
 * DELETE /api/tiktok/accounts/:id
 * 删除（停用）指定TikTok账号
 */
router.delete('/accounts/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;
  // 软删除，改status为revoked
  db.prepare("UPDATE social_accounts SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND platform = 'tiktok'").run(id);
  res.json({ success: true });
});

/**
 * GET /api/tiktok/publish-status/:publishId
 * 查询发布状态
 */
router.get('/publish-status/:publishId', requireAuth, async (req, res) => {
  try {
    const { publishId } = req.params;
    const db = req.app.locals.db;
    
    // 这里可以扩展为调用TikTok API查询发布状态
    // 目前先返回数据库中的记录
    const post = db.prepare(`
      SELECT id, content, status, published_at, engagement
      FROM social_posts 
      WHERE platform = 'tiktok' AND json_extract(engagement, '$.publishId') = ?
      ORDER BY published_at DESC LIMIT 1
    `).get(publishId);

    if (!post) {
      return res.status(404).json({ error: '未找到发布记录' });
    }

    res.json({
      publishId: publishId,
      title: post.content,
      status: post.status,
      publishedAt: post.published_at,
      engagement: JSON.parse(post.engagement || '{}')
    });
  } catch (error) {
    console.error('[TikTok API] publish-status错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tiktok/refresh-token
 * 手动刷新token
 */
router.post('/refresh-token', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const tokenResult = await ensureValidToken(db);
    
    if (tokenResult.error) {
      return res.status(401).json({ error: tokenResult.error });
    }

    res.json({
      success: true,
      message: 'Token刷新成功',
      expiresAt: tokenResult.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('[TikTok API] refresh-token错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tiktok/user-info
 * 获取已授权的TikTok用户信息
 */
router.get('/user-info', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const account = db.prepare(`
      SELECT id, platform_user_id, display_name, status, token_expires_at, updated_at
      FROM social_accounts 
      WHERE platform = 'tiktok' AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1
    `).get();

    if (!account) {
      return res.json({ 
        authorized: false,
        message: '未找到已授权的TikTok账号'
      });
    }

    // 确保token有效
    const tokenResult = await ensureValidToken(db);
    if (tokenResult.error && !tokenResult.accessToken) {
      return res.status(401).json({ error: tokenResult.error });
    }

    // 这里可以扩展为调用TikTok API获取用户详细信息
    // 目前返回数据库中的信息
    res.json({
      authorized: true,
      userId: account.platform_user_id,
      displayName: account.display_name || 'TikTok用户',
      status: account.status,
      lastUpdated: account.updated_at
    });
  } catch (error) {
    console.error('[TikTok API] user-info错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tiktok/videos
 * 获取已发布的视频列表
 */
router.get('/videos', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { limit = 20, offset = 0 } = req.query;
    
    const videos = db.prepare(`
      SELECT id, content as title, media_urls, status, published_at, engagement
      FROM social_posts 
      WHERE platform = 'tiktok' AND status = 'published'
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset));

    const total = db.prepare(`
      SELECT COUNT(*) as count
      FROM social_posts 
      WHERE platform = 'tiktok' AND status = 'published'
    `).get().count;

    const formattedVideos = videos.map(video => ({
      id: video.id,
      title: video.title,
      mediaUrls: JSON.parse(video.media_urls || '[]'),
      status: video.status,
      publishedAt: video.published_at,
      engagement: JSON.parse(video.engagement || '{}')
    }));

    res.json({
      videos: formattedVideos,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('[TikTok API] videos错误:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;