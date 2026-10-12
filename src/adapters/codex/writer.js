import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PathRemapper } from '../../core/path-remapper.js';

export class CodexWriter {
  static getCodexSessionsDir() {
    const customHome = process.env.CODEX_HOME;
    if (customHome) {
      return path.join(customHome, 'sessions');
    }
    return path.join(os.homedir(), '.codex', 'sessions');
  }

  static async injectSession(canonicalSession, targetProjectRoot) {
    const rootDir = this.getCodexSessionsDir();
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const targetDir = path.join(rootDir, year, month, day);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const rebasedSession = PathRemapper.rebaseSession(canonicalSession, targetProjectRoot);
    const sessionId = rebasedSession.id || crypto.randomUUID();
    const timestampIso = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `rollout-${timestampIso}-${sessionId}.jsonl`;
    const fullPath = path.join(targetDir, fileName);

    const lines = [];

    // 1. session_meta
    lines.push(JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: new Date().toISOString(),
        cwd: targetProjectRoot,
        git: { branch: "master" }
      }
    }));

    // 2. events
    const events = rebasedSession.events || rebasedSession.messages || [];
    for (const ev of events) {
      const ts = new Date(ev.timestamp || Date.now()).toISOString();

      if (ev.kind === 'message') {
        lines.push(JSON.stringify({
          timestamp: ts,
          type: "response_item",
          payload: {
            type: "message",
            role: ev.role,
            content: [{ type: ev.role === 'user' ? "text" : "output_text", text: ev.content }]
          }
        }));
      } else if (ev.kind === 'tool_call') {
        lines.push(JSON.stringify({
          timestamp: ts,
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            id: ev.id,
            call_id: ev.callId || ev.id,
            name: "exec",
            input: ev.arguments || ""
          }
        }));
      } else if (ev.kind === 'tool_result') {
        lines.push(JSON.stringify({
          timestamp: ts,
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            id: ev.id,
            call_id: ev.callId || ev.id,
            output: [{ type: "input_text", text: ev.output || "" }]
          }
        }));
      }
    }

    fs.writeFileSync(fullPath, lines.join('\n') + '\n', 'utf-8');
    return { sessionId, fullPath };
  }
}
