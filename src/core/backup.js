import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const RCLONE_NAME = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
const RCLONE_PATH = process.env.RCLONE_PATH || path.resolve(process.cwd(), 'tools', RCLONE_NAME);

const PROVIDER_DEFAULTS = {
  r2: { name: 'Cloudflare R2', endpoint: 'https://<account_id>.r2.cloudflarestorage.com' },
  oss: { name: '阿里云 OSS', endpoint: 'https://oss-<region>.aliyuncs.com' },
  cos: { name: '腾讯云 COS', endpoint: 'https://cos.<region>.myqcloud.com' },
  s3: { name: 'AWS S3 / 自定义 S3', endpoint: '' }
};

function runRclone(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(RCLONE_PATH)) return resolve({ ok: false, error: 'rclone 不存在（tools/' + RCLONE_NAME + '）' });
    execFile(RCLONE_PATH, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: (stderr || err.message || '').slice(0, 500) });
      else resolve({ ok: true, output: String(stdout || '').slice(-2000) });
    });
  });
}

function runTar(args, cwd, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile('tar', args, { timeout: timeoutMs, windowsHide: true, cwd }, (err) => {
      if (err) resolve({ ok: false, error: String(err.message).slice(0, 300) });
      else resolve({ ok: true });
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

  async packArchive(stamp) {
    // 跨平台：系统自带 tar（Windows 10+ 为 bsdtar）打包为 .tar.gz
    const tmpDir = path.join(this.hubDataDir, '..', 'backup-tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, 'aiassets-backup-' + stamp + '.tar.gz');
    const dirs = [this.hubDataDir, ...this.storageDirs].filter(d => fs.existsSync(d));
    // 打包各目录的 basename（解包后还原目录名）
    const packResult = await runTar(['-czf', file, ...dirs.map(d => path.basename(d))], path.dirname(dirs[0]));
    if (!packResult.ok) return packResult;
    try { return { ok: true, file, sizeBytes: fs.statSync(file).size }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  mirrorDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    let copied = 0;
    const srcEntries = new Set(fs.readdirSync(src));
    for (const name of srcEntries) {
      const s = path.join(src, name);
      const d = path.join(dest, name);
      const st = fs.statSync(s);
      if (st.isDirectory()) copied += this.mirrorDir(s, d);
      else { fs.copyFileSync(s, d); copied++; }
    }
    for (const name of fs.readdirSync(dest)) {
      if (!srcEntries.has(name)) fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    }
    return copied;
  }

  async runLocalMirror(dir) {
    // 本地镜像：Node fs 递归复制（跨平台）
    const dirs = [this.hubDataDir, ...this.storageDirs].filter(d => fs.existsSync(d));
    const results = [];
    for (const d of dirs) {
      const dest = path.join(dir, path.basename(d));
      try {
        const copied = this.mirrorDir(d, dest);
        results.push({ dir: path.basename(d), ok: true, files: copied });
      } catch (e) {
        results.push({ dir: path.basename(d), ok: false, error: e.message });
      }
    }
    return results;
  }

  async runOne(dest) {
    const stamp = new Date().toISOString().slice(0, 10);
    const results = [];
    // 1) 打包为 tar.gz（保证一致性 + 便于恢复）
    const pack = await this.packArchive(dest.id + '-' + stamp);
    if (!pack.ok) return { id: dest.id, name: dest.name, ok: false, error: pack.error, files: [] };
    results.push({ step: 'pack', ok: true, file: pack.file, sizeBytes: pack.sizeBytes });

    // 2) 推送到远端
    const confPath = this.ensureRemote(dest);
    const remote = dest.id + ':' + (dest.prefix ? dest.prefix.replace(/^\/+|\/+$/g, '') + '/' : '') + path.basename(pack.file);
    const push = await runRclone(['--config', confPath, 'copy', pack.file, remote, '--no-check-dest']);
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
