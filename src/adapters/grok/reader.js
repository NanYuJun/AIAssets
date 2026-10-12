import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { Cleaner } from '../../core/cleaner.js';

/**
 * Grok Build (xAI) 适配器
 * 存储：~/.grok/sessions/<URL编码cwd>/<uuid>/chat_history.jsonl
 * 行格式：{ type: system|user|reasoning|assistant, content: string | [{type:'text',text}] }
 */
export class GrokReader {
  static getSessionsRoot() {
    return path.join(os.homedir(), '.grok', 'sessions');
  }

  static scanAllSessions() {
    const root = this.getSessionsRoot();
    const results = [];
    if (!fs.existsSync(root)) return results;
    function walk(dir) {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && entry.name === 'chat_history.jsonl') results.push(p);
      }
    }
    walk(root);
    results.sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; } });
    return results;
  }

  static extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(c => (typeof c === 'string' ? c : c?.text || '')).join('');
    return '';
  }

  static async fastScanSummary(filePath, projectResolver) {
    return this.parseSession(filePath, projectResolver);
  }

  static async parseSession(filePath, projectResolver) {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
    const events = [];
    let title = '', cwd = '', sessionId = null, createdAt = null, msgCount = 0, toolCount = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'system') continue;
      const text = this.extractText(j.content);
      if (j.type === 'user') {
        msgCount++;
        const clean = Cleaner.cleanUserMessage(text);
        // 跳过注入的 user_info 元数据块
        if (clean.startsWith('<user_info>')) continue;
        if (!title && clean.trim()) title = clean.trim().slice(0, 50);
        if (!createdAt) createdAt = Date.now();
        events.push({ kind: 'message', id: 'u' + events.length, role: 'user', timestamp: Date.now(), content: clean.trim() });
      } else if (j.type === 'assistant') {
        msgCount++;
        if (text.trim()) events.push({ kind: 'message', id: 'a' + events.length, role: 'assistant', timestamp: Date.now(), content: text.trim() });
      } else if (j.type === 'tool_use' || j.type === 'tool_result') {
        toolCount++;
      }
    }
    if (!msgCount) return null;
    // sessionId 从目录名取（uuid 目录）
    const parent = path.basename(path.dirname(filePath));
    sessionId = /^[0-9a-f-]{36}$/.test(parent) ? parent : 'grok-' + parent;
    // cwd 从目录名 URL 解码
    const encoded = path.basename(path.dirname(path.dirname(filePath)));
    try { cwd = decodeURIComponent(encoded); } catch { cwd = encoded; }
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    return {
      schemaVersion: 1,
      id: sessionId,
        agent: 'grok',
      title: title || 'Grok 对话会话',
      createdAt: createdAt || mtime,
      updatedAt: mtime,
      sourceAgent: 'grok',
      project: { name: projectResolver ? projectResolver(cwd) : path.basename(cwd || '') || '最近对话 (未归档项目)', originalCwd: cwd },
      events,
      messages: events.filter(e => e.kind === 'message')
    };
  }
}
