import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { computeWorkBuddySlug } from './slug.js';
import { PathRemapper } from '../../core/path-remapper.js';
import { execSqlite } from '../../core/sqlite.js';

export class WorkBuddyWriter {
  static getWorkBuddyDir(customDir) {
    if (customDir) return customDir;
    const envDir = process.env.WORKBUDDY_HOME;
    if (envDir) return envDir;
    return path.join(os.homedir(), '.workbuddy');
  }

  static async injectSession(canonicalSession, targetProjectRoot, options = {}) {
    const wbDir = this.getWorkBuddyDir(options.workBuddyDir);
    if (!fs.existsSync(wbDir)) {
      fs.mkdirSync(wbDir, { recursive: true });
    }

    // 自动进行跨设备路径 Rebase
    const rebasedSession = PathRemapper.rebaseSession(canonicalSession, targetProjectRoot);

    const sessionId = rebasedSession.id || crypto.randomUUID();
    const projectSlug = computeWorkBuddySlug(targetProjectRoot);
    const targetProjectDir = path.join(wbDir, 'projects', projectSlug);

    if (!fs.existsSync(targetProjectDir)) {
      fs.mkdirSync(targetProjectDir, { recursive: true });
    }

    const jsonlPath = path.join(targetProjectDir, `${sessionId}.jsonl`);
    const lines = [];

    let lastId = null;
    let titleEmitted = false;

    const events = rebasedSession.events || rebasedSession.messages?.map(m => ({ ...m, kind: 'message' })) || [];

    for (const item of events) {
      const itemId = item.id?.replace(/^(msg_|ctc_|ctco_)/, '') || crypto.randomUUID();
      const rawTs = item.timestamp || Date.now();
      const ts = typeof rawTs === 'number' ? rawTs : (new Date(rawTs).getTime() || Date.now());

      if (item.kind === 'message' && item.role === 'user') {
        lines.push(JSON.stringify({
          id: itemId,
          timestamp: ts,
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: item.content }
          ],
          sessionId,
          cwd: targetProjectRoot
        }));
        lastId = itemId;

        if (!titleEmitted && rebasedSession.title) {
          lines.push(JSON.stringify({
            timestamp: ts + 10,
            type: 'ai-title',
            aiTitle: rebasedSession.title.slice(0, 30),
            sessionId,
            cwd: targetProjectRoot
          }));
          titleEmitted = true;
        }
      } else if (item.kind === 'tool_call') {
        let cmd = '';
        try {
          const parsed = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments;
          cmd = parsed.cmd || parsed.command || parsed.code || '';
        } catch {
          cmd = String(item.arguments || '');
        }

        const displayCmd = (cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd).replace(/\r?\n/g, ' ');

        lines.push(JSON.stringify({
          id: itemId,
          parentId: lastId,
          timestamp: ts,
          type: 'function_call',
          callId: item.callId,
          name: 'Bash',
          arguments: JSON.stringify({
            command: cmd,
            description: displayCmd ? `执行命令: ${displayCmd}` : '执行终端命令'
          }),
          providerData: {
            argumentsDisplayText: displayCmd || 'Bash 命令',
            agent: 'cli'
          },
          sessionId,
          cwd: targetProjectRoot
        }));
        lastId = itemId;
      } else if (item.kind === 'tool_result') {
        const outStr = item.output || '';
        lines.push(JSON.stringify({
          id: itemId,
          parentId: lastId,
          timestamp: ts,
          type: 'function_call_result',
          name: 'Bash',
          callId: item.callId,
          status: 'completed',
          output: {
            type: 'text',
            text: outStr
          },
          providerData: {
            agent: 'cli',
            toolResult: {
              content: outStr,
              renderer: {
                type: 'text',
                value: outStr
              },
              rawResponse: {
                exitCode: 0,
                signal: null,
                tool_error_code: '0'
              }
            }
          },
          sessionId,
          cwd: targetProjectRoot
        }));
        lastId = itemId;
      } else if (item.kind === 'message' && item.role === 'assistant') {
        let parentId = lastId;

        if (item.reasoning) {
          const reasoningId = crypto.randomUUID();
          lines.push(JSON.stringify({
            id: reasoningId,
            parentId: lastId,
            timestamp: ts,
            type: 'reasoning',
            rawContent: [
              { type: 'reasoning_text', text: item.reasoning }
            ],
            sessionId,
            cwd: targetProjectRoot
          }));
          parentId = reasoningId;
        }

        lines.push(JSON.stringify({
          id: itemId,
          parentId,
          timestamp: ts + 100,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: item.content }
          ],
          sessionId,
          cwd: targetProjectRoot
        }));
        lastId = itemId;
      }
    }

    fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');

    if (!options.skipDb) {
      this.upsertSessionDb(wbDir, sessionId, targetProjectRoot, rebasedSession.title || '同步会话', rebasedSession.createdAt, rebasedSession.updatedAt);
    }

    return { sessionId, jsonlPath, projectSlug, eventCount: lines.length };
  }

  static upsertSessionDb(wbDir, sessionId, cwd, title, createdAt, updatedAt) {
    const dbPath = path.join(wbDir, 'workbuddy.db');
    if (!fs.existsSync(dbPath)) {
      throw new Error(`WorkBuddy database not found: ${dbPath}`);
    }

    const normalizedCwd = cwd.replace(/[\\/]+/g, '/');
    const safeTitle = (title || '同步会话').slice(0, 50);
    const userId = 'f100c404-7092-40cf-843d-8a3d0f4a1c0a';

    execSqlite(dbPath, `
        INSERT INTO sessions (
            id, cwd, user_id, title, custom_title, status,
            created_at, updated_at, last_activity_at, deleted_at,
            is_playground, source_mode, mode, model, permission_mode,
            use_sandbox_cli, thought_level, transport, unread
        ) VALUES (
            ?, ?, ?, ?, ?, 'completed',
            ?, ?, ?, NULL,
            '0', 'working', 'craft', 'custom-local:deepseek-v4-pro', 'bypassPermissions',
            '1', 'disabled', 'local', '0'
        )
        ON CONFLICT(id) DO UPDATE SET
            cwd = excluded.cwd,
            title = excluded.title,
            updated_at = excluded.updated_at,
            last_activity_at = excluded.last_activity_at
    `, [
        sessionId,
        normalizedCwd,
        userId,
        safeTitle,
        safeTitle,
        createdAt,
        updatedAt,
        updatedAt
    ]);
  }
}
