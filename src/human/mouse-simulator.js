/**
 * 鼠标模拟器 — 贝塞尔曲线轨迹 + 拟人点击
 */
class MouseSimulator {
  constructor() {
    this.currentX = 0;
    this.currentY = 0;
  }

  /**
   * 贝塞尔曲线鼠标移动
   */
  async moveTo(page, targetX, targetY, personality = {}) {
    const speed = personality.mouse_speed || 1.0;
    const intensity = personality.mouse_curve_intensity || 0.6;

    const startX = this.currentX;
    const startY = this.currentY;
    const distance = Math.sqrt((targetX - startX) ** 2 + (targetY - startY) ** 2);

    if (distance < 5) {
      this.currentX = targetX;
      this.currentY = targetY;
      return;
    }

    const points = this._generateBezierPath(startX, startY, targetX, targetY, intensity, speed);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      try {
        await page.mouse.move(p.x, p.y);
      } catch (e) { break; }

      // 速度曲线：开头慢→中间快→结尾慢（ease-in-out）
      const progress = i / points.length;
      const speedFactor = Math.sin(progress * Math.PI); // 0→1→0
      const delay = Math.max(2, (8 - speedFactor * 6) / speed);
      await this._sleep(delay);
    }

    this.currentX = targetX;
    this.currentY = targetY;
  }

  /**
   * 拟人点击：移动 → 微偏移 → 按下 → 短暂停 → 松开
   */
  async click(page, x, y, personality = {}) {
    const precision = personality.mouse_precision || 0.85;

    // 添加点击偏移（真人不会点正中心）
    const offset = this._clickOffset(precision);
    const clickX = x + offset.x;
    const clickY = y + offset.y;

    await this.moveTo(page, clickX, clickY, personality);

    // 按下前微停顿（手指到达后确认）
    await this._sleep(30 + Math.random() * 80);

    await page.mouse.down();
    // 按住时长（真人按键 50-150ms）
    await this._sleep(50 + Math.random() * 100);
    await page.mouse.up();

    // 点击后微停顿
    await this._sleep(50 + Math.random() * 150);
  }

  /**
   * 点击元素（通过选择器）
   */
  async clickElement(page, selector, personality = {}) {
    try {
      const el = await page.$(selector);
      if (!el) return false;
      const box = await el.boundingBox();
      if (!box) return false;

      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await this.click(page, x, y, personality);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 三次贝塞尔曲线路径生成
   */
  _generateBezierPath(x1, y1, x2, y2, intensity, speed) {
    const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const steps = Math.max(15, Math.min(80, Math.floor(distance / (3 * speed))));

    // 随机控制点（模拟手的自然弧线）
    const cp1x = x1 + (x2 - x1) * 0.25 + (Math.random() - 0.5) * distance * intensity;
    const cp1y = y1 + (y2 - y1) * 0.25 + (Math.random() - 0.5) * distance * intensity;
    const cp2x = x1 + (x2 - x1) * 0.75 + (Math.random() - 0.5) * distance * intensity * 0.5;
    const cp2y = y1 + (y2 - y1) * 0.75 + (Math.random() - 0.5) * distance * intensity * 0.5;

    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * cp1x + 3 * (1 - t) * t ** 2 * cp2x + t ** 3 * x2;
      const y = (1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * cp1y + 3 * (1 - t) * t ** 2 * cp2y + t ** 3 * y2;

      // 添加微抖动（手不可能完全稳定）
      const jitter = Math.random() < 0.3 ? (Math.random() - 0.5) * 2 : 0;
      points.push({
        x: Math.round(x + jitter),
        y: Math.round(y + jitter)
      });
    }

    return points;
  }

  /**
   * 点击偏移（真人不会精确点中心）
   */
  _clickOffset(precision) {
    const maxOffset = (1 - precision) * 20;
    return {
      x: (Math.random() - 0.5) * maxOffset,
      y: (Math.random() - 0.5) * maxOffset
    };
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = MouseSimulator;
