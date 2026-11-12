/**
 * SEO API 路由
 */
const express = require('express');

function createSEORouter(seoEngine) {
  const router = express.Router();

  // 分析单个页面
  router.post('/analyze', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: '缺少 url' });
      const result = await seoEngine.analyzePage(url);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 批量分析
  router.post('/analyze/batch', async (req, res) => {
    try {
      const { urls } = req.body;
      if (!urls || !urls.length) return res.status(400).json({ error: '缺少 urls' });
      const result = await seoEngine.batchAnalyze(urls);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 关键词研究
  router.post('/keywords', async (req, res) => {
    try {
      const seed = req.body.seed || req.body.keyword;
      const { language, country } = req.body;
      if (!seed) return res.status(400).json({ error: '缺少关键词' });
      const result = await seoEngine.researchKeywords(seed, language, country);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // AI内容优化
  router.post('/optimize', async (req, res) => {
    try {
      const { content, keyword, language } = req.body;
      if (!content || !keyword) return res.status(400).json({ error: '缺少 content/keyword' });
      const result = await seoEngine.optimizeContent(content, keyword, { language });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 生成站点地图
  router.post('/sitemap', async (req, res) => {
    try {
      const { baseUrl, pages } = req.body;
      if (!baseUrl || !pages) return res.status(400).json({ error: '缺少 baseUrl/pages' });
      const xml = await seoEngine.generateSitemap(baseUrl, pages);
      res.type('application/xml').send(xml);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = createSEORouter;
