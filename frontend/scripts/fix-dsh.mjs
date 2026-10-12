import fs from 'node:fs';

const path = 'C:/Users/70000/Documents/Codex/2026-10-08/you/agent-sync-hub/src/adapters/dsh/reader.js';
const content = `import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { Cleaner } from '../../core/cleaner.js';

/**
 * DSH (DeepSeek) 会话存储为 zstd 压缩的 JSONL。
 * 使用 Node 24+ 内置的 zlib.zstdDecompressSync 解压，无需额外依赖。
 */
export class DshReader {
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
        for (const f of fs.readdirSync(p)) {
          if (f.endsWith('.jsonl.zstd')) results.push(path.join(p, f));
        }
      }
    }
    return results;
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
    let title = '', msgCount = 0, toolCount = 0, cwd = '';
    for (const line of jsonl.split('\\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.cwd && !cwd) cwd = e.cwd;
      const role = e.role || (e.message && e.message.role);
      const content = typeof e.content === 'string' ? e.content : (Array.isArray(e.content) ? e.content.map(c => c.text || '').join('') : (e.message?.content?.[0]?.text) || '');
      if (role === 'user') {
        msgCount++;
        if (!title && content) title = Cleaner.cleanUserMessage(content).slice(0, 30);
      } else if (role === 'assistant') msgCount++;
      else if (role === 'tool' || e.type === 'tool_call' || e.type === 'EXECUTION') toolCount++;
    }
    if (!title || !msgCount) return null;
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    const id = path.basename(path.dirname(filePath)).replace(/^session-/, '');
    return {
      id, agent: 'dsh', agentLabel: 'DSH', title,
      cwd, projectName: cwd ? cwd.split(/[\\/]/).pop() : '最近对话 (未归档项目)',
      messageCount: msgCount, toolCallCount: toolCount, updatedAt: mtime, filePath
    };
  }
}
`;
fs.writeFileSync(path, content, 'utf8');
console.log('dsh reader rewritten with builtin zstd');
