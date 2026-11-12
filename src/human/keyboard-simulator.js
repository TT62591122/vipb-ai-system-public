/**
 * 键盘模拟器 — 拟人打字（速度波动、停顿、偶尔打错）
 */
class KeyboardSimulator {
  constructor() {
    // QWERTY键盘邻近键映射
    this.nearbyKeys = {
      'a': 'sqw', 'b': 'vgn', 'c': 'xdf', 'd': 'sfec', 'e': 'wrd',
      'f': 'dgrc', 'g': 'fhtv', 'h': 'gjyn', 'i': 'uok', 'j': 'hkum',
      'k': 'jlio', 'l': 'kp;', 'm': 'njk', 'n': 'bmhj', 'o': 'iplk',
      'p': 'ol[', 'q': 'wa', 'r': 'etf', 's': 'adwx', 't': 'ryg',
      'u': 'yij', 'v': 'cfb', 'w': 'qeas', 'x': 'zsdc', 'y': 'tuh',
      'z': 'xas', '1': '2q', '2': '13w', '3': '24e', '4': '35r',
      '5': '46t', '6': '57y', '7': '68u', '8': '79i', '9': '80o', '0': '9p'
    };
  }

  /**
   * 拟人打字 — 逐字符输入，带节奏变化
   */
  async type(page, selector, text, personality = {}) {
    const wpm = personality.typing_speed_wpm || 45;
    const errorRate = personality.typing_error_rate || 0.03;
    const pauseFreq = personality.typing_pause_freq || 0.15;
    const burstMode = personality.typing_burst_mode || false;

    // 基础每字符延迟 (ms)
    const baseDelay = 60000 / (wpm * 5);

    // 先点击输入框
    if (selector) {
      try { await page.click(selector); } catch (e) {}
      await this._sleep(200 + Math.random() * 300);
    }

    let inBurst = false;
    let burstCounter = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // 突发模式：偶尔快速打一串
      if (burstMode && !inBurst && Math.random() < 0.1) {
        inBurst = true;
        burstCounter = 3 + Math.floor(Math.random() * 8);
      }
      if (inBurst) {
        burstCounter--;
        if (burstCounter <= 0) inBurst = false;
      }

      // 偶尔打错再删除（只对字母数字）
      if (/[a-zA-Z0-9]/.test(char) && Math.random() < errorRate) {
        const wrongChar = this._nearbyKey(char);
        await page.keyboard.type(wrongChar, { delay: baseDelay * 0.7 });
        // 发现错误的反应时间
        await this._sleep(150 + Math.random() * 400);
        await page.keyboard.press('Backspace');
        await this._sleep(80 + Math.random() * 200);
      }

      // 正常输入
      const delay = this._typingDelay(baseDelay, inBurst, personality);
      await page.keyboard.type(char, { delay: Math.round(delay) });

      // 词间停顿（空格后思考下一个词）
      if (char === ' ' && Math.random() < pauseFreq) {
        await this._sleep(200 + Math.random() * 1200);
      }

      // 句末长停顿
      if ('.!?。！？，,'.includes(char) && Math.random() < 0.6) {
        await this._sleep(300 + Math.random() * 1500);
      }

      // 换行后停顿
      if (char === '\n') {
        await this._sleep(500 + Math.random() * 2000);
      }
    }
  }

  /**
   * 拟人粘贴（对于长文本，模拟复制粘贴行为）
   */
  async paste(page, selector, text, personality = {}) {
    if (selector) {
      try { await page.click(selector); } catch (e) {}
      await this._sleep(200 + Math.random() * 300);
    }

    // 模拟 Ctrl+V
    await page.keyboard.down('Control');
    await this._sleep(30 + Math.random() * 50);
    await page.keyboard.press('v');
    await this._sleep(30 + Math.random() * 50);
    await page.keyboard.up('Control');

    // 粘贴后检查停顿
    await this._sleep(500 + Math.random() * 1000);
  }

  /**
   * 高斯分布打字延迟
   */
  _typingDelay(base, inBurst, personality) {
    // Box-Muller 变换生成正态分布
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    let delay = base + normal * base * 0.35;

    // 突发模式下更快
    if (inBurst) delay *= 0.5;

    // 确保延迟合理
    return Math.max(25, Math.min(delay, base * 3));
  }

  /**
   * 获取相邻按键（打错时用）
   */
  _nearbyKey(char) {
    const lower = char.toLowerCase();
    const neighbors = this.nearbyKeys[lower];
    if (!neighbors) return char;
    const wrong = neighbors[Math.floor(Math.random() * neighbors.length)];
    // 保持大小写
    return char === char.toUpperCase() ? wrong.toUpperCase() : wrong;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = KeyboardSimulator;
