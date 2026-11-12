/**
 * InstagramExecutor - Instagram 平台执行器
 * 
 * 支持:
 *   采集: collect_followers, collect_post_likers, collect_hashtag_posts, collect_location_posts
 *   群控: batch_follow, batch_like, batch_comment, batch_dm
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class InstagramExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'instagram';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    const { action } = context;

    const handlers = {
      collect_followers: () => this._collectFollowers(context),
      collect_post_likers: () => this._collectPostLikers(context),
      collect_hashtag_posts: () => this._collectHashtagPosts(context),
      collect_location_posts: () => this._collectLocationPosts(context),
      batch_follow: () => this._batchFollow(context),
      batch_like: () => this._batchLike(context),
      batch_comment: () => this._batchComment(context),
      batch_dm: () => this._batchDM(context),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`不支持的 action: ${action}`);

    return await handler();
  }

  // ==================== 工具方法 ====================

  _randomDelay(min, max) {
    const ms = (Math.random() * (max - min) + min) * 1000;
    return new Promise(r => setTimeout(r, ms));
  }

  async _humanScroll(page, container) {
    if (container) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop += Math.floor(Math.random() * 400) + 200;
      }, container);
    } else {
      const distance = Math.floor(Math.random() * 500) + 200;
      await page.evaluate(d => window.scrollBy({ top: d, behavior: 'smooth' }), distance);
    }
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

  _extractUsername(url) {
    if (!url) return null;
    const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
    return match ? match[1] : url;
  }

  async _scrollAndCollect(page, scrollContainerSel, cardSelector, extractFn, context) {
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

      await this._humanScroll(page, scrollContainerSel);
      await this._humanMouseMove(page);
      await this._randomDelay(intervalMin || 2, intervalMax || 5);
    }

    return { processed, success, failed };
  }

  // ==================== 采集 ====================

  async _collectFollowers(context) {
    const { accountIds, inputData, onProgress, onCollected } = context;
    const accountId = accountIds[0] || 'default';
    const profileUrl = inputData.profile_url || inputData.url;
    if (!profileUrl) throw new Error('缺少 profile_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      // 点击 followers 链接打开弹窗
      const sel = this.selectors.followers;
      const followersLink = await page.$(sel.followers_link);
      if (!followersLink) throw new Error('找不到 followers 链接');
      await followersLink.click();
      await this._randomDelay(2, 4);

      // 等待弹窗出现
      await page.waitForSelector(sel.dialog, { timeout: 10000 });

      const scrollContainer = this.selectors.common.scroll_container.split(',')[0].trim();
      return await this._scrollAndCollect(page, scrollContainer, sel.follower_card, async (card) => {
        const linkEl = await card.$(sel.follower_profile_link);
        const nameEl = await card.$(sel.follower_name);

        const profileLink = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const username = this._extractUsername(profileLink);
        const displayName = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : username;

        if (!username) return null;
        return {
          external_id: username,
          username,
          display_name: displayName,
          profile_url: profileLink || `https://www.instagram.com/${username}/`,
          data_type: 'follower',
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectPostLikers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const postUrl = inputData.post_url || inputData.url;
    if (!postUrl) throw new Error('缺少 post_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      // 点击 likes 数量打开弹窗
      const sel = this.selectors.post_likers;
      const likesBtn = await page.$(sel.likes_count);
      if (!likesBtn) throw new Error('找不到点赞数链接');
      await likesBtn.click();
      await this._randomDelay(2, 4);

      await page.waitForSelector(sel.dialog, { timeout: 10000 });

      const scrollContainer = this.selectors.common.scroll_container.split(',')[0].trim();
      return await this._scrollAndCollect(page, scrollContainer, sel.liker_card, async (card) => {
        const linkEl = await card.$(sel.liker_profile_link);
        const nameEl = await card.$(sel.liker_name);

        const profileLink = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const username = this._extractUsername(profileLink);
        const displayName = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : username;

        if (!username) return null;
        return {
          external_id: username,
          username,
          display_name: displayName,
          profile_url: profileLink || `https://www.instagram.com/${username}/`,
          data_type: 'post_liker',
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectHashtagPosts(context) {
    const { accountIds, inputData, dailyLimit, intervalMin, intervalMax, onProgress, onCollected } = context;
    const accountId = accountIds[0] || 'default';
    const hashtag = (inputData.hashtag || inputData.tag || '').replace(/^#/, '');
    if (!hashtag) throw new Error('缺少 hashtag 参数');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const sel = this.selectors.hashtag_posts;
      const collected = new Set();
      let noNewCount = 0;
      let processed = 0, success = 0, failed = 0;

      while (noNewCount < 5) {
        if (dailyLimit && processed >= dailyLimit) break;

        const links = await page.$$(sel.post_link);
        let foundNew = false;

        for (const link of links) {
          if (dailyLimit && processed >= dailyLimit) break;

          try {
            const href = await link.evaluate(el => el.href);
            const postId = href.match(/\/p\/([^/]+)/)?.[1] || href.match(/\/reel\/([^/]+)/)?.[1];
            if (!postId || collected.has(postId)) continue;

            collected.add(postId);
            foundNew = true;
            processed++;
            success++;

            const imgEl = await link.$('img');
            const imgSrc = imgEl ? await imgEl.evaluate(el => el.src) : null;

            const data = {
              external_id: postId,
              post_url: href,
              thumbnail: imgSrc,
              hashtag,
              data_type: 'hashtag_post',
            };

            onCollected(data);
            onProgress(processed, success, failed);
          } catch (e) {
            processed++;
            failed++;
            onProgress(processed, success, failed);
          }
        }

        if (!foundNew) noNewCount++;
        else noNewCount = 0;

        await this._humanScroll(page);
        await this._humanMouseMove(page);
        await this._randomDelay(intervalMin || 2, intervalMax || 5);
      }

      return { processed, success, failed };
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectLocationPosts(context) {
    const { accountIds, inputData, dailyLimit, intervalMin, intervalMax, onProgress, onCollected } = context;
    const accountId = accountIds[0] || 'default';
    const locationId = inputData.location_id || inputData.id;
    const locationUrl = inputData.location_url || inputData.url;
    if (!locationId && !locationUrl) throw new Error('缺少 location_id 或 location_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      const url = locationUrl || `https://www.instagram.com/explore/locations/${locationId}/`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const sel = this.selectors.location_posts;
      const collected = new Set();
      let noNewCount = 0;
      let processed = 0, success = 0, failed = 0;

      // 获取地点名称
      const locNameEl = await page.$(sel.location_name);
      const locationName = locNameEl ? await locNameEl.evaluate(el => el.textContent.trim()) : '';

      while (noNewCount < 5) {
        if (dailyLimit && processed >= dailyLimit) break;

        const links = await page.$$(sel.post_link);
        let foundNew = false;

        for (const link of links) {
          if (dailyLimit && processed >= dailyLimit) break;

          try {
            const href = await link.evaluate(el => el.href);
            const postId = href.match(/\/p\/([^/]+)/)?.[1] || href.match(/\/reel\/([^/]+)/)?.[1];
            if (!postId || collected.has(postId)) continue;

            collected.add(postId);
            foundNew = true;
            processed++;
            success++;

            const imgEl = await link.$('img');
            const imgSrc = imgEl ? await imgEl.evaluate(el => el.src) : null;

            const data = {
              external_id: postId,
              post_url: href,
              thumbnail: imgSrc,
              location_name: locationName,
              data_type: 'location_post',
            };

            onCollected(data);
            onProgress(processed, success, failed);
          } catch (e) {
            processed++;
            failed++;
            onProgress(processed, success, failed);
          }
        }

        if (!foundNew) noNewCount++;
        else noNewCount = 0;

        await this._humanScroll(page);
        await this._humanMouseMove(page);
        await this._randomDelay(intervalMin || 2, intervalMax || 5);
      }

      return { processed, success, failed };
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
      post_url: d.post_url,
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
      const url = target.profile_url || `https://www.instagram.com/${target.username}/`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      const sel = this.selectors.actions;
      // 检查是否已关注
      const alreadyFollowing = await page.$(sel.following_button);
      if (alreadyFollowing) return true; // 已经关注了

      const followBtn = await page.$(sel.follow_button);
      if (!followBtn) return false;

      const btnText = await followBtn.evaluate(el => el.textContent.trim());
      if (btnText !== 'Follow') return false; // 避免误点

      await followBtn.click();
      await this._randomDelay(1, 2);
      return true;
    });
  }

  async _batchLike(context) {
    return this._batchAction(context, async (page, target) => {
      // 可以点赞帖子或用户主页最新帖子
      const url = target.post_url || target.profile_url || `https://www.instagram.com/${target.username}/`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      // 如果是用户主页，先点击第一个帖子
      if (!target.post_url) {
        const postLink = await page.$('article a[href*="/p/"]');
        if (!postLink) return false;
        await postLink.click();
        await this._randomDelay(1, 3);
      }

      const sel = this.selectors.actions;
      // 检查是否已点赞
      const alreadyLiked = await page.$(sel.unlike_button);
      if (alreadyLiked) return true;

      const likeBtn = await page.$(sel.like_button);
      if (!likeBtn) return false;

      await likeBtn.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }

  async _batchComment(context) {
    const { inputData } = context;
    const comments = inputData.comments || [inputData.comment];
    if (!comments || comments.length === 0) throw new Error('缺少 comment/comments 参数');

    let commentIndex = 0;
    return this._batchAction(context, async (page, target) => {
      const url = target.post_url || target.profile_url || `https://www.instagram.com/${target.username}/`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);

      // 如果是用户主页，先点击第一个帖子
      if (!target.post_url) {
        const postLink = await page.$('article a[href*="/p/"]');
        if (!postLink) return false;
        await postLink.click();
        await this._randomDelay(1, 3);
      }

      await this._humanMouseMove(page);

      const sel = this.selectors.actions;
      const commentInput = await page.$(sel.comment_input);
      if (!commentInput) return false;

      const text = comments[commentIndex % comments.length];
      commentIndex++;

      await commentInput.click();
      await this._randomDelay(0.3, 0.8);

      // Instagram 评论框通常是 textarea
      await commentInput.type(text, { delay: Math.floor(Math.random() * 100) + 30 });
      await this._randomDelay(0.5, 1);

      const submitBtn = await page.$(sel.comment_submit);
      if (submitBtn) {
        await submitBtn.click();
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
      const username = target.username || this._extractUsername(target.profile_url);
      if (!username) return false;

      // 方式1: 通过用户主页的 Message 按钮
      const profileUrl = target.profile_url || `https://www.instagram.com/${username}/`;
      await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      const sel = this.selectors.actions;

      // 尝试找 Message 按钮
      let msgBtn = await page.$(sel.dm_button);
      if (msgBtn) {
        await msgBtn.click();
        await this._randomDelay(2, 4);
      } else {
        // 方式2: 通过 Direct 页面新建对话
        await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(1, 3);

        const newMsgBtn = await page.$(sel.dm_new_message);
        if (!newMsgBtn) return false;
        await newMsgBtn.click();
        await this._randomDelay(1, 2);

        // 搜索用户
        const searchInput = await page.$(sel.dm_search_input);
        if (!searchInput) return false;

        await this._humanType(page, sel.dm_search_input, username);
        await this._randomDelay(2, 3);

        // 选择搜索结果
        const userResult = await page.$(sel.dm_user_result);
        if (!userResult) return false;
        await userResult.click();
        await this._randomDelay(0.5, 1);

        // 点击 Next
        const nextBtn = await page.$(sel.dm_next_button);
        if (nextBtn) {
          await nextBtn.click();
          await this._randomDelay(1, 2);
        }
      }

      // 输入消息
      const msgInput = await page.$(sel.dm_message_input);
      if (!msgInput) return false;

      await msgInput.click();
      await this._randomDelay(0.3, 0.8);
      await msgInput.type(message, { delay: Math.floor(Math.random() * 100) + 30 });
      await this._randomDelay(0.5, 1);

      // 发送
      const sendBtn = await page.$(sel.dm_send_button);
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await this._randomDelay(1, 2);
      return true;
    });
  }
}

// 注入拟人行为 Mixin
const _inst_proto = InstagramExecutor.prototype;
if (_inst_proto._humanScroll) {
  // Mixin 在实例化时通过 execute 包装注入
}

const _origConstructor = InstagramExecutor;
function InstagramExecutorWrapped(db) {
  const inst = new _origConstructor(db);
  applyHumanMixin(inst);
  return inst;
}
InstagramExecutorWrapped.prototype = _origConstructor.prototype;

module.exports = InstagramExecutorWrapped;
