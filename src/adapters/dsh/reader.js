import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { Cleaner } from '../../core/cleaner.js';

/**
 * DSH (DeepSeek) 会话存储为 zstd 压缩的 JSONL。
 * 使用 Node 24+ 内置的 zlib.zstdDecompressSync 解压，无需额外依赖。
 */
export class DshReader {
  // DSH 生成的会话标题（session uuid -> title），来自 storages/session_projcache
  static _projTitles = null;
  static _projTitlesLoadedAt = 0;

  static getProjTitleMap() {
    if (this._projTitles && Date.now() - this._projTitlesLoadedAt < 60000) return this._projTitles;
    try {
      const dir = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
      const map = new Map();
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.json')) continue;
          try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
            const t = j?.record?.rows?.title?.val;
            if (t) map.set(f.replace(/^session-/, '').replace(/\.json$/, ''), String(t));
          } catch {}
        }
      }
      this._projTitles = map;
      this._projTitlesLoadedAt = Date.now();
      return map;
    } catch {
      return this._projTitles || new Map();
    }
  }
  static getDshHome() {
    return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  }

  static getSessionsDir() {
    return path.join(this.getDshHome(), 'sessions');
  }

  static scanAllSessions() {
    const root = this.getSessionsDir();
    const results = [];
    if (!fs.existsSync(root)) return results;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir);
      if (fs.statSync(p).isDirectory()) {
        for (const inner of fs.readdirSync(p)) {
          const innerPath = path.join(p, inner);
          if (fs.statSync(innerPath).isDirectory()) {
            for (const f of fs.readdirSync(innerPath)) {
              if (f.endsWith('.jsonl.zstd')) results.push(path.join(innerPath, f));
            }
          } else if (inner.endsWith('.jsonl.zstd')) {
            results.push(innerPath);
          }
        }
      }
    }
    return results;
  }

  static sessionIdFromPath(filePath) {
    // DSH 会话 ID 存在压缩内容首行 session.id 中；目录名格式 session-<uuid>
    try {
      const jsonl = this.decompress(filePath);
      const first = JSON.parse(jsonl.split('\n')[0]);
      if (first.type === 'session' && first.id) return first.id;
    } catch {}
    const parts = filePath.replace(/\\/g, '/').split('/');
    const inner = parts[parts.length - 2];
    return inner && inner.startsWith('session-') ? inner.slice('session-'.length) : null;
  }

  static hasZstd() {
    return typeof zlib.zstdDecompressSync === 'function';
  }

  static decompress(p) {
    return zlib.zstdDecompressSync(fs.readFileSync(p)).toString('utf-8');
  }

  static async fastScanSummary(filePath) {
    if (!this.hasZstd()) return null;
    let jsonl; try { jsonl = this.decompress(filePath); } catch { return null; }
    let title = '', msgCount = 0, toolCount = 0, cwd = '', createdAt = null, sessionId = null;
    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'session') {
        sessionId = e.id || sessionId;
        cwd = e.cwd || cwd;
        createdAt = e.createdAt || createdAt;
        continue;
      }
      if (e.cwd && !cwd) cwd = e.cwd;
      const role = e.role || (e.message && e.message.role);
      const content = typeof e.content === 'string' ? e.content : (Array.isArray(e.content) ? e.content.map(c => c.text || '').join('') : (e.message?.content?.[0]?.text) || '');
      if (role === 'user') {
        msgCount++;
        if (!title && content) title = Cleaner.cleanUserMessage(content).slice(0, 30);
      } else if (role === 'assistant') msgCount++;
      else if (role === 'tool' || e.type === 'tool_call' || e.type === 'EXECUTION') toolCount++;
    }
    // 允许无消息的空会话（DSH 会话刚创建时只有 session 行）
    if (!sessionId && !msgCount) return null;
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    const id = sessionId || path.basename(path.dirname(filePath)).replace(/^session-/, '');
    const projTitle = this.getProjTitleMap().get(id.replace(/^session-/, ''));
    const finalTitle = (projTitle && projTitle.trim()) || title;
    return {
      id, agent: 'dsh', agentLabel: 'DSH', title: finalTitle,
      cwd, projectName: cwd ? cwd.split(/[\\/]/).pop() : '最近对话 (未归档项目)',
      messageCount: msgCount, toolCallCount: toolCount, updatedAt: mtime, filePath,
      createdAt: createdAt || mtime
    };
  }

  static async parseSession(filePath, projectResolver) {
    if (!this.hasZstd()) return null;
    let jsonl; try { jsonl = this.decompress(filePath); } catch { return null; }
    const events = [];
    let title = '', cwd = '', createdAt = null, sessionId = null;
    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = e.timestamp || Date.now();
      if (e.type === 'session') {
        sessionId = e.id || sessionId;
        cwd = e.cwd || cwd;
        createdAt = e.createdAt || createdAt;
        continue;
      }
      const role = e.role || (e.message && e.message.role);
      const content = typeof e.content === 'string' ? e.content : (Array.isArray(e.content) ? e.content.map(c => c.text || '').join('') : (e.message?.content?.[0]?.text) || '');
      if (role === 'user' && content) {
        const clean = Cleaner.cleanUserMessage(content);
        if (!title && clean) title = clean;
        events.push({ kind: 'message', id: e.id || 'u' + events.length, role: 'user', timestamp: ts, content: clean.trim() });
      } else if (role === 'assistant' && content) {
        events.push({ kind: 'message', id: e.id || 'a' + events.length, role: 'assistant', timestamp: ts, content: content.trim() });
      } else if (role === 'tool' || e.type === 'tool_call') {
        events.push({ kind: 'tool_call', id: e.id || 't' + events.length, callId: e.callId || 'call_' + events.length, name: e.name || 'Bash', timestamp: ts, arguments: JSON.stringify({ command: String(content || '').slice(0, 2000) }) });
      } else if (e.type === 'tool_result') {
        events.push({ kind: 'tool_result', id: e.id || 'r' + events.length, callId: e.callId, name: 'Bash', timestamp: ts, output: String(content || '').slice(0, 3000) });
      }
    }
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    const id = sessionId || path.basename(path.dirname(filePath)).replace(/^session-/, '');
    const projTitle = this.getProjTitleMap().get(id.replace(/^session-/, ''));
    const finalTitle = (projTitle && projTitle.trim()) || title || 'DSH 对话会话';
    return {
      schemaVersion: 1, id, title: finalTitle,
      createdAt: createdAt || mtime, updatedAt: mtime,
      sourceAgent: 'dsh',
      project: { name: projectResolver ? projectResolver(cwd) : '最近对话 (未归档项目)', originalCwd: cwd },
      events, messages: events.filter(e => e.kind === 'message')
    };
  }
}
