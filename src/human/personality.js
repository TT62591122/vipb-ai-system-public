/**
 * 行为人格生成器 — 为每个账号创建独特的操作习惯
 */
class PersonalityGenerator {
  // 性格模板
  static TEMPLATES = [
    { name: 'careful',   speed: 0.7, errors: 0.01, pause: 0.22, likes: 0.1, session: 20 },
    { name: 'normal',    speed: 1.0, errors: 0.03, pause: 0.15, likes: 0.3, session: 15 },
    { name: 'energetic', speed: 1.3, errors: 0.05, pause: 0.08, likes: 0.5, session: 10 },
    { name: 'slow',      speed: 0.5, errors: 0.02, pause: 0.25, likes: 0.15, session: 25 },
    { name: 'precise',   speed: 0.9, errors: 0.005, pause: 0.12, likes: 0.25, session: 18 },
    { name: 'casual',    speed: 1.1, errors: 0.04, pause: 0.18, likes: 0.45, session: 12 },
  ];

  /**
   * 生成随机人格
   */
  static generate(platform) {
    const tpl = this.TEMPLATES[Math.floor(Math.random() * this.TEMPLATES.length)];

    // 在模板基础上加随机偏移
    const j = (base, range) => {
      const val = base + (Math.random() - 0.5) * range;
      return Math.round(val * 100) / 100;
    };

    return {
      template_name: tpl.name,
      platform: platform || 'unknown',

      // 鼠标
      mouse_speed: Math.max(0.3, j(tpl.speed, 0.3)),
      mouse_precision: Math.max(0.6, Math.min(0.98, j(0.85, 0.15))),
      mouse_curve_intensity: Math.max(0.2, Math.min(1.0, j(0.6, 0.4))),

      // 键盘
      typing_speed_wpm: Math.max(15, Math.round(j(45 * tpl.speed, 15))),
      typing_error_rate: Math.max(0, Math.min(0.1, j(tpl.errors, 0.02))),
      typing_pause_freq: Math.max(0.02, Math.min(0.4, j(tpl.pause, 0.1))),
      typing_burst_mode: Math.random() > 0.7 ? 1 : 0,

      // 浏览
      scroll_speed: Math.max(0.3, j(tpl.speed, 0.25)),
      avg_page_view_sec: Math.max(3, Math.round(j(15, 10))),
      likes_ratio: Math.max(0, Math.min(0.8, j(tpl.likes, 0.15))),
      comment_ratio: Math.max(0, Math.min(0.15, j(0.05, 0.04))),

      // 时间
      preferred_start_hour: 7 + Math.floor(Math.random() * 3),
      preferred_end_hour: 19 + Math.floor(Math.random() * 3),
      lunch_break_start: 11 + Math.floor(Math.random() * 2),
      lunch_break_end: 13 + Math.floor(Math.random()),
      avg_session_minutes: Math.max(5, Math.round(j(tpl.session, 8))),

      // 设备
      is_mobile: Math.random() > 0.6 ? 1 : 0,
      screen_dpi: Math.random() > 0.5 ? 2.0 : 1.0,
    };
  }

  /**
   * 从数据库行转为人格对象
   */
  static fromRow(row) {
    if (!row) return null;
    return { ...row };
  }
}

module.exports = PersonalityGenerator;
