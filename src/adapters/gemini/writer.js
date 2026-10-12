import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PathRemapper } from '../../core/path-remapper.js';

function iso(ms) {
  return new Date(typeof ms === 'number' ? ms : Date.now()).toISOString();
}

export class GeminiWriter {
  static async injectSession(canonicalSession, targetProjectRoot, options = {}) {
    const geminiHome = options.geminiHome || process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini');
    const brainDir = path.join(geminiHome, 'antigravity', 'brain');
    fs.mkdirSync(brainDir, { recursive: true });

    const rebased = PathRemapper.rebaseSession(canonicalSession, targetProjectRoot);
    const sessionId = crypto.randomUUID();
    const sessionDir = path.join(brainDir, sessionId);
    const logDir = path.join(sessionDir, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const events = rebased.events || rebased.messages?.map(m => ({ ...m, kind: 'message' })) || [];
    const lines = [];
    let step = 0;

    lines.push(JSON.stringify({
      step_index: step++, source: 'SYSTEM', type: 'CHECKPOINT', status: 'DONE',
      created_at: iso(rebased.createdAt || Date.now()),
      content: '{{ CHECKPOINT 0 }}\n同步会话开始。目标工作区：' + targetProjectRoot
    }));

    for (const ev of events) {
      const ts = iso(ev.timestamp || rebased.updatedAt || Date.now());
      if (ev.kind === 'message' && ev.role === 'user') {
        lines.push(JSON.stringify({
          step_index: step++, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
          created_at: ts, content: `<USER_REQUEST>\n${ev.content}\n</USER_REQUEST>`
        }));
      } else if (ev.kind === 'message' && ev.role === 'assistant') {
        lines.push(JSON.stringify({
          step_index: step++, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE',
          created_at: ts, content: ev.content
        }));
      } else if (ev.kind === 'tool_call') {
        let cmd = '';
        try { const p = JSON.parse(ev.arguments || '{}'); cmd = p.command || p.cmd || JSON.stringify(p); } catch { cmd = String(ev.arguments || ''); }
        lines.push(JSON.stringify({
          step_index: step++, source: 'MODEL', type: 'TOOL_CALL', status: 'DONE',
          created_at: ts, content: cmd.slice(0, 5000)
        }));
      } else if (ev.kind === 'tool_result') {
        lines.push(JSON.stringify({
          step_index: step++, source: 'SYSTEM', type: 'TOOL_RESULT', status: 'DONE',
          created_at: ts, content: String(ev.output || '').slice(0, 5000)
        }));
      }
    }

    const filePath = path.join(logDir, 'transcript.jsonl');
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    return { sessionId, filePath, eventCount: lines.length };
  }
}
