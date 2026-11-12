/**
 * LineExecutor - LINE 平台执行器
 * 
 * 通过 LINE Web (chat.line.biz 或 LINE Chrome Extension) 操作
 * 
 * 支持:
 *   采集: collect_group_members, collect_friends
 *   群发: batch_message, batch_add_friend
 */

const path = require('path');
const fs = require('fs');
const BrowserPool = require('../../fingerprint-engine');
const applyHumanMixin = require('../../human/executor-mixin');

class LineExecutor {
  constructor(db) {
    this.db = db;
    this.browserPool = new BrowserPool(db);
    this._platform = 'line';
    this.selectors = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8')
    );
  }

  async execute(context) {
    this._currentContext = context;
    const { action } = context;

    const handlers = {
      collect_group_members: () => this._collectGroupMembers(context),
      collect_friends: () => this._collectFriends(context),
      batch_message: () => this._batchMessage(context),
      batch_add_friend: () => this._batchAddFriend(context),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`line: 不支持的 action: ${action}`);
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
        if (el) el.scrollTop += Math.floor(Math.random() * 300) + 100;
      }, container);
    } else {
      const distance = Math.floor(Math.random() * 400) + 200;
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
    const el = await page.$(selector);
    if (!el) throw new Error(`未找到输入框: ${selector}`);
    await el.click();
    await this._randomDelay(0.3, 0.8);
    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 120) + 40 });
    }
  }

  async _acquireBrowser(accountId) {
    return await this.browserPool.acquire(accountId);
  }

  _releaseBrowser(instanceId) {
    try { this.browserPool.release(instanceId); } catch (e) {}
  }

  // ==================== 采集: 群成员 ====================

  async _collectGroupMembers(context) {
    const { accountIds, inputData, dailyLimit, intervalMin = 2, intervalMax = 5, onProgress, onItem, onCollected } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const { groupUrl, groupName, maxResults = 500 } = inputData;

    if (!groupUrl && !groupName) throw new Error('缺少 groupUrl 或 groupName');

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      // 打开LINE Web
      await page.goto('https://chat.line.biz/', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(3, 5);

      // 检查是否需要登录
      const loginRequired = await page.$(this.selectors.login.email_input);
      if (loginRequired) {
        console.warn('[LINE] 需要登录，请先手动登录LINE Web');
        return { total: 0, success: 0, failed: 0, error: '需要先登录LINE Web' };
      }

      // 如果提供了groupUrl，直接打开
      if (groupUrl) {
        await page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      } else {
        // 搜索群组
        const searchInput = await page.$(this.selectors.chat.search_input);
        if (searchInput) {
          await this._humanType(page, this.selectors.chat.search_input, groupName);
          await this._randomDelay(2, 3);
          // 点击搜索结果中的群组
          const chatItems = await page.$$(this.selectors.chat.chat_item);
          for (const item of chatItems) {
            const name = await item.$eval(this.selectors.chat.chat_name, el => el.textContent.trim()).catch(() => '');
            if (name.includes(groupName)) {
              await item.click();
              await this._randomDelay(2, 3);
              break;
            }
          }
        }
      }

      // 打开群信息查看成员
      const groupInfo = await page.$(this.selectors.group.group_info);
      if (groupInfo) await groupInfo.click();
      await this._randomDelay(2, 3);

      // 采集成员列表
      const sel = this.selectors.group;
      const collected = new Set();
      let noNewCount = 0;

      while (noNewCount < 5 && processed < (dailyLimit || maxResults)) {
        const cards = await page.$$(sel.member_card);
        let foundNew = false;

        for (const card of cards) {
          if (processed >= (dailyLimit || maxResults)) break;

          try {
            const name = await card.$eval(sel.member_name, el => el.textContent.trim()).catch(() => null);
            if (!name || collected.has(name)) continue;
            collected.add(name);
            foundNew = true;
            processed++;
            success++;

            onCollected({
              data_type: 'user',
              external_id: `line_${name.replace(/\s+/g, '_')}`,
              display_name: name,
              username: name,
            });

            onItem({ target: name, success: true, result: { name } });
            onProgress(processed, success, failed);
          } catch (e) {
            failed++;
            onProgress(processed, success, failed);
          }
        }

        if (!foundNew) noNewCount++;
        else noNewCount = 0;

        await this._humanScroll(page, sel.member_list);
        await this._randomDelay(intervalMin, intervalMax);
      }
    } catch (e) {
      console.error('[LINE] 采集群成员失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }

  // ==================== 采集: 好友列表 ====================

  async _collectFriends(context) {
    const { accountIds, inputData, dailyLimit, intervalMin = 2, intervalMax = 5, onProgress, onItem, onCollected } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const { maxResults = 500 } = inputData;

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      await page.goto('https://chat.line.biz/', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(3, 5);

      // 检查登录
      const loginRequired = await page.$(this.selectors.login.email_input);
      if (loginRequired) {
        return { total: 0, success: 0, failed: 0, error: '需要先登录LINE Web' };
      }

      // 切换到联系人标签
      const contactsTab = await page.$(this.selectors.contacts.contacts_tab);
      if (contactsTab) {
        await contactsTab.click();
        await this._randomDelay(2, 3);
      }

      const sel = this.selectors.contacts;
      const collected = new Set();
      let noNewCount = 0;

      while (noNewCount < 5 && processed < (dailyLimit || maxResults)) {
        const cards = await page.$$(sel.friend_card);
        let foundNew = false;

        for (const card of cards) {
          if (processed >= (dailyLimit || maxResults)) break;

          try {
            const name = await card.$eval(sel.friend_name, el => el.textContent.trim()).catch(() => null);
            if (!name || collected.has(name)) continue;
            collected.add(name);
            foundNew = true;
            processed++;
            success++;

            const status = await card.$eval(sel.friend_status, el => el.textContent.trim()).catch(() => '');

            onCollected({
              data_type: 'user',
              external_id: `line_${name.replace(/\s+/g, '_')}`,
              display_name: name,
              username: name,
              bio: status,
            });

            onItem({ target: name, success: true, result: { name, status } });
            onProgress(processed, success, failed);
          } catch (e) {
            failed++;
            onProgress(processed, success, failed);
          }
        }

        if (!foundNew) noNewCount++;
        else noNewCount = 0;

        await this._humanScroll(page, this.selectors.common.scroll_container);
        await this._randomDelay(intervalMin, intervalMax);
      }
    } catch (e) {
      console.error('[LINE] 采集好友失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }

  // ==================== 群发: 消息 ====================

  async _batchMessage(context) {
    const { accountIds, sourceData, inputData, intervalMin = 30, intervalMax = 60, dailyLimit, onProgress, onItem } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const targets = sourceData || inputData.targets || [];
    const messageTexts = inputData.texts || inputData.messages || ['Hello!'];

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      await page.goto('https://chat.line.biz/', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(3, 5);

      const loginRequired = await page.$(this.selectors.login.email_input);
      if (loginRequired) {
        this._releaseBrowser(instanceId);
        return { total: 0, success: 0, failed: 0, error: '需要先登录LINE Web' };
      }

      for (let i = 0; i < targets.length; i++) {
        if (dailyLimit && processed >= dailyLimit) break;

        const target = targets[i];
        const friendName = typeof target === 'string' ? target : (target.display_name || target.username);
        const messageText = messageTexts[i % messageTexts.length];

        try {
          // 搜索联系人
          const searchInput = await page.$(this.selectors.chat.search_input);
          if (searchInput) {
            await searchInput.click();
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await this._humanType(page, this.selectors.chat.search_input, friendName);
            await this._randomDelay(1, 2);

            // 点击搜索结果
            const chatItems = await page.$$(this.selectors.chat.chat_item);
            let found = false;
            for (const item of chatItems) {
              const name = await item.$eval(this.selectors.chat.chat_name, el => el.textContent.trim()).catch(() => '');
              if (name.includes(friendName)) {
                await item.click();
                found = true;
                await this._randomDelay(1, 2);
                break;
              }
            }

            if (!found) {
              processed++;
              failed++;
              onItem({ accountId, target: friendName, success: false, result: { error: '未找到联系人' } });
              onProgress(processed, success, failed);
              continue;
            }
          }

          // 输入并发送消息
          await this._humanType(page, this.selectors.chat.message_input, messageText);
          await this._randomDelay(0.5, 1.5);

          const sendBtn = await page.$(this.selectors.chat.send_button);
          if (sendBtn) {
            await sendBtn.click();
          } else {
            await page.keyboard.press('Enter');
          }

          await this._randomDelay(1, 2);
          processed++;
          success++;
          onItem({ accountId, target: friendName, success: true, result: { action: 'sent', text: messageText } });
          onProgress(processed, success, failed);
        } catch (e) {
          processed++;
          failed++;
          onItem({ accountId, target: friendName, success: false, result: { error: e.message } });
          onProgress(processed, success, failed);
        }

        await this._randomDelay(intervalMin, intervalMax);
      }
    } catch (e) {
      console.error('[LINE] 群发消息失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }

  // ==================== 群发: 添加好友 ====================

  async _batchAddFriend(context) {
    const { accountIds, sourceData, inputData, intervalMin = 30, intervalMax = 90, dailyLimit, onProgress, onItem } = context;
    const accountId = (accountIds && accountIds[0]) || 'default';
    const targets = sourceData || inputData.targets || [];

    const { instanceId, page } = await this._acquireBrowser(accountId);
    let processed = 0, success = 0, failed = 0;

    try {
      await page.goto('https://chat.line.biz/', { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(3, 5);

      const loginRequired = await page.$(this.selectors.login.email_input);
      if (loginRequired) {
        this._releaseBrowser(instanceId);
        return { total: 0, success: 0, failed: 0, error: '需要先登录LINE Web' };
      }

      // 切换到联系人标签
      const contactsTab = await page.$(this.selectors.contacts.contacts_tab);
      if (contactsTab) {
        await contactsTab.click();
        await this._randomDelay(1, 2);
      }

      for (let i = 0; i < targets.length; i++) {
        if (dailyLimit && processed >= dailyLimit) break;

        const target = targets[i];
        const lineId = typeof target === 'string' ? target : (target.username || target.external_id);

        try {
          // 查找添加好友按钮
          const addBtn = await page.$(this.selectors.contacts.add_friend_button);
          if (addBtn) {
            await addBtn.click();
            await this._randomDelay(1, 2);
          }

          // 输入LINE ID
          const idInput = await page.$(this.selectors.contacts.add_friend_by_id);
          if (idInput) {
            await idInput.click();
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await this._humanType(page, this.selectors.contacts.add_friend_by_id, lineId);
            await this._randomDelay(1, 2);

            // 搜索并添加
            await page.keyboard.press('Enter');
            await this._randomDelay(2, 4);

            processed++;
            success++;
            onItem({ accountId, target: lineId, success: true, result: { action: 'add_request_sent' } });
          } else {
            processed++;
            failed++;
            onItem({ accountId, target: lineId, success: false, result: { error: '未找到添加好友输入框' } });
          }

          onProgress(processed, success, failed);
        } catch (e) {
          processed++;
          failed++;
          onItem({ accountId, target: lineId, success: false, result: { error: e.message } });
          onProgress(processed, success, failed);
        }

        await this._randomDelay(intervalMin, intervalMax);
      }
    } catch (e) {
      console.error('[LINE] 添加好友失败:', e.message);
    } finally {
      this._releaseBrowser(instanceId);
    }

    return { total: processed, success, failed };
  }
}

// 应用拟人行为Mixin
applyHumanMixin(LineExecutor.prototype);

module.exports = LineExecutor;
