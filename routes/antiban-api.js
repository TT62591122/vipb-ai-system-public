/**
 * 防封规则管理 API
 */
const router = require('express').Router();

/** 获取当前规则 */
router.get('/rules', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.json({ error: '防封引擎未初始化' });
  res.json(ab.getRules());
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 获取默认规则（用于对比/重置） */
router.get('/rules/default', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.json({ error: '防封引擎未初始化' });
  res.json(ab.getDefaultRules());
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 更新全部规则 */
router.put('/rules', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.status(500).json({ error: '防封引擎未初始化' });
  const rules = ab.updateRules(req.body);
  req.app.locals.auditLog('antiban_update', 'system', 0, { version: rules.version });
  res.json({ success: true, rules });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 更新单个平台规则 */
router.put('/rules/:platform', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.status(500).json({ error: '防封引擎未初始化' });
  const rules = ab.updatePlatformRules(req.params.platform, req.body);
  req.app.locals.auditLog('antiban_update_platform', 'system', 0, { platform: req.params.platform });
  res.json({ success: true, rules: rules[req.params.platform] });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 重置为默认规则 */
router.post('/rules/reset', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.status(500).json({ error: '防封引擎未初始化' });
  const rules = ab.resetRules();
  req.app.locals.auditLog('antiban_reset', 'system', 0, {});
  res.json({ success: true, rules });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 检查是否允许操作 */
router.post('/check', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.json({ allowed: true });
  const { platform, accountId, action, context } = req.body;
  const result = ab.check(platform, accountId || 'default', action, context || {});
  res.json(result);
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 获取所有账号状态 */
router.get('/accounts', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.json([]);
  res.json(ab.getAccountStatuses());
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 注册新账号 */
router.post('/accounts', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.status(500).json({ error: '防封引擎未初始化' });
  const { platform, accountId, createdDate } = req.body;
  ab.registerAccount(platform, accountId, createdDate);
  res.json({ success: true });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 暂停账号 */
router.post('/accounts/:platform/:accountId/pause', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.status(500).json({ error: '防封引擎未初始化' });
  const hours = parseInt(req.body.hours) || 24;
  ab.pauseAccount(req.params.platform, req.params.accountId, hours);
  req.app.locals.auditLog('antiban_pause', 'account', 0, { platform: req.params.platform, accountId: req.params.accountId, hours });
  res.json({ success: true });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 取消暂停 */
router.post('/accounts/:platform/:accountId/unpause', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.status(500).json({ error: '防封引擎未初始化' });
  ab.unpauseAccount(req.params.platform, req.params.accountId);
  res.json({ success: true });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 获取账号今日统计 */
router.get('/accounts/:platform/:accountId/stats', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.json({});
  const stats = ab.getTodayStats(req.params.platform, req.params.accountId);
  const age = ab.getAccountAge(req.params.platform, req.params.accountId);
  const stage = ab._getCurrentStage(req.params.platform, req.params.accountId);
  res.json({ stats, age, stage });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 生成内容变体 */
router.post('/variation', (req, res) => {
  try {
  const ab = req.app.locals.antiban;
  if (!ab) return res.json({ content: req.body.content });
  const variation = ab.generateVariation(req.body.content || '');
  res.json({ original: req.body.content, variation });
  } catch(e) { console.error('[AntiBan] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
