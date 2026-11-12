/**
 * 紧急刹车 API
 */
const router = require('express').Router();

/** 获取刹车状态 */
router.get('/status', (req, res) => {
  try {
  const brake = req.app.locals.brake;
  if (!brake) return res.status(500).json({ error: '刹车系统未初始化' });
  res.json(brake.getStatus());
  } catch(e) { console.error('[Emergency] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 紧急停止 */
router.post('/stop', (req, res) => {
  try {
  const brake = req.app.locals.brake;
  if (!brake) return res.status(500).json({ error: '刹车系统未初始化' });
  const reason = req.body.reason || '手动停止';
  const result = brake.stopAll(reason, 'manual');
  if (result.success) {
    req.app.locals.auditLog('emergency_stop_manual', 'system', 0, { reason });
  }
  res.json(result);
  } catch(e) { console.error('[Emergency] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 恢复运行 */
router.post('/resume', (req, res) => {
  try {
  const brake = req.app.locals.brake;
  if (!brake) return res.status(500).json({ error: '刹车系统未初始化' });
  const options = {
    resumeMatrix: req.body.resumeMatrix !== false,
    resumeInbox: req.body.resumeInbox !== false,
    resumeCron: req.body.resumeCron !== false
  };
  const result = brake.resumeAll(options);
  if (result.success) {
    req.app.locals.auditLog('emergency_resume_manual', 'system', 0, { options, recovered: result.recovered });
  }
  res.json(result);
  } catch(e) { console.error('[Emergency] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 风险日志 */
router.get('/logs', (req, res) => {
  try {
  const brake = req.app.locals.brake;
  if (!brake) return res.status(500).json({ error: '刹车系统未初始化' });
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  res.json(brake.getLogs(limit, offset));
  } catch(e) { console.error('[Emergency] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 获取配置 */
router.get('/config', (req, res) => {
  try {
  const brake = req.app.locals.brake;
  if (!brake) return res.status(500).json({ error: '刹车系统未初始化' });
  res.json(brake.getConfig());
  } catch(e) { console.error('[Emergency] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

/** 更新配置 */
router.put('/config', (req, res) => {
  try {
  const brake = req.app.locals.brake;
  if (!brake) return res.status(500).json({ error: '刹车系统未初始化' });
  const config = brake.updateConfig(req.body);
  req.app.locals.auditLog('emergency_config_update', 'system', 0, { config });
  res.json({ success: true, config });
  } catch(e) { console.error('[Emergency] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
