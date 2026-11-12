/**
 * ThreadsExecutor - Threads (Meta) 平台执行器
 * 
 * 支持:
 *   采集: collect_followers, collect_post_repliers
 *   群发: batch_follow, batch_like, batch_reply
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class ThreadsExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'threads';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    this._currentContext = context;
    const { action } = context;

    const handlers = {
      collect_followers: () => this._collectFollowers(context),
      collect_post_repliers: () => this._collectPostRepliers(context),
      batch_follow: () => this._batchFollow(context),
      batch_like: () => this._batchLike(context),
      batch_reply: () => this._batchReply(context),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`threads: 不支持的 action: ${action}`);
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

  // ==================== 采集: 粉丝 ====================

  async _collectFollowers(context) {
    const { accountIds, inputData, dailyLimit, intervalMin = 2, intervalMax = 5, onProgress, onItem, onCollected } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const { targetUser, maxResults = 200 } = inputData;

    if (!targetUser) throw new Error('缺少 targetUser 参数');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      const profileUrl = targetUser.startsWith('http') ? targetUser : `https://www.threads.net/@${targetUser}`;
      await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      // 点击粉丝链接
      const sel = this.selectors.followers;
      const followersLink = await page.$(sel.followers_link);
      if (!followersLink) throw new Error('未找到粉丝链接，可能需要登录或用户不存在');
      await followersLink.click();
      await this._randomDelay(2, 3);

      // 等待弹窗
      await page.waitForSelector(sel.dialog, { timeout: 10000 }).catch(() => {});

      const collected = new Set();
      let noNewCount = 0;

      while (noNewCount < 5 && processed < (dailyLimit || maxResults)) {
        const cards = await page.$$(sel.follower_card);
        let foundNew = false;

        for (const card of cards) {
          if (processed >= (dailyLimit || maxResults)) break;

          try {
            const username = await card.$eval(sel.follower_username, el => {
              const href = el.getAttribute('href') || '';
              const match = href.match(/@([^/]+)/);
              return match ? match[1] : el.textContent.trim().replace('@', '');
            }).catch(() => null);

            if (!username || collected.has(username)) continue;
            collected.add(username);
            foundNew = true;
            processed++;
            success++;

            const displayName = await card.$eval(sel.follower_name, el => el.textContent.trim()).catch(() => username);

            onCollected({
              data_type: 'user',
              external_id: `threads_${username}`,
              username,
              display_name: displayName,
              profile_url: `https://www.threads.net/@${username}`,
            });

            onItem({ target: username, success: true, result: { username, displayName } });
            onProgress(processed, success, failed);
          } catch (e) {
            failed++;
            onProgress(processed, success, failed);
          }
        }

        if (!foundNew) noNewCount++;
        else noNewCount = 0;

        await this._humanScroll(page);
        await this._randomDelay(intervalMin, intervalMax);
      }
    } catch (e) {
      console.error('[Threads] 采集粉丝失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }

  // ==================== 采集: 帖子回复者 ====================

  async _collectPostRepliers(context) {
    const { accountIds, inputData, dailyLimit, intervalMin = 2, intervalMax = 5, onProgress, onItem, onCollected } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const { postUrl, maxResults = 200 } = inputData;

    if (!postUrl) throw new Error('缺少 postUrl 参数');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const sel = this.selectors.post_repliers;
      const collected = new Set();
      let noNewCount = 0;

      while (noNewCount < 5 && processed < (dailyLimit || maxResults)) {
        const cards = await page.$$(sel.reply_card);
        let foundNew = false;

        for (const card of cards) {
          if (processed >= (dailyLimit || maxResults)) break;

          try {
            const username = await card.$eval(sel.replier_username, el => {
              const href = el.getAttribute('href') || '';
              const match = href.match(/@([^/]+)/);
              return match ? match[1] : el.textContent.trim().replace('@', '');
            }).catch(() => null);

            if (!username || collected.has(username)) continue;
            collected.add(username);
            foundNew = true;
            processed++;
            success++;

            const displayName = await card.$eval(sel.replier_name, el => el.textContent.trim()).catch(() => username);

            onCollected({
              data_type: 'user',
              external_id: `threads_${username}`,
              username,
              display_name: displayName,
              profile_url: `https://www.threads.net/@${username}`,
            });

            onItem({ target: username, success: true, result: { username, displayName } });
            onProgress(processed, success, failed);
          } catch (e) {
            failed++;
            onProgress(processed, success, failed);
          }
        }

        if (!foundNew) noNewCount++;
        else noNewCount = 0;

        await this._humanScroll(page);
        await this._randomDelay(intervalMin, intervalMax);
      }
    } catch (e) {
      console.error('[Threads] 采集回复者失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }

  // ==================== 群发: 关注 ====================

  async _batchFollow(context) {
    const { accountIds, sourceData, inputData, intervalMin = 30, intervalMax = 60, dailyLimit, onProgress, onItem } = context;
    const accountPool = (accountIds && accountIds.length) ? accountIds : ['default'];
    const targets = sourceData || inputData.targets || [];

    let processed = 0, success = 0, failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (dailyLimit && processed >= dailyLimit) break;

      const target = targets[i];
      const username = typeof target === 'string' ? target : (target.username || target.external_id);
      const accountId = accountPool[i % accountPool.length];
      const { instanceId, page } = await this._acquireBrowser(accountId);

      try {
        const profileUrl = username.startsWith('http') ? username : `https://www.threads.net/@${username}`;
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(1, 3);
        await this._humanMouseMove(page);

        // 查找关注按钮（排除已关注状态）
        const sel = this.selectors.actions;
        const alreadyFollowing = await page.$(sel.following_button);
        if (alreadyFollowing) {
          processed++;
          onItem({ accountId, target: username, success: true, result: { action: 'already_following' } });
          onProgress(processed, ++success, failed);
          this._releaseBrowser(instanceId);
          continue;
        }

        const followBtn = await page.$(sel.follow_button);
        if (followBtn) {
          await followBtn.click();
          await this._randomDelay(1, 2);
          processed++;
          success++;
          onItem({ accountId, target: username, success: true, result: { action: 'followed' } });
        } else {
          processed++;
          failed++;
          onItem({ accountId, target: username, success: false, result: { error: '未找到关注按钮' } });
        }

        onProgress(processed, success, failed);
      } catch (e) {
        processed++;
        failed++;
        onItem({ accountId, target: username, success: false, result: { error: e.message } });
        onProgress(processed, success, failed);
      } finally {
        this._releaseBrowser(instanceId);
      }

      await this._randomDelay(intervalMin, intervalMax);
    }

    return { total: processed, success, failed };
  }

  // ==================== 群发: 点赞 ====================

  async _batchLike(context) {
    const { accountIds, sourceData, inputData, intervalMin = 15, intervalMax = 40, dailyLimit, onProgress, onItem } = context;
    const accountPool = (accountIds && accountIds.length) ? accountIds : ['default'];
    const targets = sourceData || inputData.targets || [];

    let processed = 0, success = 0, failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (dailyLimit && processed >= dailyLimit) break;

      const target = targets[i];
      const postUrl = typeof target === 'string' ? target : (target.profile_url || target.url);
      const accountId = accountPool[i % accountPool.length];
      const { instanceId, page } = await this._acquireBrowser(accountId);

      try {
        await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(1, 3);
        await this._humanMouseMove(page);

        const sel = this.selectors.actions;
        const alreadyLiked = await page.$(sel.unlike_button);
        if (alreadyLiked) {
          processed++;
          onItem({ accountId, target: postUrl, success: true, result: { action: 'already_liked' } });
          onProgress(processed, ++success, failed);
          this._releaseBrowser(instanceId);
          continue;
        }

        const likeBtn = await page.$(sel.like_button);
        if (likeBtn) {
          await likeBtn.click();
          await this._randomDelay(0.5, 1.5);
          processed++;
          success++;
          onItem({ accountId, target: postUrl, success: true, result: { action: 'liked' } });
        } else {
          processed++;
          failed++;
          onItem({ accountId, target: postUrl, success: false, result: { error: '未找到点赞按钮' } });
        }

        onProgress(processed, success, failed);
      } catch (e) {
        processed++;
        failed++;
        onItem({ accountId, target: postUrl, success: false, result: { error: e.message } });
        onProgress(processed, success, failed);
      } finally {
        this._releaseBrowser(instanceId);
      }

      await this._randomDelay(intervalMin, intervalMax);
    }

    return { total: processed, success, failed };
  }

  // ==================== 群发: 回复 ====================

  async _batchReply(context) {
    const { accountIds, sourceData, inputData, intervalMin = 30, intervalMax = 90, dailyLimit, onProgress, onItem } = context;
    const accountPool = (accountIds && accountIds.length) ? accountIds : ['default'];
    const targets = sourceData || inputData.targets || [];
    const replyTexts = inputData.texts || inputData.comments || ['Thanks!'];

    let processed = 0, success = 0, failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (dailyLimit && processed >= dailyLimit) break;

      const target = targets[i];
      const postUrl = typeof target === 'string' ? target : (target.profile_url || target.url);
      const accountId = accountPool[i % accountPool.length];
      const replyText = replyTexts[i % replyTexts.length];
      const { instanceId, page } = await this._acquireBrowser(accountId);

      try {
        await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(2, 4);
        await this._humanMouseMove(page);

        const sel = this.selectors.actions;
        const replyInput = await page.$(sel.reply_input);
        if (!replyInput) {
          throw new Error('未找到回复输入框');
        }

        await this._humanType(page, sel.reply_input, replyText);
        await this._randomDelay(1, 2);

        const submitBtn = await page.$(sel.reply_submit);
        if (submitBtn) {
          await submitBtn.click();
          await this._randomDelay(2, 4);
          processed++;
          success++;
          onItem({ accountId, target: postUrl, success: true, result: { action: 'replied', text: replyText } });
        } else {
          // 尝试Enter提交
          await page.keyboard.press('Enter');
          await this._randomDelay(2, 4);
          processed++;
          success++;
          onItem({ accountId, target: postUrl, success: true, result: { action: 'replied', text: replyText } });
        }

        onProgress(processed, success, failed);
      } catch (e) {
        processed++;
        failed++;
        onItem({ accountId, target: postUrl, success: false, result: { error: e.message } });
        onProgress(processed, success, failed);
      } finally {
        this._releaseBrowser(instanceId);
      }

      await this._randomDelay(intervalMin, intervalMax);
    }

    return { total: processed, success, failed };
  }
}

// 应用拟人行为Mixin
applyHumanMixin(ThreadsExecutor.prototype);

module.exports = ThreadsExecutor;
