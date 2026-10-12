import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Claude Code 会话写入：~/.claude/projects/<编码 cwd>/<session-uuid>.jsonl
 * 行格式与 Claude Code 一致：{ type: 'user'|'assistant', message: { role, content }, timestamp, cwd, sessionId }
 */
export class ClaudeWriter {
  static encodeProjectDir(cwd) {
    // 反向映射：C:\Users\x\proj -> C--Users-x-proj
    return String(cwd || '')
      .replace(/^([A-Za-z]):\\/, '$1--')
      .replace(/[\\/:.]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  static async injectSession(canonical, targetProjectRoot) {
    const claudeHome = process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
    const cwd = targetProjectRoot || canonical.project?.originalCwd || canonical.project?.original_cwd || path.join(os.homedir(), 'claude-imported');
    const dirName = this.encodeProjectDir(cwd);
    const projectDir = path.join(claudeHome, 'projects', dirName);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = canonical.id && /^[0-9a-f-]{36}$/i.test(canonical.id)
      ? canonical.id
      : crypto.randomUUID();
    const filePath = path.join(projectDir, sessionId + '.jsonl');

    const lines = [];
    for (const ev of canonical.events || canonical.messages || []) {
      if (ev.kind !== 'message') continue;
      lines.push(JSON.stringify({
        type: ev.role === 'user' ? 'user' : 'assistant',
        message: { role: ev.role, content: ev.content },
        timestamp: new Date(ev.timestamp || Date.now()).toISOString(),
        cwd,
        sessionId
      }));
    }
    fs.writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
    return { filePath, sessionId, count: lines.length };
  }
}
