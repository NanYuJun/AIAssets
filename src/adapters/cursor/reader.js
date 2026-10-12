import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { querySqlite } from '../../core/sqlite.js';

/**
 * Cursor 适配器
 * 存储：%APPDATA%/Cursor/User/globalStorage/state.vscdb
 * 结构：cursorDiskKV 表 → composerData:<id>（对话头）+ bubbleId:<id>（消息）
 */
export class CursorReader {
  static getDbPath() {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }

  static available() { return fs.existsSync(this.getDbPath()); }

  static scanAllSessions() {
    if (!this.available()) return [];
    try {
      const rows = querySqlite(this.getDbPath(), "SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%'");
      return rows.map(r => 'cursor:' + r.key.replace('composerData:', '')).filter(v => !v.includes('empty-state'));
    } catch { return []; }
  }

  static async fastScanSummary(cursorId, projectResolver) {
    return this.parseSession(cursorId, projectResolver);
  }

  static async parseSession(cursorId, projectResolver) {
    if (!this.available()) return null;
    const cid = cursorId.replace(/^cursor:/, '');
    try {
      const composerRow = querySqlite(this.getDbPath(), 'SELECT value FROM cursorDiskKV WHERE key = ?', ['composerData:' + cid])[0];
      if (!composerRow) return null;
      const composer = JSON.parse(composerRow.value);
      const headers = composer.fullConversationHeadersOnly || [];
      const events = [];
      let msgCount = 0, toolCount = 0;
      for (const h of headers) {
        if (!h.bubbleId) continue;
        let rows;
        try { rows = querySqlite(this.getDbPath(), 'SELECT value FROM cursorDiskKV WHERE key = ?', ['bubbleId:' + cid + ':' + h.bubbleId]); } catch { continue; }
        if (!rows.length) continue;
        let j; try { j = JSON.parse(rows[0].value); } catch { continue; }
        const role = j.type === 1 ? 'user' : 'assistant';
        const text = (j.text || '').trim();
        if (!text) continue;
        msgCount++;
        events.push({ kind: 'message', id: 'm' + events.length, role, timestamp: h.createdAt ? new Date(h.createdAt).getTime() : Date.now(), content: text });
      }
      if (!msgCount) return null;
      const title = (composer.title || composer.name || 'Cursor 对话会话').slice(0, 80);
      const updatedAt = composer.lastUpdatedAt || Date.now();
      const createdAt = composer.createdAt ? new Date(composer.createdAt).getTime() : updatedAt;
      return {
        schemaVersion: 1,
        id: cid,
        agent: 'cursor',
        title,
        createdAt,
        updatedAt,
        sourceAgent: 'cursor',
        project: { name: projectResolver ? projectResolver('') : 'Cursor 对话', originalCwd: '' },
        events,
        messages: events.filter(e => e.kind === 'message')
      };
    } catch { return null; }
  }
}
