/**
 * 执行器拟人行为 Mixin
 * 
 * 用法：在执行器构造函数末尾调用 applyHumanMixin(this)
 * 
 * 安全原则：
 * - 只覆盖 _humanScroll / _humanMouseMove / _humanType / _randomDelay
 * - 保留原始方法为 _origXxx 作 fallback
 * - humanBehavior 不可用时自动退回原始实现
 * - 所有调用方代码零改动
 */

function applyHumanMixin(executor) {
  // 保存原始实现
  executor._origHumanScroll = executor._humanScroll;
  executor._origHumanMouseMove = executor._humanMouseMove;
  executor._origHumanType = executor._humanType;
  executor._origRandomDelay = executor._randomDelay;

  /**
   * 获取拟人工具集（如果可用）
   * @returns {{ engine, personality, mouse, keyboard, scroll } | null}
   */
  executor._getHumanTools = function (accountId, platform) {
    try {
      const ctx = this._currentContext;
      const engine = ctx && ctx.humanBehavior;
      if (!engine || !engine.enabled) return null;

      const personality = engine.getPersonality(accountId || 'default', platform || 'unknown');
      return { engine, personality, mouse: engine.mouse, keyboard: engine.keyboard, scroll: engine.scroll };
    } catch (e) {
      return null;
    }
  };

  /**
   * 升级版滚动 — 有引擎用引擎，没有用原始
   */
  executor._humanScroll = async function (page, accountId) {
    const tools = this._getHumanTools(accountId, this._platform);
    if (tools) {
      try {
        await tools.scroll.readFeed(page, tools.personality, 1 + Math.random() * 2);
        return;
      } catch (e) { /* fallback */ }
    }
    return this._origHumanScroll.call(this, page);
  };

  /**
   * 升级版鼠标移动
   */
  executor._humanMouseMove = async function (page, accountId) {
    const tools = this._getHumanTools(accountId, this._platform);
    if (tools) {
      try {
        const x = Math.floor(Math.random() * 800) + 100;
        const y = Math.floor(Math.random() * 600) + 100;
        await tools.mouse.moveTo(page, x, y, tools.personality);
        return;
      } catch (e) { /* fallback */ }
    }
    return this._origHumanMouseMove.call(this, page);
  };

  /**
   * 升级版打字
   */
  executor._humanType = async function (page, selector, text, accountId) {
    const tools = this._getHumanTools(accountId, this._platform);
    if (tools) {
      try {
        await tools.keyboard.type(page, selector, text, tools.personality);
        return;
      } catch (e) { /* fallback */ }
    }
    return this._origHumanType.call(this, page, selector, text);
  };

  /**
   * 升级版延迟 — 使用正态分布而非均匀分布
   */
  executor._randomDelay = function (min, max) {
    // Box-Muller for more natural variance
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    const mean = (min + max) / 2;
    const stddev = (max - min) / 4;
    const delay = mean + normal * stddev;
    const clamped = Math.max(min, Math.min(max, delay));
    const ms = clamped * 1000;
    return new Promise(r => setTimeout(r, ms));
  };

  /**
   * 拟人点击（新增）— 供执行器内部按需使用
   */
  executor._humanClick = async function (page, selector, accountId) {
    const tools = this._getHumanTools(accountId, this._platform);
    if (tools) {
      try {
        return await tools.mouse.clickElement(page, selector, tools.personality);
      } catch (e) { /* fallback */ }
    }
    try { await page.click(selector); } catch (e) {}
  };

  /**
   * 保存当前执行上下文（在 execute 方法开头调用）
   */
  const origExecute = executor.execute.bind(executor);
  executor.execute = async function (context) {
    this._currentContext = context;
    try {
      return await origExecute(context);
    } finally {
      this._currentContext = null;
    }
  };
}

module.exports = applyHumanMixin;
