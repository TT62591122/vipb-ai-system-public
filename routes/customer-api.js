/**
 * 客户身份合并 API
 * - POST /api/customers/build-index — 重建身份索引
 * - GET /api/customers/:id/identifiers — 获取客户跨渠道标识
 * - GET /api/customers/:id/conversations — 获取客户所有渠道对话
 * - POST /api/customers/:id/add-identifier — 添加标识
 * - POST /api/customers/merge — 合并两个客户
 * - GET /api/customers/find?q=xxx — 按任意标识查找客户
 */
const router = require('express').Router();

module.exports = function(db) {
  const { CustomerMerger } = require('../src/customer-merger');
  const merger = new CustomerMerger(db);

  // 启动时自动建索引
  try { merger.buildIndex(); } catch(e) { console.error('客户索引构建失败:', e.message); }

  // 重建身份索引
  router.post('/build-index', (req, res) => {
    try {
      const result = merger.buildIndex();
      res.json({ success: true, ...result });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 获取客户跨渠道标识
  router.get('/:id/identifiers', (req, res) => {
    const identifiers = merger.getCustomerIdentifiers(parseInt(req.params.id));
    res.json({ success: true, data: identifiers });
  });

  // 获取客户所有渠道对话
  router.get('/:id/conversations', (req, res) => {
    const conversations = merger.getCustomerConversations(parseInt(req.params.id));
    res.json({ success: true, data: conversations });
  });

  // 添加标识
  router.post('/:id/add-identifier', (req, res) => {
    const { channel, identifier } = req.body;
    if (!channel || !identifier) return res.status(400).json({ error: '需要channel和identifier' });
    const result = merger.addIdentifier(parseInt(req.params.id), channel, identifier);
    res.json(result);
  });

  // 合并客户
  router.post('/merge', (req, res) => {
    const { keepId, mergeId } = req.body;
    if (!keepId || !mergeId) return res.status(400).json({ error: '需要keepId和mergeId' });
    const result = merger.mergeCustomers(parseInt(keepId), parseInt(mergeId));
    res.json(result);
  });

  // 按标识查找客户
  router.get('/find', (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: '请提供查询参数q' });
    const customer = merger.findCustomer(q);
    res.json({ success: true, data: customer });
  });

  return router;
};
