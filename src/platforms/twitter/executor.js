/**
 * TwitterExecutor - Twitter/X 平台执行器
 * 
 * 支持:
 *   采集: collect_followers, collect_tweet_repliers, collect_hashtag_users
 *   群控: batch_follow, batch_like, batch_retweet, batch_reply, batch_dm
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class TwitterExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'twitter';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    const { action } = context;
    const handlers = {
      collect_followers: () => this._collectFollowers(context),
      collect_tweet_repliers: () => this._collectTweetRepliers(context),
      collect_hashtag_users: () => this._collectHashtagUsers(context),
      batch_follow: () => this._batchFollow(context),
      batch_like: () => this._batchLike(context),
      batch_retweet: () => this._batchRetweet(context),
      batch_reply: () => this._batchReply(context),
      batch_dm: () => this._batchDM(context),
    };
    const handler = handlers[action];
    if (!handler) throw new Error('Twitter 不支持的 action: ' + action);
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

  _extractUsername(url) {
    if (!url) return null;
    const m = url.match(/(?:twitter|x)\.com\/([^\/\?]+)/);
    return m ? m[1] : url;
  }

  async _scrollAndCollect(page, cardSelector, extractFn, context) {
    const { dailyLimit, intervalMin, intervalMax, onProgress, onCollected } = context;
    const collected = new Set();
    let noNewCount = 0, processed = 0, success = 0, failed = 0;

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
          processed++; success++;
          onCollected(data);
          onProgress(processed, success, failed);
        } catch (e) {
          processed++; failed++;
          onProgress(processed, success, failed);
        }
      }
      noNewCount = foundNew ? 0 : noNewCount + 1;
      await this._humanScroll(page);
      await this._humanMouseMove(page);
      await this._randomDelay(intervalMin || 2, intervalMax || 5);
    }
    return { processed, success, failed };
  }

  async _batchAction(context, actionFn) {
    const { accountIds, sourceData, inputData, intervalMin, intervalMax, dailyLimit, onProgress, onItem } = context;
    const targets = (sourceData || []).map(d => ({
      profile_url: d.profile_url, username: d.username,
      external_id: d.external_id, display_name: d.display_name,
    }));
    if (inputData.targets && Array.isArray(inputData.targets)) targets.push(...inputData.targets);
    if (targets.length === 0) throw new Error('无操作目标');

    let processed = 0, success = 0, failed = 0;
    const accountPool = accountIds.length > 0 ? accountIds : ['default'];
    let accountIndex = 0;

    for (const target of targets) {
      if (dailyLimit && processed >= dailyLimit) break;
      const accountId = accountPool[accountIndex++ % accountPool.length];
      const { instanceId, page } = await this._acquireBrowser(accountId);
      try {
        const ok = await actionFn(page, target, inputData, accountId);
        processed++; if (ok) success++; else failed++;
        onItem({ accountId, target: target.profile_url || target.username, success: ok, actionData: { target: target.display_name || target.username }, result: { ok } });
        onProgress(processed, success, failed);
      } catch (e) {
        processed++; failed++;
        onItem({ accountId, target: target.profile_url || target.username, success: false, result: { error: e.message } });
        onProgress(processed, success, failed);
      } finally {
        this._releaseBrowser(instanceId);
      }
      await this._randomDelay(intervalMin || 30, intervalMax || 120);
    }
    return { processed, success, failed };
  }

  // ==================== 采集 ====================

  async _collectFollowers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const profileUrl = inputData.profile_url || inputData.url;
    if (!profileUrl) throw new Error('缺少 profile_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      const username = this._extractUsername(profileUrl);
      await page.goto('https://x.com/' + username + '/followers', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);
      const sel = this.selectors.followers;
      return await this._scrollAndCollect(page, sel.follower_card, async (card) => {
        const nameEl = await card.$(sel.follower_name);
        const linkEl = await card.$(sel.follower_link);
        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const link = linkEl ? await linkEl.evaluate(el => el.href) : null;
        if (!name) return null;
        const uname = this._extractUsername(link);
        return { external_id: uname || name, username: uname, display_name: name, profile_url: link || ('https://x.com/' + uname), data_type: 'follower' };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectTweetRepliers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const tweetUrl = inputData.tweet_url || inputData.url;
    if (!tweetUrl) throw new Error('缺少 tweet_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);
      const sel = this.selectors.tweet_repliers;
      return await this._scrollAndCollect(page, sel.reply_block, async (card) => {
        const nameEl = await card.$(sel.replier_name);
        const linkEl = await card.$(sel.replier_link);
        const textEl = await card.$(sel.reply_text);
        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const link = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const replyText = textEl ? await textEl.evaluate(el => el.textContent.trim()) : '';
        if (!name) return null;
        const uname = this._extractUsername(link);
        return { external_id: uname || name, username: uname, display_name: name, profile_url: link, data_type: 'tweet_replier', raw: { reply_text: replyText } };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectHashtagUsers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const hashtag = (inputData.hashtag || inputData.url || '').replace('#', '');
    if (!hashtag) throw new Error('缺少 hashtag');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto('https://x.com/search?q=%23' + encodeURIComponent(hashtag) + '&src=typed_query', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);
      const sel = this.selectors.hashtag;
      return await this._scrollAndCollect(page, sel.tweet_card, async (card) => {
        const nameEl = await card.$(sel.user_name);
        const linkEl = await card.$(sel.user_link);
        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const link = linkEl ? await linkEl.evaluate(el => el.href) : null;
        if (!name) return null;
        const uname = this._extractUsername(link);
        return { external_id: uname || name, username: uname, display_name: name, profile_url: link, data_type: 'hashtag_user' };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  // ==================== 群控操作 ====================

  async _batchFollow(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url || ('https://x.com/' + target.username);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);
      const btn = await page.$(this.selectors.actions.follow_button);
      if (!btn) return false;
      await btn.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }

  async _batchLike(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url;
      if (!url) return false;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      const btn = await page.$(this.selectors.actions.like_button);
      if (!btn) return false;
      await btn.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }

  async _batchRetweet(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url;
      if (!url) return false;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      const sel = this.selectors.actions;
      const btn = await page.$(sel.retweet_button);
      if (!btn) return false;
      await btn.click();
      await this._randomDelay(0.5, 1);
      const confirm = await page.$(sel.retweet_confirm);
      if (confirm) await confirm.click();
      await this._randomDelay(0.5, 1.5);
      return true;
    });
  }

  async _batchReply(context) {
    const { inputData } = context;
    const replies = inputData.replies || inputData.comments || [inputData.reply || inputData.comment];
    if (!replies || replies.length === 0) throw new Error('缺少 reply/replies 参数');
    let replyIndex = 0;
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url;
      if (!url) return false;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      const sel = this.selectors.actions;
      const replyBtn = await page.$(sel.reply_button);
      if (replyBtn) await replyBtn.click();
      await this._randomDelay(1, 2);
      const input = await page.$(sel.reply_input);
      if (!input) return false;
      const text = replies[replyIndex++ % replies.length];
      await this._humanType(page, sel.reply_input, text);
      await this._randomDelay(0.5, 1);
      const submit = await page.$(sel.reply_submit);
      if (submit) await submit.click();
      await this._randomDelay(1, 2);
      return true;
    });
  }

  async _batchDM(context) {
    const { inputData } = context;
    const message = inputData.message;
    if (!message) throw new Error('缺少 message 参数');
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url || ('https://x.com/' + target.username);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);
      const sel = this.selectors.actions;
      const dmBtn = await page.$(sel.dm_button);
      if (!dmBtn) return false;
      await dmBtn.click();
      await this._randomDelay(2, 4);
      const input = await page.$(sel.dm_input);
      if (!input) return false;
      await this._humanType(page, sel.dm_input, message);
      await this._randomDelay(0.5, 1);
      const send = await page.$(sel.dm_send);
      if (send) await send.click();
      await this._randomDelay(1, 2);
      return true;
    });
  }
}

// 注入拟人行为 Mixin
const _inst_proto = TwitterExecutor.prototype;
if (_inst_proto._humanScroll) {
  // Mixin 在实例化时通过 execute 包装注入
}

const _origConstructor = TwitterExecutor;
function TwitterExecutorWrapped(db) {
  const inst = new _origConstructor(db);
  applyHumanMixin(inst);
  return inst;
}
TwitterExecutorWrapped.prototype = _origConstructor.prototype;

module.exports = TwitterExecutorWrapped;
