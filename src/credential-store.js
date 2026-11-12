/**
 * 凭证加密存储 (D16 + D18)
 * 自动加密/解密 social_accounts 和 proxies 表的敏感字段
 */
const { encrypt, decrypt } = require('./crypto-utils');

class CredentialStore {
  constructor(db) {
    this.db = db;
  }

  // 存储凭证（自动加密）
  setCredential(table, id, field, value) {
    if (!value) return;
    const encrypted = `ENC:${encrypt(value)}`;
    this.db.prepare(`UPDATE ${table} SET ${field} = ? WHERE id = ?`).run(encrypted, id);
  }

  // 读取凭证（自动解密）
  getCredential(table, id, field) {
    const row = this.db.prepare(`SELECT ${field} FROM ${table} WHERE id = ?`).get(id);
    if (!row) return null;
    const val = row[field];
    if (!val) return null;
    if (val.startsWith('ENC:')) {
      return decrypt(val.slice(4));
    }
    return val; // 未加密的旧数据
  }

  // 批量迁移 social_accounts 明文凭证 → 加密
  migrateSocialAccounts() {
    const accounts = this.db.prepare(
      `SELECT id, cookies, access_token, password FROM social_accounts`
    ).all();

    let migrated = 0;
    for (const acc of accounts) {
      for (const field of ['cookies', 'access_token', 'password']) {
        if (acc[field] && !acc[field].startsWith('ENC:')) {
          this.setCredential('social_accounts', acc.id, field, acc[field]);
          migrated++;
        }
      }
    }
    console.log(`🔐 social_accounts 凭证加密迁移: ${migrated} 个字段`);
    return migrated;
  }

  // 批量迁移 proxies 明文凭证 → 加密 (D18)
  migrateProxies() {
    const proxies = this.db.prepare(
      `SELECT id, username, password FROM proxies`
    ).all();

    let migrated = 0;
    for (const p of proxies) {
      for (const field of ['username', 'password']) {
        if (p[field] && !p[field].startsWith('ENC:')) {
          this.setCredential('proxies', p.id, field, p[field]);
          migrated++;
        }
      }
    }
    console.log(`🔐 proxies 凭证加密迁移: ${migrated} 个字段`);
    return migrated;
  }

  // 一键迁移全部
  migrateAll() {
    const s = this.migrateSocialAccounts();
    const p = this.migrateProxies();
    return s + p;
  }
}

module.exports = CredentialStore;
