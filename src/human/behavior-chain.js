/**
 * 行为链 — 操作前预热 + 操作后收尾
 */
class BehaviorChain {
  constructor(mouse, keyboard, scroll) {
    this.mouse = mouse;
    this.keyboard = keyboard;
    this.scroll = scroll;
  }

  /**
   * 操作前预热：模拟真人打开社媒后先浏览一会儿
   */
  async warmup(page, personality = {}, config = {}) {
    if (config.warmup_browsing === false) return;

    const range = config.warmup_duration_sec || [3, 30];
    const duration = range[0] + Math.random() * (range[1] - range[0]);

    // 1. 随机移动鼠标（刚打开页面会动一下）
    await this.mouse.moveTo(page,
      200 + Math.random() * 600,
      150 + Math.random() * 400,
      personality
    );

    // 2. 刷信息流
    await this.scroll.readFeed(page, personality, duration);

    // 3. 随机点赞（如果性格允许）
    if (config.random_likes !== false && Math.random() < (personality.likes_ratio || 0.3)) {
      await this._tryRandomLike(page, personality);
    }

    // 4. 操作前的小停顿（准备开始做事了）
    await this._sleep(500 + Math.random() * 1500);
  }

  /**
   * 操作后收尾：不要操作完就走
   */
  async cooldown(page, personality = {}, config = {}) {
    if (config.cooldown_browsing === false) return;

    const range = config.cooldown_duration_sec || [2, 10];
    const duration = range[0] + Math.random() * (range[1] - range[0]);

    // 1. 再看几秒
    await this.scroll.readFeed(page, personality, duration);

    // 2. 随机移动鼠标到别处
    await this.mouse.moveTo(page,
      Math.random() * 800,
      Math.random() * 500,
      personality
    );

    // 3. 离开前停顿
    await this._sleep(800 + Math.random() * 2000);
  }

  /**
   * 尝试随机点赞一个帖子
   */
  async _tryRandomLike(page, personality = {}) {
    const platform = personality.platform || '';

    // 各平台点赞按钮选择器
    const selectors = {
      facebook: '[aria-label="Like"], [aria-label="赞"]',
      instagram: '[aria-label="Like"], svg[aria-label="Like"]',
      twitter: '[data-testid="like"], [data-testid="unlike"]',
      linkedin: 'button.react-button, button[aria-label*="Like"]',
      tiktok: '[data-e2e="like-icon"]',
      youtube: '#like-button button, ytd-toggle-button-renderer button',
      reddit: 'button[aria-label="upvote"]',
      vk: '.like_btn, .PostButtonReactions'
    };

    const selector = selectors[platform];
    if (!selector) return;

    try {
      const buttons = await page.$$(selector);
      if (buttons.length === 0) return;

      // 选一个靠前的按钮
      const idx = Math.floor(Math.random() * Math.min(3, buttons.length));
      const el = buttons[idx];
      const box = await el.boundingBox();

      if (box && box.y > 0 && box.y < 2000) {
        // 先滚动到可见
        await this.scroll.scrollToElement(page, selector, personality);
        await this._sleep(300 + Math.random() * 500);

        // 拟人点击
        await this.mouse.click(page, box.x + box.width / 2, box.y + box.height / 2, personality);
        await this._sleep(500 + Math.random() * 1000);
      }
    } catch (e) {
      // 找不到点赞按钮也没关系，静默失败
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = BehaviorChain;
