/**
 * P3-19 矩阵直播转播引擎
 * 拉取源流 → 推送到多个目标平台（YouTube/Facebook/TikTok/Instagram/Twitch）
 * 每个目标独立 ffmpeg 进程，独立监控
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');

const PLATFORMS = {
  youtube:   { name: 'YouTube Live',   prefix: 'rtmp://a.rtmp.youtube.com/live2/' },
  facebook:  { name: 'Facebook Live',  prefix: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
  tiktok:    { name: 'TikTok Live',    prefix: 'rtmp://push.tiktokcdn.com/live/' },
  instagram: { name: 'Instagram Live', prefix: 'rtmps://live-upload.instagram.com:443/rtmp/' },
  twitch:    { name: 'Twitch',         prefix: 'rtmp://live.twitch.tv/app/' },
};

class LiveRestreamEngine extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    // streamId -> { targetPlatform -> { process, stats } }
    this.activeProcesses = new Map();
    this.scheduledTimers = new Map();
  }

  // ========== CRUD ==========

  createStream(config) {
    const { name, sourceUrl, targets } = config;
    if (!sourceUrl) throw new Error('sourceUrl is required');
    const targetsJson = JSON.stringify(targets || []);
    const stmt = this.db.prepare(
      `INSERT INTO restream_sessions (name, source_url, targets, status) VALUES (?, ?, ?, 'idle')`
    );
    const result = stmt.run(name || 'Untitled', sourceUrl, targetsJson);
    const session = this.getSession(result.lastInsertRowid);
    this._log(session.id, 'system', 'created', { name, sourceUrl, targets });
    return session;
  }

  getSession(id) {
    const row = this.db.prepare('SELECT * FROM restream_sessions WHERE id = ?').get(id);
    if (!row) throw new Error(`Session ${id} not found`);
    row.targets = JSON.parse(row.targets || '[]');
    row.overlay_config = JSON.parse(row.overlay_config || '{}');
    return row;
  }

  listSessions(opts = {}) {
    const { limit = 50, offset = 0, status } = opts;
    let sql = 'SELECT * FROM restream_sessions';
    const params = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this.db.prepare(sql).all(...params).map(r => {
      r.targets = JSON.parse(r.targets || '[]');
      r.overlay_config = JSON.parse(r.overlay_config || '{}');
      return r;
    });
  }

  updateStream(id, updates) {
    const allowed = ['name', 'source_url', 'targets'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (updates[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(k === 'targets' ? JSON.stringify(updates[k]) : updates[k]);
      }
    }
    if (!sets.length) return this.getSession(id);
    vals.push(id);
    this.db.prepare(`UPDATE restream_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.getSession(id);
  }

  deleteStream(id) {
    this.stopRestream(id);
    this.db.prepare('DELETE FROM restream_sessions WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM restream_logs WHERE session_id = ?').run(id);
    return { ok: true };
  }

  // ========== Restream Control ==========

  startRestream(streamId) {
    const session = this.getSession(streamId);
    if (session.status === 'live') throw new Error('Already live');
    if (!session.targets.length) throw new Error('No targets configured');

    const procs = {};
    this.activeProcesses.set(streamId, procs);

    for (const target of session.targets) {
      this._startTargetProcess(streamId, session.source_url, target, session.overlay_config);
    }

    this.db.prepare(
      `UPDATE restream_sessions SET status = 'live', started_at = datetime('now') WHERE id = ?`
    ).run(streamId);

    this._log(streamId, 'system', 'started', { targets: session.targets.map(t => t.platform) });
    this.emit('stream:started', { streamId });
    return this.getSession(streamId);
  }

  stopRestream(streamId) {
    const procs = this.activeProcesses.get(streamId);
    if (procs) {
      for (const [platform, info] of Object.entries(procs)) {
        try { info.process.kill('SIGTERM'); } catch (_) {}
      }
      this.activeProcesses.delete(streamId);
    }

    // Cancel scheduled timer
    const timer = this.scheduledTimers.get(streamId);
    if (timer) { clearTimeout(timer); this.scheduledTimers.delete(streamId); }

    try {
      this.db.prepare(
        `UPDATE restream_sessions SET status = 'stopped', stopped_at = datetime('now') WHERE id = ?`
      ).run(streamId);
      this._log(streamId, 'system', 'stopped', {});
    } catch (_) {}

    this.emit('stream:stopped', { streamId });
    return { ok: true };
  }

  getStatus(streamId) {
    const session = this.getSession(streamId);
    const procs = this.activeProcesses.get(streamId) || {};
    const targetStatuses = {};

    for (const [platform, info] of Object.entries(procs)) {
      targetStatuses[platform] = {
        running: !info.process.killed,
        pid: info.process.pid,
        bitrate: info.stats.bitrate || '0 kbps',
        fps: info.stats.fps || 0,
        uptime: info.stats.startedAt ? Math.floor((Date.now() - info.stats.startedAt) / 1000) : 0,
        errors: info.stats.errors || 0,
      };
    }

    return {
      id: session.id,
      name: session.name,
      status: session.status,
      source_url: session.source_url,
      targets: session.targets,
      overlay_config: session.overlay_config,
      scheduled_at: session.scheduled_at,
      started_at: session.started_at,
      stopped_at: session.stopped_at,
      targetStatuses,
    };
  }

  // ========== Overlay ==========

  addOverlay(streamId, overlay) {
    const session = this.getSession(streamId);
    const config = { ...session.overlay_config, ...overlay };
    this.db.prepare('UPDATE restream_sessions SET overlay_config = ? WHERE id = ?')
      .run(JSON.stringify(config), streamId);
    this._log(streamId, 'system', 'overlay_updated', overlay);

    // If live, restart all processes with new overlay
    if (session.status === 'live') {
      this.stopRestream(streamId);
      this.db.prepare(`UPDATE restream_sessions SET status = 'idle' WHERE id = ?`).run(streamId);
      this.startRestream(streamId);
    }
    return this.getSession(streamId);
  }

  // ========== Schedule ==========

  scheduleStream(streamId, startTime) {
    const dt = new Date(startTime);
    if (isNaN(dt.getTime())) throw new Error('Invalid startTime');
    const delay = dt.getTime() - Date.now();
    if (delay < 0) throw new Error('startTime is in the past');

    this.db.prepare('UPDATE restream_sessions SET scheduled_at = ?, status = ? WHERE id = ?')
      .run(dt.toISOString(), 'scheduled', streamId);

    // Clear old timer
    const old = this.scheduledTimers.get(streamId);
    if (old) clearTimeout(old);

    const timer = setTimeout(() => {
      try {
        this.startRestream(streamId);
        this.scheduledTimers.delete(streamId);
      } catch (e) {
        this._log(streamId, 'system', 'schedule_error', { error: e.message });
      }
    }, delay);

    this.scheduledTimers.set(streamId, timer);
    this._log(streamId, 'system', 'scheduled', { startTime: dt.toISOString() });
    return this.getSession(streamId);
  }

  // ========== Internal ==========

  _buildFfmpegArgs(sourceUrl, target, overlay) {
    const args = ['-re', '-i', sourceUrl];

    // Overlay filters
    const filters = [];
    if (overlay.watermark) {
      args.push('-i', overlay.watermark);
      filters.push('overlay=W-w-10:10');
    }
    if (overlay.text) {
      const escaped = overlay.text.replace(/'/g, "'\\''");
      const fontSize = overlay.fontSize || 24;
      const fontColor = overlay.fontColor || 'white';
      filters.push(`drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:x=10:y=H-th-10`);
    }

    if (filters.length) {
      args.push('-filter_complex', filters.join(','));
    }

    // Output
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', target.bitrate || '2500k',
      '-maxrate', target.bitrate || '2500k', '-bufsize', '5000k',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv',
      target.rtmpUrl
    );

    return args;
  }

  _startTargetProcess(streamId, sourceUrl, target, overlay) {
    const procs = this.activeProcesses.get(streamId) || {};
    const rtmpUrl = target.rtmpUrl || ((PLATFORMS[target.platform]?.prefix || '') + (target.streamKey || ''));
    const fullTarget = { ...target, rtmpUrl };

    const args = this._buildFfmpegArgs(sourceUrl, fullTarget, overlay);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const info = {
      process: proc,
      stats: { startedAt: Date.now(), bitrate: '0 kbps', fps: 0, errors: 0 },
    };

    // Parse ffmpeg stderr for stats
    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\r');
      stderrBuf = lines.pop();
      for (const line of lines) {
        const bitrateMatch = line.match(/bitrate=\s*([\d.]+\s*kbits\/s)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        if (bitrateMatch) info.stats.bitrate = bitrateMatch[1];
        if (fpsMatch) info.stats.fps = parseFloat(fpsMatch[1]);
      }
    });

    proc.on('error', (err) => {
      info.stats.errors++;
      this._log(streamId, target.platform, 'error', { error: err.message });
    });

    proc.on('exit', (code) => {
      this._log(streamId, target.platform, 'process_exit', { code });
      // Auto-restart on unexpected exit if session still live
      try {
        const s = this.getSession(streamId);
        if (s.status === 'live' && code !== 0) {
          setTimeout(() => {
            try {
              if (this.getSession(streamId).status === 'live') {
                this._startTargetProcess(streamId, sourceUrl, target, overlay);
              }
            } catch (_) {}
          }, 5000);
        }
      } catch (_) {}
    });

    procs[target.platform] = info;
    this.activeProcesses.set(streamId, procs);
    this._log(streamId, target.platform, 'process_started', { pid: proc.pid });
  }

  _log(sessionId, platform, event, data) {
    try {
      this.db.prepare(
        `INSERT INTO restream_logs (session_id, target_platform, event, data, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
      ).run(sessionId, platform, event, JSON.stringify(data));
    } catch (_) {}
  }

  getLogs(sessionId, opts = {}) {
    const { limit = 100, offset = 0 } = opts;
    return this.db.prepare(
      'SELECT * FROM restream_logs WHERE session_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
    ).all(sessionId, limit, offset).map(r => {
      try { r.data = JSON.parse(r.data); } catch (_) {}
      return r;
    });
  }

  getSupportedPlatforms() {
    return PLATFORMS;
  }
}

module.exports = LiveRestreamEngine;
