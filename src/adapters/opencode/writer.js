import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSqlite, querySqlite } from '../../core/sqlite.js';

/**
 * OpenCode 写入：INSERT session/message/part 到 opencode.db
 */
export class OpenCodeWriter {
  static getDbPath() {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  static async injectSession(canonical, targetDir) {
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) throw new Error('未找到 OpenCode 数据库（先安装并运行 OpenCode 一次）');
    const sid = canonical.id.startsWith('ses_') ? canonical.id : 'ses_mig' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const dir = (targetDir || canonical.project?.originalCwd || '').replace(/\\/g, '/');
    const now = Date.now();
    const title = (canonical.title || '迁移会话').slice(0, 100);

    // 需要 project 外键：查找或创建
    let projectId = querySqlite(dbPath, 'SELECT id FROM project LIMIT 1')[0]?.id;
    if (!projectId) {
      projectId = 'proj_migrated';
      execSqlite(dbPath, 'INSERT INTO project (id, worktree, name) VALUES (?, ?, ?)', [projectId, dir, 'Migrated']);
    }

    execSqlite(dbPath, 'INSERT OR REPLACE INTO session (id, project_id, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sid, projectId, dir, title, '1', canonical.createdAt || now, canonical.updatedAt || now]);

    let seq = 0;
    for (const ev of canonical.events || canonical.messages || []) {
      if (ev.kind !== 'message') continue;
      const msgId = 'msg_mig' + seq + '_' + Math.random().toString(36).slice(2, 10);
      execSqlite(dbPath, 'INSERT INTO message (id, session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
        [msgId, sid, JSON.stringify({ role: ev.role, time: { created: ev.timestamp || now } }), ev.timestamp || now, ev.timestamp || now]);
      execSqlite(dbPath, 'INSERT INTO part (id, message_id, session_id, data, time_created) VALUES (?, ?, ?, ?, ?)',
        ['prt_' + msgId + '_' + seq, msgId, sid, JSON.stringify({ type: 'text', text: ev.content }), ev.timestamp || now]);
      seq++;
    }
    return { sessionId: sid, path: dbPath, count: seq };
  }
}
