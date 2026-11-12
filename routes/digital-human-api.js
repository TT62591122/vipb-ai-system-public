/**
 * P3-18 AI数字人/克隆翻译 API路由
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { DigitalHumanEngine } = require('../src/digital-human-engine');

const upload = multer({ dest: path.join(__dirname, '..', 'data', 'uploads', 'digital-human') });

module.exports = function(db, io) {
  const engine = new DigitalHumanEngine(db, io);

  // ========== CRUD 数字人形象 ==========

  // 列表
  router.get('/', (req, res) => {
    try {
      const humans = db.prepare('SELECT * FROM digital_humans ORDER BY created_at DESC').all();
      res.json({ success: true, data: humans });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 详情
  router.get('/:id', (req, res) => {
    try {
      const human = db.prepare('SELECT * FROM digital_humans WHERE id = ?').get(req.params.id);
      if (!human) return res.status(404).json({ success: false, error: '数字人不存在' });
      const videos = db.prepare('SELECT * FROM digital_human_videos WHERE human_id = ? ORDER BY created_at DESC').all(req.params.id);
      res.json({ success: true, data: { ...human, videos } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 创建
  router.post('/', upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'voice_sample', maxCount: 1 }]), async (req, res) => {
    try {
      const { name, voice_provider = 'edge-tts', settings = '{}' } = req.body;
      if (!name) return res.status(400).json({ success: false, error: '名称必填' });

      let avatarUrl = null;
      let voiceId = null;

      // 处理头像
      if (req.files?.avatar?.[0]) {
        const result = await engine.generateAvatar(req.files.avatar[0].path);
        avatarUrl = result.avatarUrl;
      } else if (req.body.avatar_description) {
        const result = await engine.generateAvatar(req.body.avatar_description);
        avatarUrl = result.avatarUrl;
      }

      // 处理声音
      if (req.files?.voice_sample?.[0]) {
        const result = await engine.cloneVoice(req.files.voice_sample[0].path, name);
        voiceId = result.voiceId;
      }

      const stmt = db.prepare('INSERT INTO digital_humans (name, avatar_url, voice_id, voice_provider, settings) VALUES (?, ?, ?, ?, ?)');
      const info = stmt.run(name, avatarUrl, voiceId, voice_provider, settings);

      res.json({ success: true, data: { id: info.lastInsertRowid, name, avatar_url: avatarUrl, voice_id: voiceId } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 更新
  router.put('/:id', (req, res) => {
    try {
      const { name, avatar_url, voice_id, voice_provider, settings } = req.body;
      const existing = db.prepare('SELECT * FROM digital_humans WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ success: false, error: '数字人不存在' });

      db.prepare('UPDATE digital_humans SET name=?, avatar_url=?, voice_id=?, voice_provider=?, settings=? WHERE id=?')
        .run(name || existing.name, avatar_url || existing.avatar_url, voice_id || existing.voice_id, voice_provider || existing.voice_provider, settings || existing.settings, req.params.id);

      res.json({ success: true, message: '更新成功' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 删除
  router.delete('/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM digital_human_videos WHERE human_id = ?').run(req.params.id);
      const info = db.prepare('DELETE FROM digital_humans WHERE id = ?').run(req.params.id);
      if (info.changes === 0) return res.status(404).json({ success: false, error: '数字人不存在' });
      res.json({ success: true, message: '删除成功' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========== 生成视频 ==========
  router.post('/:id/generate-video', async (req, res) => {
    try {
      const human = db.prepare('SELECT * FROM digital_humans WHERE id = ?').get(req.params.id);
      if (!human) return res.status(404).json({ success: false, error: '数字人不存在' });

      const { text, language = 'zh', title } = req.body;
      if (!text) return res.status(400).json({ success: false, error: '文本内容必填' });

      // 获取avatarId
      const avatarId = human.avatar_url ? path.basename(human.avatar_url, '.png') : null;
      const voice = human.voice_id || 'zh-CN-XiaoxiaoNeural';

      const result = await engine.createTalkingHead(avatarId, text, voice, language);

      // 保存到数据库
      const stmt = db.prepare('INSERT INTO digital_human_videos (human_id, title, video_path, language, duration, status) VALUES (?, ?, ?, ?, ?, ?)');
      const info = stmt.run(req.params.id, title || `视频-${Date.now()}`, result.videoPath || result.audioPath, language, result.duration || 0, 'completed');

      res.json({ success: true, data: { id: info.lastInsertRowid, ...result } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========== 翻译配音 ==========
  router.post('/:id/translate', async (req, res) => {
    try {
      const human = db.prepare('SELECT * FROM digital_humans WHERE id = ?').get(req.params.id);
      if (!human) return res.status(404).json({ success: false, error: '数字人不存在' });

      const { video_id, target_languages = ['en', 'es', 'ar'] } = req.body;

      let videoPath;
      if (video_id) {
        const video = db.prepare('SELECT * FROM digital_human_videos WHERE id = ? AND human_id = ?').get(video_id, req.params.id);
        if (!video) return res.status(404).json({ success: false, error: '视频不存在' });
        videoPath = video.video_path;
      } else if (req.body.video_path) {
        videoPath = req.body.video_path;
      } else {
        return res.status(400).json({ success: false, error: '需要提供video_id或video_path' });
      }

      const result = await engine.translateAndDub(videoPath, target_languages);

      // 保存翻译结果到数据库
      for (const r of result.results || []) {
        if (r.status === 'completed') {
          db.prepare('INSERT INTO digital_human_videos (human_id, title, video_path, language, status) VALUES (?, ?, ?, ?, ?)')
            .run(req.params.id, `翻译-${r.language}`, r.videoPath, r.language, 'completed');
        }
      }

      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========== 批量生成 ==========
  router.post('/batch-generate', async (req, res) => {
    try {
      const { templates, variants } = req.body;
      if (!templates || !variants) return res.status(400).json({ success: false, error: 'templates和variants必填' });
      const results = await engine.batchGenerate(templates, variants);
      res.json({ success: true, data: results });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========== 视频列表 ==========
  router.get('/:id/videos', (req, res) => {
    try {
      const videos = db.prepare('SELECT * FROM digital_human_videos WHERE human_id = ? ORDER BY created_at DESC').all(req.params.id);
      res.json({ success: true, data: videos });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
