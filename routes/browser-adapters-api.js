/**
 * 指纹浏览器适配器 API
 */
const router = require('express').Router();

// 获取所有浏览器状态
router.get('/status', async (req, res) => {
  const mgr = req.app.locals.browserAdapters;
  if (!mgr) return res.json({ error: '适配器未初始化' });
  try {
    const status = await mgr.getStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 获取指定浏览器的配置文件列表
router.get('/:type/profiles', async (req, res) => {
  const mgr = req.app.locals.browserAdapters;
  if (!mgr) return res.json({ error: '适配器未初始化' });
  const adapter = mgr.getAdapter(req.params.type);
  if (!adapter) return res.status(400).json({ error: `不支持的浏览器类型: ${req.params.type}` });
  try {
    const profiles = await adapter.listProfiles();
    res.json({ success: true, data: profiles });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 启动配置文件
router.post('/:type/launch', async (req, res) => {
  const mgr = req.app.locals.browserAdapters;
  if (!mgr) return res.json({ error: '适配器未初始化' });
  const adapter = mgr.getAdapter(req.params.type);
  if (!adapter) return res.status(400).json({ error: `不支持的浏览器类型: ${req.params.type}` });
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: '需要 profileId' });
  try {
    const result = await adapter.launch(profileId);
    res.json({ success: true, data: { wsEndpoint: result.wsEndpoint, profileId } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 停止配置文件
router.post('/:type/stop', async (req, res) => {
  const mgr = req.app.locals.browserAdapters;
  if (!mgr) return res.json({ error: '适配器未初始化' });
  const adapter = mgr.getAdapter(req.params.type);
  if (!adapter) return res.status(400).json({ error: `不支持的浏览器类型: ${req.params.type}` });
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: '需要 profileId' });
  try {
    const ok = await adapter.stop(profileId);
    res.json({ success: true, stopped: ok });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 更新配置
router.put('/config', (req, res) => {
  const mgr = req.app.locals.browserAdapters;
  if (!mgr) return res.json({ error: '适配器未初始化' });
  try {
    mgr.saveConfig(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;