/**
 * TaskScheduler - 轻量级替代
 * 
 * 旧版引用了6个不存在的表，所有定时任务已禁用。
 * 此 stub 保留接口兼容性，实际调度将由 MatrixTaskEngine 接管（融合方案）。
 * 
 * 旧文件备份: src/deprecated/task-scheduler.js.bak
 */

const cron = require('node-cron');

class TaskScheduler {
  constructor(db, emailSender, socialPublisher, aiOptimizer) {
    this.db = db;
    this.emailSender = emailSender;
    this.socialPublisher = socialPublisher;
    this.aiOptimizer = aiOptimizer;
    this.tasks = new Map();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🕐 任务调度器已就绪（等待 MatrixTaskEngine 接管）');
  }

  stop() {
    this.tasks.forEach((task) => task.stop());
    this.tasks.clear();
    this.isRunning = false;
  }

  addTask(name, schedule, handler) {
    if (this.tasks.has(name)) return;
    const task = cron.schedule(schedule, async () => {
      try {
        await handler();
      } catch (error) {
        console.error(`任务 ${name} 执行失败:`, error);
      }
    });
    this.tasks.set(name, task);
  }

  removeTask(name) {
    const task = this.tasks.get(name);
    if (task) {
      task.stop();
      this.tasks.delete(name);
    }
  }

  getTasksStatus() {
    const status = {};
    this.tasks.forEach((task, name) => {
      status[name] = { running: true };
    });
    return status;
  }

  async backupDatabase() {
    // better-sqlite3 自动持久化，无需手动备份
    // 保留接口兼容性
    console.log('💾 数据库自动持久化（无需手动备份）');
  }
}

module.exports = TaskScheduler;
