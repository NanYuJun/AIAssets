import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSqlite } from '../../core/sqlite.js';

/**
 * ZCode 写入：INSERT session/message/part 到 ~/.zcode/cli/db/db.sqlite
 */
export class ZCodeWriter {
  static getDbPath() {
    return path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
  }

  static async injectSession(canonical, targetDir) {
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) throw new Error('未找到 ZCode 数据库（先安装并运行 ZCode 一次）');
    const sid = canonical.id.startsWith('sess_') ? canonical.id : 'sess_' + canonical.id.replace(/-/g, '').slice(0, 32);
    const dir = targetDir || canonical.project?.originalCwd || path.join(os.homedir(), '.zcode', 'workspace', 'default');
    const now = Date.now();
    const title = (canonical.title || '迁移会话').slice(0, 100);

    execSqlite(dbPath, 'INSERT OR REPLACE INTO session (id, project_id, workspace_id, parent_id, slug, directory, path, title, version, permission, time_created, time_updated) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sid, 'default', 'default', sid.slice(0, 20), dir, dir, title, '1', '{}', canonical.createdAt || now, canonical.updatedAt || now]);

    let seq = 0;
    for (const ev of canonical.events || canonical.messages || []) {
      if (ev.kind !== 'message') continue;
      const msgId = 'msg_' + 'mig' + seq + '_' + Math.random().toString(36).slice(2, 8);
      const msgData = JSON.stringify({ role: ev.role, time: { created: ev.timestamp || now } });
      execSqlite(dbPath, 'INSERT INTO message (id, session_id, data, sequence) VALUES (?, ?, ?, ?)', [msgId, sid, msgData, seq]);
      execSqlite(dbPath, 'INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?, ?, ?, ?, ?)',
        ['part_' + msgId + '_' + seq, msgId, sid, JSON.stringify({ type: 'text', text: ev.content }), 0]);
      seq++;
    }
    return { sessionId: sid, path: dbPath, count: seq };
  }
}
