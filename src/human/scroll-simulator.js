/**
 * 滚动模拟器 — 模拟人类阅读式滚动
 */
class ScrollSimulator {
  /**
   * 模拟阅读信息流
   * @param {Page} page - Puppeteer page
   * @param {Object} personality - 行为档案
   * @param {number} durationSec - 浏览时长（秒）
   */
  async readFeed(page, personality = {}, durationSec = 10) {
    const scrollSpeed = personality.scroll_speed || 1.0;
    const endTime = Date.now() + durationSec * 1000;

    while (Date.now() < endTime) {
      // 每次滚动 50-350px（不是匀速的）
      const scrollAmount = 50 + Math.random() * 300;

      try {
        await page.evaluate((amount) => {
          window.scrollBy({ top: amount, behavior: 'smooth' });
        }, scrollAmount * scrollSpeed);
      } catch (e) { break; }

      // 阅读停顿（正态分布，大部分时间 1-3 秒）
      const readTime = this._readingPause(scrollSpeed);
      await this._sleep(readTime);

      // 10% 概率停下来看更久（看到有趣内容）
      if (Math.random() < 0.1) {
        await this._sleep(2000 + Math.random() * 5000);
      }

      // 5% 概率往回滚一点（回去看刚才的内容）
      if (Math.random() < 0.05) {
        try {
          await page.evaluate((amount) => {
            window.scrollBy({ top: -amount, behavior: 'smooth' });
          }, 50 + Math.random() * 150);
        } catch (e) {}
        await this._sleep(1000 + Math.random() * 2000);
      }
    }
  }

  /**
   * 滚动到指定元素（模拟找东西的行为）
   */
  async scrollToElement(page, selector, personality = {}) {
    const scrollSpeed = personality.scroll_speed || 1.0;

    try {
      const el = await page.$(selector);
      if (!el) return false;

      // 不用scrollIntoView（太机械），用多次小滚动逼近
      for (let attempt = 0; attempt < 20; attempt++) {
        const box = await el.boundingBox();
        if (!box) return false;

        const viewportHeight = await page.evaluate(() => window.innerHeight);

        // 元素已在视口中
        if (box.y >= 0 && box.y + box.height <= viewportHeight) {
          return true;
        }

        // 计算需要滚动的距离
        const scrollNeeded = box.y - viewportHeight * 0.4;
        const scrollStep = Math.min(Math.abs(scrollNeeded), 200 + Math.random() * 200);
        const direction = scrollNeeded > 0 ? 1 : -1;

        await page.evaluate((amount) => {
          window.scrollBy({ top: amount, behavior: 'smooth' });
        }, scrollStep * direction * scrollSpeed);

        await this._sleep(300 + Math.random() * 500);
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 快速滚动到页面顶部（模拟按Home键或快速划）
   */
  async scrollToTop(page) {
    try {
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      await this._sleep(500 + Math.random() * 1000);
    } catch (e) {}
  }

  /**
   * 阅读停顿时长（正态分布）
   */
  _readingPause(scrollSpeed) {
    // Box-Muller
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    const base = 1500; // 基础 1.5 秒
    const duration = base + normal * 800;

    return Math.max(300, Math.min(duration / scrollSpeed, 5000));
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = ScrollSimulator;
