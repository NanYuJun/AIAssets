import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { Cleaner } from '../../core/cleaner.js';
import { querySqlite } from '../../core/sqlite.js';

export class WorkBuddyReader {
  static getWorkBuddyHome() {
    return process.env.WORKBUDDY_HOME || path.join(os.homedir(), '.workbuddy');
  }

  static getProjectsDir() {
    return path.join(this.getWorkBuddyHome(), 'projects');
  }

  static listProjects() {
    const dbPath = path.join(this.getWorkBuddyHome(), 'workbuddy.db');
    const rows = querySqlite(dbPath, `
      SELECT path, last_opened_at
      FROM workspaces
      WHERE path IS NOT NULL AND TRIM(path) <> ''
      ORDER BY last_opened_at DESC
    `);
    const seen = new Set();

    return rows.flatMap(row => {
      const normalizedPath = String(row.path).replace(/[\\/]+/g, '/');
      const identity = normalizedPath.toLowerCase();
      if (seen.has(identity)) return [];
      seen.add(identity);

      return [{
        id: `workbuddy:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12)}`,
        agent: 'workbuddy',
        label: path.basename(normalizedPath) || normalizedPath,
        path: normalizedPath,
        lastUpdated: row.last_opened_at,
        exists: fs.existsSync(row.path),
        source: 'workbuddy_db'
      }];
    });
  }

  static scanAllSessions() {
    const root = this.getProjectsDir();
    const results = [];
    if (!fs.existsSync(root)) return results;

    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.includes('.file-rollback')) {
          results.push(fullPath);
        }
      }
    }

    try { walk(root); } catch {}
    results.sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    });
    return results;
  }

  static async fastScanSummary(filePath, projectResolver) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let title = '';
    let cwd = '';
    let msgCount = 0;
    let toolCount = 0;
    const sessionId = path.basename(filePath, '.jsonl');

    for await (const line of rl) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }

      if (e.cwd && !cwd) cwd = e.cwd;

      if (e.type === 'ai-title' && e.aiTitle) {
        title = e.aiTitle;
      } else if (e.type === 'message') {
        msgCount++;
        if (!title && e.role === 'user') {
          const rawText = Array.isArray(e.content) ? e.content.map(c => c.text || '').join('') : String(e.content || '');
          title = Cleaner.cleanUserMessage(rawText).slice(0, 30);
        }
      } else if (e.type === 'function_call') {
        toolCount++;
      }
    }

    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}

    const projectName = projectResolver ? projectResolver(cwd) : (path.basename(cwd) || '最近对话 (未归档项目)');

    return {
      id: sessionId,
      agent: 'workbuddy',
      agentLabel: 'WorkBuddy',
      title: title || 'WorkBuddy 对话会话',
      cwd,
      projectName,
      messageCount: msgCount,
      toolCallCount: toolCount,
      updatedAt: mtime,
      filePath
    };
  }

  static async parseSession(filePath, projectResolver) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const sessionId = path.basename(filePath, '.jsonl');
    let title = '';
    let cwd = '';
    const events = [];

    for await (const line of rl) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }

      if (e.cwd && !cwd) cwd = e.cwd;

      if (e.type === 'ai-title' && e.aiTitle) {
        title = e.aiTitle;
      } else if (e.type === 'message') {
        const rawContent = Array.isArray(e.content) ? e.content.map(c => c.text || '').join('') : String(e.content || '');
        const cleanContent = e.role === 'user' ? Cleaner.cleanUserMessage(rawContent) : rawContent;
        if (!title && e.role === 'user' && cleanContent) {
          title = cleanContent.slice(0, 30);
        }
        events.push({
          kind: 'message',
          id: e.id,
          role: e.role,
          timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
          content: cleanContent.trim()
        });
      } else if (e.type === 'function_call') {
        events.push({
          kind: 'tool_call',
          id: e.id,
          callId: e.callId || e.id,
          name: e.name || 'Bash',
          timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
          arguments: typeof e.arguments === 'string' ? e.arguments : JSON.stringify(e.arguments || {})
        });
      } else if (e.type === 'function_call_result') {
        const out = typeof e.output === 'object' && e.output !== null ? (e.output.text || JSON.stringify(e.output)) : String(e.output || '');
        events.push({
          kind: 'tool_result',
          id: e.id,
          callId: e.callId || e.id,
          name: e.name || 'Bash',
          timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
          output: out.trim()
        });
      }
    }

    let mtime = Date.now();
    try { mtime = fs.statSync(filePath).mtimeMs; } catch {}

    const projectName = projectResolver ? projectResolver(cwd) : (path.basename(cwd) || '最近对话 (未归档项目)');

    return {
      schemaVersion: 1,
      id: sessionId,
      title: title || 'WorkBuddy 对话会话',
      createdAt: mtime,
      updatedAt: mtime,
      sourceAgent: 'workbuddy',
      project: {
        name: projectName,
        originalCwd: cwd
      },
      events,
      messages: events.filter(e => e.kind === 'message')
    };
  }
}
