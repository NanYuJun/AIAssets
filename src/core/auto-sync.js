import fs from 'node:fs';
import path from 'node:path';

/**
 * 自动上云：监听本地 Agent 会话目录，发现新/变更会话自动备份到云端。
 * 简化实现：定时轮询 mtime（比 fs.watch 更稳，跨盘/网络盘也可靠）。
 */
export class AutoSyncManager {
  constructor(dataDir) {
    this.configPath = path.join(dataDir, 'auto-sync.json');
    this.statePath = path.join(dataDir, 'auto-sync-state.json');
    this.timer = null;
    this.known = new Map(); // filePath -> mtimeMs
  }

  get config() {
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf-8')); } catch { return { enabled: false, agents: ['codex', 'workbuddy', 'pi'], intervalSec: 1800 } }
  }

  saveConfig(cfg) {
    fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }

  getState() {
    try { return JSON.parse(fs.readFileSync(this.statePath, 'utf-8')); } catch { return { lastRun: null, lastError: null, syncedCount: 0 } }
  }

  saveState(st) {
    fs.writeFileSync(this.statePath, JSON.stringify(st, null, 2), 'utf-8');
  }

  ensureTimer(runFn) {
    const cfg = this.config;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (cfg.enabled) {
      this.timer = setInterval(() => runFn().catch(() => {}), Math.max(30, cfg.intervalSec) * 1000);
    }
  }
}
