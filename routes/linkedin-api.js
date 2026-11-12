/**
 * LinkedIn 自动化 API
 */
const router = require('express').Router();

// ===== 序列管理 =====
router.get('/sequences', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.json([]);
  res.json(li.getSequences());
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/sequences', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  const result = li.createSequence(req.body);
  req.app.locals.auditLog('linkedin_sequence_create', 'li_sequence', result.id, { name: req.body.name });
  res.json({ success: true, ...result });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.put('/sequences/:id', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.updateSequence(parseInt(req.params.id), req.body);
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/sequences/:id', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.deleteSequence(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// ===== 目标客户 =====
router.get('/prospects', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.json({ data: [], pagination: {} });
  res.json(li.getProspects({
    search: req.query.search,
    status: req.query.status,
    sequence_id: req.query.sequence_id ? parseInt(req.query.sequence_id) : undefined,
    has_replied: req.query.replied === '1' ? true : req.query.replied === '0' ? false : undefined,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
  }));
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/prospects', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  if (Array.isArray(req.body)) {
    const result = li.addProspectsBatch(req.body);
    res.json({ success: true, ...result });
  } else {
    const result = li.addProspect(req.body);
    res.json(result);
  }
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/prospects/:id', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.deleteProspect(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// ===== 序列操作 =====
router.post('/enroll', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  const { prospect_ids, sequence_id } = req.body;
  if (!prospect_ids || !sequence_id) return res.status(400).json({ error: '缺少参数' });
  const result = li.enrollInSequence(prospect_ids, sequence_id);
  req.app.locals.auditLog('linkedin_enroll', 'li_sequence', sequence_id, { count: prospect_ids.length });
  res.json({ success: true, ...result });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/unenroll/:prospectId', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.unenrollFromSequence(parseInt(req.params.prospectId));
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/prospects/:id/replied', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.markReplied(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/prospects/:id/connected', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.markConnected(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/prospects/:id/link-customer', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  li.linkCustomer(parseInt(req.params.id), parseInt(req.body.customer_id));
  res.json({ success: true });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// ===== 处理队列 =====
router.post('/process-queue', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.status(500).json({ error: 'LinkedIn模块未初始化' });
  const result = li.processSequenceQueue();
  res.json({ success: true, ...result });
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// ===== 统计 & 日志 =====
router.get('/stats', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.json({});
  res.json(li.getStats());
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.get('/prospects/:id/logs', (req, res) => {
  try {
  const li = req.app.locals.linkedin;
  if (!li) return res.json([]);
  res.json(li.getActionLogs(parseInt(req.params.id)));
  } catch(e) { console.error('[LinkedIn] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
