/**
 * TikTokExecutor - TikTok 平台执行器
 * 
 * 支持:
 *   采集: collect_followers, collect_video_commenters, collect_hashtag_users
 *   群控: batch_follow, batch_like, batch_comment, batch_dm
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class TikTokExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'tiktok';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    const { action } = context;

    const handlers = {
      collect_followers: () => this._collectFollowers(context),
      collect_video_commenters: () => this._collectVideoCommenters(context),
      collect_hashtag_users: () => this._collectHashtagUsers(context),
      batch_follow: () => this._batchFollow(context),
      batch_like: () => this._batchLike(context),
      batch_comment: () => this._batchComment(context),
      batch_dm: () => this._batchDM(context),
      publish_video: () => this._publishVideo(context),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`TikTok 不支持的 action: ${action}`);

    return await handler();
  }

  // ==================== 工具方法 ====================

  _randomDelay(min, max) {
    const ms = (Math.random() * (max - min) + min) * 1000;
    return new Promise(r => setTimeout(r, ms));
  }

  async _humanScroll(page) {
    const distance = Math.floor(Math.random() * 500) + 200;
    await page.evaluate(d => window.scrollBy({ top: d, behavior: 'smooth' }), distance);
    await this._randomDelay(0.5, 1.5);
  }

  async _humanMouseMove(page) {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 600) + 100;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  }

  async _humanType(page, selector, text) {
    await page.click(selector);
    await this._randomDelay(0.3, 0.8);
    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 150) + 50 });
    }
  }

  async _acquireBrowser(accountId) {
    return await this.browserPool.acquire(accountId);
  }

  _releaseBrowser(instanceId) {
    try { this.browserPool.release(instanceId); } catch (e) {}
  }

  _extractUsernameFromUrl(url) {
    if (!url) return null;
    const match = url.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
    return match ? match[1] : null;
  }

  async _scrollAndCollect(page, cardSelector, extractFn, context) {
    const { dailyLimit, intervalMin, intervalMax, onProgress, onCollected } = context;
    const collected = new Set();
    let noNewCount = 0;
    let processed = 0, success = 0, failed = 0;

    while (noNewCount < 5) {
      if (dailyLimit && processed >= dailyLimit) break;

      const cards = await page.$$(cardSelector);
      let foundNew = false;

      for (const card of cards) {
        if (dailyLimit && processed >= dailyLimit) break;

        try {
          const data = await extractFn(card, page);
          if (!data || !data.external_id || collected.has(data.external_id)) continue;

          collected.add(data.external_id);
          foundNew = true;
          processed++;
          success++;

          onCollected(data);
          onProgress(processed, success, failed);
        } catch (e) {
          processed++;
          failed++;
          onProgress(processed, success, failed);
        }
      }

      if (!foundNew) {
        noNewCount++;
      } else {
        noNewCount = 0;
      }

      await this._humanScroll(page);
      await this._humanMouseMove(page);
      await this._randomDelay(intervalMin || 2, intervalMax || 5);
    }

    return { processed, success, failed };
  }

  // ==================== 采集 ====================

  async _collectFollowers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const userUrl = inputData.user_url || inputData.url;
    const username = inputData.username;
    if (!userUrl && !username) throw new Error('缺少 user_url 或 username');

    const targetUrl = userUrl || `https://www.tiktok.com/@${username}`;

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      // 点击粉丝数量打开粉丝列表
      const sel = this.selectors.profile;
      const followersTab = await page.$(sel.followers_tab);
      if (followersTab) {
        await followersTab.click();
        await this._randomDelay(2, 4);
      }

      const fSel = this.selectors.followers;
      return await this._scrollAndCollect(page, fSel.follower_card, async (card) => {
        const nameEl = await card.$(fSel.follower_name);
        const usernameEl = await card.$(fSel.follower_username);
        const linkEl = await card.$(fSel.follower_link);

        const displayName = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const uname = usernameEl ? await usernameEl.evaluate(el => el.textContent.trim().replace(/^@/, '')) : null;
        const profileUrl = linkEl ? await linkEl.evaluate(el => el.href) : null;

        const extractedUsername = uname || this._extractUsernameFromUrl(profileUrl);
        if (!extractedUsername && !displayName) return null;

        return {
          external_id: extractedUsername || displayName,
          username: extractedUsername,
          display_name: displayName,
          profile_url: profileUrl || (extractedUsername ? `https://www.tiktok.com/@${extractedUsername}` : null),
          data_type: 'follower',
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectVideoCommenters(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const videoUrl = inputData.video_url || inputData.url;
    if (!videoUrl) throw new Error('缺少 video_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      // 展开更多评论
      const cSel = this.selectors.video_commenters;
      for (let i = 0; i < 15; i++) {
        const moreBtn = await page.$(cSel.view_more_comments);
        if (!moreBtn) break;
        await moreBtn.click();
        await this._randomDelay(1, 3);
      }

      return await this._scrollAndCollect(page, cSel.comment_block, async (card) => {
        const nameEl = await card.$(cSel.commenter_name);
        const linkEl = await card.$(cSel.commenter_link);
        const textEl = await card.$(cSel.comment_text);

        const displayName = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const profileUrl = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const commentText = textEl ? await textEl.evaluate(el => el.textContent.trim()) : '';

        const username = this._extractUsernameFromUrl(profileUrl) || (displayName ? displayName.replace(/^@/, '') : null);
        if (!username && !displayName) return null;

        return {
          external_id: username || displayName,
          username: username,
          display_name: displayName,
          profile_url: profileUrl || (username ? `https://www.tiktok.com/@${username}` : null),
          data_type: 'video_commenter',
          raw: { comment_text: commentText },
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectHashtagUsers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const hashtag = (inputData.hashtag || inputData.tag || '').replace(/^#/, '');
    const hashtagUrl = inputData.hashtag_url || inputData.url;
    if (!hashtag && !hashtagUrl) throw new Error('缺少 hashtag 或 hashtag_url');

    const targetUrl = hashtagUrl || `https://www.tiktok.com/tag/${encodeURIComponent(hashtag)}`;

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const hSel = this.selectors.hashtag;
      return await this._scrollAndCollect(page, hSel.video_card, async (card) => {
        const authorLinkEl = await card.$(hSel.author_link);
        const authorNameEl = await card.$(hSel.author_name);

        const profileUrl = authorLinkEl ? await authorLinkEl.evaluate(el => el.href) : null;
        const displayName = authorNameEl ? await authorNameEl.evaluate(el => el.textContent.trim()) : null;

        const username = this._extractUsernameFromUrl(profileUrl) || (displayName ? displayName.replace(/^@/, '') : null);
        if (!username) return null;

        return {
          external_id: username,
          username: username,
          display_name: displayName || username,
          profile_url: profileUrl || `https://www.tiktok.com/@${username}`,
          data_type: 'hashtag_user',
          raw: { hashtag },
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  // ==================== 群控操作 ====================

  async _batchAction(context, actionFn) {
    const { accountIds, sourceData, inputData, intervalMin, intervalMax, dailyLimit, onProgress, onItem } = context;
    const targets = (sourceData || []).map(d => ({
      profile_url: d.profile_url,
      username: d.username,
      external_id: d.external_id,
      display_name: d.display_name,
    }));

    if (inputData.targets && Array.isArray(inputData.targets)) {
      targets.push(...inputData.targets);
    }

    if (targets.length === 0) throw new Error('无操作目标，请提供 sourceData 或 inputData.targets');

    let processed = 0, success = 0, failed = 0;
    const accountPool = accountIds.length > 0 ? accountIds : ['default'];
    let accountIndex = 0;

    for (const target of targets) {
      if (dailyLimit && processed >= dailyLimit) break;

      const accountId = accountPool[accountIndex % accountPool.length];
      accountIndex++;

      const { instanceId, page } = await this._acquireBrowser(accountId);
      try {
        const ok = await actionFn(page, target, inputData, accountId);
        processed++;
        if (ok) success++; else failed++;

        onItem({
          accountId,
          target: target.profile_url || target.username,
          success: ok,
          actionData: { target: target.display_name || target.username },
          result: { ok },
        });
        onProgress(processed, success, failed);
      } catch (e) {
        processed++;
        failed++;
        onItem({
          accountId,
          target: target.profile_url || target.username,
          success: false,
          result: { error: e.message },
        });
        onProgress(processed, success, failed);
      } finally {
        this._releaseBrowser(instanceId);
      }

      await this._randomDelay(intervalMin || 30, intervalMax || 120);
    }

    return { processed, success, failed };
  }

  async _batchFollow(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url || (target.username ? `https://www.tiktok.com/@${target.username}` : null);
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      const sel = this.selectors.actions;
      const followBtn = await page.$(sel.follow_button);
      if (!followBtn) return false;

      // 检查是否已关注（按钮文字含 Following 则跳过）
      const btnText = await followBtn.evaluate(el => el.textContent.trim().toLowerCase());
      if (btnText.includes('following') || btnText.includes('已关注')) return false;

      await followBtn.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }

  async _batchLike(context) {
    const { inputData } = context;

    return this._batchAction(context, async (page, target) => {
      // 支持直接传视频URL，或者去用户主页点赞最新视频
      const videoUrl = target.video_url || inputData.video_url;
      const profileUrl = target.profile_url || (target.username ? `https://www.tiktok.com/@${target.username}` : null);
      const url = videoUrl || profileUrl;
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      // 如果是用户主页，先点击第一个视频
      if (!videoUrl && profileUrl) {
        const videoLink = await page.$('div[data-e2e="user-post-item"] a, div[class*="DivItemContainer"] a');
        if (videoLink) {
          await videoLink.click();
          await this._randomDelay(2, 4);
        }
      }

      const sel = this.selectors.actions;
      const likeBtn = await page.$(sel.like_button);
      if (!likeBtn) return false;

      // 检查是否已点赞
      const isLiked = await likeBtn.evaluate(el => {
        const svg = el.querySelector('svg');
        const color = svg ? getComputedStyle(svg).color : '';
        return color.includes('rgb(254') || el.classList.toString().includes('liked');
      }).catch(() => false);

      if (isLiked) return false;

      await likeBtn.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }

  async _batchComment(context) {
    const { inputData } = context;
    const comments = inputData.comments || [inputData.comment];
    if (!comments || comments.length === 0 || !comments[0]) throw new Error('缺少 comment/comments 参数');

    let commentIndex = 0;
    return this._batchAction(context, async (page, target) => {
      const videoUrl = target.video_url || inputData.video_url;
      const profileUrl = target.profile_url || (target.username ? `https://www.tiktok.com/@${target.username}` : null);
      const url = videoUrl || profileUrl;
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);

      // 如果是用户主页，先点击第一个视频
      if (!videoUrl && profileUrl) {
        const videoLink = await page.$('div[data-e2e="user-post-item"] a, div[class*="DivItemContainer"] a');
        if (videoLink) {
          await videoLink.click();
          await this._randomDelay(2, 4);
        }
      }

      await this._humanScroll(page);

      const sel = this.selectors.actions;
      const commentInput = await page.$(sel.comment_input);
      if (!commentInput) return false;

      const text = comments[commentIndex % comments.length];
      commentIndex++;

      await commentInput.click();
      await this._randomDelay(0.3, 0.8);

      // TikTok 评论框通常是 contenteditable div
      await page.evaluate((selector, t) => {
        const el = document.querySelector(selector);
        if (el) {
          el.focus();
          el.textContent = t;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, sel.comment_input, text);

      await this._randomDelay(0.5, 1);

      const postBtn = await page.$(sel.comment_post);
      if (postBtn) {
        await postBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await this._randomDelay(1, 2);
      return true;
    });
  }

  async _batchDM(context) {
    const { inputData } = context;
    const message = inputData.message;
    if (!message) throw new Error('缺少 message 参数');

    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url || (target.username ? `https://www.tiktok.com/@${target.username}` : null);
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      const sel = this.selectors.actions;

      // 尝试找到私信按钮（TikTok 用户主页可能有消息入口）
      let dmBtn = await page.$(sel.dm_button);

      if (!dmBtn) {
        // 如果主页没有私信按钮，直接导航到消息页面
        await page.goto('https://www.tiktok.com/messages', { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(2, 4);

        // 搜索用户发起新对话
        const searchInput = await page.$(sel.search_input);
        if (!searchInput) return false;

        const username = target.username || this._extractUsernameFromUrl(target.profile_url);
        if (!username) return false;

        await this._humanType(page, sel.search_input, username);
        await this._randomDelay(1, 3);

        // 点击搜索结果
        const result = await page.$(sel.user_search_result);
        if (!result) return false;

        await result.click();
        await this._randomDelay(1, 3);
      } else {
        await dmBtn.click();
        await this._randomDelay(2, 4);
      }

      // 输入消息
      const msgInput = await page.$(sel.dm_input);
      if (!msgInput) return false;

      await this._humanType(page, sel.dm_input, message);
      await this._randomDelay(0.5, 1);

      const sendBtn = await page.$(sel.dm_send);
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await this._randomDelay(1, 2);
      return true;
    });
  }

  // ==================== 通过官方API发布视频 ====================
  async _publishVideo(context) {
    const { video_path, title, privacy_level } = context;
    if (!video_path) throw new Error('缺少 video_path 参数');
    if (!fs.existsSync(video_path)) throw new Error('视频文件不存在: ' + video_path);
    
    const SocialPublisher = require('../../social-publisher');
    const OAuthManager = require('../../oauth-manager');
    const oauthMgr = new OAuthManager(this.db);
    const publisher = new SocialPublisher(oauthMgr, this.db);
    
    const result = await publisher.publishToTikTok(video_path, {
      title: title || '产品视频',
      privacyLevel: privacy_level || 'PUBLIC_TO_EVERYONE'
    });
    
    return {
      success: true,
      action: 'publish_video',
      data: result,
      message: `视频已通过TikTok API发布: ${title || video_path}`
    };
  }
}

// 注入拟人行为 Mixin
const _inst_proto = TikTokExecutor.prototype;
if (_inst_proto._humanScroll) {
  // Mixin 在实例化时通过 execute 包装注入
}

const _origConstructor = TikTokExecutor;
function TikTokExecutorWrapped(db) {
  const inst = new _origConstructor(db);
  applyHumanMixin(inst);
  return inst;
}
TikTokExecutorWrapped.prototype = _origConstructor.prototype;

module.exports = TikTokExecutorWrapped;
