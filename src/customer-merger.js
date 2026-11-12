/**
 * 客户身份跨渠道合并引擎
 * - 按手机号、邮箱自动匹配同一客户在不同渠道的对话
 * - 合并统一收件箱中的 conversation → customer 关联
 * - 手动合并/拆分支持
 */

class CustomerMerger {
  constructor(db) {
    this.db = db;
    this._ensureSchema();
  }

  _ensureSchema() {
    // Add customer_id to inbox_conversations if not linked
    // Already exists per schema check. Ensure customer_identifiers table:
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS customer_identifiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        channel TEXT NOT NULL,       -- 'whatsapp' | 'email' | 'linkedin' | 'facebook'
        identifier TEXT NOT NULL,    -- phone number, email, linkedin url, etc.
        verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now')),
        UNIQUE(channel, identifier)
      );
      CREATE INDEX IF NOT EXISTS idx_ci_customer ON customer_identifiers(customer_id);
      CREATE INDEX IF NOT EXISTS idx_ci_identifier ON customer_identifiers(identifier);
    `);
  }

  /**
   * Scan all customers and build identifier index from existing data
   */
  buildIndex() {
    const customers = this.db.prepare('SELECT id, email, phone FROM customers').all();
    const upsert = this.db.prepare(
      'INSERT OR IGNORE INTO customer_identifiers (customer_id, channel, identifier, verified) VALUES (?, ?, ?, 1)'
    );
    
    let added = 0;
    const tx = this.db.transaction(() => {
      for (const c of customers) {
        if (c.email) {
          upsert.run(c.id, 'email', c.email.toLowerCase().trim());
          added++;
        }
        if (c.phone) {
          const phone = c.phone.replace(/[^0-9+]/g, '');
          if (phone.length >= 7) {
            upsert.run(c.id, 'whatsapp', phone);
            upsert.run(c.id, 'phone', phone);
            added++;
          }
        }
      }
    });
    tx();

    // Also scan WhatsApp conversations
    const waConvos = this.db.prepare(
      "SELECT id, channel_id, contact_name FROM inbox_conversations WHERE channel = 'whatsapp' AND customer_id IS NULL"
    ).all();
    
    for (const conv of waConvos) {
      const phone = (conv.channel_id || '').replace('@c.us', '').replace(/[^0-9]/g, '');
      if (phone.length >= 7) {
        const match = this.db.prepare(
          'SELECT customer_id FROM customer_identifiers WHERE identifier = ? AND channel IN (?, ?)'
        ).get(phone, 'whatsapp', 'phone');

        if (match) {
          this.db.prepare('UPDATE inbox_conversations SET customer_id = ? WHERE id = ?')
            .run(match.customer_id, conv.id);
          console.log(`🔗 关联: WA对话 ${conv.contact_name} → 客户 #${match.customer_id}`);
        }
      }
    }

    // Scan email conversations
    const emailConvos = this.db.prepare(
      "SELECT id, channel_id, contact_name FROM inbox_conversations WHERE channel = 'email' AND customer_id IS NULL"
    ).all();

    for (const conv of emailConvos) {
      const email = (conv.channel_id || '').toLowerCase().trim();
      if (email.includes('@')) {
        const match = this.db.prepare(
          "SELECT customer_id FROM customer_identifiers WHERE identifier = ? AND channel = 'email'"
        ).get(email);

        if (match) {
          this.db.prepare('UPDATE inbox_conversations SET customer_id = ? WHERE id = ?')
            .run(match.customer_id, conv.id);
          console.log(`🔗 关联: 邮件对话 ${conv.contact_name} → 客户 #${match.customer_id}`);
        }
      }
    }

    console.log(`🔗 客户身份索引: 处理 ${customers.length} 个客户, 新增 ${added} 条标识`);
    return { customers: customers.length, identifiers: added, waLinked: waConvos.length, emailLinked: emailConvos.length };
  }

  /**
   * Find customer by any identifier (phone, email, etc.)
   */
  findCustomer(identifier) {
    const normalized = identifier.toLowerCase().trim().replace(/[^0-9a-z@.+_-]/g, '');
    const match = this.db.prepare(
      'SELECT ci.customer_id, c.company, c.contact_name, c.email, c.phone FROM customer_identifiers ci JOIN customers c ON c.id = ci.customer_id WHERE ci.identifier = ?'
    ).get(normalized);
    return match || null;
  }

  /**
   * Add an identifier to a customer
   */
  addIdentifier(customerId, channel, identifier) {
    try {
      this.db.prepare(
        'INSERT OR REPLACE INTO customer_identifiers (customer_id, channel, identifier, verified) VALUES (?, ?, ?, 1)'
      ).run(customerId, channel, identifier.toLowerCase().trim());
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get all identifiers for a customer (cross-channel view)
   */
  getCustomerIdentifiers(customerId) {
    return this.db.prepare(
      'SELECT channel, identifier, verified, created_at FROM customer_identifiers WHERE customer_id = ? ORDER BY channel'
    ).all(customerId);
  }

  /**
   * Get all conversations for a customer across channels
   */
  getCustomerConversations(customerId) {
    return this.db.prepare(
      'SELECT * FROM inbox_conversations WHERE customer_id = ? ORDER BY last_message_at DESC'
    ).all(customerId);
  }

  /**
   * Manual merge: merge customer B into customer A
   */
  mergeCustomers(keepId, mergeId) {
    if (keepId === mergeId) return { success: false, error: '不能合并同一客户' };

    const keep = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(keepId);
    const merge = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(mergeId);
    if (!keep || !merge) return { success: false, error: '客户不存在' };

    const tx = this.db.transaction(() => {
      // Move identifiers
      this.db.prepare('UPDATE OR IGNORE customer_identifiers SET customer_id = ? WHERE customer_id = ?')
        .run(keepId, mergeId);
      // Move conversations
      this.db.prepare('UPDATE inbox_conversations SET customer_id = ? WHERE customer_id = ?')
        .run(keepId, mergeId);
      // Move emails
      this.db.prepare('UPDATE emails SET customer_id = ? WHERE customer_id = ?')
        .run(keepId, mergeId);
      // Move activity logs
      this.db.prepare("UPDATE activity_log SET entity_id = ? WHERE entity_type = 'customer' AND entity_id = ?")
        .run(keepId, mergeId);
      // Fill empty fields in keep from merge
      if (!keep.phone && merge.phone) {
        this.db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run(merge.phone, keepId);
      }
      if (!keep.email && merge.email) {
        this.db.prepare('UPDATE customers SET email = ? WHERE id = ?').run(merge.email, keepId);
      }
      // Append notes
      if (merge.notes) {
        const newNotes = (keep.notes || '') + '\n[合并自 #' + mergeId + '] ' + merge.notes;
        this.db.prepare('UPDATE customers SET notes = ? WHERE id = ?').run(newNotes.trim(), keepId);
      }
      // Delete merged customer
      this.db.prepare('DELETE FROM customer_identifiers WHERE customer_id = ?').run(mergeId);
      this.db.prepare('DELETE FROM customers WHERE id = ?').run(mergeId);
    });
    tx();

    console.log(`🔗 客户合并: #${mergeId} → #${keepId}`);
    return { success: true, message: `客户 #${mergeId} 已合并到 #${keepId}` };
  }
}

module.exports = { CustomerMerger };
