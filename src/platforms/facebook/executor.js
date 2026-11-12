/**
 * FacebookExecutor - Facebook 平台执行器
 * 
 * 支持:
 *   采集: collect_group_members, collect_page_followers, collect_post_commenters
 *   群控: batch_dm, batch_like, batch_comment, batch_follow
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class FacebookExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'facebook';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    const { action } = context;

    const handlers = {
      collect_group_members: () => this._collectGroupMembers(context),
      collect_page_followers: () => this._collectPageFollowers(context),
      collect_post_commenters: () => this._collectPostCommenters(context),
      batch_dm: () => this._batchDM(context),
      batch_like: () => this._batchLike(context),
      batch_comment: () => this._batchComment(context),
      batch_follow: () => this._batchFollow(context),
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

  _extractIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/facebook\.com\/(?:profile\.php\?id=(\d+)|([a-zA-Z0-9.]+))/);
    return match ? (match[1] || match[2]) : url;
  }

  // ==================== 采集 ====================

  async _collectGroupMembers(context) {
    const { accountIds, inputData, onProgress, onCollected } = context;
    const accountId = accountIds[0] || 'default';
    const groupUrl = inputData.group_url || inputData.url;
    if (!groupUrl) throw new Error('缺少 group_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      const membersUrl = groupUrl.replace(/\/$/, '') + '/members';
      await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const sel = this.selectors.group_members;
      return await this._scrollAndCollect(page, sel.member_card, async (card) => {
        const nameEl = await card.$(sel.member_name || 'span');
        const linkEl = await card.$(sel.member_profile_link || 'a');

        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const profileUrl = linkEl ? await linkEl.evaluate(el => el.href) : null;

        if (!name) return null;
        return {
          external_id: this._extractIdFromUrl(profileUrl) || name,
          username: this._extractIdFromUrl(profileUrl),
          display_name: name,
          profile_url: profileUrl,
          data_type: 'group_member',
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectPageFollowers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const pageUrl = inputData.page_url || inputData.url;
    if (!pageUrl) throw new Error('缺少 page_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      const followersUrl = pageUrl.replace(/\/$/, '') + '/followers';
      await page.goto(followersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const sel = this.selectors.page_followers;
      return await this._scrollAndCollect(page, sel.follower_card, async (card) => {
        const nameEl = await card.$('span');
        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const profileUrl = await card.evaluate(el => el.href || '');

        if (!name) return null;
        return {
          external_id: this._extractIdFromUrl(profileUrl) || name,
          username: this._extractIdFromUrl(profileUrl),
          display_name: name,
          profile_url: profileUrl,
          data_type: 'page_follower',
        };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectPostCommenters(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const postUrl = inputData.post_url || inputData.url;
    if (!postUrl) throw new Error('缺少 post_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      // 展开更多评论
      const sel = this.selectors.post_commenters;
      for (let i = 0; i < 10; i++) {
        const moreBtn = await page.$(sel.view_more_comments);
        if (!moreBtn) break;
        await moreBtn.click();
        await this._randomDelay(1, 3);
      }

      return await this._scrollAndCollect(page, sel.comment_block, async (card) => {
        const nameEl = await card.$(sel.commenter_name);
        const linkEl = await card.$(sel.commenter_profile_link);
        const textEl = await card.$(sel.comment_text);

        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const profileUrl = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const commentText = textEl ? await textEl.evaluate(el => el.textContent.trim()) : '';

        if (!name) return null;
        return {
          external_id: this._extractIdFromUrl(profileUrl) || name,
          username: this._extractIdFromUrl(profileUrl),
          display_name: name,
          profile_url: profileUrl,
          data_type: 'post_commenter',
          raw: { comment_text: commentText },
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

    // 也支持从 inputData.targets 传入
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

  async _batchDM(context) {
    const { inputData } = context;
    const message = inputData.message;
    if (!message) throw new Error('缺少 message 参数');

    return this._batchAction(context, async (page, target) => {
      const profileUrl = target.profile_url;
      if (!profileUrl) return false;

      await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      const sel = this.selectors.actions;
      const msgBtn = await page.$(sel.message_button);
      if (!msgBtn) return false;

      await msgBtn.click();
      await this._randomDelay(2, 4);

      const input = await page.$(sel.message_input);
      if (!input) return false;

      await this._humanType(page, sel.message_input, message);
      await this._randomDelay(0.5, 1);
      await page.keyboard.press('Enter');
      await this._randomDelay(1, 2);
      return true;
    });
  }

  async _batchLike(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url;
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanScroll(page);
      await this._humanMouseMove(page);

      // 找到第一个帖子的 Like 按钮并点击
      const sel = this.selectors.actions;
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
      const url = target.profile_url;
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanScroll(page);

      const sel = this.selectors.actions;
      const commentInput = await page.$(sel.comment_input);
      if (!commentInput) return false;

      const text = comments[commentIndex % comments.length];
      commentIndex++;

      await this._humanType(page, sel.comment_input, text);
      await this._randomDelay(0.5, 1);
      await page.keyboard.press('Enter');
      await this._randomDelay(1, 2);
      return true;
    });
  }

  async _batchFollow(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url;
      if (!url) return false;

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);

      const sel = this.selectors.actions;
      // 先试 Follow，再试 Add Friend
      let btn = await page.$(sel.follow_button);
      if (!btn) btn = await page.$(sel.add_friend_button);
      if (!btn) return false;

      await btn.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }
}

// 注入拟人行为 Mixin
const _inst_proto = FacebookExecutor.prototype;
if (_inst_proto._humanScroll) {
  // Mixin 在实例化时通过 execute 包装注入
}

const _origConstructor = FacebookExecutor;
function FacebookExecutorWrapped(db) {
  const inst = new _origConstructor(db);
  applyHumanMixin(inst);
  return inst;
}
FacebookExecutorWrapped.prototype = _origConstructor.prototype;

module.exports = FacebookExecutorWrapped;
