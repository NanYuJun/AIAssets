import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { querySqlite } from '../../core/sqlite.js';

/**
 * OpenCode 适配器
 * 存储：~/.local/share/opencode/opencode.db（session / message / part 表，data JSON）
 */
export class OpenCodeReader {
  static getDbPath() {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  static scanAllSessions() {
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) return [];
    try {
      return querySqlite(dbPath, 'SELECT id FROM session ORDER BY time_updated DESC').map(r => 'opencode:' + r.id);
    } catch { return []; }
  }

  static async fastScanSummary(ocId, projectResolver) {
    return this.parseSession(ocId, projectResolver);
  }

  static async parseSession(ocId, projectResolver) {
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) return null;
    const sid = ocId.replace(/^opencode:/, '');
    try {
      const meta = querySqlite(dbPath, 'SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?', [sid])[0];
      if (!meta) return null;
      const msgRows = querySqlite(dbPath, 'SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created', [sid]);
      const events = [];
      let msgCount = 0, toolCount = 0;
      for (const m of msgRows) {
        let j; try { j = JSON.parse(m.data); } catch { continue; }
        const role = j.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const partRows = querySqlite(dbPath, 'SELECT data FROM part WHERE message_id = ? ORDER BY id', [m.id]);
        let text = '';
        for (const p of partRows) {
          try {
            const pj = JSON.parse(p.data);
            if (pj.type === 'text' && pj.text) text += pj.text;
            if (pj.type === 'tool' || pj.type === 'tool-call') toolCount++;
          } catch {}
        }
        if (!text.trim()) continue;
        msgCount++;
        events.push({ kind: 'message', id: 'm' + events.length, role, timestamp: j.time?.created || meta.time_created, content: text.trim() });
      }
      if (!msgCount) return null;
      const title = (meta.title && meta.title.trim()) || 'OpenCode 对话会话';
      return {
        schemaVersion: 1,
        id: sid,
        agent: 'opencode',
        title,
        createdAt: meta.time_created,
        updatedAt: meta.time_updated,
        sourceAgent: 'opencode',
        project: { name: projectResolver ? projectResolver(meta.directory) : path.basename(meta.directory || '') || '最近对话 (未归档项目)', originalCwd: meta.directory },
        events,
        messages: events.filter(e => e.kind === 'message')
      };
    } catch { return null; }
  }
}
