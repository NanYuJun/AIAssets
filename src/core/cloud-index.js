import fs from 'node:fs';
import path from 'node:path';

/**
 * 内存云端索引：启动时扫描一次，之后增量更新，避免每次请求全量读盘。
 */
export class CloudIndex {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.map = new Map(); // id -> { meta, mtimeMs, size }
  }

  loadOnce() {
    if (this.loaded) return;
    this.loaded = true;
    this.rebuild();
  }

  rebuild() {
    this.map = new Map();
    if (!fs.existsSync(this.storageDir)) return;
    for (const f of fs.readdirSync(this.storageDir)) {
      if (!f.endsWith('.json')) continue;
      this.ingestFile(path.join(this.storageDir, f));
    }
  }

  ingestFile(p) {
    try {
      const st = fs.statSync(p);
      const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
      this.map.set(s.id, {
        meta: {
          id: s.id,
          title: s.title || '',
          createdAt: s.createdAt || 0,
          updatedAt: s.updatedAt || 0,
          sourceAgent: s.sourceAgent || 'codex',
          projectName: s.project?.name || '',
          originalCwd: s.project?.originalCwd || '',
          messageCount: (s.events || s.messages || []).filter(e => e.kind === 'message' || e.role).length,
          toolCallCount: (s.events || []).filter(e => e.kind === 'tool_call').length,
          shareOrigin: s.metadata?.shareOrigin || null,
          sizeBytes: st.size
        },
        mtimeMs: st.mtimeMs
      });
    } catch {}
  }

  /** 增量刷新：只重读 mtime 变化的文件 */
  refresh() {
    this.loadOnce();
    if (!fs.existsSync(this.storageDir)) return;
    const seen = new Set();
    for (const f of fs.readdirSync(this.storageDir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(this.storageDir, f);
      seen.add(f);
      const st = fs.statSync(p);
      // 用 id 直接索引判断是否已知，避免 O(n²) 全表线性查找
      const knownId = f.replace(/\.json$/, '');
      const known = this.map.get(knownId);
      if (!known || known.mtimeMs !== st.mtimeMs || known.meta.sizeBytes !== st.size) this.ingestFile(p);
    }
    // remove deleted
    for (const [id] of this.map) {
      if (!seen.has(`${id}.json`)) this.map.delete(id);
    }
  }

  updateOne(id, session) {
    const p = path.join(this.storageDir, `${id}.json`);
    if (fs.existsSync(p)) this.ingestFile(p);
  }

  removeOne(id) {
    this.map.delete(id);
  }

  stats() {
    this.loadOnce();
    let totalBytes = 0, sharedBytes = 0, sharedCount = 0;
    for (const [, v] of this.map) {
      totalBytes += v.meta.sizeBytes || 0;
      if (v.meta.shareOrigin) { sharedBytes += v.meta.sizeBytes || 0; sharedCount++; }
    }
    return { count: this.map.size, totalBytes, sharedCount, sharedBytes };
  }
}
