/**
 * 社媒账号管理 API
 */
const router = require('express').Router();

// 获取账号列表
router.get('/', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.json([]);
  res.json(sam.getAccounts(req.query.platform, {
    status: req.query.status,
    search: req.query.search,
    account_type: req.query.type,
  }));
});

// 统计
router.get('/stats', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.json({});
  res.json(sam.getStats(req.query.platform));
});

// 单个添加
router.post('/', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const result = sam.addAccount(req.body);
  if (result.success) req.app.locals.auditLog('social_account_add', 'social_accounts', result.id, { platform: req.body.platform });
  res.json(result);
});

// 批量添加
router.post('/batch', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const { platform, accounts } = req.body;
  if (!platform || !Array.isArray(accounts)) return res.status(400).json({ error: '需要platform和accounts数组' });
  const result = sam.addAccountsBatch(platform, accounts);
  req.app.locals.auditLog('social_account_batch_add', 'social_accounts', null, { platform, count: accounts.length });
  res.json({ success: true, ...result });
});

// 获取单个
router.get('/:id', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.json(null);
  res.json(sam.getAccount(parseInt(req.params.id)));
});

// 更新
router.put('/:id', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  sam.updateAccount(parseInt(req.params.id), req.body);
  res.json({ success: true });
});

// 单个删除
router.delete('/:id', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  sam.deleteAccount(parseInt(req.params.id));
  req.app.locals.auditLog('social_account_delete', 'social_accounts', req.params.id);
  res.json({ success: true });
});

// 批量删除
router.post('/batch-delete', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: '需要ids数组' });
  const result = sam.deleteAccountsBatch(ids);
  req.app.locals.auditLog('social_account_batch_delete', 'social_accounts', null, { count: ids.length });
  res.json({ success: true, ...result });
});

// 更新状态
router.post('/:id/status', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  sam.setStatus(parseInt(req.params.id), req.body.status);
  res.json({ success: true });
});

// ========== 环境绑定接口 ==========
router.put('/:id/bindProxy', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const id = parseInt(req.params.id);
  const proxy_id = req.body.proxy_id || null;
  sam.updateAccount(id, { proxy_id });
  res.json({ success: true });
});

router.put('/:id/bindProfile', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const id = parseInt(req.params.id);
  const profile_id = req.body.profile_id || null;
  sam.updateAccount(id, { profile_id });
  res.json({ success: true });
});

router.put('/:id/bindPhone', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const id = parseInt(req.params.id);
  const phone_id = req.body.phone_id || null;
  sam.updateAccount(id, { phone_id });
  res.json({ success: true });
});

router.get('/:id/bindings', (req, res) => {
  const sam = req.app.locals.socialAccounts;
  if (!sam) return res.status(500).json({ error: '账号管理未初始化' });
  const account = sam.getAccount(parseInt(req.params.id));
  if (!account) return res.status(404).json({ error: '账号不存在' });
  const db = sam.db;
  const proxy = account.proxy_id ? db.prepare('SELECT id,type,host,port,country,is_alive FROM proxies WHERE id=?').get(account.proxy_id) : null;
  const profile = account.profile_id ? db.prepare('SELECT id,name,platform,status,health_score FROM browser_profiles WHERE id=?').get(account.profile_id) : null;
  const phone = account.phone_id ? db.prepare('SELECT id,number,country,status FROM phone_numbers WHERE id=?').get(account.phone_id) : null;
  res.json({ proxy, profile, phone });
});

module.exports = router;
