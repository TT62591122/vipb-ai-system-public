/**
 * 配置管理 — 从config目录读取，不硬编码
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configDir = path.join(__dirname, '..', 'config');
const configFile = path.join(configDir, 'settings.yaml');

// 默认配置（后备值）
// 注意：email warmup、公司信息等运行时配置优先从数据库 settings 表读取
// 此处仅作为数据库无数据时的后备默认值和服务器基础配置（端口等）
const defaults = {
  port: parseInt(process.env.PORT) || 3001,
  ai: {
    providers: [],
    defaultModel: 'claude-sonnet',
    dailyBudget: 20,
    monthlyBudget: 500,
    costMultiplier: 0.45,
    routing: { sonnet: 70, opus: 25, haiku: 5 }
  },
  email: {
    warmup: { week1: 3, week2: 8, week3: 15, week4: 25, week5plus: 40 },
    maxPerDay: 40,
    intervalMinSec: 180,
    intervalMaxSec: 480,
    bounceThreshold: 0.08,
    complaintThreshold: 0.003
  },
  whatsapp: {
    personalLimit: 30,
    businessLimit: 80,
    intervalMinSec: 45,
    intervalMaxSec: 180
  },
  company: {
    name: '',
    products: 'Smart Meters, Circuit Breakers',
    markets: '中东, 东南亚, 非洲, 南美'
  }
};

// 加载配置
function loadConfig() {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (fs.existsSync(configFile)) {
    try {
      const loaded = yaml.load(fs.readFileSync(configFile, 'utf8'));
      return deepMerge(defaults, loaded || {});
    } catch (e) {
      console.warn('[CONFIG] Failed to load settings.yaml, using defaults');
    }
  }
  // 首次运行，写入默认配置
  fs.writeFileSync(configFile, yaml.dump(defaults), 'utf8');
  return { ...defaults };
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function saveConfig(cfg) {
  fs.writeFileSync(configFile, yaml.dump(cfg), 'utf8');
}

const config = loadConfig();
config.save = saveConfig;
module.exports = config;
