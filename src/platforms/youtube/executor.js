/**
 * YouTubeExecutor - YouTube 平台执行器
 * 
 * 支持:
 *   采集: collect_subscribers, collect_video_commenters, collect_channel_videos
 *   群控: batch_subscribe, batch_like, batch_comment
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class YouTubeExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'youtube';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    const { action } = context;
    const handlers = {
      collect_subscribers: () => this._collectSubscribers(context),
      collect_video_commenters: () => this._collectVideoCommenters(context),
      collect_channel_videos: () => this._collectChannelVideos(context),
      batch_subscribe: () => this._batchSubscribe(context),
      batch_like: () => this._batchLike(context),
      batch_comment: () => this._batchComment(context),
    };
    const handler = handlers[action];
    if (!handler) throw new Error('YouTube 不支持的 action: ' + action);
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

  _extractChannelId(url) {
    if (!url) return null;
    const m = url.match(/youtube\.com\/(?:channel\/|@|c\/|user\/)([^\/?]+)/);
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

  async _collectSubscribers(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const channelUrl = inputData.channel_url || inputData.url;
    if (!channelUrl) throw new Error('缺少 channel_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(channelUrl.replace(/\/$/, '') + '/channels', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);
      const sel = this.selectors.subscribers;
      return await this._scrollAndCollect(page, sel.subscriber_card, async (card) => {
        const nameEl = await card.$(sel.subscriber_name);
        const linkEl = await card.$(sel.subscriber_link);
        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const profileUrl = linkEl ? await linkEl.evaluate(el => el.href) : null;
        if (!name) return null;
        return { external_id: this._extractChannelId(profileUrl) || name, username: this._extractChannelId(profileUrl), display_name: name, profile_url: profileUrl, data_type: 'subscriber' };
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
      await page.evaluate(() => window.scrollBy(0, 600));
      await this._randomDelay(3, 5);
      const sel = this.selectors.video_commenters;
      return await this._scrollAndCollect(page, sel.comment_block, async (card) => {
        const nameEl = await card.$(sel.commenter_name);
        const linkEl = await card.$(sel.commenter_link || sel.commenter_avatar);
        const textEl = await card.$(sel.comment_text);
        const name = nameEl ? await nameEl.evaluate(el => el.textContent.trim()) : null;
        const profileUrl = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const commentText = textEl ? await textEl.evaluate(el => el.textContent.trim()) : '';
        if (!name) return null;
        return { external_id: this._extractChannelId(profileUrl) || name, username: name.replace('@', ''), display_name: name, profile_url: profileUrl, data_type: 'video_commenter', raw: { comment_text: commentText } };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  async _collectChannelVideos(context) {
    const { accountIds, inputData } = context;
    const accountId = accountIds[0] || 'default';
    const channelUrl = inputData.channel_url || inputData.url;
    if (!channelUrl) throw new Error('缺少 channel_url');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    try {
      await page.goto(channelUrl.replace(/\/$/, '') + '/videos', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);
      const sel = this.selectors.channel_videos;
      return await this._scrollAndCollect(page, sel.video_card, async (card) => {
        const titleEl = await card.$(sel.video_title);
        const linkEl = await card.$(sel.video_link);
        const viewsEl = await card.$(sel.video_views);
        const dateEl = await card.$(sel.video_date);
        const title = titleEl ? await titleEl.evaluate(el => el.textContent.trim()) : null;
        const videoLink = linkEl ? await linkEl.evaluate(el => el.href) : null;
        const views = viewsEl ? await viewsEl.evaluate(el => el.textContent.trim()) : '';
        const date = dateEl ? await dateEl.evaluate(el => el.textContent.trim()) : '';
        if (!title || !videoLink) return null;
        const videoId = (videoLink.match(/[?&]v=([^&]+)/) || [])[1] || videoLink;
        return { external_id: videoId, username: null, display_name: title, profile_url: videoLink, data_type: 'channel_video', raw: { views, date, title } };
      }, context);
    } finally {
      this._releaseBrowser(instanceId);
    }
  }

  // ==================== 群控操作 ====================

  async _batchSubscribe(context) {
    return this._batchAction(context, async (page, target) => {
      const url = target.profile_url;
      if (!url) return false;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(1, 3);
      await this._humanMouseMove(page);
      const btn = await page.$(this.selectors.actions.subscribe_button);
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
      await this._humanMouseMove(page);
      const btn = await page.$(this.selectors.actions.like_button);
      if (!btn) return false;
      await btn.click();
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
      await page.evaluate(() => window.scrollBy(0, 500));
      await this._randomDelay(2, 4);
      const sel = this.selectors.actions;
      // Click placeholder to open comment box
      const placeholder = await page.$(sel.comment_input);
      if (placeholder) await placeholder.click();
      await this._randomDelay(1, 2);
      const box = await page.$(sel.comment_box);
      if (!box) return false;
      const text = comments[commentIndex++ % comments.length];
      await this._humanType(page, sel.comment_box, text);
      await this._randomDelay(0.5, 1);
      const submitBtn = await page.$(sel.comment_submit);
      if (submitBtn) await submitBtn.click();
      await this._randomDelay(1, 2);
      return true;
    });
  }
}

// 注入拟人行为 Mixin
const _inst_proto = YouTubeExecutor.prototype;
if (_inst_proto._humanScroll) {
  // Mixin 在实例化时通过 execute 包装注入
}

const _origConstructor = YouTubeExecutor;
function YouTubeExecutorWrapped(db) {
  const inst = new _origConstructor(db);
  applyHumanMixin(inst);
  return inst;
}
YouTubeExecutorWrapped.prototype = _origConstructor.prototype;

module.exports = YouTubeExecutorWrapped;
