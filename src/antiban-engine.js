/**
 * 社媒防封 & 养号规则引擎
 * 集中管理所有平台安全限制，支持手动编辑和自动更新
 */

const DEFAULT_RULES = {
  version: '2026.03.26',
  last_updated: '2026-03-26',

  whatsapp: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-3',  days:[1,3],   max_outbound:5,   max_new_chats:3,  only_reply:true },
        { name:'day4-7',  days:[4,7],   max_outbound:15,  max_new_chats:5,  only_reply:false },
        { name:'week2',   days:[8,14],  max_outbound:30,  max_new_chats:10, only_reply:false },
        { name:'week3',   days:[15,21], max_outbound:50,  max_new_chats:15, only_reply:false },
        { name:'week4',   days:[22,28], max_outbound:80,  max_new_chats:25, only_reply:false },
        { name:'mature',  days:[29,999],max_outbound:150, max_new_chats:40, only_reply:false }
      ]
    },
    sending: {
      min_delay_ms:5000, max_delay_ms:12000,
      max_daily_outbound:150, max_daily_broadcast:200, max_hourly_messages:25,
      broadcast_delay_ms:8000, broadcast_delay_random_ms:5000,
      cooldown_after_n:40, cooldown_duration_ms:600000,
      portfolio_pacing_enabled:true, portfolio_pacing_note:'Dec2025-Feb2026: Meta sends large campaigns in batches with feedback checks between batches',
      tier_update_note:'Q1-Q2 2026: 2K/10K tiers removed, 100K baseline after business verification'
    },
    content: {
      max_same_content_per_day:10, require_content_variation:true,
      banned_keywords:['free money','click here now','limited offer','100% guaranteed'],
      max_links_per_message:2, max_message_length:4096,
      frequency_capping_enabled:true, frequency_capping_note:'Meta enforces per-user message frequency caps to prevent spam'
    },
    policy: { general_purpose_ai_banned:true, ban_effective_date:'2026-01-15', business_specific_bots_allowed:true, us_marketing_templates_paused:true, us_marketing_note:'Marketing templates paused in US market as of 2026' },
    schedule: { active_hours_start:8, active_hours_end:21, weekend_reduction:0.5 },
    health: { max_block_rate:0.05, max_report_count_daily:3, pause_hours_on_warning:24, pause_hours_on_block:72, auto_pause_enabled:true, max_spam_report_rate:0.003, min_response_rate:0.20, quality_rating_note:'Spam reports must stay below 0.3%, response rate above 20% to maintain quality tier' }
  },

  linkedin: {
    warmup: {
      enabled: true,
      manual_warmup_days: 30,
      stages: [
        { name:'day1-7',   days:[1,7],   max_connections:3,  max_messages:5,  max_views:20 },
        { name:'day8-14',  days:[8,14],  max_connections:8,  max_messages:15, max_views:40 },
        { name:'week3',    days:[15,21], max_connections:12, max_messages:20, max_views:60 },
        { name:'week4',    days:[22,28], max_connections:15, max_messages:25, max_views:80 },
        { name:'mature',   days:[29,999],max_connections:20, max_messages:30, max_views:80 }
      ]
    },
    sending: {
      min_delay_ms:45000, max_delay_ms:120000,
      max_daily_connections:20, max_daily_messages:50, max_daily_messages_premium:75, max_daily_messages_salesnav:250, max_daily_messages_recruiter:300,
      max_daily_profile_views:100, max_daily_profile_views_premium:250, max_daily_profile_views_salesnav:500, max_daily_profile_views_recruiter:600,
      max_pending_connections:700, withdraw_old_pending_days:14,
      max_weekly_connections:80, max_weekly_messages:100,
      max_weekly_connections_note:'official 100/week, safe threshold 50-80/week; recommend 3% of total connections/day',
      connection_with_note_preferred:true, connection_note_improves_acceptance:true
    },
    content: { personalization_required:true, max_same_message_per_day:3, banned_keywords:['buy now','discount','cheap','order now','free trial'], max_inmails_per_month:50 },
    schedule: { active_hours_start:8, active_hours_end:18, active_days:[1,2,3,4,5] },
    health: { max_connection_reject_rate:0.7, max_weekly_restrictions:2, auto_pause_enabled:true, reputation_based_limits:true, red_flags:['accepting 50+ requests in minutes','perfect daily consistency','instant messaging after accept','same message to everyone','weekend 3AM activity'] }
  },

  facebook: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-7',  days:[1,7],   max_posts:1, max_comments:5,  max_messages:5,  max_friend_requests:3 },
        { name:'week2',   days:[8,14],  max_posts:2, max_comments:10, max_messages:10, max_friend_requests:5 },
        { name:'week3',   days:[15,21], max_posts:3, max_comments:20, max_messages:20, max_friend_requests:10 },
        { name:'mature',  days:[22,999],max_posts:5, max_comments:30, max_messages:30, max_friend_requests:15 }
      ]
    },
    sending: {
      min_delay_ms:25000, max_delay_ms:75000,
      max_daily_posts:5, max_daily_group_posts:8, max_daily_messages:25,
      max_daily_comments:25, group_post_interval_hours:3
    },
    content: { max_same_content_groups:3, require_content_variation:true, banned_keywords:['buy now','whatsapp me','DM for price'], max_links_per_post:1, meta_verified_link_limit:true, non_verified_max_links_per_month:2, non_verified_link_note:'2026: Non-verified Pages limited to 2 links/month in post body; links in comments unlimited', meta_verified_cost_range:'$14.99-$500/month' },
    health: { max_post_removal_per_week:2, checkpoint_cooldown_hours:48, auto_pause_enabled:true }
  },

  tiktok: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-7',   days:[1,7],   max_posts:1, max_comments:10, max_follows:10 },
        { name:'week2',    days:[8,14],  max_posts:1, max_comments:20, max_follows:20 },
        { name:'week3-4',  days:[15,28], max_posts:2, max_comments:30, max_follows:30 },
        { name:'mature',   days:[29,999],max_posts:3, max_comments:40, max_follows:40 }
      ]
    },
    sending: { 
      min_post_interval_hours:3, max_daily_posts:3, max_daily_comments:40, 
      max_daily_follows:40, max_daily_likes:150,
      max_daily_shares:20, max_daily_dms:10
    },
    content: { optimal_video_length_sec:[15,90], max_hashtags:5, banned_keywords:['follow for follow','f4f','like for like'], require_original_content:true },
    health: { shadow_ban_detection:true, max_zero_view_videos:3, auto_pause_enabled:true }
  },

  email: {
    warmup: {
      enabled: true,
      stages: [
        { name:'week1',  days:[1,7],    max_daily:5 },
        { name:'week2',  days:[8,14],   max_daily:10 },
        { name:'week3',  days:[15,21],  max_daily:20 },
        { name:'week4',  days:[22,28],  max_daily:30 },
        { name:'mature', days:[29,999], max_daily:40 }
      ]
    },
    sending: { min_delay_ms:30000, max_delay_ms:120000, max_daily_per_account:35, max_bounce_rate:0.03, max_spam_rate:0.003, rotate_accounts:true },
    content: { require_unsubscribe_link:true, require_one_click_unsubscribe:true, require_personalization:true, require_dmarc:true, require_spf:true, require_dkim:true, spammy_keywords:['free','urgent','act now','limited time','congratulations','winner','click here','100% free','no cost','risk free'], max_subject_length:60, max_links_per_email:3 },
    health: { auto_pause_on_bounce:true, pause_hours_on_high_bounce:48 }
  },

  instagram: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-7',   days:[1,7],   max_follows:5,  max_likes:20,  max_comments:5,  max_dms:3 },
        { name:'week2',    days:[8,14],  max_follows:15, max_likes:50,  max_comments:15, max_dms:10 },
        { name:'week3-4',  days:[15,28], max_follows:30, max_likes:100, max_comments:25, max_dms:20 },
        { name:'mature',   days:[29,999],max_follows:40, max_likes:150, max_comments:30, max_dms:20 }
      ]
    },
    sending: {
      min_delay_ms:25000, max_delay_ms:75000,
      max_daily_follows:40, max_daily_unfollows:25, max_daily_likes:150,
      max_daily_comments:30, max_daily_dms:25, max_hourly_actions:40,
      max_hourly_automated_dms:200, max_hourly_automated_dms_note:'2026 Messaging API cap: 200 automated DMs/hour/account',
      follow_unfollow_ratio:0.7,
      max_daily_story_views:100,
      organic_warmup_before_automation_days:30, organic_warmup_note:'2026: Build organic engagement for 30 days before introducing any automation'
    },
    content: { max_hashtags:30, optimal_hashtags:[5,15], max_same_comment_per_day:3, banned_keywords:['follow for follow','f4f','buy followers'], require_comment_variation:true },
    health: { action_block_cooldown_hours:24, max_action_blocks_per_week:2, auto_pause_enabled:true, shadow_ban_detection:true, enforcement_hardened_2026:true, enforcement_note:'2026: Detection and enforcement significantly tightened since late 2025; accounts previously safe now being flagged' }
  },

  youtube: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-7',   days:[1,7],   max_comments:5,  max_likes:20, max_subscribes:5 },
        { name:'week2',    days:[8,14],  max_comments:15, max_likes:50, max_subscribes:15 },
        { name:'mature',   days:[15,999],max_comments:30, max_likes:100,max_subscribes:30 }
      ]
    },
    sending: { min_delay_ms:30000, max_delay_ms:90000, max_daily_comments:30, max_daily_likes:100, max_daily_subscribes:30 },
    content: { max_same_comment_per_day:3, banned_keywords:['sub4sub','subscribe to my channel'], require_comment_variation:true },
    health: { max_comment_removals_per_week:5, auto_pause_enabled:true }
  },

  twitter: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-7',   days:[1,7],   max_tweets:3,  max_follows:10, max_likes:20, max_dms:5 },
        { name:'week2',    days:[8,14],  max_tweets:5,  max_follows:20, max_likes:50, max_dms:10 },
        { name:'mature',   days:[15,999],max_tweets:10, max_follows:40, max_likes:100,max_dms:20 }
      ]
    },
    sending: {
      min_delay_ms:20000, max_delay_ms:60000,
      max_daily_tweets:10, max_daily_follows:40, max_daily_likes:80,
      max_daily_dms:15, max_daily_dms_premium:30, max_daily_retweets:20, max_hourly_follows:40,
      platform_limits_note:'Platform hard limits: 2400 tweets/day, 400 follows/day, 1000 likes/day, 500 DMs/day(free)/1000(premium)/2000(premium+); our limits are conservative safe thresholds',
      max_hourly_follows_safe:40, max_hourly_follows_note:'40-50/hour triggers rate limits'
    },
    content: { max_hashtags:5, banned_keywords:['follow back','f4f'], max_same_tweet_per_day:1 },
    health: { rate_limit_cooldown_minutes:15, max_suspensions_before_pause:1, auto_pause_enabled:true }
  },

  vk: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-7',   days:[1,7],   max_messages:5,  max_friends:5,  max_likes:20 },
        { name:'week2',    days:[8,14],  max_messages:15, max_friends:10, max_likes:50 },
        { name:'mature',   days:[15,999],max_messages:30, max_friends:20, max_likes:100 }
      ]
    },
    sending: { min_delay_ms:20000, max_delay_ms:60000, max_daily_messages:30, max_daily_friend_requests:20, max_daily_likes:100, max_daily_group_posts:5 },
    content: { require_content_variation:true, max_same_message_per_day:5 },
    health: { captcha_cooldown_hours:2, auto_pause_enabled:true }
  },

  reddit: {
    warmup: {
      enabled: true,
      stages: [
        { name:'day1-14',  days:[1,14],  max_posts:1, max_comments:5,  karma_farming:true },
        { name:'week3-4',  days:[15,28], max_posts:2, max_comments:10, karma_farming:false },
        { name:'mature',   days:[29,999],max_posts:3, max_comments:20, karma_farming:false }
      ]
    },
    sending: { min_delay_ms:60000, max_delay_ms:180000, max_daily_posts:3, max_daily_comments:20, min_karma_to_post:10, subreddit_cooldown_minutes:10 },
    content: { no_self_promotion_ratio:0.9, banned_keywords:['buy now','check my site'], require_subreddit_rules_check:true },
    health: { shadow_ban_detection:true, max_post_removals_per_week:2, auto_pause_enabled:true }
  },

  global: {
    browser_fingerprint: { isolate_per_account:true, rotate_user_agent:true, unique_ip_per_account:true },
    proxy: { required:true, type_preference:['residential','mobile','datacenter'], rotate_interval_hours:24 },
    human_simulation: {
      enabled: true,
      typing_speed_variance: true,
      session_duration_min_minutes: 5,
      session_duration_max_minutes: 30,
      mouse_simulation: true,
      keyboard_simulation: true,
      scroll_simulation: true,
      warmup_browsing: true,
      cooldown_browsing: true,
      random_likes: true,
      warmup_duration_sec: [3, 20],
      cooldown_duration_sec: [2, 8]
    }
  }
};

