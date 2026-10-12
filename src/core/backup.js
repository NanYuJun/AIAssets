import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const RCLONE_PATH = process.env.RCLONE_PATH || path.resolve(process.cwd(), 'tools/rclone.exe');

const PROVIDER_DEFAULTS = {
  r2: { name: 'Cloudflare R2', endpoint: 'https://<account_id>.r2.cloudflarestorage.com' },
  oss: { name: '阿里云 OSS', endpoint: 'https://oss-<region>.aliyuncs.com' },
  cos: { name: '腾讯云 COS', endpoint: 'https://cos.<region>.myqcloud.com' },
  s3: { name: 'AWS S3 / 自定义 S3', endpoint: '' }
};

function runRclone(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(RCLONE_PATH)) return resolve({ ok: false, error: 'rclone.exe 不存在（tools/rclone.exe）' });
    execFile(RCLONE_PATH, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: (stderr || err.message || '').slice(0, 500) });
      else resolve({ ok: true, output: String(stdout || '').slice(-2000) });
    });
  });
}

export class BackupManager {
  constructor(dataDir, { hubDataDir, storageDirs }) {
    this.configPath = path.join(dataDir, 'backup-config.json');
    this.statePath = path.join(dataDir, 'backup-state.json');
    this.hubDataDir = hubDataDir;
    this.storageDirs = storageDirs; // array of dirs to back up
    this.timer = null;
  }

  get config() {
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf-8')); }
    catch { return { enabled: false, frequencyHours: 6, localMirror: { enabled: false, dir: '' }, destinations: [] }; }
  }

