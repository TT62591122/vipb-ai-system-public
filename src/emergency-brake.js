/**
 * EmergencyBrake - 紧急刹车系统
 * 
 * 职责：
 * - 一键停止/恢复所有AI引擎
 * - 网络异常自动触发刹车
 * - 全局频率/错误率监控
 * - 风险日志记录
 * - 断点续跑支持
 */

const http = require('http');
const https = require('https');

const STATE_KEY = 'emergency_brake_state';
const CONFIG_KEY = 'emergency_brake_config';

const DEFAULT_CONFIG = {
  networkCheck: {
    enabled: true,
    intervalMs: 30000,
    targets: ['https://www.baidu.com', 'https://www.google.com', 'https://api.facebook.com'],
    failThreshold: 3,
    timeoutMs: 5000
  },
  frequencyCheck: {
    enabled: true,
    windowMs: 300000,
    maxActions: 500,
    checkIntervalMs: 60000
  },
  errorRateCheck: {
    enabled: true,
    windowMs: 300000,
    maxErrorRate: 0.5,
    minSamples: 10
  },
  banWaveCheck: {
    enabled: true,
    windowMs: 3600000,
    maxBans: 3
  }
};

class EmergencyBrake {
  constructor({ db, io, matrixEngine, inboxSync, antiban, alert }) {
    this.db = db;
    this.io = io;
    this.matrixEngine = matrixEngine;
    this.inboxSync = inboxSync;
    this.antiban = antiban;
    this.alert = alert;

    // 内部状态
    this.cronSuppressed = false;
    this.healthCheckTimer = null;
    this.frequencyCheckTimer = null;

    // 滑动窗口计数器
    this.actionWindow = { total: 0, failed: 0, windowStart: Date.now() };
    this.banWindow = { count: 0, windowStart: Date.now() };

    // 网络检测连续失败计数
    this.networkFailures = 0;

    // 加载配置和状态
    this.config = this._loadConfig();
    this._loadState();

    // 如果上次是stopped状态，重新停止已启动的引擎
    if (this.cronSuppressed) {
      try { this.matrixEngine.stop(); } catch (e) { /* ignore */ }
      try { this.inboxSync.stopSync(); } catch (e) { /* ignore */ }
    }

    // 启动监控
    this._startMonitors();

    // 监听矩阵引擎事件（不修改引擎内部）
    this._attachEngineListeners();

    console.log(`🚨 EmergencyBrake 已初始化 [状态: ${this.cronSuppressed ? 'STOPPED' : 'RUNNING'}]`);
  }

  // ==================== 公开API ====================

  /** 是否处于停止状态 */
  isStopped() {
    return this.cronSuppressed;
  }

