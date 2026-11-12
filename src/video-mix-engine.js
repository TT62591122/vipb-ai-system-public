/**
 * AI视频混剪增强引擎
 * 
 * 在现有 VideoGenerator 基础上增加：
 * - 多源素材混剪（多个视频片段+图片混合）
 * - AI生成脚本/字幕
 * - 多语言配音
 * - 批量生成变体（防重复检测）
 * - 转场效果
 */

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { injectProxy } = require('./outbound-proxy');

class VideoMixEngine {
  constructor(db) {
    this.db = db;
    this.outputDir = path.join(__dirname, '../data/videos');
    this.tempDir = path.join(__dirname, '../data/temp');
  }

  async init() {
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  // ==================== AI 脚本生成 ====================

  async generateScript(product, options = {}) {
    const config = this.db.prepare("SELECT * FROM ai_configs WHERE module_name = 'video' AND is_active = 1").get();
    
    if (!config) {
      return this._defaultScript(product);
    }

    const language = options.language || 'en';
    const duration = options.duration || 30;
    const style = options.style || 'professional';

    const prompt = `Create a ${duration}-second video script for: ${product.name || product}
Style: ${style}
Language: ${language}
Target: B2B buyers

Return JSON:
{
  "scenes": [
    {"duration": 5, "text": "hook text", "voiceover": "narration", "transition": "fade"},
    ...
  ],
  "hashtags": ["#tag1", "#tag2"],
  "title": "video title"
}`;

    try {
      const response = await axios.post(`${config.api_base_url}/chat/completions`, {
        model: config.model_name,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8
      }, injectProxy(this.db, {
        headers: { 'Authorization': `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
        timeout: 30000
      }));

      return JSON.parse(response.data.choices[0].message.content);
    } catch (e) {
      return this._defaultScript(product);
    }
  }

  _defaultScript(product) {
    const name = typeof product === 'string' ? product : product.name || 'Product';
    return {
      scenes: [
        { duration: 3, text: `🔥 ${name}`, voiceover: `Introducing ${name}`, transition: 'fade' },
        { duration: 5, text: 'Premium Quality', voiceover: 'Built with premium materials and strict quality control', transition: 'slide' },
        { duration: 5, text: 'Factory Direct', voiceover: 'Direct from factory, best price guaranteed', transition: 'zoom' },
        { duration: 3, text: 'Contact Us Today!', voiceover: 'Contact us for a free quote', transition: 'fade' },
      ],
      hashtags: ['#B2B', '#manufacturer', '#quality'],
      title: `${name} - Factory Direct`
    };
  }

  // ==================== 多源素材混剪 ====================

  async mixClips(clips, outputPath, options = {}) {
    await this.init();
    const tempFiles = [];

    try {
      // 1. 标准化每个片段（统一分辨率/帧率）
      const normalizedClips = [];
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const normalized = path.join(this.tempDir, `norm_${i}_${Date.now()}.mp4`);
        
        const resolution = options.resolution || '1080:1920'; // 竖版
        const startTime = clip.startTime || 0;
        const duration = clip.duration || 5;

        await this._execCmd(
          `ffmpeg -i "${clip.path}" -ss ${startTime} -t ${duration} ` +
          `-vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black" ` +
          `-r 30 -c:v libx264 -c:a aac -ar 44100 -ac 2 "${normalized}"`,
          60000
        );
        
        normalizedClips.push(normalized);
        tempFiles.push(normalized);
      }

      // 2. 添加转场效果
      if (options.transitions !== false && normalizedClips.length > 1) {
        const withTransitions = await this._addTransitions(normalizedClips, tempFiles);
        normalizedClips.length = 0;
        normalizedClips.push(withTransitions);
      }

      // 3. 合并
      const concatFile = path.join(this.tempDir, `concat_${Date.now()}.txt`);
      await fs.writeFile(concatFile, normalizedClips.map(p => `file '${p}'`).join('\n'));
      tempFiles.push(concatFile);

      await this._execCmd(
        `ffmpeg -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`,
        120000
      );

      return outputPath;
    } finally {
      for (const f of tempFiles) {
        try { await fs.unlink(f); } catch (e) {}
      }
    }
  }

  async _addTransitions(clips, tempFiles) {
    // 简单的 crossfade 转场
    if (clips.length < 2) return clips[0];
    
    let current = clips[0];
    for (let i = 1; i < clips.length; i++) {
      const output = path.join(this.tempDir, `trans_${i}_${Date.now()}.mp4`);
      await this._execCmd(
        `ffmpeg -i "${current}" -i "${clips[i]}" ` +
        `-filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=${i * 4.5}[v];[0:a][1:a]acrossfade=d=0.5[a]" ` +
        `-map "[v]" -map "[a]" "${output}"`,
        120000
      ).catch(() => {
        // 转场失败，直接拼接
        return this._execCmd(
          `ffmpeg -i "${current}" -i "${clips[i]}" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v];[0:a][1:a]concat=n=2:v=0:a=1[a]" -map "[v]" -map "[a]" "${output}"`,
          120000
        );
      });
      tempFiles.push(output);
      current = output;
    }
    return current;
  }

  // ==================== 批量变体生成 ====================

  async generateVariants(sourcePath, count = 5, options = {}) {
    await this.init();
    const variants = [];

    for (let i = 0; i < count; i++) {
      const variantPath = path.join(this.outputDir, `variant_${Date.now()}_${i}.mp4`);
      
      // 每个变体有随机差异
      const brightness = (Math.random() * 0.1 - 0.05).toFixed(3);
      const contrast = (1 + Math.random() * 0.1 - 0.05).toFixed(3);
      const saturation = (1 + Math.random() * 0.15 - 0.075).toFixed(3);
      const hue = Math.floor(Math.random() * 10 - 5);
      const speed = (0.95 + Math.random() * 0.1).toFixed(3);
      
      // 随机裁剪几像素（改变哈希）
      const cropX = Math.floor(Math.random() * 4);
      const cropY = Math.floor(Math.random() * 4);

      const filters = [
        `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
        `hue=h=${hue}`,
        `crop=iw-${cropX}:ih-${cropY}:${Math.floor(cropX/2)}:${Math.floor(cropY/2)}`,
        `setpts=${speed}*PTS`
      ].join(',');

      try {
        await this._execCmd(
          `ffmpeg -i "${sourcePath}" -vf "${filters}" -af "atempo=${(1/parseFloat(speed)).toFixed(3)}" ` +
          `-c:v libx264 -c:a aac "${variantPath}"`,
          120000
        );
        variants.push(variantPath);
      } catch (e) {
        console.error(`变体 ${i} 生成失败:`, e.message);
      }
    }

    console.log(`✅ 生成 ${variants.length}/${count} 个视频变体`);
    return variants;
  }

  // ==================== 多语言配音 ====================

  async addMultiLanguageVoiceover(videoPath, text, languages = ['en', 'zh', 'es', 'ar']) {
    const results = [];
    const voiceMap = {
      'en': 'en-US-JennyNeural',
      'zh': 'zh-CN-XiaoxiaoNeural',
      'es': 'es-ES-ElviraNeural',
      'ar': 'ar-SA-ZariyahNeural',
      'fr': 'fr-FR-DeniseNeural',
      'de': 'de-DE-KatjaNeural',
      'pt': 'pt-BR-FranciscaNeural',
      'ru': 'ru-RU-SvetlanaNeural',
      'ja': 'ja-JP-NanamiNeural',
      'ko': 'ko-KR-SunHiNeural'
    };

    for (const lang of languages) {
      const voice = voiceMap[lang] || 'en-US-JennyNeural';
      const audioPath = path.join(this.tempDir, `voice_${lang}_${Date.now()}.mp3`);
      const outputPath = path.join(this.outputDir, `${path.basename(videoPath, '.mp4')}_${lang}.mp4`);

      try {
        // 生成配音
        await this._execCmd(
          `edge-tts --text "${text.replace(/"/g, '\\"')}" --write-media "${audioPath}" --voice ${voice}`,
          30000
        );

        // 替换原音轨
        await this._execCmd(
          `ffmpeg -i "${videoPath}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -c:a aac -shortest "${outputPath}"`,
          60000
        );

        results.push({ language: lang, path: outputPath });

        try { await fs.unlink(audioPath); } catch (e) {}
      } catch (e) {
        console.error(`${lang} 配音失败:`, e.message);
      }
    }

    return results;
  }

  // ==================== 工具 ====================

  _execCmd(cmd, timeout = 60000) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }
}

module.exports = VideoMixEngine;
