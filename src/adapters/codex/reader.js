import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Cleaner } from '../../core/cleaner.js';
import { querySqlite } from '../../core/sqlite.js';

export class CodexReader {
  // Codex 桌面端生成的会话标题缓存（thread_id -> display_title），来自 codex-dev.db
  static _titleMap = null;
  static _titleMapLoadedAt = 0;

  static getTitleMap() {
    // 缓存 60 秒，避免频繁打开 SQLite
    if (this._titleMap && Date.now() - this._titleMapLoadedAt < 60000) return this._titleMap;
    try {
      const dbPath = path.join(os.homedir(), '.codex', 'sqlite', 'codex-dev.db');
      if (!fs.existsSync(dbPath)) return this._titleMap || new Map();
      const rows = querySqlite(dbPath, 'SELECT thread_id, display_title FROM local_thread_catalog WHERE display_title IS NOT NULL AND display_title != \'\'');
      const map = new Map(rows.map(r => [r.thread_id, r.display_title]));
      this._titleMap = map;
      this._titleMapLoadedAt = Date.now();
      return map;
    } catch {
      return this._titleMap || new Map();
    }
  }
  static getCodexHome() {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  }

  static getSessionsDir() {
    return path.join(this.getCodexHome(), 'sessions');
  }

  static listProjects() {
    const stateDbPath = path.join(this.getCodexHome(), 'state_5.sqlite');
    const rows = querySqlite(stateDbPath, `
      SELECT
        p.id AS project_id,
        p.name,
        p.position,
        p.updated_at_ms,
        r.position AS root_position,
        r.path
      FROM projects p
      INNER JOIN project_roots r ON r.project_id = p.id
      ORDER BY p.position ASC, r.position ASC
    `);

    return rows.map(row => ({
      id: `codex:${row.project_id}:${row.root_position}`,
      agent: 'codex',
      agentProjectId: row.project_id,
      label: row.name,
      path: String(row.path).replace(/[\\/]+/g, '/'),
      position: row.position,
      lastUpdated: row.updated_at_ms,
      exists: fs.existsSync(row.path),
      source: 'codex_state_db'
    }));
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
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

    return results;
  }

  static async parseSession(filePath, options = { includeToolExecution: true }) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session file not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let sessionMeta = {};
    const events = [];
    let firstUserText = '';

    const activeToolCalls = new Map();

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const type = entry.type;
      const payload = entry.payload || {};
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

      if (type === 'session_meta') {
        sessionMeta = payload;
        continue;
      }

      if (type === 'response_item') {
        const payloadType = payload.type;
        const role = payload.role;

        if (payloadType === 'message') {
          if (role === 'developer') continue;

          const contentArr = payload.content || [];
          let text = '';
          let thinking = '';

          for (const c of contentArr) {
            if (typeof c === 'string') {
              text += c;
            } else if (typeof c === 'object' && c !== null) {
              if (c.type === 'text' || c.type === 'input_text' || c.type === 'output_text') {
                text += c.text || '';
              } else if (c.type === 'thinking') {
                thinking += c.text || '';
              }
            }
          }

          if (role === 'user') {
            text = Cleaner.cleanUserMessage(text);
            if (!firstUserText && text) {
              firstUserText = text.slice(0, 30);
            }
          }

          if (text || thinking) {
            events.push({
              kind: 'message',
              id: payload.id || crypto.randomUUID(),
              role,
              timestamp: ts,
              content: text.trim(),
              reasoning: thinking.trim() || undefined
            });
          }
        } else if (options.includeToolExecution && (payloadType === 'custom_tool_call' || payloadType === 'tool_call')) {
          const callId = payload.call_id || payload.id || crypto.randomUUID();
          const toolName = payload.name || 'tool';
          const input = payload.input || payload.arguments || '';

          // 提取命令：支持多命令抽取
          let commandStr = '';
          if (typeof input === 'string') {
            const cmdMatches = [...input.matchAll(/cmd:\s*(["'`])([\s\S]*?)\1/g)];
            if (cmdMatches.length > 0) {
              commandStr = cmdMatches.map(m => m[2].replace(/\\"/g, '"')).join(' && ');
            } else {
              commandStr = input;
            }
          } else if (typeof input === 'object' && input !== null) {
            commandStr = input.cmd || input.command || JSON.stringify(input);
          }

          const callEvent = {
            kind: 'tool_call',
            id: payload.id || crypto.randomUUID(),
            callId,
            name: 'Bash',
            timestamp: ts,
            arguments: JSON.stringify({ command: commandStr })
          };

          activeToolCalls.set(callId, callEvent);
          events.push(callEvent);
        } else if (options.includeToolExecution && (payloadType === 'custom_tool_call_output' || payloadType === 'tool_output')) {
          const callId = payload.call_id;
          let outText = '';
          if (Array.isArray(payload.output)) {
            outText = payload.output.map(o => (typeof o === 'string' ? o : o.text || '')).join('');
          } else if (typeof payload.output === 'string') {
            outText = payload.output;
          } else if (payload.output) {
            outText = JSON.stringify(payload.output);
          }

          events.push({
            kind: 'tool_result',
            id: payload.id || crypto.randomUUID(),
            callId,
            name: 'Bash',
            timestamp: ts,
            output: outText.trim()
          });
        }
      }
    }

    const sessionId = sessionMeta.id || path.basename(filePath, '.jsonl');
    const cwd = sessionMeta.cwd || process.cwd();
    let projectName = path.basename(cwd) || '自由对话 / 日常问答';
    const normCwd = (cwd || '').replace(/[\/]+/g, '/');
    if (!cwd || /Documents\/Codex\/\d{4}-\d{2}-\d{2}\//i.test(normCwd) || ['you', 'bei', 'mao', 'xian', 'pu', 'new-chat', 'fu', 'xiao-i', 'jia-li', 'na-s', 'wo-x', 'wo-y', 'zhe'].includes(projectName.toLowerCase())) {
      projectName = '自由对话 / 日常问答';
    }
    let birthtime = Date.now();
    let mtime = Date.now();
    try {
      const st = fs.statSync(filePath);
      birthtime = st.birthtimeMs;
      mtime = st.mtimeMs;
    } catch {}

    const createdAt = sessionMeta.timestamp ? new Date(sessionMeta.timestamp).getTime() : birthtime;
    const updatedAt = mtime;

    // 优先使用 Codex 桌面端生成的标题，其次第一句用户消息
    const catalogTitle = this.getTitleMap().get(sessionId);
    const title = (catalogTitle && catalogTitle.trim()) || firstUserText || 'Codex 对话会话';

    return {
      schemaVersion: 1,
      id: sessionId,
      title,
      createdAt,
      updatedAt,
      sourceAgent: 'codex',
      project: {
        name: projectName,
        gitRemote: sessionMeta.git?.remote,
        gitBranch: sessionMeta.git?.branch,
        originalCwd: cwd
      },
      events,
      messages: events.filter(e => e.kind === 'message'),
      metadata: {
        model: sessionMeta.model
      }
    };
  }
}