  /** 一键停止所有引擎 */
  stopAll(reason = '手动停止', triggerType = 'manual') {
    if (this.cronSuppressed) {
      return { success: false, error: '系统已处于停止状态' };
    }

    console.log(`🚨 [EmergencyBrake] 触发紧急停止: ${reason} (${triggerType})`);

    // 1. 拍快照
    const snapshot = this._takeSnapshot();

    // 2. 停止矩阵引擎
    try {
      this.matrixEngine.stop();
      // 将queued的任务标记为 paused_emergency（防止重启后被自动拉起）
      const r = this.db.prepare(
        "UPDATE matrix_tasks SET status='paused_emergency', updated_at=datetime('now') WHERE status='queued'"
      ).run();
      if (r.changes > 0) {
        console.log(`  ⏸️ 已暂停 ${r.changes} 个排队中的矩阵任务`);
      }
    } catch (e) {
      console.error('  ❌ 停止矩阵引擎失败:', e.message);
    }

    // 3. 停止收件箱同步
    try {
      this.inboxSync.stopSync();
    } catch (e) {
      console.error('  ❌ 停止收件箱同步失败:', e.message);
    }

    // 4. 抑制cron
    this.cronSuppressed = true;

    // 5. 持久化状态
    const state = {
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
      reason,
      triggerType,
      snapshot
    };
    this._saveState(state);

    // 6. 写入告警日志
    if (this.alert) {
      this.alert.alert('critical', `🚨 紧急刹车已触发: ${reason}`, {
        triggerType,
        snapshot: {
          matrixRunning: snapshot.matrixRunningTasks.length,
          matrixQueued: snapshot.matrixQueuedTasks.length,
          inboxPlatforms: snapshot.inboxActivePlatforms.length
        }
      });
    }

    // 7. 审计日志
    try {
      this.db.prepare(
        "INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run('system', 0, 'emergency_stop', JSON.stringify({ reason, triggerType, snapshot }), 'system', 'server');
    } catch (e) { /* ignore */ }

    // 8. WebSocket推送
    if (this.io) {
      this.io.emit('emergency_brake', {
        action: 'stopped',
        reason,
        triggerType,
        stoppedAt: state.stoppedAt,
        snapshot: {
          matrixRunning: snapshot.matrixRunningTasks.length,
          matrixQueued: snapshot.matrixQueuedTasks.length,
          inboxPlatforms: snapshot.inboxActivePlatforms
        }
      });
    }

    console.log('🚨 [EmergencyBrake] 所有引擎已停止');
    return { success: true, snapshot };
  }

  /** 恢复运行 */
  resumeAll(options = {}) {
    if (!this.cronSuppressed) {
      return { success: false, error: '系统已在运行中' };
    }

    const { resumeMatrix = true, resumeInbox = true, resumeCron = true } = options;
    const state = this._getState();
    const snapshot = state?.snapshot || {};
    const recovered = { tasks: 0, platforms: [] };

    console.log('✅ [EmergencyBrake] 开始恢复运行...');

    // 1. 恢复矩阵引擎
    if (resumeMatrix) {
      try {
        // 恢复 paused_emergency 的任务为 queued
        const r = this.db.prepare(
          "UPDATE matrix_tasks SET status='queued', updated_at=datetime('now') WHERE status='paused_emergency'"
        ).run();
        recovered.tasks = r.changes;
        if (r.changes > 0) {
          console.log(`  ▶️ 已恢复 ${r.changes} 个矩阵任务到队列`);
        }

        // 恢复 stop() 时被标记为 paused 的 running 任务
        const r2 = this.db.prepare(
          "UPDATE matrix_tasks SET status='queued', updated_at=datetime('now') WHERE status='paused' AND id IN (" +
          (snapshot.matrixRunningTasks || []).map(() => '?').join(',') + ')'
        );
        if (snapshot.matrixRunningTasks?.length > 0) {
          const r2Result = r2.run(...snapshot.matrixRunningTasks);
          recovered.tasks += r2Result.changes;
        }

        // 重启引擎
        this.matrixEngine.start();
      } catch (e) {
        console.error('  ❌ 恢复矩阵引擎失败:', e.message);
      }
    }

    // 2. 恢复收件箱同步
    if (resumeInbox) {
      try {
        const platforms = snapshot.inboxActivePlatforms || [];
        if (platforms.length > 0) {
          this.inboxSync.startSync(platforms);
          recovered.platforms = platforms;
          console.log(`  ▶️ 已恢复收件箱同步: ${platforms.join(', ')}`);
        }
      } catch (e) {
        console.error('  ❌ 恢复收件箱同步失败:', e.message);
      }
    }

    // 3. 恢复cron
    if (resumeCron) {
      this.cronSuppressed = false;
      console.log('  ▶️ 已恢复定时任务');
    }

    // 4. 重置监控计数器
    this.actionWindow = { total: 0, failed: 0, windowStart: Date.now() };
    this.banWindow = { count: 0, windowStart: Date.now() };
    this.networkFailures = 0;

    // 5. 更新持久化状态
    this._saveState({ status: 'running', resumedAt: new Date().toISOString() });

    // 6. 日志
    if (this.alert) {
      this.alert.alert('info', '✅ 系统已恢复运行', { recovered });
    }
    try {
      this.db.prepare(
        "INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run('system', 0, 'emergency_resume', JSON.stringify({ recovered, options }), 'system', 'server');
    } catch (e) { /* ignore */ }

    // 7. WebSocket推送
    if (this.io) {
      this.io.emit('emergency_brake', {
        action: 'resumed',
        recovered,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ [EmergencyBrake] 系统已恢复运行');
    return { success: true, recovered };
  }

  /** 获取完整状态 */
  getStatus() {
    const state = this._getState();
    return {
      status: this.cronSuppressed ? 'stopped' : 'running',
      stoppedAt: state?.stoppedAt || null,
      reason: state?.reason || null,
      triggerType: state?.triggerType || null,
      snapshot: state?.snapshot || null,
      engines: {
        matrix: {
          running: this.matrixEngine.isRunning,
          activeTasks: this.matrixEngine.runningTasks.size,
          queuedTasks: this._countTasksByStatus('queued'),
          pausedEmergency: this._countTasksByStatus('paused_emergency')
        },
        inbox: {
          running: this.inboxSync.activePlatforms.length > 0,
          activePlatforms: [...this.inboxSync.activePlatforms]
        },
        emailCron: { suppressed: this.cronSuppressed },
        linkedinCron: { suppressed: this.cronSuppressed }
      },
      monitors: {
        network: {
          enabled: this.config.networkCheck.enabled,
          consecutiveFailures: this.networkFailures
        },
        frequency: {
          enabled: this.config.frequencyCheck.enabled,
          currentWindow: { ...this.actionWindow }
        },
        errorRate: {
          enabled: this.config.errorRateCheck.enabled,
          currentRate: this.actionWindow.total > 0
            ? (this.actionWindow.failed / this.actionWindow.total).toFixed(3)
            : 0
        }
      }
    };
  }

  /** 获取风险日志 */
  getLogs(limit = 20, offset = 0) {
    const logs = this.db.prepare(
      "SELECT * FROM activity_log WHERE action IN ('emergency_stop','emergency_resume') ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(limit, offset);
    const total = this.db.prepare(
      "SELECT COUNT(*) as c FROM activity_log WHERE action IN ('emergency_stop','emergency_resume')"
    ).get().c;
    return { logs, total };
  }

  /** 获取配置 */
  getConfig() {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this._saveConfig(this.config);

    // 重启监控器以应用新配置
    this._stopMonitors();
    this._startMonitors();

    return this.config;
  }

  /** 记录一次操作（供外部调用） */
  recordAction(success = true) {
    if (this.cronSuppressed) return;

    const now = Date.now();

    // 检查窗口是否过期
    if (now - this.actionWindow.windowStart > (this.config.frequencyCheck.windowMs || 300000)) {
      this.actionWindow = { total: 0, failed: 0, windowStart: now };
    }

    this.actionWindow.total++;
    if (!success) this.actionWindow.failed++;
  }

  /** 记录封号事件（供外部调用） */
  recordBan(platform, accountId) {
    if (this.cronSuppressed) return;

    const now = Date.now();
    if (now - this.banWindow.windowStart > (this.config.banWaveCheck.windowMs || 3600000)) {
      this.banWindow = { count: 0, windowStart: now };
    }

    this.banWindow.count++;
    console.warn(`⚠️ [EmergencyBrake] 检测到封号: ${platform}/${accountId} (窗口内第${this.banWindow.count}次)`);

    // 检查是否触发批量封号刹车
    if (this.config.banWaveCheck.enabled && this.banWindow.count >= this.config.banWaveCheck.maxBans) {
      this.stopAll(`批量封号: ${this.banWindow.count}个账号在${Math.round((this.config.banWaveCheck.windowMs) / 60000)}分钟内被封`, 'ban_wave');
    }
  }

  // ==================== 内部方法 ====================

  /** 拍快照 */
  _takeSnapshot() {
    const matrixRunningTasks = [];
    const matrixQueuedTasks = [];

    try {
      const running = this.db.prepare("SELECT id FROM matrix_tasks WHERE status='running'").all();
      running.forEach(r => matrixRunningTasks.push(r.id));

      const queued = this.db.prepare("SELECT id FROM matrix_tasks WHERE status='queued'").all();
      queued.forEach(r => matrixQueuedTasks.push(r.id));
    } catch (e) { /* ignore */ }

    return {
      matrixRunningTasks,
      matrixQueuedTasks,
      inboxActivePlatforms: [...this.inboxSync.activePlatforms],
      timestamp: new Date().toISOString()
    };
  }

  /** 统计指定状态的任务数 */
  _countTasksByStatus(status) {
    try {
      return this.db.prepare('SELECT COUNT(*) as c FROM matrix_tasks WHERE status=?').get(status).c;
    } catch (e) { return 0; }
  }

  // ===== 状态持久化 =====

  _loadState() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(STATE_KEY);
      if (row) {
        const state = JSON.parse(row.value);
        if (state.status === 'stopped') {
          this.cronSuppressed = true;
          console.log('🚨 [EmergencyBrake] 检测到上次刹车状态未恢复，保持停止');
        }
        return state;
      }
    } catch (e) { /* ignore */ }
    return { status: 'running' };
  }

  _getState() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(STATE_KEY);
      return row ? JSON.parse(row.value) : { status: 'running' };
    } catch (e) {
      return { status: 'running' };
    }
  }

  _saveState(state) {
    try {
      this.db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      ).run(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('[EmergencyBrake] 保存状态失败:', e.message);
    }
  }

  // ===== 配置持久化 =====

  _loadConfig() {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(CONFIG_KEY);
      if (row) return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
    } catch (e) { /* ignore */ }
    return { ...DEFAULT_CONFIG };
  }

  _saveConfig(config) {
    try {
      this.db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      ).run(CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('[EmergencyBrake] 保存配置失败:', e.message);
    }
  }

  // ===== 引擎事件监听 =====

  _attachEngineListeners() {
    if (this.matrixEngine) {
      this.matrixEngine.on('task:progress', () => this.recordAction(true));
      this.matrixEngine.on('task:completed', () => this.recordAction(true));
      this.matrixEngine.on('task:failed', () => this.recordAction(false));
    }
  }

  // ===== 自动监控 =====

  _startMonitors() {
    // 网络健康检测
    if (this.config.networkCheck.enabled) {
      this.healthCheckTimer = setInterval(
        () => this._checkNetwork(),
        this.config.networkCheck.intervalMs
      );
    }

    // 频率+错误率检测
    if (this.config.frequencyCheck.enabled || this.config.errorRateCheck.enabled) {
      this.frequencyCheckTimer = setInterval(
        () => this._checkFrequencyAndErrors(),
        this.config.frequencyCheck.checkIntervalMs || 60000
      );
    }
  }

  _stopMonitors() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.frequencyCheckTimer) {
      clearInterval(this.frequencyCheckTimer);
      this.frequencyCheckTimer = null;
    }
  }

  /** 网络健康检测 */
  async _checkNetwork() {
    // 刹车已触发时不检测
    if (this.cronSuppressed) return;

    const targets = this.config.networkCheck.targets;
    const timeout = this.config.networkCheck.timeoutMs;
    let allFailed = true;

    for (const url of targets) {
      try {
        const ok = await this._ping(url, timeout);
        if (ok) {
          allFailed = false;
          break;
        }
      } catch (e) {
        // continue checking others
      }
    }

    if (allFailed) {
      this.networkFailures++;
      console.warn(`⚠️ [EmergencyBrake] 网络检测失败 (连续${this.networkFailures}次)`);

      if (this.networkFailures >= this.config.networkCheck.failThreshold) {
        this.stopAll(
          `网络中断: ${targets.join(', ')} 连续${this.networkFailures}次全部不可达`,
          'network'
        );
      }
    } else {
      if (this.networkFailures > 0) {
        console.log('✅ [EmergencyBrake] 网络恢复正常');
      }
      this.networkFailures = 0;
    }
  }

  /** HTTP ping */
  _ping(url, timeout) {
    return new Promise((resolve) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout }, (res) => {
        res.resume(); // drain
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      // 安全超时
      setTimeout(() => { req.destroy(); resolve(false); }, timeout + 1000);
    });
  }

  /** 频率+错误率检测 */
  _checkFrequencyAndErrors() {
    if (this.cronSuppressed) return;

    const now = Date.now();
    const windowMs = this.config.frequencyCheck.windowMs || 300000;

    // 窗口过期则重置
    if (now - this.actionWindow.windowStart > windowMs) {
      this.actionWindow = { total: 0, failed: 0, windowStart: now };
      return;
    }

    // 频率检查
    if (this.config.frequencyCheck.enabled) {
      if (this.actionWindow.total > this.config.frequencyCheck.maxActions) {
        this.stopAll(
          `全局操作频率过高: ${this.actionWindow.total}次/${Math.round(windowMs / 60000)}分钟 (阈值${this.config.frequencyCheck.maxActions})`,
          'frequency'
        );
        return;
      }
    }

    // 错误率检查
    if (this.config.errorRateCheck.enabled) {
      const { total, failed } = this.actionWindow;
      const minSamples = this.config.errorRateCheck.minSamples || 10;
      const maxRate = this.config.errorRateCheck.maxErrorRate || 0.5;

      if (total >= minSamples) {
        const rate = failed / total;
        if (rate > maxRate) {
          this.stopAll(
            `错误率过高: ${(rate * 100).toFixed(1)}% (${failed}/${total}) 超过阈值${(maxRate * 100)}%`,
            'error_rate'
          );
        }
      }
    }
  }

  /** 销毁（graceful shutdown时调用） */
  destroy() {
    this._stopMonitors();
  }
}

module.exports = EmergencyBrake;