class AntiBanEngine {
  constructor(db) {
    this.db = db;
    this.rules = null;
    this.accountStats = new Map();
    this._loadRules();
  }

  _loadRules() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='antiban_rules'").get();
      if (row) {
        this.rules = JSON.parse(row.value);
        console.log('[AntiBan] 规则已加载 v' + this.rules.version);
      } else {
        this.rules = DEFAULT_RULES;
        this._saveRules();
        console.log('[AntiBan] 默认规则已写入 v' + this.rules.version);
      }
    } catch (e) {
      this.rules = DEFAULT_RULES;
    }
  }

  _saveRules() {
    this.db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('antiban_rules',?,datetime('now'))")
      .run(JSON.stringify(this.rules));
  }

  /** 更新规则 */
  updateRules(newRules) {
    this.rules = { ...this.rules, ...newRules, last_updated: new Date().toISOString().split('T')[0] };
    this._saveRules();
    return this.rules;
  }

  /** 更新单个平台规则 */
  updatePlatformRules(platform, rules) {
    if (this.rules[platform]) {
      this.rules[platform] = { ...this.rules[platform], ...rules };
      this.rules.last_updated = new Date().toISOString().split('T')[0];
      this._saveRules();
    }
    return this.rules;
  }

  getRules() { return this.rules; }
  getDefaultRules() { return DEFAULT_RULES; }
  resetRules() { this.rules = {...DEFAULT_RULES, last_updated: new Date().toISOString().split('T')[0]}; this._saveRules(); return this.rules; }

  /**
   * 核心检查：是否允许操作
   * @returns {{ allowed:boolean, reason?:string, delay_ms?:number, stage?:string }}
   */
  check(platform, accountId, action, context = {}) {
    const pr = this.rules[platform];
    if (!pr) return { allowed: true };

    // 1. 暂停检查
    const pause = this._checkPause(platform, accountId);
    if (!pause.allowed) return pause;

    // 2. 时间窗口
    if (pr.schedule) {
      const sched = this._checkSchedule(pr.schedule);
      if (!sched.allowed) return sched;
    }

    // 3. 养号阶段
    if (pr.warmup?.enabled) {
      const warmup = this._checkWarmup(platform, accountId, action, context);
      if (!warmup.allowed) return warmup;
    }

    // 4. 频率限制
    const rate = this._checkRate(platform, accountId, action);
    if (!rate.allowed) return rate;

    // 5. 内容安全
    if (context.content && pr.content) {
      const cont = this._checkContent(pr.content, context.content);
      if (!cont.allowed) return cont;
    }

    // 计算延迟
    const delay = this._getDelay(pr.sending);
    return { allowed: true, delay_ms: delay, stage: this._getCurrentStage(platform, accountId) };
  }

  /** 记录操作 */
  recordAction(platform, accountId, action) {
    const key = `${platform}:${accountId}`;
    if (!this.accountStats.has(key)) this.accountStats.set(key, { daily:{}, hourly:{} });
    const s = this.accountStats.get(key);
    const today = new Date().toISOString().split('T')[0];
    const hk = `${today}-${new Date().getHours()}`;
    if (!s.daily[today]) s.daily[today] = {};
    s.daily[today][action] = (s.daily[today][action] || 0) + 1;
    if (!s.hourly[hk]) s.hourly[hk] = {};
    s.hourly[hk][action] = (s.hourly[hk][action] || 0) + 1;
    // 清理7天前
    const cutoff = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    Object.keys(s.daily).filter(d => d < cutoff).forEach(d => delete s.daily[d]);
  }

  /** 获取今日统计 */
  getTodayStats(platform, accountId) {
    const s = this.accountStats.get(`${platform}:${accountId}`);
    return s?.daily[new Date().toISOString().split('T')[0]] || {};
  }

  /** 获取账号年龄(天) */
  getAccountAge(platform, accountId) {
    try {
      const r = this.db.prepare("SELECT value FROM settings WHERE key=?").get(`acct_born_${platform}_${accountId}`);
      if (r) return Math.floor((Date.now() - new Date(r.value).getTime()) / 86400000) + 1;
    } catch(e) {}
    return 999;
  }

  /** 注册新账号 */
  registerAccount(platform, accountId, createdDate) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))")
      .run(`acct_born_${platform}_${accountId}`, createdDate || new Date().toISOString());
  }

  /** 暂停账号 */
  pauseAccount(platform, accountId, hours) {
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    this.db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))")
      .run(`acct_pause_${platform}_${accountId}`, until);
  }

  /** 取消暂停 */
  unpauseAccount(platform, accountId) {
    this.db.prepare("DELETE FROM settings WHERE key=?").run(`acct_pause_${platform}_${accountId}`);
  }

  /** 获取所有账号状态 */
  getAccountStatuses() {
    const statuses = [];
    for (const [key, stats] of this.accountStats) {
      const [platform, accountId] = key.split(':');
      const age = this.getAccountAge(platform, accountId);
      const stage = this._getCurrentStage(platform, accountId);
      const today = this.getTodayStats(platform, accountId);
      const paused = this._checkPause(platform, accountId);
      statuses.push({ platform, accountId, age, stage, todayStats: today, paused: !paused.allowed, pauseReason: paused.reason });
    }
    return statuses;
  }

  // ===== 内部方法 =====

  _checkPause(platform, accountId) {
    try {
      const r = this.db.prepare("SELECT value FROM settings WHERE key=?").get(`acct_pause_${platform}_${accountId}`);
      if (r) {
        const until = new Date(r.value);
        if (until > new Date()) {
          const hrs = Math.ceil((until - new Date()) / 3600000);
          return { allowed: false, reason: `账号已暂停(还剩${hrs}小时)` };
        }
        this.db.prepare("DELETE FROM settings WHERE key=?").run(`acct_pause_${platform}_${accountId}`);
      }
    } catch(e) {}
    return { allowed: true };
  }

  _checkSchedule(sched) {
    const h = new Date().getHours();
    const d = new Date().getDay();
    if (h < sched.active_hours_start || h >= sched.active_hours_end) {
      return { allowed: false, reason: `非活跃时间(${sched.active_hours_start}:00-${sched.active_hours_end}:00)` };
    }
    if (sched.active_days && !sched.active_days.includes(d)) {
      return { allowed: false, reason: '今日非活跃日' };
    }
    return { allowed: true };
  }

  _checkWarmup(platform, accountId, action, ctx) {
    const stages = this.rules[platform].warmup.stages;
    const age = this.getAccountAge(platform, accountId);
    const stage = stages.find(s => age >= s.days[0] && age <= s.days[1]);
    if (!stage) return { allowed: true };

    const today = this.getTodayStats(platform, accountId);

    // WhatsApp: 养号期只回复
    if (platform === 'whatsapp' && stage.only_reply && ctx.isNewChat) {
      return { allowed: false, reason: `养号期(${stage.name}): 只能回复，不能主动发起`, stage: stage.name };
    }

    // 各平台日限额
    const limitMap = {
      whatsapp: { send: stage.max_outbound },
      linkedin: { connect: stage.max_connections, send: stage.max_messages, view: stage.max_views },
      facebook: { post: stage.max_posts, comment: stage.max_comments, send: stage.max_messages },
      tiktok:   { post: stage.max_posts, comment: stage.max_comments, follow: stage.max_follows },
      email:    { send: stage.max_daily }
    };

    const limits = limitMap[platform] || {};
    if (limits[action] !== undefined && (today[action] || 0) >= limits[action]) {
      return { allowed: false, reason: `养号期(${stage.name})${action}已达上限: ${limits[action]}`, stage: stage.name };
    }

    return { allowed: true, stage: stage.name };
  }

  _checkRate(platform, accountId, action) {
    const sr = this.rules[platform].sending;
    if (!sr) return { allowed: true };
    const today = this.getTodayStats(platform, accountId);

    const dailyMap = {
      whatsapp: { send: sr.max_daily_outbound, broadcast: sr.max_daily_broadcast },
      linkedin: { connect: sr.max_daily_connections, send: sr.max_daily_messages, view: sr.max_daily_profile_views },
      facebook: { post: sr.max_daily_posts, send: sr.max_daily_messages, comment: sr.max_daily_comments },
      tiktok:   { post: sr.max_daily_posts, comment: sr.max_daily_comments, follow: sr.max_daily_follows },
      email:    { send: sr.max_daily_per_account }
    };

    const limits = dailyMap[platform] || {};
    if (limits[action] !== undefined && (today[action] || 0) >= limits[action]) {
      return { allowed: false, reason: `今日${action}已达上限: ${limits[action]}` };
    }

    // WhatsApp 每小时限制
    if (platform === 'whatsapp' && sr.max_hourly_messages) {
      const s = this.accountStats.get(`${platform}:${accountId}`);
      const hk = `${new Date().toISOString().split('T')[0]}-${new Date().getHours()}`;
      const hourCount = s?.hourly[hk]?.send || 0;
      if (hourCount >= sr.max_hourly_messages) {
        return { allowed: false, reason: `本小时消息已达上限: ${sr.max_hourly_messages}` };
      }
    }

    return { allowed: true };
  }

  _checkContent(rules, content) {
    const text = (content || '').toLowerCase();
    if (rules.banned_keywords) {
      const found = rules.banned_keywords.find(kw => text.includes(kw.toLowerCase()));
      if (found) return { allowed: false, reason: `含高风险词: "${found}"` };
    }
    if (rules.spammy_keywords) {
      const found = rules.spammy_keywords.filter(kw => text.includes(kw.toLowerCase()));
      if (found.length >= 2) return { allowed: false, reason: `含多个垃圾特征词: ${found.join(',')}` };
    }
    if (rules.max_links_per_message) {
      const links = (content.match(/https?:\/\//gi) || []).length;
      if (links > rules.max_links_per_message) return { allowed: false, reason: `链接数(${links})超限(${rules.max_links_per_message})` };
    }
    return { allowed: true };
  }

  _getDelay(sending) {
    if (!sending) return 0;
    const min = sending.min_delay_ms || sending.min_delay_between_actions_ms || 1000;
    const max = sending.max_delay_ms || sending.max_delay_between_actions_ms || 3000;
    return min + Math.floor(Math.random() * (max - min));
  }

  _getCurrentStage(platform, accountId) {
    const stages = this.rules[platform]?.warmup?.stages;
    if (!stages) return 'unknown';
    const age = this.getAccountAge(platform, accountId);
    const stage = stages.find(s => age >= s.days[0] && age <= s.days[1]);
    return stage?.name || 'mature';
  }

  /** 生成内容变体（简单替换同义词） */
  generateVariation(content) {
    const variations = [
      ['Hello', 'Hi', 'Hey', 'Greetings'],
      ['Thank you', 'Thanks', 'Much appreciated', 'Many thanks'],
      ['interested', 'keen', 'looking into', 'considering'],
      ['products', 'solutions', 'offerings', 'range'],
      ['please', 'kindly', 'would you', 'could you'],
      ['contact', 'reach out to', 'get in touch with', 'connect with'],
      ['best regards', 'kind regards', 'warm regards', 'regards'],
      ['We are', "We're", 'Our company is', 'Our team is'],
    ];
    let result = content;
    for (const group of variations) {
      for (const word of group) {
        if (result.includes(word)) {
          const replacement = group[Math.floor(Math.random() * group.length)];
          if (replacement !== word) {
            result = result.replace(word, replacement);
            break;
          }
        }
      }
    }
    return result;
  }
}

module.exports = { AntiBanEngine, DEFAULT_RULES };