  saveConfig(cfg) { fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf-8'); }

  get state() {
    try { return JSON.parse(fs.readFileSync(this.statePath, 'utf-8')); }
    catch { return { lastRun: null, results: [], running: false }; }
  }

  saveState(st) { fs.writeFileSync(this.statePath, JSON.stringify(st, null, 2), 'utf-8'); }

  maskSecrets(cfg) {
    const clone = JSON.parse(JSON.stringify(cfg));
    for (const d of clone.destinations || []) {
      if (d.secretKey) { d.secretKey = d.secretKey.slice(0, 4) + '****'; d._hasSecret = true; }
    }
    return clone;
  }

  ensureRemote(d) {
    // 为目标生成 rclone remote 配置（写入 rclone.conf 到 tools 旁）
    const confDir = path.dirname(RCLONE_PATH);
    const confPath = path.join(confDir, 'rclone.conf');
    const lines = [
      '[' + d.id + ']',
      'type = s3',
      'provider = Other',
      'access_key_id = ' + d.accessKey,
      'secret_access_key = ' + d.secretKey,
      'endpoint = ' + (d.endpoint || PROVIDER_DEFAULTS[d.type]?.endpoint || '')
    ];
    fs.writeFileSync(confPath, lines.join('\n') + '\n', 'utf-8');
    return confPath;
  }

  async runOne(dest) {
    const stamp = new Date().toISOString().slice(0, 10);
    const results = [];
    // 1) 打包为 zip（保证一致性 + 便于恢复）
    const zipPath = await this.packZip(dest.id + '-' + stamp);
    if (!zipPath.ok) return { id: dest.id, name: dest.name, ok: false, error: zipPath.error, files: [] };
    results.push({ step: 'pack', ok: true, file: zipPath.file, sizeBytes: zipPath.sizeBytes });

    // 2) 推送到远端
    const confPath = this.ensureRemote(dest);
    const remote = dest.id + ':' + (dest.prefix ? dest.prefix.replace(/^\/+|\/+$/g, '') + '/' : '') + path.basename(zipPath.file);
    const push = await runRclone(['--config', confPath, 'copy', zipPath.file, remote, '--no-check-dest']);
    results.push({ step: 'push', ok: push.ok, error: push.error, remote });
    if (!push.ok) return { id: dest.id, name: dest.name, ok: false, steps: results };

    // 3) 保留最近 N 份（默认 14）
    const keep = dest.keepVersions || 14;
    const list = await runRclone(['--config', confPath, 'lsjson', dest.id + ':' + (dest.prefix ? dest.prefix.replace(/^\/+|\/+$/g, '') + '/' : '')]);
    if (list.ok) {
      try {
        const files = JSON.parse(list.output).filter(f => f.Name && f.Name.startsWith(dest.id + '-')).sort((a, b) => (b.ModTime || '').localeCompare(a.ModTime || ''));
        for (const old of files.slice(keep)) {
          await runRclone(['--config', confPath, 'deletefile', dest.id + ':' + (dest.prefix ? dest.prefix.replace(/^\/+|\/+$/g, '') + '/' : '') + old.Name]);
        }
        results.push({ step: 'prune', ok: true, kept: Math.min(files.length, keep) });
      } catch {}
    }
    return { id: dest.id, name: dest.name, ok: true, steps: results };
  }

  async packZip(stamp) {
    // 使用 rclone 的 zip？rclone 无 zip。改用 Node 内置：无 zip 库 → 用 tar？Windows 10+ 自带 tar.exe
    const tmpDir = path.join(this.hubDataDir, '..', 'backup-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, 'agent-sync-hub-backup-' + stamp + '.zip');
    // 用 PowerShell Compress-Archive 兜底（单文件 zip，排除 lock 文件）
    const dirs = [this.hubDataDir, ...this.storageDirs].filter(d => fs.existsSync(d));
    return new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-Command',
        '$ErrorActionPreference="Stop"; ' +
        dirs.map((d, i) => 'Copy-Item -Recurse -Force "' + d + '" "$env:TEMP\\ashub-' + i + '"; ').join('') +
        'Compress-Archive -Force -Path ' + dirs.map((d, i) => '"$env:TEMP\\ashub-' + i + '"').join(', ') + ' -DestinationPath "' + file + '"; ' +
        dirs.map((d, i) => 'Remove-Item -Recurse -Force "$env:TEMP\\ashub-' + i + '"; ').join('')
      ], { timeout: 10 * 60 * 1000, windowsHide: true }, (err) => {
        if (err) return resolve({ ok: false, error: String(err.message).slice(0, 300) });
        try { resolve({ ok: true, file, sizeBytes: fs.statSync(file).size }); } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
  }

  async runLocalMirror(dir) {
    // 本地镜像：直接 robocopy（PowerShell 调用），/MIR 镜像
    const dirs = [this.hubDataDir, ...this.storageDirs].filter(d => fs.existsSync(d));
    const results = [];
    for (let i = 0; i < dirs.length; i++) {
      const dest = path.join(dir, path.basename(dirs[i]));
      const res = await new Promise((resolve) => {
        execFile('robocopy', [dirs[i], dest, '/MIR', '/NFL', '/NDL', '/NJH', '/R:2', '/W:5'], { timeout: 10 * 60 * 1000, windowsHide: true }, (err, stdout) => {
          // robocopy 退出码 0-7 都是成功
          resolve({ ok: !err || err.code <= 7, code: err ? err.code : 0 });
        });
      });
      results.push({ dir: path.basename(dirs[i]), ...res });
    }
    return results;
  }

  async runNow() {
    const cfg = this.config;
    const state = this.state;
    if (state.running) return { ok: false, error: '备份正在执行中' };
    state.running = true;
    this.saveState(state);
    const results = [];
    try {
      if (cfg.localMirror?.enabled && cfg.localMirror.dir) {
        const mirror = await this.runLocalMirror(cfg.localMirror.dir);
        results.push({ id: 'local', name: '本地镜像', ok: mirror.every(m => m.ok), steps: mirror });
      }
      for (const dest of cfg.destinations || []) {
        if (dest.enabled === false) continue;
        if (!dest.accessKey || !dest.secretKey || !dest.bucket) {
          results.push({ id: dest.id, name: dest.name, ok: false, error: '缺少 bucket/accessKey/secretKey' });
          continue;
        }
        results.push(await this.runOne(dest));
      }
    } finally {
      state.running = false;
      state.lastRun = Date.now();
      state.results = results;
      this.saveState(state);
    }
    return { ok: true, results };
  }

  ensureTimer(runFn) {
    const cfg = this.config;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (cfg.enabled) this.timer = setInterval(() => runFn().catch(() => {}), Math.max(1, cfg.frequencyHours || 6) * 3600 * 1000);
  }
}

export { PROVIDER_DEFAULTS };
