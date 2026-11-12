/**
 * MatrixTaskEngine - 统一任务调度引擎
 * 
 * 核心架构:
 * - TaskQueue: 优先级队列 + 并发控制 + 失败重试
 * - PlatformExecutor: 每平台独立执行器
 * - AntiBanGuard: 执行前检查/执行后记录
 * - AccountRotator: 轮流选号/跳过暂停封禁
 */

const EventEmitter = require('events');

class MatrixTaskEngine extends EventEmitter {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.isRunning = false;
    this.executors = new Map();     // platform → executor
    this.runningTasks = new Map();  // taskId → { task, abortController }
    this.maxConcurrency = options.maxConcurrency || 5;
    this.pollIntervalMs = options.pollIntervalMs || 3000;
    this.pollTimer = null;
    this.retryLimit = options.retryLimit || 3;
  }

  // ==================== 生命周期 ====================

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    // 崩溃恢复：将之前运行中的任务标记为 interrupted
    this._markInterruptedTasks();
    console.log('🚀 MatrixTaskEngine 已启动');
    this._startPolling();
  }

  /**
   * 启动时将 status='running' 的任务标记为 'interrupted'
   */
  _markInterruptedTasks() {
    try {
      const result = this.db.prepare(
        "UPDATE matrix_tasks SET status='interrupted', updated_at=datetime('now') WHERE status='running'"
      ).run();
      if (result.changes > 0) {
        console.log(`🔄 已将 ${result.changes} 个运行中任务标记为 interrupted`);
      }
    } catch (err) {
      console.error('[MatrixTaskEngine] 标记中断任务失败:', err.message);
    }
  }

  /**
   * 恢复被中断的任务 — 重新排队
   */
  recoverTasks() {
    try {
      const result = this.db.prepare(
        "UPDATE matrix_tasks SET status='pending', updated_at=datetime('now') WHERE status='interrupted'"
      ).run();
      console.log(`🔄 已恢复 ${result.changes} 个中断任务到队列`);
      return { recovered: result.changes };
    } catch (err) {
      console.error('[MatrixTaskEngine] 恢复任务失败:', err.message);
      return { recovered: 0, error: err.message };
    }
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // 暂停所有运行中任务
    for (const [taskId, ctx] of this.runningTasks) {
      this._updateTaskStatus(taskId, 'paused');
    }
    this.runningTasks.clear();
    console.log('⏹️  MatrixTaskEngine 已停止');
  }

  // ==================== 平台执行器注册 ====================

  registerExecutor(platform, executor) {
    this.executors.set(platform, executor);
    console.log(`📦 已注册平台执行器: ${platform}`);
  }

  // ==================== 任务 CRUD ====================

  createTask(taskData) {
    const stmt = this.db.prepare(`
      INSERT INTO matrix_tasks (task_type, platform, action, name, status, priority,
        account_ids, input_data, input_source_task_id,
        schedule_type, scheduled_at, cron_expression,
        max_concurrency, interval_min_sec, interval_max_sec,
        daily_limit, time_window_start, time_window_end, created_by)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      taskData.task_type,
      taskData.platform,
      taskData.action,
      taskData.name || `${taskData.platform}-${taskData.action}-${Date.now()}`,
      taskData.priority || 5,
      JSON.stringify(taskData.account_ids || []),
      JSON.stringify(taskData.input_data || {}),
      taskData.input_source_task_id || null,
      taskData.schedule_type || 'immediate',
      taskData.scheduled_at || null,
      taskData.cron_expression || null,
      taskData.max_concurrency || 1,
      taskData.interval_min_sec || 30,
      taskData.interval_max_sec || 120,
      taskData.daily_limit || 0,
      taskData.time_window_start || 8,
      taskData.time_window_end || 21,
      taskData.created_by || 'manual'
    );

    const taskId = result.lastInsertRowid;
    this.emit('task:created', { taskId, ...taskData });
    console.log(`📋 任务已创建: #${taskId} ${taskData.platform}/${taskData.action}`);
    return taskId;
  }

  getTask(taskId) {
    return this.db.prepare('SELECT * FROM matrix_tasks WHERE id = ?').get(taskId);
  }

  listTasks(filters = {}) {
    let sql = 'SELECT * FROM matrix_tasks WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.platform) {
      sql += ' AND platform = ?';
      params.push(filters.platform);
    }
    if (filters.task_type) {
      sql += ' AND task_type = ?';
      params.push(filters.task_type);
    }

    sql += ' ORDER BY priority ASC, created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params);
  }

  updateTask(taskId, updates) {
    const allowed = ['name', 'priority', 'status', 'input_data', 'account_ids',
      'max_concurrency', 'interval_min_sec', 'interval_max_sec',
      'daily_limit', 'time_window_start', 'time_window_end'];
    
    const fields = [];
    const values = [];
    
    for (const [key, val] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(typeof val === 'object' ? JSON.stringify(val) : val);
      }
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(taskId);

    this.db.prepare(`UPDATE matrix_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  deleteTask(taskId) {
    // 先停止如果在运行
    if (this.runningTasks.has(taskId)) {
      this.runningTasks.delete(taskId);
    }
    this.db.prepare('DELETE FROM matrix_task_items WHERE task_id = ?').run(taskId);
    this.db.prepare('DELETE FROM collected_data WHERE task_id = ?').run(taskId);
    this.db.prepare('DELETE FROM matrix_tasks WHERE id = ?').run(taskId);
  }

  // ==================== 任务控制 ====================

  async startTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`任务 #${taskId} 不存在`);
    if (task.status === 'running') throw new Error(`任务 #${taskId} 已在运行`);

    this._updateTaskStatus(taskId, 'queued');
    this.emit('task:queued', { taskId });
  }

  pauseTask(taskId) {
    this._updateTaskStatus(taskId, 'paused');
    this.runningTasks.delete(taskId);
    this.emit('task:paused', { taskId });
  }

  resumeTask(taskId) {
    this._updateTaskStatus(taskId, 'queued');
    this.emit('task:resumed', { taskId });
  }

  cancelTask(taskId) {
    this._updateTaskStatus(taskId, 'failed');
    this.runningTasks.delete(taskId);
    this.emit('task:cancelled', { taskId });
  }

  // ==================== 任务明细与结果 ====================

  getTaskItems(taskId, filters = {}) {
    let sql = 'SELECT * FROM matrix_task_items WHERE task_id = ?';
    const params = [taskId];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY id ASC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params);
  }

  getTaskResults(taskId) {
    return this.db.prepare('SELECT * FROM collected_data WHERE task_id = ? ORDER BY id ASC').all(taskId);
  }

  // ==================== 统计 ====================

  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as c FROM matrix_tasks').get();
    const byStatus = this.db.prepare(
      'SELECT status, COUNT(*) as c FROM matrix_tasks GROUP BY status'
    ).all();
    const byPlatform = this.db.prepare(
      'SELECT platform, COUNT(*) as c FROM matrix_tasks GROUP BY platform'
    ).all();
    const collectedTotal = this.db.prepare('SELECT COUNT(*) as c FROM collected_data').get();

    return {
      totalTasks: total.c,
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.c])),
      byPlatform: Object.fromEntries(byPlatform.map(r => [r.platform, r.c])),
      totalCollected: collectedTotal.c,
      runningNow: this.runningTasks.size,
      maxConcurrency: this.maxConcurrency
    };
  }

  // ==================== 内部：轮询调度 ====================

  _startPolling() {
    this.pollTimer = setInterval(() => {
      if (!this.isRunning) return;
      this._pollAndExecute();
    }, this.pollIntervalMs);
  }

  async _pollAndExecute() {
    // 检查是否有空闲槽位
    if (this.runningTasks.size >= this.maxConcurrency) return;

    // 拉取待执行任务
    const available = this.maxConcurrency - this.runningTasks.size;
    const tasks = this.db.prepare(`
      SELECT * FROM matrix_tasks 
      WHERE status = 'queued' 
      AND (schedule_type = 'immediate' OR (schedule_type = 'scheduled' AND scheduled_at <= CURRENT_TIMESTAMP))
      ORDER BY priority ASC, created_at ASC
      LIMIT ?
    `).all(available);

    for (const task of tasks) {
      if (this.runningTasks.has(task.id)) continue;
      
      // 检查时间窗口
      const hour = new Date().getHours();
      if (hour < task.time_window_start || hour >= task.time_window_end) continue;

      // 检查模块开关
      if (this._isModuleDisabled(task.platform)) {
        continue; // 模块已关闭，跳过
      }

      // 检查平台执行器
      const executor = this.executors.get(task.platform);
      if (!executor) {
        console.warn(`⚠️ 平台 ${task.platform} 无执行器，跳过任务 #${task.id}`);
        continue;
      }

      // 启动执行
      this._executeTask(task, executor);
    }
  }

  async _executeTask(task, executor) {
    this._updateTaskStatus(task.id, 'running');
    this.runningTasks.set(task.id, { task, startedAt: Date.now() });
    this.emit('task:started', { taskId: task.id });

    try {
      const inputData = JSON.parse(task.input_data || '{}');
      const accountIds = JSON.parse(task.account_ids || '[]');

      // 如果有上游任务，获取上游结果作为输入
      let sourceData = null;
      if (task.input_source_task_id) {
        sourceData = this.getTaskResults(task.input_source_task_id);
      }

      // 调用平台执行器（注入拟人行为引擎引用）
      const result = await executor.execute({
        taskId: task.id,
        taskType: task.task_type,
        action: task.action,
        humanBehavior: this.humanBehavior || null,
        inputData,
        accountIds,
        sourceData,
        intervalMin: task.interval_min_sec,
        intervalMax: task.interval_max_sec,
        dailyLimit: task.daily_limit,
        onProgress: (processed, success, failed) => {
          this.db.prepare(`
            UPDATE matrix_tasks SET processed_items=?, success_items=?, failed_items=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `).run(processed, success, failed, task.id);
          this.emit('task:progress', { taskId: task.id, processed, success, failed });
        },
        onItem: (item) => {
          this.db.prepare(`
            INSERT INTO matrix_task_items (task_id, account_id, target, action_data, status, result, executed_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).run(task.id, item.accountId || null, item.target || '', JSON.stringify(item.actionData || {}),
                 item.success ? 'success' : 'failed', JSON.stringify(item.result || {}));
        },
        onCollected: (data) => {
          try {
            this.db.prepare(`
              INSERT OR IGNORE INTO collected_data 
              (task_id, platform, data_type, external_id, username, display_name,
               profile_url, avatar_url, bio, email, phone, website, country,
               gender, age_range, followers_count, following_count, posts_count,
               engagement_rate, raw_data)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(task.id, task.platform, data.data_type || 'user',
              data.external_id, data.username, data.display_name,
              data.profile_url, data.avatar_url, data.bio,
              data.email, data.phone, data.website, data.country,
              data.gender, data.age_range, data.followers_count,
              data.following_count, data.posts_count, data.engagement_rate,
              JSON.stringify(data.raw || {}));
          } catch (e) {
            // UNIQUE constraint → 已存在，跳过
          }
        }
      });

      // 任务完成
      this.db.prepare(`
        UPDATE matrix_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(task.id);

      this.emit('task:completed', { taskId: task.id, result });
      console.log(`✅ 任务 #${task.id} 完成: ${task.platform}/${task.action}`);

    } catch (error) {
      console.error(`❌ 任务 #${task.id} 失败:`, error.message);
      
      this.db.prepare(`
        UPDATE matrix_tasks SET status='failed', error_log=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(error.message, task.id);

      this.emit('task:failed', { taskId: task.id, error: error.message });
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  // ==================== 内部工具 ====================

  _isModuleDisabled(platform) {
    try {
      const row = this.db.prepare("SELECT value FROM settings WHERE key='module_switches'").get();
      if (!row || !row.value) return false; // 默认开启
      const switches = JSON.parse(row.value);
      return switches[platform] === false;
    } catch(e) {
      return false; // 出错默认开启
    }
  }

  _updateTaskStatus(taskId, status) {
    const extra = status === 'running' ? ', started_at=CURRENT_TIMESTAMP' : '';
    this.db.prepare(`UPDATE matrix_tasks SET status=?${extra}, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, taskId);
  }
}

module.exports = MatrixTaskEngine;
