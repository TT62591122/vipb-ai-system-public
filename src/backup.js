/**
 * 数据库自动备份模块
 * - 复制 vipb.db 到 data/backups/
 * - 文件名格式: vipb-backup-YYYY-MM-DD-HHmmss.db
 * - 保留最近7天备份，自动清理
 * - 支持手动触发和定时触发
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'vipb.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const RETENTION_DAYS = 7;

/**
 * 确保备份目录存在
 */
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * 生成备份文件名
 */
function generateBackupName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `vipb-backup-${timestamp}.db`;
}

/**
 * 执行备份（同步版，使用 VACUUM INTO 确保 WAL 合并）
 * @param {object} db - better-sqlite3 数据库实例
 * @returns {{ success: boolean, filename?: string, size?: number, error?: string }}
 */
function performBackup(db) {
  try {
    ensureBackupDir();

    const filename = generateBackupName();
    const destPath = path.join(BACKUP_DIR, filename);

    // 使用 VACUUM INTO 创建完整独立备份（合并 WAL）
    // 这是 SQLite 3.27+ 支持的安全备份方式
    try {
      db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    } catch (vacuumErr) {
      // 如果 VACUUM INTO 不支持，fallback 到 pragma + copyFile
      if (DB_PATH === ':memory:') throw vacuumErr;
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(DB_PATH, destPath);
    }

    const stats = fs.statSync(destPath);
    console.log(`💾 备份完成: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    return {
      success: true,
      filename,
      size: stats.size,
      path: destPath
    };
  } catch (err) {
    console.error('❌ 备份失败:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 获取备份列表
 * @returns {Array<{ filename: string, size: number, created: string }>}
 */
function listBackups() {
  ensureBackupDir();

  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('vipb-backup-') && f.endsWith('.db'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          size: stats.size,
          sizeFormatted: formatSize(stats.size),
          created: stats.mtime.toISOString(),
          createdFormatted: stats.mtime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        };
      })
      .sort((a, b) => b.created.localeCompare(a.created)); // 最新的在前

    return files;
  } catch (err) {
    console.error('获取备份列表失败:', err.message);
    return [];
  }
}

/**
 * 删除指定备份
 * @param {string} filename 
 * @returns {{ success: boolean, error?: string }}
 */
function deleteBackup(filename) {
  try {
    // 安全检查：防止路径穿越
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return { success: false, error: '非法文件名' };
    }
    if (!filename.startsWith('vipb-backup-') || !filename.endsWith('.db')) {
      return { success: false, error: '不是有效的备份文件' };
    }

    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ 已删除备份: ${filename}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 获取备份文件路径（用于下载）
 * @param {string} filename 
 * @returns {string|null}
 */
function getBackupPath(filename) {
  // 安全检查
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }
  if (!filename.startsWith('vipb-backup-') || !filename.endsWith('.db')) {
    return null;
  }

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

/**
 * 清理过期备份（保留最近N天）
 * @param {number} retentionDays 
 * @returns {{ deleted: number, errors: number }}
 */
function cleanOldBackups(retentionDays = RETENTION_DAYS) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const backups = listBackups();
  let deleted = 0;
  let errors = 0;

  backups.forEach(backup => {
    const backupDate = new Date(backup.created);
    if (backupDate < cutoff) {
      const result = deleteBackup(backup.filename);
      if (result.success) {
        deleted++;
      } else {
        errors++;
      }
    }
  });

  if (deleted > 0) {
    console.log(`🧹 清理旧备份: 删除${deleted}个, 失败${errors}个`);
  }

  return { deleted, errors };
}

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

module.exports = {
  performBackup,
  listBackups,
  deleteBackup,
  getBackupPath,
  cleanOldBackups,
  BACKUP_DIR
};
