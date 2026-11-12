const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class VideoGenerator {
  constructor(db) {
    this.db = db;
    this.outputDir = path.join(__dirname, '../data/videos');
    this.tempDir = path.join(__dirname, '../data/temp');
  }

  // 初始化目录
  async init() {
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  // 1. 使用Edge TTS生成语音（免费）
  async generateVoiceover(text, outputPath) {
    return new Promise((resolve, reject) => {
      // 使用edge-tts命令行工具
      const cmd = `edge-tts --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}" --voice en-US-JennyNeural`;
      
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error('TTS生成失败，使用静音:', error.message);
          // 如果TTS失败，生成静音音频
          this.generateSilence(5, outputPath).then(resolve).catch(reject);
        } else {
          resolve(outputPath);
        }
      });
    });
  }

  // 生成静音音频（备用）
  async generateSilence(duration, outputPath) {
    return new Promise((resolve, reject) => {
      const cmd = `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${duration} -q:a 9 -acodec libmp3lame "${outputPath}"`;
      exec(cmd, (error) => {
        if (error) reject(error);
        else resolve(outputPath);
      });
    });
  }

  // 2. 生成单个场景视频
  async generateScene(scene, imageFiles, sceneIndex) {
    const scenePath = path.join(this.tempDir, `scene_${sceneIndex}.mp4`);
    const imagePath = imageFiles[sceneIndex % imageFiles.length];
    
    // 生成语音
    const audioPath = path.join(this.tempDir, `audio_${sceneIndex}.mp3`);
    if (scene.voiceover) {
      await this.generateVoiceover(scene.voiceover, audioPath);
    } else {
      await this.generateSilence(scene.duration, audioPath);
    }

    // 使用FFmpeg生成场景视频
    const text = scene.text || '';
    const duration = scene.duration || 5;

    const cmd = `ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" \
      -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,\
      drawtext=text='${text.replace(/'/g, "\\'")}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=(h-text_h)/2:\
      box=1:boxcolor=black@0.5:boxborderw=10" \
      -c:v libx264 -t ${duration} -pix_fmt yuv420p -c:a aac -shortest "${scenePath}"`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 60000 }, (error) => {
        if (error) {
          console.error(`场景${sceneIndex}生成失败:`, error.message);
          reject(error);
        } else {
          resolve(scenePath);
        }
      });
    });
  }

  // 3. 合并所有场景
  async mergeScenes(scenePaths, outputPath) {
    // 创建concat文件
    const concatFile = path.join(this.tempDir, 'concat.txt');
    const concatContent = scenePaths.map(p => `file '${p}'`).join('\n');
    await fs.writeFile(concatFile, concatContent);

    const cmd = `ffmpeg -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 120000 }, (error) => {
        if (error) reject(error);
        else resolve(outputPath);
      });
    });
  }

  // 4. 添加背景音乐（可选）
  async addBackgroundMusic(videoPath, musicPath, outputPath) {
    const cmd = `ffmpeg -i "${videoPath}" -i "${musicPath}" \
      -filter_complex "[1:a]volume=0.3[a1];[0:a][a1]amix=inputs=2:duration=first[aout]" \
      -map 0:v -map "[aout]" -c:v copy -c:a aac "${outputPath}"`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 120000 }, (error) => {
        if (error) {
          console.warn('添加背景音乐失败，使用原视频');
          resolve(videoPath);
        } else {
          resolve(outputPath);
        }
      });
    });
  }

  // 5. 添加公司LOGO水印
  async addWatermark(videoPath, logoPath, outputPath) {
    if (!logoPath) return videoPath;

    const cmd = `ffmpeg -i "${videoPath}" -i "${logoPath}" \
      -filter_complex "[1:v]scale=150:-1[logo];[0:v][logo]overlay=W-w-20:20" \
      -c:a copy "${outputPath}"`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 120000 }, (error) => {
        if (error) {
          console.warn('添加水印失败，使用原视频');
          resolve(videoPath);
        } else {
          resolve(outputPath);
        }
      });
    });
  }

  // 6. 视频随机化处理（防封号）
  async randomizeVideo(videoPath, outputPath) {
    const brightness = (Math.random() * 0.1 - 0.05).toFixed(3);
    const contrast = (1 + Math.random() * 0.1 - 0.05).toFixed(3);
    const saturation = (1 + Math.random() * 0.1 - 0.05).toFixed(3);

    const cmd = `ffmpeg -i "${videoPath}" \
      -vf "eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}" \
      -c:a copy "${outputPath}"`;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 120000 }, (error) => {
        if (error) {
          console.warn('视频随机化失败，使用原视频');
          resolve(videoPath);
        } else {
          resolve(outputPath);
        }
      });
    });
  }

  // 7. 主生成函数
  async generateVideo(videoId, script, imageFiles, options = {}) {
    try {
      await this.init();

      console.log(`开始生成视频 ${videoId}...`);

      // 解析脚本
      let scenes = [];
      if (typeof script === 'string') {
        // 简单解析脚本文本
        scenes = this.parseScript(script);
      } else if (script.scenes) {
        scenes = script.scenes;
      }

      if (scenes.length === 0) {
        throw new Error('脚本为空或格式错误');
      }

      // 生成每个场景
      const scenePaths = [];
      for (let i = 0; i < scenes.length; i++) {
        console.log(`生成场景 ${i + 1}/${scenes.length}...`);
        const scenePath = await this.generateScene(scenes[i], imageFiles, i);
        scenePaths.push(scenePath);
      }

      // 合并场景
      console.log('合并场景...');
      const mergedPath = path.join(this.tempDir, `merged_${videoId}.mp4`);
      await this.mergeScenes(scenePaths, mergedPath);

      // 添加水印
      let finalPath = mergedPath;
      if (options.logoPath) {
        console.log('添加水印...');
        const watermarkedPath = path.join(this.tempDir, `watermarked_${videoId}.mp4`);
        finalPath = await this.addWatermark(finalPath, options.logoPath, watermarkedPath);
      }

      // 视频随机化
      console.log('视频随机化处理...');
      const randomizedPath = path.join(this.outputDir, `${videoId}.mp4`);
      finalPath = await this.randomizeVideo(finalPath, randomizedPath);

      // 清理临时文件
      await this.cleanupTemp(scenePaths);

      console.log(`✅ 视频生成完成: ${finalPath}`);

      return {
        success: true,
        videoPath: finalPath,
        duration: scenes.reduce((sum, s) => sum + (s.duration || 5), 0)
      };

    } catch (error) {
      console.error('视频生成失败:', error);
      throw error;
    }
  }

  // 解析脚本文本
  parseScript(scriptText) {
    const scenes = [];
    const lines = scriptText.split('\n');
    let currentScene = null;

    for (const line of lines) {
      if (line.match(/场景\d+/)) {
        if (currentScene) scenes.push(currentScene);
        currentScene = { duration: 5 };
        
        const durationMatch = line.match(/(\d+)秒/);
        if (durationMatch) {
          currentScene.duration = parseInt(durationMatch[1]);
        }
      } else if (line.startsWith('文案:') && currentScene) {
        currentScene.text = line.replace('文案:', '').replace(/["""]/g, '').trim();
        currentScene.voiceover = currentScene.text;
      }
    }

    if (currentScene) scenes.push(currentScene);
    return scenes;
  }

  // 清理临时文件
  async cleanupTemp(files) {
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch (e) {
        // 忽略删除错误
      }
    }
  }
}

module.exports = VideoGenerator;
