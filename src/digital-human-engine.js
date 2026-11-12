/**
 * P3-18 AI数字人/克隆翻译引擎
 * 功能：声音克隆、数字人形象生成、口型同步视频、多语言翻译配音、批量生成
 */
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const { injectProxyFetch } = require('./outbound-proxy');

class DigitalHumanEngine {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this.outputDir = path.join(__dirname, '..', 'data', 'digital-humans');
    this.voiceDir = path.join(this.outputDir, 'voices');
    this.avatarDir = path.join(this.outputDir, 'avatars');
    this.videoDir = path.join(this.outputDir, 'videos');
    this._ensureDirs();
  }

  _ensureDirs() {
    [this.outputDir, this.voiceDir, this.avatarDir, this.videoDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _notify(type, data) {
    if (this.io) this.io.emit('digital-human', { type, data, timestamp: new Date().toISOString() });
  }

  // ========== 声音克隆 ==========
  async cloneVoice(audioSample, name) {
    const voiceId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const provider = process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'edge-tts';

    if (provider === 'elevenlabs') {
      try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices/add', 
          injectProxyFetch(this.db, {
            method: 'POST',
            headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            body: (() => {
              const FormData = require('form-data');
              const form = new FormData();
              form.append('name', name);
              if (Buffer.isBuffer(audioSample)) {
                form.append('files', audioSample, { filename: 'sample.mp3', contentType: 'audio/mpeg' });
              } else if (fs.existsSync(audioSample)) {
                form.append('files', fs.createReadStream(audioSample));
              }
              return form;
            })()
          })
        );
        const result = await response.json();
        if (result.voice_id) {
          return { voiceId: result.voice_id, provider: 'elevenlabs', name };
        }
      } catch (err) {
        console.error('[DigitalHuman] ElevenLabs克隆失败，回退到edge-tts:', err.message);
      }
    }

    // Edge TTS fallback — 保存样本引用，使用预设声音
    const samplePath = path.join(this.voiceDir, `${voiceId}.mp3`);
    if (Buffer.isBuffer(audioSample)) {
      fs.writeFileSync(samplePath, audioSample);
    } else if (typeof audioSample === 'string' && fs.existsSync(audioSample)) {
      fs.copyFileSync(audioSample, samplePath);
    }

    return { voiceId, provider: 'edge-tts', name, samplePath };
  }

  // ========== 数字人形象生成 ==========
  async generateAvatar(imageOrDescription, options = {}) {
    const avatarId = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const avatarPath = path.join(this.avatarDir, `${avatarId}.png`);

    // 如果传入的是图片文件/Buffer，直接保存
    if (Buffer.isBuffer(imageOrDescription)) {
      fs.writeFileSync(avatarPath, imageOrDescription);
      return { avatarId, avatarUrl: `/data/digital-humans/avatars/${avatarId}.png`, type: 'uploaded' };
    }

    if (typeof imageOrDescription === 'string' && fs.existsSync(imageOrDescription)) {
      fs.copyFileSync(imageOrDescription, avatarPath);
      return { avatarId, avatarUrl: `/data/digital-humans/avatars/${avatarId}.png`, type: 'uploaded' };
    }

    // 文字描述 → 调用AI图像生成
    const description = typeof imageOrDescription === 'string' ? imageOrDescription : 'professional business person';

    // 尝试 DALL-E / Stability AI
    if (process.env.OPENAI_API_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/images/generations', 
          injectProxyFetch(this.db, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: `Professional digital human avatar: ${description}. Photorealistic, front-facing, neutral background, suitable for video presentation.`,
              n: 1,
              size: options.size || '1024x1024',
              response_format: 'b64_json'
            })
          })
        );
        const result = await response.json();
        if (result.data && result.data[0]) {
          const imgBuffer = Buffer.from(result.data[0].b64_json, 'base64');
          fs.writeFileSync(avatarPath, imgBuffer);
          return { avatarId, avatarUrl: `/data/digital-humans/avatars/${avatarId}.png`, type: 'generated' };
        }
      } catch (err) {
        console.error('[DigitalHuman] 图像生成失败:', err.message);
      }
    }

    // Fallback: 使用占位头像
    return { avatarId, avatarUrl: null, type: 'placeholder', message: '需要配置OPENAI_API_KEY来生成AI头像' };
  }

  // ========== 口型同步数字人视频 ==========
  async createTalkingHead(avatarId, text, voice, language = 'zh') {
    const videoId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const videoPath = path.join(this.videoDir, `${videoId}.mp4`);
    const audioPath = path.join(this.videoDir, `${videoId}_audio.mp3`);

    // Step 1: 生成语音
    await this._generateSpeech(text, voice, language, audioPath);

    // Step 2: 尝试 D-ID API
    if (process.env.DID_API_KEY) {
      try {
        const result = await this._didCreateVideo(avatarId, audioPath, text);
        if (result.videoUrl) {
          // 下载视频
          const videoResponse = await fetch(result.videoUrl, injectProxyFetch(this.db, {}));
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          fs.writeFileSync(videoPath, videoBuffer);

          const duration = this._getVideoDuration(videoPath);
          this._notify('video_created', { videoId, avatarId, duration });
          return { videoId, videoPath, duration, provider: 'd-id' };
        }
      } catch (err) {
        console.error('[DigitalHuman] D-ID失败，使用ffmpeg合成:', err.message);
      }
    }

    // Step 3: Fallback — ffmpeg简单合成（静态图片 + 音频）
    const avatarFile = path.join(this.avatarDir, `${avatarId}.png`);
    if (fs.existsSync(avatarFile) && fs.existsSync(audioPath)) {
      try {
        execSync(
          `ffmpeg -y -loop 1 -i "${avatarFile}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${videoPath}"`,
          { timeout: 120000, stdio: 'pipe' }
        );
        const duration = this._getVideoDuration(videoPath);
        this._notify('video_created', { videoId, avatarId, duration });
        return { videoId, videoPath, duration, provider: 'ffmpeg' };
      } catch (err) {
        console.error('[DigitalHuman] ffmpeg合成失败:', err.message);
      }
    }

    // 返回仅音频
    return { videoId, audioPath, videoPath: null, provider: 'audio-only', message: '视频合成需要ffmpeg或D-ID API' };
  }

  // ========== 视频多语言翻译配音 ==========
  async translateAndDub(videoPath, targetLanguages = ['en', 'es', 'ar']) {
    if (!fs.existsSync(videoPath)) throw new Error(`视频文件不存在: ${videoPath}`);

    const results = [];
    const baseName = path.basename(videoPath, path.extname(videoPath));

    // Step 1: 提取音频
    const extractedAudio = path.join(this.videoDir, `${baseName}_extracted.wav`);
    try {
      execSync(`ffmpeg -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 "${extractedAudio}"`, { timeout: 60000, stdio: 'pipe' });
    } catch (err) {
      console.error('[DigitalHuman] 音频提取失败:', err.message);
      // 继续，使用文本输入方式
    }

    // Step 2: 语音转文字（使用AI）
    let sourceText = '';
    if (process.env.OPENAI_API_KEY && fs.existsSync(extractedAudio)) {
      try {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', fs.createReadStream(extractedAudio));
        form.append('model', 'whisper-1');
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', 
          injectProxyFetch(this.db, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
            body: form
          })
        );
        const result = await response.json();
        sourceText = result.text || '';
      } catch (err) {
        console.error('[DigitalHuman] 语音识别失败:', err.message);
      }
    }

    if (!sourceText) {
      return { error: '无法提取视频文本，需要配置OPENAI_API_KEY', results: [] };
    }

    // Step 3: 对每种目标语言翻译+配音
    for (const lang of targetLanguages) {
      try {
        // 翻译
        const translatedText = await this._translateText(sourceText, lang);

        // 生成配音
        const dubAudioPath = path.join(this.videoDir, `${baseName}_dub_${lang}.mp3`);
        const voiceMap = { en: 'en-US-JennyNeural', es: 'es-ES-ElviraNeural', ar: 'ar-SA-ZariyahNeural', fr: 'fr-FR-DeniseNeural', de: 'de-DE-KatjaNeural', ja: 'ja-JP-NanamiNeural', ko: 'ko-KR-SunHiNeural', pt: 'pt-BR-FranciscaNeural', ru: 'ru-RU-SvetlanaNeural', zh: 'zh-CN-XiaoxiaoNeural' };
        const voiceName = voiceMap[lang] || 'en-US-JennyNeural';
        await this._generateSpeech(translatedText, voiceName, lang, dubAudioPath);

        // 替换音轨
        const outputPath = path.join(this.videoDir, `${baseName}_${lang}.mp4`);
        try {
          execSync(`ffmpeg -y -i "${videoPath}" -i "${dubAudioPath}" -c:v copy -map 0:v:0 -map 1:a:0 "${outputPath}"`, { timeout: 120000, stdio: 'pipe' });
        } catch {
          // 如果视频无视频流，仅保存音频
          fs.copyFileSync(dubAudioPath, outputPath);
        }

        results.push({ language: lang, text: translatedText, videoPath: outputPath, status: 'completed' });

        // 保存到数据库
        this._notify('translation_completed', { language: lang, videoPath: outputPath });
      } catch (err) {
        results.push({ language: lang, status: 'failed', error: err.message });
      }
    }

    return { sourceText, results };
  }

  // ========== 批量生成数字人视频变体 ==========
  async batchGenerate(templates, variants) {
    const results = [];
    for (const template of templates) {
      for (const variant of variants) {
        try {
          const merged = { ...template, ...variant };
          const result = await this.createTalkingHead(
            merged.avatarId,
            merged.text,
            merged.voice || 'zh-CN-XiaoxiaoNeural',
            merged.language || 'zh'
          );

          // 保存到数据库
          if (merged.humanId) {
            this.db.prepare(`INSERT INTO digital_human_videos (human_id, title, video_path, language, duration, status) VALUES (?, ?, ?, ?, ?, 'completed')`)
              .run(merged.humanId, merged.title || `批量视频-${Date.now()}`, result.videoPath || result.audioPath, merged.language || 'zh', result.duration || 0);
          }

          results.push({ template: template.id, variant: variant.id, ...result, status: 'completed' });
        } catch (err) {
          results.push({ template: template.id, variant: variant.id, status: 'failed', error: err.message });
        }
      }
    }

    this._notify('batch_completed', { total: results.length, success: results.filter(r => r.status === 'completed').length });
    return results;
  }

  // ========== 内部方法 ==========

  async _generateSpeech(text, voice, language, outputPath) {
    // 尝试 ElevenLabs
    if (process.env.ELEVENLABS_API_KEY && voice && !voice.includes('Neural')) {
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, 
          injectProxyFetch(this.db, {
            method: 'POST',
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
          })
        );
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          fs.writeFileSync(outputPath, buffer);
          return;
        }
      } catch (err) {
        console.error('[DigitalHuman] ElevenLabs TTS失败:', err.message);
      }
    }

    // Edge TTS (via command line)
    const voiceName = voice || 'zh-CN-XiaoxiaoNeural';
    try {
      const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 5000);
      execSync(`edge-tts --voice "${voiceName}" --text "${escapedText}" --write-media "${outputPath}"`, { timeout: 60000, stdio: 'pipe' });
    } catch (err) {
      // Fallback: 使用 OpenAI TTS
      if (process.env.OPENAI_API_KEY) {
        const response = await fetch('https://api.openai.com/v1/audio/speech', 
          injectProxyFetch(this.db, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1', input: text.slice(0, 4096), voice: 'alloy' })
          })
        );
        if (response.ok) {
          fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
          return;
        }
      }
      throw new Error(`语音生成失败: ${err.message}`);
    }
  }

  async _translateText(text, targetLang) {
    const langNames = { en: 'English', es: 'Spanish', ar: 'Arabic', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese' };
    const targetName = langNames[targetLang] || targetLang;

    if (process.env.OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', 
        injectProxyFetch(this.db, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `You are a professional translator. Translate the following text to ${targetName}. Return only the translation, no explanations.` },
              { role: 'user', content: text }
            ],
            temperature: 0.3
          })
        })
      );
      const result = await response.json();
      return result.choices?.[0]?.message?.content || text;
    }

    // 无API key时返回原文
    return `[${targetLang}] ${text}`;
  }

  async _didCreateVideo(avatarId, audioPath, text) {
    const avatarFile = path.join(this.avatarDir, `${avatarId}.png`);
    if (!fs.existsSync(avatarFile)) throw new Error('头像文件不存在');

    // Upload image to D-ID
    const imgBuffer = fs.readFileSync(avatarFile);
    const imgBase64 = imgBuffer.toString('base64');

    const response = await fetch('https://api.d-id.com/talks', 
      injectProxyFetch(this.db, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${process.env.DID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source_url: `data:image/png;base64,${imgBase64}`,
          script: { type: 'text', input: text, provider: { type: 'microsoft', voice_id: 'zh-CN-XiaoxiaoNeural' } }
        })
      })
    );

    const result = await response.json();
    if (!result.id) throw new Error(result.message || 'D-ID创建失败');

    // 轮询等待完成
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(`https://api.d-id.com/talks/${result.id}`, 
        injectProxyFetch(this.db, {
          headers: { 'Authorization': `Basic ${process.env.DID_API_KEY}` }
        })
      );
      const status = await statusRes.json();
      if (status.status === 'done') return { videoUrl: status.result_url };
      if (status.status === 'error') throw new Error('D-ID视频生成失败');
    }
    throw new Error('D-ID视频生成超时');
  }

  _getVideoDuration(videoPath) {
    try {
      const output = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`, { timeout: 10000, stdio: 'pipe' });
      return parseFloat(output.toString().trim()) || 0;
    } catch {
      return 0;
    }
  }
}

module.exports = { DigitalHumanEngine };
