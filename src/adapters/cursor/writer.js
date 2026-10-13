import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSqlite } from '../../core/sqlite.js';

/**
 * Cursor 写入：INSERT composerData + bubbleId 到 state.vscdb
 * 注意：Cursor 运行时缓存可能与直接写库冲突，建议注入后重启 Cursor
 */
export class CursorWriter {
  static getDbPath() {
    switch (process.platform) {
      case 'win32': return path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
      case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
      default: return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
  }

  static async injectSession(canonical) {
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) throw new Error('未找到 Cursor 数据库（先安装并运行 Cursor 一次）');
    const composerId = /^[0-9a-f-]{36}$/.test(canonical.id) ? canonical.id : crypto.randomUUID();
    const now = Date.now();
    const title = (canonical.title || '迁移会话').slice(0, 80);
    const headers = [];
    let seq = 0;
    for (const ev of canonical.events || canonical.messages || []) {
      if (ev.kind !== 'message') continue;
      const bubbleId = crypto.randomUUID();
      const type = ev.role === 'user' ? 1 : 2;
      execSqlite(dbPath, 'INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)',
        ['bubbleId:' + composerId + ':' + bubbleId, JSON.stringify({ type, text: ev.content })]);
      headers.push({ bubbleId, type });
      seq++;
    }
    const composer = {
      _v: 1, composerId, title, name: title,
      fullConversationHeadersOnly: headers,
      conversationMap: {},
      createdAt: new Date(canonical.createdAt || now).toISOString(),
      lastUpdatedAt: canonical.updatedAt || now,
      isDraft: false
    };
    execSqlite(dbPath, 'INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)',
      ['composerData:' + composerId, JSON.stringify(composer)]);
    return { composerId, path: dbPath, count: seq };
  }
}
