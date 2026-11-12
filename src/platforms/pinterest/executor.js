/**
 * PinterestExecutor - Pinterest 平台执行器
 * 
 * 支持:
 *   采集: collect_pins, collect_board_followers
 *   群发: batch_follow, batch_save, batch_comment
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class PinterestExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'pinterest';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    this._currentContext = context;
    const { action } = context;

    const handlers = {
      collect_pins: () => this._collectPins(context),
      collect_board_followers: () => this._collectBoardFollowers(context),
      batch_follow: () => this._batchFollow(context),
      batch_save: () => this._batchSave(context),
      batch_pin: () => this._batchSave(context), // alias
      batch_comment: () => this._batchComment(context),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`pinterest: 不支持的 action: ${action}`);
    return await handler();
  }

  // ==================== 工具方法 ====================

  _randomDelay(min, max) {
    const ms = (Math.random() * (max - min) + min) * 1000;
    return new Promise(r => setTimeout(r, ms));
  }

  async _humanScroll(page) {
    const distance = Math.floor(Math.random() * 600) + 300;
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

  // ==================== 采集: Pins ====================

  async _collectPins(context) {
    const { accountIds, inputData, dailyLimit, intervalMin = 1, intervalMax = 3, onProgress, onItem, onCollected } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const { keyword, boardUrl, maxResults = 200 } = inputData;

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      // 搜索或打开board
      if (boardUrl) {
        await page.goto(boardUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      } else if (keyword) {
        await page.goto(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle2', timeout: 30000 });
      } else {
        throw new Error('缺少 keyword 或 boardUrl 参数');
      }

      await this._randomDelay(2, 4);

      const sel = this.selectors.pins;
      const collected = new Set();
      let noNewCount = 0;

      while (noNewCount < 5 && processed < (dailyLimit || maxResults)) {
        const pins = await page.$$(sel.pin_card);
        let foundNew = false;

        for (const pin of pins) {
          if (processed >= (dailyLimit || maxResults)) break;

          try {
            const pinLink = await pin.$eval(sel.pin_link, el => el.getAttribute('href')).catch(() => null);
            if (!pinLink || collected.has(pinLink)) continue;
            collected.add(pinLink);
            foundNew = true;
            processed++;
            success++;

            const pinId = pinLink.match(/\/pin\/(\d+)/)?.[1] || pinLink;
            const title = await pin.$eval(sel.pin_title, el => el.textContent.trim()).catch(() => '');
            const imageUrl = await pin.$eval(sel.pin_image, el => el.src || el.getAttribute('srcset')?.split(' ')[0]).catch(() => '');

            onCollected({
              data_type: 'pin',
              external_id: `pinterest_${pinId}`,
              display_name: title || `Pin ${pinId}`,
              profile_url: `https://www.pinterest.com${pinLink}`,
              raw: { pinId, title, imageUrl }
            });

            onItem({ target: pinId, success: true, result: { pinId, title } });
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
      console.error('[Pinterest] 采集Pins失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }

  // ==================== 采集: Board粉丝 ====================

  async _collectBoardFollowers(context) {
    const { accountIds, inputData, dailyLimit, intervalMin = 2, intervalMax = 5, onProgress, onItem, onCollected } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const { boardUrl, targetUser, maxResults = 200 } = inputData;

    if (!boardUrl && !targetUser) throw new Error('缺少 boardUrl 或 targetUser');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      const url = boardUrl || `https://www.pinterest.com/${targetUser}/followers/`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2, 4);

      const sel = this.selectors.board_followers;
      const collected = new Set();
      let noNewCount = 0;

      while (noNewCount < 5 && processed < (dailyLimit || maxResults)) {
        const cards = await page.$$(sel.follower_card);
        let foundNew = false;

        for (const card of cards) {
          if (processed >= (dailyLimit || maxResults)) break;

          try {
            const profileLink = await card.$eval(sel.follower_profile_link, el => el.getAttribute('href')).catch(() => null);
            if (!profileLink || collected.has(profileLink)) continue;
            collected.add(profileLink);
            foundNew = true;
            processed++;
            success++;

            const username = profileLink.replace(/^\/|\/$/g, '');
            const displayName = await card.$eval(sel.follower_name, el => el.textContent.trim()).catch(() => username);

            onCollected({
              data_type: 'user',
              external_id: `pinterest_${username}`,
              username,
              display_name: displayName,
              profile_url: `https://www.pinterest.com/${username}/`,
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
      console.error('[Pinterest] 采集Board粉丝失败:', e.message);
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
        await page.goto(`https://www.pinterest.com/${username}/`, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(1, 3);
        await this._humanMouseMove(page);

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

  // ==================== 群发: Save/Pin ====================

  async _batchSave(context) {
    const { accountIds, sourceData, inputData, intervalMin = 20, intervalMax = 50, dailyLimit, onProgress, onItem } = context;
    const accountPool = (accountIds && accountIds.length) ? accountIds : ['default'];
    const targets = sourceData || inputData.targets || [];

    let processed = 0, success = 0, failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (dailyLimit && processed >= dailyLimit) break;

      const target = targets[i];
      const pinUrl = typeof target === 'string' ? target : (target.profile_url || target.url);
      const accountId = accountPool[i % accountPool.length];
      const { instanceId, page } = await this._acquireBrowser(accountId);

      try {
        const fullUrl = pinUrl.startsWith('http') ? pinUrl : `https://www.pinterest.com${pinUrl}`;
        await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(1, 3);
        await this._humanMouseMove(page);

        const sel = this.selectors.actions;
        const saveBtn = await page.$(sel.save_button);
        if (saveBtn) {
          await saveBtn.click();
          await this._randomDelay(1, 3);
          processed++;
          success++;
          onItem({ accountId, target: pinUrl, success: true, result: { action: 'saved' } });
        } else {
          processed++;
          failed++;
          onItem({ accountId, target: pinUrl, success: false, result: { error: '未找到Save按钮' } });
        }

        onProgress(processed, success, failed);
      } catch (e) {
        processed++;
        failed++;
        onItem({ accountId, target: pinUrl, success: false, result: { error: e.message } });
        onProgress(processed, success, failed);
      } finally {
        this._releaseBrowser(instanceId);
      }

      await this._randomDelay(intervalMin, intervalMax);
    }

    return { total: processed, success, failed };
  }

  // ==================== 群发: 评论 ====================

  async _batchComment(context) {
    const { accountIds, sourceData, inputData, intervalMin = 30, intervalMax = 90, dailyLimit, onProgress, onItem } = context;
    const accountPool = (accountIds && accountIds.length) ? accountIds : ['default'];
    const targets = sourceData || inputData.targets || [];
    const commentTexts = inputData.texts || inputData.comments || ['Great pin!'];

    let processed = 0, success = 0, failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (dailyLimit && processed >= dailyLimit) break;

      const target = targets[i];
      const pinUrl = typeof target === 'string' ? target : (target.profile_url || target.url);
      const accountId = accountPool[i % accountPool.length];
      const commentText = commentTexts[i % commentTexts.length];
      const { instanceId, page } = await this._acquireBrowser(accountId);

      try {
        const fullUrl = pinUrl.startsWith('http') ? pinUrl : `https://www.pinterest.com${pinUrl}`;
        await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._randomDelay(2, 4);
        await this._humanMouseMove(page);

        const sel = this.selectors.actions;
        const commentInput = await page.$(sel.comment_input);
        if (!commentInput) throw new Error('未找到评论输入框');

        await this._humanType(page, sel.comment_input, commentText);
        await this._randomDelay(1, 2);

        const submitBtn = await page.$(sel.comment_submit);
        if (submitBtn) {
          await submitBtn.click();
        } else {
          await page.keyboard.press('Enter');
        }

        await this._randomDelay(2, 4);
        processed++;
        success++;
        onItem({ accountId, target: pinUrl, success: true, result: { action: 'commented', text: commentText } });
        onProgress(processed, success, failed);
      } catch (e) {
        processed++;
        failed++;
        onItem({ accountId, target: pinUrl, success: false, result: { error: e.message } });
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
applyHumanMixin(PinterestExecutor.prototype);

module.exports = PinterestExecutor;
