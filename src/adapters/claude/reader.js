import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Cleaner } from '../../core/cleaner.js';

/**
 * Claude Code 会话读取：~/.claude/projects/<编码 cwd>/<session-uuid>.jsonl
 * 每行一个 JSON 事件：{ type, message: { role, content }, timestamp, cwd, sessionId, ... }
 */
export class ClaudeReader {
  static getClaudeHome() {
    return process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
  }

  static scanAllSessions() {
    const root = path.join(this.getClaudeHome(), 'projects');
    const results = [];
    if (!fs.existsSync(root)) return results;
    function walk(dir) {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(p);
      }
    }
    walk(root);
    results.sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; } });
    return results;
  }

  static decodeProjectDir(dirName) {
    // projects 目录名是 cwd 的编码形式（如 C--Users-yourname-Documents-Project）
    let s = String(dirName || '');
    if (/^[A-Za-z]:--/.test(s)) {
      return s.replace(/^([A-Za-z]):--/, '$1:\\').replace(/--/g, '\\');
    }
    return s.replace(/--/g, '/').replace(/^-+/, '');
  }

  static extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(c => (typeof c === 'string' ? c : c?.text || '')).join('');
    return '';
  }

  static async fastScanSummary(filePath) {
    const events = await this.readEvents(filePath);
    if (!events) return null;
    return this.toSummary(events, filePath);
  }

  static async readEvents(filePath) {
    const events = [];
    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'user' && e.type !== 'assistant') continue;
      const msg = e.message || {};
      const role = msg.role || e.type;
      const text = this.extractText(msg.content);
      if (!text) continue;
      events.push({ type: e.type, role, content: text, timestamp: e.timestamp || null, cwd: e.cwd || null, sessionId: e.sessionId || null });
    }
    return events.length ? events : null;
  }

  static toSummary(events, filePath) {
    let title = '', cwd = '', sessionId = null, msgCount = 0, createdAt = null;
    for (const ev of events) {
      if (ev.cwd && !cwd) cwd = ev.cwd;
      if (ev.sessionId && !sessionId) sessionId = ev.sessionId;
      if (ev.role === 'user') {
        msgCount++;
        const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null;
        if (ts && !createdAt) createdAt = ts;
        if (!title) {
          const clean = Cleaner.cleanUserMessage(ev.content);
          if (clean && !clean.startsWith('#') && !clean.startsWith('<')) title = clean.slice(0, 50);
        }
      } else if (ev.role === 'assistant') msgCount++;
    }
    if (!msgCount) return null;
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    sessionId = sessionId || path.basename(filePath, '.jsonl');
    return {
      id: sessionId, agent: 'claude', agentLabel: 'Claude', title: title || 'Claude 对话会话',
      cwd, projectName: cwd ? cwd.split(/[\\/]/).pop() : '最近对话 (未归档项目)',
      messageCount: msgCount, toolCallCount: 0, updatedAt: mtime, filePath,
      createdAt: createdAt || mtime
    };
  }

  static async parseSession(filePath, projectResolver) {
    const events = await this.readEvents(filePath);
    if (!events) return null;
    const summary = this.toSummary(events, filePath);
    if (!summary) return null;
    const canonicalEvents = events.map((ev, i) => ({
      kind: 'message',
      id: (ev.role === 'user' ? 'u' : 'a') + i,
      role: ev.role,
      timestamp: ev.timestamp ? new Date(ev.timestamp).getTime() : Date.now(),
      content: ev.content.trim()
    }));
    return {
      schemaVersion: 1,
      id: summary.id,
      title: summary.title,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      sourceAgent: 'claude',
      project: { name: projectResolver ? projectResolver(summary.cwd) : (summary.projectName || '最近对话 (未归档项目)'), originalCwd: summary.cwd },
      events: canonicalEvents,
      messages: canonicalEvents
    };
  }
}
