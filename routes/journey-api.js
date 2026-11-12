/**
 * 客户旅程自动化 API
 */
const router = require('express').Router();

router.get('/', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json([]);
  res.json(je.getJourneys());
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.status(500).json({ error: '旅程引擎未初始化' });
  const result = je.createJourney(req.body);
  req.app.locals.auditLog('journey_create', 'journey', result.id, { name: req.body.name });
  res.json({ success: true, ...result });
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.get('/templates', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json([]);
  res.json(je.getTemplates());
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.get('/stats', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json({});
  res.json(je.getStats());
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.get('/:id', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json(null);
  res.json(je.getJourney(parseInt(req.params.id)));
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.put('/:id', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.status(500).json({ error: '旅程引擎未初始化' });
  je.updateJourney(parseInt(req.params.id), req.body);
  res.json({ success: true });
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.status(500).json({ error: '旅程引擎未初始化' });
  je.deleteJourney(parseInt(req.params.id));
  res.json({ success: true });
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 加入旅程
router.post('/:id/enroll', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.status(500).json({ error: '旅程引擎未初始化' });
  const { customer_id } = req.body;
  if (!customer_id) return res.status(400).json({ error: '缺少 customer_id' });
  res.json(je.enrollCustomer(parseInt(req.params.id), customer_id));
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:id/unenroll', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.status(500).json({ error: '旅程引擎未初始化' });
  je.unenrollCustomer(parseInt(req.params.id), req.body.customer_id);
  res.json({ success: true });
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 旅程中的客户
router.get('/:id/enrollments', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json([]);
  res.json(je.getEnrollments(parseInt(req.params.id), req.query.status || 'active'));
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 旅程日志
router.get('/:id/logs', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json([]);
  res.json(je.getLogs(parseInt(req.params.id), parseInt(req.query.limit) || 50));
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 手动处理队列
router.post('/process-queue', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.status(500).json({ error: '旅程引擎未初始化' });
  res.json({ success: true, ...je.processQueue() });
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 客户的旅程历史
router.get('/customer/:customerId', (req, res) => {
  try {
  const je = req.app.locals.journey;
  if (!je) return res.json([]);
  res.json(je.getCustomerJourneys(parseInt(req.params.customerId)));
  } catch(e) { console.error('[Journey] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
