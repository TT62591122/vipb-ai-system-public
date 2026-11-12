/**
 * Data Access Layer (DAL) - 统一数据库访问层
 * 
 * 集中管理所有数据库访问模式，替代散布在路由中的 db.prepare() 调用。
 * 
 * 用法:
 *   const dal = require('./src/dal')(db);
 *   const customer = dal.customers.findById(1);
 *   const list = dal.customers.list({ page: 1, limit: 20, search: 'test' });
 */

module.exports = function(db) {
  return {
    // ========== 客户管理 ==========
    customers: {
      findById(id) {
        return db.prepare('SELECT * FROM customers WHERE id=?').get(id);
      },

      findByEmail(email) {
        return db.prepare('SELECT * FROM customers WHERE email=?').get(email);
      },

      create(data) {
        const { company = '', contact_name = '', email, phone, country, source = 'manual', tags = [], notes = '', stage = 'new' } = data;
        const result = db.prepare(
          `INSERT INTO customers (company, contact_name, email, phone, country, source, tags, notes, stage)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(company, contact_name, email || null, phone || null, country || null, source, JSON.stringify(tags), notes, stage);
        return { id: result.lastInsertRowid };
      },

      update(id, data) {
        const allowedFields = ['company', 'contact_name', 'email', 'phone', 'country', 'source', 'lead_score', 'stage', 'tags', 'notes'];
        const updates = [];
        const params = [];

        for (const field of allowedFields) {
          if (data[field] !== undefined) {
            updates.push(`${field}=?`);
            params.push(typeof data[field] === 'object' ? JSON.stringify(data[field]) : data[field]);
          }
        }
        if (updates.length === 0) return { changes: 0 };

        updates.push("updated_at=datetime('now')");
        params.push(id);
        const result = db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id=?`).run(...params);
        return { changes: result.changes };
      },

      delete(id) {
        const result = db.prepare('DELETE FROM customers WHERE id=?').run(id);
        return { changes: result.changes };
      },

      list(opts = {}) {
        const { search, country, stage, page = 1, limit = 20 } = opts;
        const offset = (page - 1) * limit;
        let where = '1=1';
        const params = [];

        if (search) {
          where += ' AND (company LIKE ? OR contact_name LIKE ? OR email LIKE ?)';
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (country) { where += ' AND country=?'; params.push(country); }
        if (stage) { where += ' AND stage=?'; params.push(stage); }

        const total = db.prepare(`SELECT COUNT(*) as c FROM customers WHERE ${where}`).get(...params).c;
        const data = db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
          .all(...params, limit, offset);

        return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
      },

      count() {
        return db.prepare('SELECT COUNT(*) as c FROM customers').get().c;
      },
    },

    // ========== 邮件管理 ==========
    emails: {
      findById(id) {
        return db.prepare('SELECT * FROM emails WHERE id=?').get(id);
      },

      listQueued() {
        return db.prepare("SELECT * FROM emails WHERE status='queued' ORDER BY created_at ASC").all();
      },

      updateStatus(id, status) {
        const result = db.prepare("UPDATE emails SET status=?, updated_at=datetime('now') WHERE id=?").run(status, id);
        return { changes: result.changes };
      },

      count() {
        return db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
      },
    },

    // ========== 活动日志 ==========
    activityLog: {
      create(entry) {
        const { entity_type = '', entity_id = 0, action, details = {}, user_id = 'system', ip_address = 'server' } = entry;
        const result = db.prepare(
          `INSERT INTO activity_log (entity_type, entity_id, action, details, user_id, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(entity_type, entity_id, action, typeof details === 'string' ? details : JSON.stringify(details), user_id, ip_address);
        return { id: result.lastInsertRowid };
      },

      recent(limit = 50) {
        return db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
      },
    },

    // ========== 矩阵任务 ==========
    matrixTasks: {
      findById(id) {
        return db.prepare('SELECT * FROM matrix_tasks WHERE id=?').get(id);
      },

      create(data) {
        const { task_type, platform, account_id, config = {}, status = 'pending', priority = 0 } = data;
        const result = db.prepare(
          `INSERT INTO matrix_tasks (task_type, platform, account_id, config, status, priority, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(task_type, platform, account_id || null, JSON.stringify(config), status, priority);
        return { id: result.lastInsertRowid };
      },

      updateStatus(id, status) {
        const result = db.prepare("UPDATE matrix_tasks SET status=?, updated_at=datetime('now') WHERE id=?").run(status, id);
        return { changes: result.changes };
      },

      list(opts = {}) {
        const { status, platform, page = 1, limit = 20 } = opts;
        const offset = (page - 1) * limit;
        let where = '1=1';
        const params = [];

        if (status) { where += ' AND status=?'; params.push(status); }
        if (platform) { where += ' AND platform=?'; params.push(platform); }

        const total = db.prepare(`SELECT COUNT(*) as c FROM matrix_tasks WHERE ${where}`).get(...params).c;
        const data = db.prepare(`SELECT * FROM matrix_tasks WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(...params, limit, offset);

        return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
      },
    },
  };
};
