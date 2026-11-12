/**
 * Enhanced Audit Logger - 增强审计日志模块
 * 
 * 在现有 app.locals.auditLog 基础上提供:
 * - 结构化分类日志 (auth, data, system, security)
 * - 批量插入支持
 * - 查询辅助方法
 * - created_at 索引确保
 * 
 * 用法:
 *   const AuditLogger = require('./src/audit-logger');
 *   const audit = new AuditLogger(db);
 *   audit.log({ category: 'auth', action: 'login', userId: 'admin', ip: '127.0.0.1' });
 */

const CATEGORIES = ['auth', 'data', 'system', 'security'];

class AuditLogger {
  constructor(db) {
    this.db = db;
    this._ensureIndex();
    this._prepareStatements();
  }

  /** 确保 created_at 索引存在 */
  _ensureIndex() {
    try {
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)`
      ).run();
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id)`
      ).run();
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_activity_log_entity_type ON activity_log(entity_type)`
      ).run();
    } catch (err) {
      console.error('[AuditLogger] 索引创建失败:', err.message);
    }
  }

  /** 预编译常用语句 */
  _prepareStatements() {
    this._insertStmt = this.db.prepare(
      `INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    );
    this._batchInsert = this.db.transaction((entries) => {
      for (const e of entries) {
        this._insertStmt.run(
          e.entity_type || e.category || '',
          e.entity_id || 0,
          e.action || '',
          typeof e.details === 'string' ? e.details : JSON.stringify(e.details || {}),
          e.userId || e.user_id || 'system',
          e.ip || e.ip_address || 'server'
        );
      }
      return { inserted: entries.length };
    });
  }

  /**
   * 记录单条审计日志
   * @param {Object} entry
   * @param {string} entry.category - auth|data|system|security
   * @param {string} entry.action - 操作描述
   * @param {string} [entry.entityType] - 实体类型
   * @param {number} [entry.entityId] - 实体ID
   * @param {object} [entry.details] - 详情
   * @param {string} [entry.userId] - 用户ID
   * @param {string} [entry.ip] - IP地址
   */
  log(entry) {
    try {
      const category = CATEGORIES.includes(entry.category) ? entry.category : 'system';
      this._insertStmt.run(
        entry.entityType || category,
        entry.entityId || 0,
        entry.action || '',
        typeof entry.details === 'string' ? entry.details : JSON.stringify({ ...entry.details, _category: category }),
        entry.userId || 'system',
        entry.ip || 'server'
      );
    } catch (err) {
      console.error('[AuditLogger] 日志写入失败:', err.message);
    }
  }

  /** 从 Express req 对象提取信息并记录 */
  logReq(req, action, details = {}, category = 'system') {
    this.log({
      category,
      action,
      details,
      userId: req.session?.userId || 'anonymous',
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
    });
  }

  /** 批量插入 */
  batchLog(entries) {
    try {
      return this._batchInsert(entries);
    } catch (err) {
      console.error('[AuditLogger] 批量写入失败:', err.message);
      return { inserted: 0 };
    }
  }

  // ========== 查询方法 ==========

  /** 按实体类型查询 */
  getByEntity(entityType, limit = 50) {
    return this.db.prepare(
      'SELECT * FROM activity_log WHERE entity_type=? ORDER BY created_at DESC LIMIT ?'
    ).all(entityType, limit);
  }

  /** 按用户查询 */
  getByUser(userId, limit = 50) {
    return this.db.prepare(
      'SELECT * FROM activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit);
  }

  /** 按日期范围查询 */
  getByDateRange(startDate, endDate, limit = 200) {
    return this.db.prepare(
      'SELECT * FROM activity_log WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ?'
    ).all(startDate, endDate, limit);
  }

  /** 获取最近的错误日志 */
  getRecentErrors(limit = 50) {
    return this.db.prepare(
      "SELECT * FROM activity_log WHERE action LIKE '%error%' OR action LIKE '%fail%' OR action LIKE '%Error%' ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  }

  /** 按分类查询 */
  getByCategory(category, limit = 50) {
    return this.db.prepare(
      "SELECT * FROM activity_log WHERE entity_type=? OR details LIKE ? ORDER BY created_at DESC LIMIT ?"
    ).all(category, `%"_category":"${category}"%`, limit);
  }
}

module.exports = AuditLogger;
