const express = require('express');

function createVideoRouter(db, aiEngine) {
  const router = express.Router();

  // GET /api/videos — 视频列表
  router.get('/', (req, res) => {
    try {
      const videos = db.prepare(`
        SELECT v.*, h.name as avatar_name 
        FROM digital_human_videos v 
        LEFT JOIN digital_humans h ON v.human_id = h.id 
        ORDER BY v.created_at DESC
      `).all() || [];
      res.json({ success: true, videos });
    } catch (e) {
      console.error('[VIDEO] list error:', e.message);
      res.json({ success: true, videos: [] });
    }
  });

  // GET /api/videos/avatars — 数字人列表
  router.get('/avatars', (req, res) => {
    try {
      const avatars = db.prepare('SELECT * FROM digital_humans ORDER BY created_at DESC').all() || [];
      // 前端期望 name + type 字段
      const mapped = avatars.map(a => ({
        id: a.id,
        name: a.name,
        type: a.voice_provider || 'heygen',
        avatar_url: a.avatar_url,
        voice_id: a.voice_id,
        created_at: a.created_at
      }));
      res.json({ success: true, avatars: mapped });
    } catch (e) {
      console.error('[VIDEO] avatars list error:', e.message);
      res.json({ success: true, avatars: [] });
    }
  });

  // POST /api/videos/avatars — 添加数字人
  router.post('/avatars', (req, res) => {
    try {
      const { name, type, external_id } = req.body;
      if (!name) return res.status(400).json({ success: false, error: '名称不能为空' });
      const result = db.prepare(
        'INSERT INTO digital_humans (name, voice_provider, voice_id) VALUES (?, ?, ?)'
      ).run(name, type || 'heygen', external_id || '');
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
      console.error('[VIDEO] create avatar error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/videos/generate-script — AI生成视频脚本
  router.post('/generate-script', async (req, res) => {
    try {
      const { topic, style, duration, language, notes } = req.body;
      if (!topic) return res.status(400).json({ success: false, error: '请输入主题' });

      // 如果有AI引擎，调用生成
      if (aiEngine && typeof aiEngine.chat === 'function') {
        const prompt = `你是一个专业的外贸产品视频脚本编剧。请为以下主题生成一个${duration || 30}秒的${style || '专业'}风格视频脚本。
主题：${topic}
语言：${language === 'zh' ? '中文' : language === 'en' ? 'English' : language}
${notes ? '补充要求：' + notes : ''}

请输出完整的视频脚本，包含：画面描述、旁白文字、时间节点。`;
        const result = await aiEngine.chat(prompt);
        return res.json({ success: true, script: result });
      }

      // 无AI引擎时返回模板
      res.json({
        success: true,
        script: `【${topic} - 视频脚本】\n\n` +
          `风格：${style || '专业'} | 时长：${duration || 30}秒 | 语言：${language || 'zh'}\n\n` +
          `[0-5s] 开场：品牌Logo + 产品全景\n` +
          `[5-15s] 核心卖点展示\n` +
          `[15-25s] 应用场景/客户案例\n` +
          `[25-${duration || 30}s] CTA + 联系方式\n\n` +
          `（提示：请配置AI引擎以获得AI自动生成的脚本）`
      });
    } catch (e) {
      console.error('[VIDEO] generate-script error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/videos/batch-variants — 批量生成变体
  router.post('/batch-variants', (req, res) => {
    try {
      const { source_id, languages, count } = req.body;
      if (!source_id) return res.status(400).json({ success: false, error: '请指定源视频ID' });

      // 查找源视频
      const source = db.prepare('SELECT * FROM digital_human_videos WHERE id = ?').get(source_id);
      if (!source) return res.status(404).json({ success: false, error: '源视频不存在' });

      const created = [];
      const langs = languages || ['en'];
      const num = Math.min(count || 1, 20);

      for (let i = 0; i < num; i++) {
        const lang = langs[i % langs.length];
        const result = db.prepare(
          'INSERT INTO digital_human_videos (human_id, title, language, status) VALUES (?, ?, ?, ?)'
        ).run(source.human_id, `${source.title || '变体'} - ${lang} #${i + 1}`, lang, 'pending');
        created.push(result.lastInsertRowid);
      }

      res.json({ success: true, message: `已创建 ${created.length} 个变体任务`, ids: created });
    } catch (e) {
      console.error('[VIDEO] batch-variants error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/videos/:id — 删除视频
  router.delete('/:id', (req, res) => {
    try {
      const { id } = req.params;
      db.prepare('DELETE FROM digital_human_videos WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (e) {
      console.error('[VIDEO] delete error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = createVideoRouter;
