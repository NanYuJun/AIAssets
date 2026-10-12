import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { Cleaner } from '../../core/cleaner.js';

export class GeminiReader {
  // Antigravity 生成的会话标题（cascade_id -> title），来自 agyhub_summaries_proto.pb
  static _summaryMap = null;
  static _summaryMapLoadedAt = 0;

  static getSummaryMap() {
    if (this._summaryMap && Date.now() - this._summaryMapLoadedAt < 60000) return this._summaryMap;
    try {
      const pbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'agyhub_summaries_proto.pb');
      if (!fs.existsSync(pbPath)) return this._summaryMap || new Map();
      const buf = fs.readFileSync(pbPath);
      const text = buf.toString('latin1');
      const readVarint = (b, pos) => { let result = 0, shift = 0, byte; do { byte = b[pos++]; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80); return { value: result, next: pos }; };
      const map = new Map();
      const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
      let m;
      while ((m = uuidRe.exec(text)) !== null) {
        const id = m[0];
        let pos = m.index + id.length;
        if (buf[pos] !== 0x12) continue;
        pos++;
        const lenRes = readVarint(buf, pos);
        const subEnd = lenRes.next + lenRes.value;
        // 子消息中第一个 0x0a <len> <可打印文本> 即标题
        let p = lenRes.next;
        while (p < subEnd - 2) {
          if (buf[p] === 0x0a) {
            const len = buf[p + 1];
            if (len >= 4 && len <= 120 && p + 2 + len <= subEnd) {
              const title = buf.slice(p + 2, p + 2 + len).toString('utf8').trim();
              const printable = title.split('').filter(c => c.charCodeAt(0) >= 32).length / title.length;
              if (title.length >= 4 && printable > 0.9 && !/^[0-9a-f-]{36}$/.test(title)) { map.set(id, title); break; }
            }
          }
          p++;
        }
      }
      this._summaryMap = map;
      this._summaryMapLoadedAt = Date.now();
      return map;
    } catch {
      return this._summaryMap || new Map();
    }
  }
  static getGeminiHome() {
    return process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini');
  }

  static listProjects() {
    return [];
  }

  static resolveRealPath(mappedPath) {
    // 映射路径格式: <brain>/<id>/.system_generated/logs/gemini-session-<id>.jsonl
    const id = mappedPath.match(/gemini-session-(.+?)\.jsonl$/)?.[1];
    return id ? path.join(this.getGeminiHome(), 'antigravity', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl') : mappedPath;
  }

  static scanAllSessions() {
    const root = path.join(this.getGeminiHome(), 'antigravity', 'brain');
    const results = [];
    if (!fs.existsSync(root)) return results;
    for (const dir of fs.readdirSync(root)) {
      const t = path.join(root, dir, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(t)) results.push(t);
    }
    results.sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; } });
    return results;
  }

  static async fastScanSummary(filePath, projectResolver) {
    filePath = this.resolveRealPath(filePath);
    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
    let title = '', msgCount = 0, toolCount = 0, firstTs = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!firstTs && e.created_at) firstTs = e.created_at;
      if (e.type === 'USER_INPUT') {
        msgCount++;
        if (!title) {
          const m = String(e.content || '').match(/<USER_REQUEST>\n?([\s\S]*?)<\/USER_REQUEST>/);
          title = Cleaner.cleanUserMessage(m ? m[1] : String(e.content || '')).slice(0, 30);
        }
      } else if (e.type === 'PLANNER_RESPONSE' || e.type === 'MODEL_RESPONSE') {
        msgCount++;
      } else if (e.type === 'TOOL_CALL' || e.type === 'EXECUTION') {
        toolCount++;
      }
    }
    if (!title || !msgCount) return null;
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    const cascadeId = String(filePath).match(/brain[/\\]([0-9a-f-]{36})[/\\]/i)?.[1] || String(filePath).match(/gemini-session-([0-9a-f-]{36})\.jsonl$/i)?.[1] || '';
    const id = 'gemini-' + cascadeId;
    const summaryTitle = this.getSummaryMap().get(cascadeId);
    const finalTitle = (summaryTitle && summaryTitle.trim()) || title;
    return {
      id, agent: 'gemini', agentLabel: 'Gemini', title: finalTitle,
      cwd: '', projectName: projectResolver ? projectResolver('') : '最近对话 (未归档项目)',
      messageCount: msgCount, toolCallCount: toolCount, updatedAt: mtime, filePath
    };
  }

  static async parseSession(filePath, projectResolver) {
    filePath = this.resolveRealPath(filePath);
    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
    const events = [];
    let title = '', firstTs = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = e.created_at ? new Date(e.created_at).getTime() : Date.now();
      if (e.type === 'USER_INPUT') {
        const m = String(e.content || '').match(/<USER_REQUEST>\n?([\s\S]*?)<\/USER_REQUEST>/);
        const text = Cleaner.cleanUserMessage(m ? m[1] : String(e.content || ''));
        if (!title && text) title = text;
        if (text) events.push({ kind: 'message', id: 'u' + e.step_index, role: 'user', timestamp: ts, content: text.trim() });
      } else if (e.type === 'PLANNER_RESPONSE' || e.type === 'MODEL_RESPONSE') {
        events.push({ kind: 'message', id: 'a' + e.step_index, role: 'assistant', timestamp: ts, content: String(e.content || '').trim() });
      } else if (e.type === 'TOOL_CALL' || e.type === 'EXECUTION') {
        events.push({ kind: 'tool_call', id: 't' + e.step_index, callId: 'call_' + e.step_index, name: 'Bash', timestamp: ts, arguments: JSON.stringify({ command: String(e.content || '').slice(0, 2000) }) });
      }
    }
    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
    const cascadeId = String(filePath).match(/brain[/\\]([0-9a-f-]{36})[/\\]/i)?.[1] || String(filePath).match(/gemini-session-([0-9a-f-]{36})\.jsonl$/i)?.[1] || path.basename(path.dirname(path.dirname(path.dirname(filePath))));
    const id = 'gemini-' + cascadeId;
    const summaryTitle = this.getSummaryMap().get(cascadeId);
    const finalTitle = (summaryTitle && summaryTitle.trim()) || title || 'Gemini 对话会话';
    return {
      schemaVersion: 1, id, title: finalTitle,
      createdAt: firstTs ? new Date(firstTs).getTime() : mtime, updatedAt: mtime,
      sourceAgent: 'gemini',
      project: { name: projectResolver ? projectResolver('') : '最近对话 (未归档项目)', originalCwd: '' },
      events, messages: events.filter(e => e.kind === 'message')
    };
  }
}
