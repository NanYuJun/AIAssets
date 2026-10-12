import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PathRemapper } from '../../core/path-remapper.js';

export class DshWriter {
  static async injectSession(canonicalSession, targetProjectRoot, options = {}) {
    const dshHome = options.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    const sessionsDir = path.join(dshHome, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const rebased = PathRemapper.rebaseSession(canonicalSession, targetProjectRoot);
    const sessionId = rebased.id?.startsWith('session-') ? rebased.id : 'session-' + crypto.randomUUID();
    const slug = '--' + targetProjectRoot.replace(/[\\/]+/g, '-').replace(/:/g, '') + '--';
    const projectDir = path.join(sessionsDir, slug);
    const sessionDir = path.join(projectDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const events = rebased.events || rebased.messages?.map(m => ({ ...m, kind: 'message' })) || [];
    const lines = [];

    lines.push(JSON.stringify({
      type: 'session', version: 4, id: sessionId,
      createdAt: rebased.createdAt || Date.now(),
      cwd: targetProjectRoot, isSeeded: false, delegationDepth: 0, agentPreset: 'standard'
    }));

    for (const ev of events) {
      const ts = ev.timestamp || rebased.updatedAt || Date.now();
      if (ev.kind === 'message' && ev.role === 'user') {
        lines.push(JSON.stringify({ type: 'message', id: ev.id || crypto.randomUUID(), role: 'user', timestamp: ts, content: ev.content }));
      } else if (ev.kind === 'message' && ev.role === 'assistant') {
        lines.push(JSON.stringify({ type: 'message', id: ev.id || crypto.randomUUID(), role: 'assistant', timestamp: ts, content: ev.content }));
      } else if (ev.kind === 'tool_call') {
        let cmd = '';
        try { const p = JSON.parse(ev.arguments || '{}'); cmd = p.command || p.cmd || JSON.stringify(p); } catch { cmd = String(ev.arguments || ''); }
        lines.push(JSON.stringify({ type: 'tool_call', id: ev.id || crypto.randomUUID(), name: ev.name || 'Bash', timestamp: ts, content: cmd.slice(0, 5000) }));
      } else if (ev.kind === 'tool_result') {
        lines.push(JSON.stringify({ type: 'tool_result', id: ev.id || crypto.randomUUID(), callId: ev.callId, timestamp: ts, content: String(ev.output || '').slice(0, 5000) }));
      }
    }

    const jsonl = lines.join('\n') + '\n';
    const filePath = path.join(sessionDir, 'session.v4.jsonl.zstd');
    fs.writeFileSync(filePath, zlib.zstdCompressSync(Buffer.from(jsonl, 'utf-8')));
    return { sessionId, filePath, eventCount: lines.length };
  }
}
