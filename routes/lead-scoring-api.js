/**
 * 线索评分 API
 */
const router = require('express').Router();

/** 获取评分规则 */
router.get('/rules', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.json({});
  res.json(ls.getRules());
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 更新评分规则 */
router.put('/rules', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.status(500).json({ error: '评分引擎未初始化' });
  res.json({ success: true, rules: ls.updateRules(req.body) });
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 重置规则 */
router.post('/rules/reset', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.status(500).json({ error: '评分引擎未初始化' });
  res.json({ success: true, rules: ls.resetRules() });
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 记录评分事件 */
router.post('/event', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.status(500).json({ error: '评分引擎未初始化' });
  const { customer_id, event_type, source, details } = req.body;
  if (!customer_id || !event_type) return res.status(400).json({ error: '缺少 customer_id 或 event_type' });
  const result = ls.recordEvent(customer_id, event_type, { source, details });
  if (!result) return res.status(400).json({ error: '未知事件类型: ' + event_type });
  res.json({ success: true, ...result });
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 设置属性评分 */
router.post('/attribute', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.status(500).json({ error: '评分引擎未初始化' });
  const { customer_id, attr_type, attr_value } = req.body;
  if (!customer_id || !attr_type || !attr_value) return res.status(400).json({ error: '缺少参数' });
  const result = ls.setAttribute(customer_id, attr_type, attr_value);
  res.json({ success: true, ...result });
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 获取客户评分详情 */
router.get('/customer/:id', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.json({});
  res.json(ls.getScoreDetail(parseInt(req.params.id)));
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 线索排行榜 */
router.get('/leaderboard', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.json([]);
  const limit = parseInt(req.query.limit) || 50;
  res.json(ls.getLeaderboard(limit));
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 各等级统计 */
router.get('/stats', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.json({});
  res.json(ls.getGradeStats());
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 批量重算 */
router.post('/recalculate', (req, res) => {
  try {
  const ls = req.app.locals.leadScoring;
  if (!ls) return res.status(500).json({ error: '评分引擎未初始化' });
  const count = ls.recalculateAll();
  res.json({ success: true, updated: count });
  } catch(e) { console.error('[LeadScoring] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
