import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Grok Build 写入：生成同构 chat_history.jsonl
 */
export class GrokWriter {
  static async injectSession(canonical, targetDir) {
    const root = path.join(os.homedir(), '.grok', 'sessions');
    const cwd = targetDir || canonical.project?.originalCwd || path.join(os.homedir(), 'grok-imported');
    const encoded = encodeURIComponent(cwd);
    const sessionId = /^[0-9a-f-]{36}$/.test(canonical.id) ? canonical.id : crypto.randomUUID();
    const sessionDir = path.join(root, encoded, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, 'chat_history.jsonl');
    const lines = [];
    for (const ev of canonical.events || canonical.messages || []) {
      if (ev.kind !== 'message') continue;
      lines.push(JSON.stringify({ type: ev.role, content: ev.content }));
    }
    fs.writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
    return { filePath, sessionId, count: lines.length };
  }
}
