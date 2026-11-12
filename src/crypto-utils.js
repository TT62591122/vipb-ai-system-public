/**
 * 加密工具 — 保护敏感数据
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// S3: 动态加密密钥
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || (() => {
  const s = crypto.randomBytes(16).toString('hex'); // 32 hex chars = 32 bytes
  console.warn('⚠️ ENCRYPTION_KEY未设置，使用随机值（重启后已加密数据无法解密）');
  return s;
})();
const IV_LENGTH = 16;

/**
 * 加密文本
 */
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * 解密文本
 */
function decrypt(text) {
  if (!text) return '';
  try {
    const parts = text.split(':');
    if (parts.length !== 2) return text; // 可能是未加密的旧数据
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('解密失败:', err.message);
    return text; // 返回原文，可能是未加密的旧数据
  }
}

/**
 * 哈希密码（bcrypt，10轮盐）
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * 验证密码（兼容旧SHA256哈希）
 */
async function verifyPassword(password, hash) {
  if (!hash.startsWith('$2')) {
    return crypto.createHash('sha256').update(password).digest('hex') === hash;
  }
  return bcrypt.compare(password, hash);
}

module.exports = { encrypt, decrypt, hashPassword, verifyPassword };
