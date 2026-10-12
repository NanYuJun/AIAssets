import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { Cleaner } from '../../core/cleaner.js';

const TOOL_LABELS = {
  read: 'Read',
  bash: 'Bash',
  edit: 'Edit',
  write: 'Write'
};

export class PiReader {
  static getPiHome() {
    return process.env.PI_HOME || path.join(os.homedir(), '.pi');
  }

  static getSessionsDir() {
    return path.join(this.getPiHome(), 'agent', 'sessions');
  }

  static listProjects() {
    const root = this.getSessionsDir();
    if (!fs.existsSync(root)) return [];

    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('--') && entry.name.endsWith('--'))
      .map(entry => {
        const workspacePath = this.decodeCwdFromDir(path.join(root, entry.name, 'session.jsonl'));
        return {
          id: `pi:${entry.name}`,
          agent: 'pi',
          label: path.basename(workspacePath) || workspacePath,
          path: workspacePath.replace(/\\/g, '/'),
          exists: fs.existsSync(workspacePath),
          source: 'pi_sessions_dir'
        };
      });
  }

  static scanAllSessions() {
    const root = this.getSessionsDir();
    const results = [];

    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    }

    walk(root);
    results.sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    });
    return results;
  }

  static decodeCwdFromDir(filePath) {
    const dirName = path.basename(path.dirname(filePath));
    const raw = dirName.startsWith('--') && dirName.endsWith('--') ? dirName.slice(2, -2) : dirName;
    const segments = raw.split('--').filter(Boolean);
    if (segments.length === 0) return '';
    const drive = segments[0].slice(0, 1).toUpperCase();
    const rest = segments.length > 1 ? segments.slice(1).join('/') : '';
    return `${drive}:/${rest}`.replace(/\/+$/, '');
  }

  static contentToText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }

  static async fastScanSummary(filePath, projectResolver) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let sessionMeta = {};
    let title = '';
    let msgCount = 0;
    let toolCount = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (entry.type === 'session') {
        sessionMeta = entry;
      } else if (entry.type === 'message' && entry.message) {
        const role = entry.message.role;
        if (role === 'toolResult') {
          toolCount++;
        } else {
          msgCount++;
          const text = this.contentToText(entry.message.content);
          if (!title && role === 'user' && text) {
            title = Cleaner.cleanUserMessage(text).slice(0, 30);
          }
        }
      }
    }

    if (!title || !title.startsWith('<image') === false) {
      // title 由首个用户文本决定；纯图片路径会话也允许保留
    }
    if (!title) return null;

    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}

    const cwd = sessionMeta.cwd || this.decodeCwdFromDir(filePath);
    return {
      id: sessionMeta.id || path.basename(filePath, '.jsonl').split('_').pop(),
      agent: 'pi',
      agentLabel: 'Pi',
      title,
      cwd,
      projectName: projectResolver ? projectResolver(cwd) : path.basename(cwd),
      messageCount: msgCount,
      toolCallCount: toolCount,
      updatedAt: mtime,
      filePath
    };
  }

  static async parseSession(filePath, projectResolver) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let sessionMeta = {};
    const events = [];
    let firstUserText = '';
    const toolCalls = new Map();

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (entry.type === 'session') {
        sessionMeta = entry;
        continue;
      }
      if (entry.type !== 'message' || !entry.message) continue;

      const message = entry.message;
      const ts = typeof entry.timestamp === 'string' ? new Date(entry.timestamp).getTime() : (message.timestamp || Date.now());
      const role = message.role;

      if (role === 'toolResult') {
        const call = toolCalls.get(message.toolCallId);
        const output = this.contentToText(message.content);
        events.push({
          kind: 'tool_result',
          id: entry.id || message.toolCallId || crypto.randomUUID(),
          callId: message.toolCallId,
          name: call?.name || 'Bash',
          timestamp: ts,
          output: output.trim()
        });
        continue;
      }

      const content = Array.isArray(message.content) ? message.content : [];
      const textParts = content.filter(part => part?.type === 'text' && typeof part.text === 'string');
      const toolParts = content.filter(part => part?.type === 'toolCall');

      if (toolParts.length > 0) {
        for (const tool of toolParts) {
          const toolName = TOOL_LABELS[tool.name] || tool.name || 'Bash';
          events.push({
            kind: 'tool_call',
            id: tool.id || entry.id || crypto.randomUUID(),
            callId: tool.id,
            name: toolName,
            timestamp: ts,
            arguments: JSON.stringify(tool.arguments || {})
          });
          toolCalls.set(tool.id, { name: toolName });
        }
      }

      const text = textParts.map(part => part.text).join('');
      if (!text) continue;

      if (role === 'user') {
        const cleaned = Cleaner.cleanUserMessage(text);
        if (!firstUserText && cleaned) firstUserText = cleaned;
        events.push({ kind: 'message', id: entry.id || crypto.randomUUID(), role: 'user', timestamp: ts, content: cleaned.trim() });
      } else if (role === 'assistant') {
        events.push({ kind: 'message', id: entry.id || crypto.randomUUID(), role: 'assistant', timestamp: ts, content: text.trim() });
      }
    }

    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}

    const cwd = sessionMeta.cwd || this.decodeCwdFromDir(filePath);
    const sessionId = sessionMeta.id || path.basename(filePath, '.jsonl').split('_').pop();

    return {
      schemaVersion: 1,
      id: sessionId,
      title: firstUserText || 'Pi 对话会话',
      createdAt: sessionMeta.timestamp ? new Date(sessionMeta.timestamp).getTime() : mtime,
      updatedAt: mtime,
      sourceAgent: 'pi',
      project: {
        name: projectResolver ? projectResolver(cwd) : path.basename(cwd),
        originalCwd: cwd
      },
      events,
      messages: events.filter(e => e.kind === 'message')
    };
  }
}
