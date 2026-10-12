import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PathRemapper } from '../../core/path-remapper.js';

const TOOL_NAMES = {
  Read: 'read',
  Bash: 'bash',
  Edit: 'edit',
  Write: 'write'
};

function isoTimestamp(ms) {
  return new Date(typeof ms === 'number' ? ms : Date.now()).toISOString();
}

export class PiWriter {
  static encodeProjectDir(cwd) {
    return '--' + String(cwd || '').replace(/\\/g, '--').replace(/\//g, '--') + '--';
  }

  static async injectSession(canonicalSession, targetProjectRoot, options = {}) {
    const piDir = options.piDir || process.env.PI_HOME || path.join(os.homedir(), '.pi');
    const sessionsDir = path.join(piDir, 'agent', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const rebasedSession = PathRemapper.rebaseSession(canonicalSession, targetProjectRoot);
    const sessionId = rebasedSession.id || crypto.randomUUID();
    const createdAt = rebasedSession.createdAt || Date.now();
    const updatedAt = rebasedSession.updatedAt || createdAt;

    const projectDirName = '--' + targetProjectRoot.replace(/:/g, '').replace(/[\\/]+/g, '--') + '--';
    const targetProjectDir = path.join(sessionsDir, projectDirName);
    if (!fs.existsSync(targetProjectDir)) {
      fs.mkdirSync(targetProjectDir, { recursive: true });
    }

    const events = rebasedSession.events || rebasedSession.messages?.map(m => ({ ...m, kind: 'message' })) || [];
    const fileName = `${isoTimestamp(createdAt).replace(/[:.]/g, '-')}_${sessionId}.jsonl`;
    const filePath = path.join(targetProjectDir, fileName);
    const lines = [];

    lines.push(JSON.stringify({
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: isoTimestamp(createdAt),
      cwd: targetProjectRoot
    }));

    lines.push(JSON.stringify({
      type: 'model_change',
      id: crypto.randomUUID().slice(0, 8),
      parentId: null,
      timestamp: isoTimestamp(createdAt + 1),
      provider: 'opencodex',
      modelId: rebasedSession.metadata?.model || 'google-antigravity/gemini-3.7-flash'
    }));

    let lastId = null;
    for (const event of events) {
      const eventId = (event.id && event.id.length <= 8) ? event.id : crypto.randomUUID().slice(0, 8);
      const ts = isoTimestamp(event.timestamp || updatedAt);

      if (event.kind === 'message' && event.role === 'user') {
        lines.push(JSON.stringify({
          type: 'message',
          id: eventId,
          parentId: lastId,
          timestamp: ts,
          message: {
            role: 'user',
            content: [{ type: 'text', text: event.content }],
            timestamp: event.timestamp || updatedAt
          }
        }));
        lastId = eventId;
      } else if (event.kind === 'message' && event.role === 'assistant') {
        lines.push(JSON.stringify({
          type: 'message',
          id: eventId,
          parentId: lastId,
          timestamp: ts,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: event.content }],
            api: 'openai-completions',
            provider: 'opencodex',
            model: rebasedSession.metadata?.model || 'google-antigravity/gemini-3.7-flash',
            timestamp: event.timestamp || updatedAt,
            stopReason: 'stop'
          }
        }));
        lastId = eventId;
      } else if (event.kind === 'tool_call') {
        let args = {};
        try {
          const parsed = typeof event.arguments === 'string' ? JSON.parse(event.arguments) : event.arguments;
          if (parsed && typeof parsed === 'object' && parsed.command !== undefined) {
            args = { command: parsed.command };
          } else {
            args = parsed || {};
          }
        } catch {
          args = { command: String(event.arguments || '') };
        }

        const toolName = TOOL_NAMES[event.name] || event.name.toLowerCase();
        lines.push(JSON.stringify({
          type: 'message',
          id: eventId,
          parentId: lastId,
          timestamp: ts,
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: event.callId || `call_${eventId}`, name: toolName, arguments: args }],
            api: 'openai-completions',
            provider: 'opencodex',
            model: rebasedSession.metadata?.model || 'google-antigravity/gemini-3.7-flash',
            timestamp: event.timestamp || updatedAt,
            stopReason: 'toolUse'
          }
        }));
        lastId = eventId;
      } else if (event.kind === 'tool_result') {
        lines.push(JSON.stringify({
          type: 'message',
          id: eventId,
          parentId: lastId,
          timestamp: ts,
          message: {
            role: 'toolResult',
            toolCallId: event.callId,
            toolName: TOOL_NAMES[event.name] || (event.name || 'bash').toLowerCase(),
            content: [{ type: 'text', text: event.output }],
            isError: false,
            timestamp: event.timestamp || updatedAt
          }
        }));
        lastId = eventId;
      }
    }

    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    return { sessionId, filePath, projectDir: targetProjectDir, eventCount: lines.length };
  }
}
