import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CodexReader } from '../adapters/codex/reader.js';
import { CodexWriter } from '../adapters/codex/writer.js';
import { WorkBuddyReader } from '../adapters/workbuddy/reader.js';
import { WorkBuddyWriter } from '../adapters/workbuddy/writer.js';
import { PiReader } from '../adapters/pi/reader.js';
import { PiWriter } from '../adapters/pi/writer.js';
import { GeminiReader } from '../adapters/gemini/reader.js';
import { GeminiWriter } from '../adapters/gemini/writer.js';
import { DshReader } from '../adapters/dsh/reader.js';
import { DshWriter } from '../adapters/dsh/writer.js';
import { ClaudeReader } from '../adapters/claude/reader.js';
import { ClaudeWriter } from '../adapters/claude/writer.js';
import { ZCodeReader } from '../adapters/zcode/reader.js';
import { ZCodeWriter } from '../adapters/zcode/writer.js';
import { OpenCodeReader } from '../adapters/opencode/reader.js';
import { OpenCodeWriter } from '../adapters/opencode/writer.js';
import { GrokReader } from '../adapters/grok/reader.js';
import { GrokWriter } from '../adapters/grok/writer.js';
import { CursorReader } from '../adapters/cursor/reader.js';
import { CursorWriter } from '../adapters/cursor/writer.js';
import { BackupManager, PROVIDER_DEFAULTS } from '../core/backup.js';
import { ConfigManager } from '../core/config.js';
import { Cleaner } from '../core/cleaner.js';
import { AuthManager } from '../core/auth.js';
import { ShareManager, CollectionManager } from '../core/sharing.js';
import { CloudIndex } from '../core/cloud-index.js';
import { RequestLog } from '../core/request-log.js';
import { AutoSyncManager } from '../core/auto-sync.js';
import { execSqlite } from '../core/sqlite.js';
import { createZip } from './utils/zip.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLOUD_STORAGE_DIR = process.env.CLOUD_STORAGE_DIR || path.resolve(__dirname, '../../cloud-hub-storage');
if (!fs.existsSync(CLOUD_STORAGE_DIR)) {
  fs.mkdirSync(CLOUD_STORAGE_DIR, { recursive: true });
}

const HUB_DATA_DIR = process.env.HUB_DATA_DIR || path.resolve(__dirname, '../../hub-data');
if (!fs.existsSync(HUB_DATA_DIR)) {
  fs.mkdirSync(HUB_DATA_DIR, { recursive: true });
}
const auth = new AuthManager(HUB_DATA_DIR);
const shares = new ShareManager(HUB_DATA_DIR);
const collections = new CollectionManager(HUB_DATA_DIR);
const cloudIndex = new CloudIndex(CLOUD_STORAGE_DIR);
cloudIndex.loadOnce();
const requestLog = new RequestLog(HUB_DATA_DIR);
const autoSync = new AutoSyncManager(HUB_DATA_DIR);
const backup = new BackupManager(HUB_DATA_DIR, {
  hubDataDir: HUB_DATA_DIR,
  storageDirs: [CLOUD_STORAGE_DIR]
});

function isLocalRequest(req) {
  const remote = req.socket.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function isAuthorized(req, url) {
  if (!auth.isConfigured()) return true;
  return Boolean(resolveAuth(req, url));
}

function resolveAuth(req, url) {
  const bearer = auth.verifyToken(auth.extractToken(req, url));
  if (bearer) return { via: 'bearer', ...bearer };
  const cookie = auth.verifyToken(getCookieToken(req));
  if (cookie) return { via: 'cookie', ...cookie };
  return null;
}

function currentUser(req, url) {
  if (!auth.isConfigured()) return { userId: null, username: 'local', role: 'admin' };
  const a = resolveAuth(req, url);
  if (!a || !a.userId) return null;
  const user = auth.getUserById(a.userId);
  if (!user || user.status === 'disabled') return null;
  return { userId: user.id, username: user.username, role: user.role, displayName: user.displayName || user.username, avatarColor: user.avatarColor || null, status: user.status || 'active', lastLoginAt: user.lastLoginAt || null };
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `hub_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'hub_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function getCookieToken(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)hub_token=([^;]+)/);
  return match ? match[1] : null;
}

function isCookieAuthorized(req) {
  if (!auth.isConfigured()) return true;
  return auth.verifyToken(getCookieToken(req));
}

let cachedLocalItems = [];
let totalFoundSessions = 0;
let scanPromise = null;
let projectSourceErrors = [];

function normalizeProjectPath(value) {
  return String(value || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

function applyCodexLabelsToWorkBuddy(codexProjects, workBuddyProjects) {
  const codexLabels = new Map(codexProjects.map(project => [normalizeProjectPath(project.path), project.label]));
  return workBuddyProjects.map(project => {
    const codexLabel = codexLabels.get(normalizeProjectPath(project.path));
    return {
      ...project,
      label: codexLabel || project.label,
      labelSource: codexLabel ? 'codex_state_db' : 'path_basename'
    };
  });
}

function buildProjectResolver(codexProjects, workBuddyProjects) {
  const projects = [...codexProjects, ...applyCodexLabelsToWorkBuddy(codexProjects, workBuddyProjects), ...PiReader.listProjects()]
    .filter(project => project.path)
    .sort((a, b) => normalizeProjectPath(b.path).length - normalizeProjectPath(a.path).length);

  return cwd => {
    const normalizedCwd = normalizeProjectPath(cwd);
    if (!normalizedCwd) return '最近对话 (未归档项目)';
    const matched = projects.find(project => {
      const normalizedProject = normalizeProjectPath(project.path);
      return normalizedCwd === normalizedProject || normalizedCwd.startsWith(`${normalizedProject}/`);
    });
    return matched?.label || '最近对话 (未归档项目)';
  };
}

function loadProjectCatalogs() {
  const errors = [];
  let codexProjects = [];
  let workBuddyProjects = [];

  try {
    codexProjects = CodexReader.listProjects();
  } catch (err) {
    errors.push({ agent: 'codex', error: err.message });
    console.error('读取 Codex 项目数据库失败:', err.message);
  }

  try {
    workBuddyProjects = WorkBuddyReader.listProjects();
  } catch (err) {
    errors.push({ agent: 'workbuddy', error: err.message });
    console.error('读取 WorkBuddy 项目数据库失败:', err.message);
  }

  try {
    PiReader.listProjects();
  } catch (err) {
    errors.push({ agent: 'pi', error: err.message });
    console.error('读取 Pi 项目目录失败:', err.message);
  }

  return { codexProjects, workBuddyProjects, errors };
}

function findSessionFile(files, sessionId) {
  return files.find(filePath => {
    // DSH: 内层目录名是 session-<uuid>，文件名固定为 session.v4.jsonl.zstd
    if (filePath.includes('session.v4.jsonl.zstd')) {
      const parts = filePath.replace(/\\/g, '/').split('/');
      const innerDir = parts[parts.length - 2];
      if (innerDir === `session-${sessionId}` || innerDir === sessionId) return true;
    }
    const basename = path.basename(filePath, '.jsonl');
    // Gemini 映射路径磁盘上不存在（transcript.jsonl 的虚拟名），需要解析真实路径
    if (filePath.includes('gemini-session-') && sessionId.includes(filePath.match(/gemini-session-([^\\/]+)\.jsonl/)?.[1] || '')) return true;
    if (filePath.includes('.grok\\sessions\\') || filePath.includes('.grok/sessions/')) {
      return path.dirname(filePath).replace(/\\/g, '/').includes(sessionId);
    }
    return basename === sessionId || basename.endsWith(`-${sessionId}`) || basename.endsWith(`_${sessionId}`) || basename.includes(sessionId);
  });
}

const titleCache = new Map(); // sessionId -> title（进程内持久）
// 本地会话文件列表缓存（60 秒），避免解析分享标题时反复全盘扫描
const scanCache = { at: 0, lists: null };
function getCachedScanLists() {
  if (scanCache.lists && Date.now() - scanCache.at < 60000) return scanCache.lists;
  scanCache.lists = {
    codex: CodexReader.scanAllSessions(),
    workbuddy: WorkBuddyReader.scanAllSessions(),
    pi: PiReader.scanAllSessions(),
    gemini: GeminiReader.scanAllSessions(),
    dsh: DshReader.scanAllSessions(),
    claude: ClaudeReader.scanAllSessions()
  };
  scanCache.at = Date.now();
  return scanCache.lists;
}

async function resolveSessionCanonical(sessionId, catalogs, projectResolver) {
  const cloudFile = path.join(CLOUD_STORAGE_DIR, `${sessionId}.json`);
  if (fs.existsSync(cloudFile)) {
    try {
      const s = JSON.parse(fs.readFileSync(cloudFile, 'utf-8'));
      return { session: s, fromCloud: true };
    } catch {}
  }

  const codexFile = findSessionFile(getCachedScanLists().codex, sessionId);
  if (codexFile) {
    const s = await CodexReader.parseSession(codexFile, { includeToolExecution: true });
    s.sourceAgent = 'codex';
    s.project = { ...(s.project || {}) };
    s.project.name = projectResolver(s.project.originalCwd);
    return { session: s, fromCloud: false };
  }

  const wbFile = findSessionFile(getCachedScanLists().workbuddy, sessionId);
  if (wbFile) {
    const s = await WorkBuddyReader.parseSession(wbFile, projectResolver);
    s.sourceAgent = 'workbuddy';
    return { session: s, fromCloud: false };
  }

  const piFile = findSessionFile(getCachedScanLists().pi, sessionId);
  if (piFile) {
    const s = await PiReader.parseSession(piFile, projectResolver);
    s.sourceAgent = 'pi';
    return { session: s, fromCloud: false };
  }

  const geminiFile = findSessionFile(getCachedScanLists().gemini, sessionId);
  if (geminiFile) {
    const s = await GeminiReader.parseSession(geminiFile, projectResolver);
    s.sourceAgent = 'gemini';
    return { session: s, fromCloud: false };
  }

  const dshFile = findSessionFile(getCachedScanLists().dsh, sessionId);
  if (dshFile) {
    const s = await DshReader.parseSession(dshFile, projectResolver);
    s.sourceAgent = 'dsh';
    return { session: s, fromCloud: false };
  }

  return null;
}

async function resolveSessionForTransfer(sessionId, targetAgent, sources, projectResolver) {
  const sourceOrder = ['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude', 'zcode', 'opencode', 'grok', 'cursor'].filter(agent => agent !== targetAgent);

  for (const sourceAgent of sourceOrder) {
    const files = sourceAgent === 'codex' ? sources.codexFiles
      : sourceAgent === 'workbuddy' ? sources.workBuddyFiles
      : sourceAgent === 'pi' ? sources.piFiles
      : sourceAgent === 'gemini' ? sources.geminiFiles
      : sourceAgent === 'claude' ? sources.claudeFiles
      : sourceAgent === 'zcode' ? sources.zcodeFiles
      : sourceAgent === 'opencode' ? sources.opencodeFiles
      : sourceAgent === 'grok' ? sources.grokFiles
      : sourceAgent === 'cursor' ? sources.cursorFiles
      : sources.dshFiles;
    const filePath = findSessionFile(files, sessionId);
    if (!filePath) continue;

    const canonical = sourceAgent === 'codex'
      ? await CodexReader.parseSession(filePath, { includeToolExecution: true })
      : sourceAgent === 'workbuddy'
        ? await WorkBuddyReader.parseSession(filePath, projectResolver)
        : sourceAgent === 'pi'
          ? await PiReader.parseSession(filePath, projectResolver)
          : sourceAgent === 'gemini'
            ? await GeminiReader.parseSession(filePath, projectResolver)
            : sourceAgent === 'claude'
              ? await ClaudeReader.parseSession(filePath, projectResolver)
              : sourceAgent === 'zcode'
                ? await ZCodeReader.parseSession(filePath, projectResolver)
                : sourceAgent === 'opencode'
                  ? await OpenCodeReader.parseSession(filePath, projectResolver)
                  : sourceAgent === 'grok'
                    ? await GrokReader.parseSession(filePath, projectResolver)
                    : sourceAgent === 'cursor'
                      ? await CursorReader.parseSession(filePath, projectResolver)
                      : await DshReader.parseSession(filePath, projectResolver);
    canonical.sourceAgent = sourceAgent;
    canonical.project.name = projectResolver(canonical.project.originalCwd);
    return { canonical, sourceLocation: 'local', sourceAgent };
  }

  const cloudFilePath = path.join(CLOUD_STORAGE_DIR, `${sessionId}.json`);
  if (fs.existsSync(cloudFilePath)) {
    const canonical = JSON.parse(fs.readFileSync(cloudFilePath, 'utf-8'));
    return {
      canonical,
      sourceLocation: 'cloud',
      sourceAgent: canonical.sourceAgent || 'codex'
    };
  }

  return null;
}

// 扫描单个 Codex 文件摘要
async function fastScanCodexSummary(filePath, projectResolver) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let sessionMeta = {};
  let title = '';
  let msgCount = 0;
  let toolCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'session_meta') {
      sessionMeta = e.payload || {};
    } else if (e.type === 'response_item') {
      const pt = e.payload?.type;
      if (pt === 'message') {
        msgCount++;
        if (!title && e.payload?.role === 'user') {
          const txt = Array.isArray(e.payload.content) ? e.payload.content.map(c => c.text || '').join('') : String(e.payload.content || '');
          title = Cleaner.cleanUserMessage(txt).slice(0, 30);
        }
      } else if (pt === 'custom_tool_call' || pt === 'tool_call') {
        toolCount++;
      }
    }
  }

  // 严格过滤内部安全审查日志与空会话
  if (!title || title.startsWith('The following is the Codex') || title.includes('assessing')) {
    return null;
  }

  const cwd = sessionMeta.cwd || '';
  const projectName = projectResolver(cwd);
  let mtime = Date.now();
  try { mtime = fs.statSync(filePath).mtimeMs; } catch {}

  return {
    id: sessionMeta.id || path.basename(filePath, '.jsonl'),
    agent: 'codex',
    agentLabel: 'Codex',
    title,
    cwd,
    projectName,
    messageCount: msgCount,
    toolCallCount: toolCount,
    updatedAt: mtime,
    filePath
  };
}

function rebuildLocalCache() {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    try {
      const list = [];
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      projectSourceErrors = catalogs.errors;
      const codexFiles = CodexReader.scanAllSessions();
      for (let i = 0; i < Math.min(codexFiles.length, 200); i++) {
        try {
          const s = await fastScanCodexSummary(codexFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const wbFiles = WorkBuddyReader.scanAllSessions();
      for (let i = 0; i < Math.min(wbFiles.length, 80); i++) {
        try {
          const s = await WorkBuddyReader.fastScanSummary(wbFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const piFiles = PiReader.scanAllSessions();
      for (let i = 0; i < Math.min(piFiles.length, 80); i++) {
        try {
          const s = await PiReader.fastScanSummary(piFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const geminiFiles = GeminiReader.scanAllSessions();
      for (let i = 0; i < Math.min(geminiFiles.length, 80); i++) {
        try {
          const s = await GeminiReader.fastScanSummary(geminiFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const dshFiles = DshReader.scanAllSessions();
      for (let i = 0; i < Math.min(dshFiles.length, 80); i++) {
        try {
          const s = await DshReader.fastScanSummary(dshFiles[i]);
          if (s) list.push(s);
        } catch {}
      }

      const claudeFiles = ClaudeReader.scanAllSessions();
      for (let i = 0; i < Math.min(claudeFiles.length, 80); i++) {
        try {
          const s = await ClaudeReader.fastScanSummary(claudeFiles[i]);
          if (s) list.push(s);
        } catch {}
      }

      const zcodeFiles = ZCodeReader.scanAllSessions();
      for (let i = 0; i < Math.min(zcodeFiles.length, 80); i++) {
        try {
          const s = await ZCodeReader.fastScanSummary(zcodeFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const opencodeFiles = OpenCodeReader.scanAllSessions();
      for (let i = 0; i < Math.min(opencodeFiles.length, 80); i++) {
        try {
          const s = await OpenCodeReader.fastScanSummary(opencodeFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const grokFiles = GrokReader.scanAllSessions();
      for (let i = 0; i < Math.min(grokFiles.length, 80); i++) {
        try {
          const s = await GrokReader.fastScanSummary(grokFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      const cursorFiles = CursorReader.scanAllSessions();
      for (let i = 0; i < Math.min(cursorFiles.length, 80); i++) {
        try {
          const s = await CursorReader.fastScanSummary(cursorFiles[i], projectResolver);
          if (s) list.push(s);
        } catch {}
      }

      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      cachedLocalItems = list;
      totalFoundSessions = codexFiles.length + wbFiles.length + piFiles.length + geminiFiles.length + dshFiles.length + claudeFiles.length + zcodeFiles.length + opencodeFiles.length + grokFiles.length + cursorFiles.length;
      console.log(`✅ 缓存预热完成: ${cachedLocalItems.length} 个多助手会话已常驻内存`);
    } catch (err) {
      console.error('缓存初始化异常:', err);
    } finally {
      scanPromise = null;
    }
  })();
  return scanPromise;
}

rebuildLocalCache();

// 自动上云：轮询本地会话目录，把新增/变更的会话自动备份到云端
async function runAutoSync() {
  const cfg = autoSync.config;
  if (!cfg.enabled) return { pushed: 0 };
  const catalogs = loadProjectCatalogs();
  const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
  const state = autoSync.getState();
  const known = new Map();
  try { Object.assign(known, JSON.parse(fs.readFileSync(path.join(HUB_DATA_DIR, 'auto-sync-known.json'), 'utf-8'))); } catch {}

  const agents = {
    codex: { scan: () => CodexReader.scanAllSessions(), parse: (f) => CodexReader.parseSession(f, { includeToolExecution: true }) },
    workbuddy: { scan: () => WorkBuddyReader.scanAllSessions(), parse: (f) => WorkBuddyReader.parseSession(f, projectResolver) },
    pi: { scan: () => PiReader.scanAllSessions(), parse: (f) => PiReader.parseSession(f, projectResolver) },
    gemini: { scan: () => GeminiReader.scanAllSessions(), parse: (f) => GeminiReader.parseSession(f, projectResolver) },
    dsh: { scan: () => DshReader.scanAllSessions(), parse: (f) => DshReader.parseSession(f, projectResolver) },
    claude: { scan: () => ClaudeReader.scanAllSessions(), parse: (f) => ClaudeReader.parseSession(f, projectResolver) },
    zcode: { scan: () => ZCodeReader.scanAllSessions(), parse: (f) => ZCodeReader.parseSession(f, projectResolver) },
    opencode: { scan: () => OpenCodeReader.scanAllSessions(), parse: (f) => OpenCodeReader.parseSession(f, projectResolver) },
    grok: { scan: () => GrokReader.scanAllSessions(), parse: (f) => GrokReader.parseSession(f, projectResolver) },
    cursor: { scan: () => CursorReader.scanAllSessions(), parse: (f) => CursorReader.parseSession(f, projectResolver) }
  };

  let pushed = 0;
  for (const agent of cfg.agents || ['codex', 'workbuddy', 'pi']) {
    const impl = agents[agent];
    if (!impl) continue;
    for (const file of impl.scan()) {
      let mtime;
      try { mtime = fs.statSync(file).mtimeMs; } catch { continue; } // 文件不存在（如 Gemini 虚拟路径）则跳过
      if (known[file] === mtime) continue; // unchanged
      known[file] = mtime;
      try {
        const canonical = await impl.parse(file);
        // 过滤系统注入会话：标题以系统提示开头或无有效内容的会话不上云
        const t = (canonical.title || '').trim();
        if (!t || t.startsWith('The following is the Codex') || t.includes('assessing') || t === 'Codex 对话会话') {
          known[file] = mtime;
          continue;
        }
        canonical.sourceAgent = agent;
        canonical.project.name = projectResolver(canonical.project.originalCwd);
        canonical.ownerId = autoSync.ownerId || null; // 服务端自动上云归属 admin
        fs.writeFileSync(path.join(CLOUD_STORAGE_DIR, `${canonical.id}.json`), JSON.stringify(canonical, null, 2), 'utf-8');
        cloudIndex.updateOne(canonical.id, canonical);
        pushed++;
      } catch {}
    }
  }
  fs.writeFileSync(path.join(HUB_DATA_DIR, 'auto-sync-known.json'), JSON.stringify(Object.fromEntries(known)), 'utf-8');
  state.lastRun = Date.now();
  state.syncedCount = (state.syncedCount || 0) + pushed;
  state.history = [...(state.history || []), { ts: Date.now(), pushed, agents: cfg.agents || [] }].slice(-50);
  autoSync.saveState(state);
  return { pushed };
}

autoSync.ensureTimer(runAutoSync);
// 启动后 30 秒先跑一次（若启用）
setTimeout(() => runAutoSync().catch(() => {}), 30000);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ===== 登录防爆破 =====
const loginLocks = new Map(); // key -> { failures, lockedUntil }
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
function checkLoginLock(key) {
  const rec = loginLocks.get(key);
  if (!rec) return { locked: false, failures: 0 };
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { locked: true, failures: rec.failures, retryAfterSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  // 锁定已过，重置
  if (rec.lockedUntil) { loginLocks.delete(key); return { locked: false, failures: 0 }; }
  return { locked: false, failures: rec.failures };
}
function recordLoginFailure(key) {
  const rec = loginLocks.get(key) || { failures: 0 };
  rec.failures++;
  if (rec.failures >= LOGIN_MAX_FAILURES) rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  loginLocks.set(key, rec);
  // 防止 Map 无限增长：超过 1000 条时清理过期记录
  if (loginLocks.size > 1000) {
    for (const [k, v] of loginLocks) {
      if (v.lockedUntil && Date.now() > v.lockedUntil) loginLocks.delete(k);
    }
  }
}
function clearLoginFailures(key) { loginLocks.delete(key); }

const server = http.createServer(async (req, res) => {
  // CORS：Electron 内嵌前端（file:// 源）跨域访问 API；带鉴权头时不允许 * 通配，回显 Origin
  const origin = req.headers.origin || '';
  const allowOrigin = req.headers.authorization || getCookieToken(req) ? (origin || '*') : '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 远程请求日志
  if (pathname.startsWith('/api/')) {
    requestLog.add({ method: req.method, path: pathname, authed: isAuthorized(req, url) });
  }

  // 轻客户端双向同步端点
  if (pathname === '/api/sync' && req.method === 'POST') {
    try {
      if (!isAuthorized(req, url)) {
        return sendJson(res, 401, { success: false, error: '未授权' });
      }
      const body = await parseBody(req);
      const deviceName = String(body.deviceName || 'unknown').slice(0, 50);
      const cloudItems = [...cloudIndex.map.values()].map(({ meta }) => meta);
      const pullList = cloudItems.filter(m => m.title).slice(0, 100);
      return sendJson(res, 200, {
        success: true, pushed: 0, pulled: pullList.length,
        sessions: pullList, deviceName
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 分享页静态资源（public/）：marked 等
  if (pathname === '/marked.umd.js') {
    const mp = path.join(__dirname, 'public', 'marked.umd.js');
    if (fs.existsSync(mp)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'max-age=86400' });
      return res.end(fs.readFileSync(mp));
    }
  }

  // 桌面客户端自动更新分发（updates/latest.yml + 安装包）
  if (pathname.startsWith('/updates/')) {
    const rawName = decodeURIComponent(pathname.replace('/updates/', ''));
    const safeName = path.normalize(rawName).replace(/^([.]{2}[\\/])+/, '');
    const fp = path.join(HUB_DATA_DIR, 'updates', safeName);
    if (fp.startsWith(path.join(HUB_DATA_DIR, 'updates')) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp);
      const mime = { '.yml': 'text/yaml', '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      return res.end(fs.readFileSync(fp));
    }
  }

  // React 前端静态资源（public-react）：服务所有静态文件（带路径穿越保护）
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/s/') && pathname !== '/' && pathname !== '/index.html') {
    const safeName = path.normalize(pathname).replace(/^([.]{2}[\\/])+/, '');
    const assetPath = path.join(__dirname, 'public-react', safeName);
    if (assetPath.startsWith(path.join(__dirname, 'public-react')) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
      const ext = path.extname(assetPath);
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' });
      return res.end(fs.readFileSync(assetPath));
    }
  }

  // 鉴权：本机请求直通；远程请求需要有效 Token 或会话 Cookie；分享路由除外
  if (pathname.startsWith('/api/')) {
    requestLog.add({ method: req.method, path: pathname, authed: isAuthorized(req, url) });
  }
  const isShareRoute = pathname.startsWith('/s/') || pathname.startsWith('/api/shares/') || pathname.startsWith('/api/auth/');
  if (pathname.startsWith('/api/') && !isShareRoute && !isAuthorized(req, url)) {
    return sendJson(res, 401, { success: false, error: '未授权：请先登录或提供有效 Token' });
  }
  // 游客 Token 作用域限制：仅迁移相关接口
  if (pathname.startsWith('/api/') && !isShareRoute) {
    const tok = auth.verifyToken(auth.extractToken(req, url)) || auth.verifyToken(getCookieToken(req));
    if (tok && tok.type === 'guest') {
      const guestAllowed = pathname === '/api/auth/status' || pathname === '/api/sync' || pathname === '/api/projects'
        || pathname === '/api/sessions/local' || pathname === '/api/sessions/cloud'
        || pathname.startsWith('/api/sessions/detail/') || pathname === '/api/sessions/pull';
      if (!guestAllowed) return sendJson(res, 403, { success: false, error: '游客模式仅支持会话迁移功能，请登录后使用' });
    }
  }

  // Auth API
  if (pathname === '/api/auth/status' && req.method === 'GET') {
    const guestMeta = auth.verifyToken(auth.extractToken(req, url))?.type === 'guest' ? auth.verifyToken(auth.extractToken(req, url)) : (auth.verifyToken(getCookieToken(req))?.type === 'guest' ? auth.verifyToken(getCookieToken(req)) : null);
    const me = currentUser(req, url);
    const isAdmin = !auth.isConfigured() || me?.role === 'admin';
    return sendJson(res, 200, {
      success: true,
      configured: auth.isConfigured(),
      localRequest: isLocalRequest(req),
      authorized: isCookieAuthorized(req) || isAuthorized(req, url),
      isGuest: Boolean(guestMeta),
      me: me ? { userId: me.userId, username: me.username, role: me.role, displayName: me.displayName || me.username, avatarColor: me.avatarColor || null, status: me.status || 'active', lastLoginAt: me.lastLoginAt || null } : (guestMeta ? { userId: null, username: 'guest', displayName: '游客', role: 'guest', avatarColor: '#71717a', status: 'active', lastLoginAt: null } : null),
      isAdmin,
      tokens: isAdmin
        ? auth.listTokens().map(t => ({ tokenPreview: t.tokenPreview, token: t.token, label: t.label, createdAt: t.createdAt, userId: t.userId, username: t.username }))
        : auth.listTokens().filter(t => t.userId === me?.userId).map(t => ({ tokenPreview: t.tokenPreview, token: t.token, label: t.label, createdAt: t.createdAt, userId: t.userId, username: t.username }))
    });
  }

  if (pathname === '/api/auth/setup' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (body.confirmPassword !== undefined && body.confirmPassword !== body.password) {
        return sendJson(res, 400, { success: false, error: '两次输入的密码不一致' });
      }
      const result = auth.setup(body.username, body.password);
      const token = auth.issueToken('setup', result.userId, 'session');
      setSessionCookie(res, token);
      return sendJson(res, 200, { success: true, ...result, token });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/reset' && req.method === 'POST') {
    try {
      if (!isLocalRequest(req)) {
        return sendJson(res, 403, { success: false, error: '仅允许本机重置鉴权' });
      }
      const usersPath = path.join(HUB_DATA_DIR, 'users.json');
      const credPath = path.join(HUB_DATA_DIR, 'auth-credentials.json');
      const tokPath = path.join(HUB_DATA_DIR, 'auth-tokens.json');
      if (fs.existsSync(usersPath)) fs.rmSync(usersPath);
      if (fs.existsSync(credPath)) fs.rmSync(credPath);
      if (fs.existsSync(tokPath)) fs.rmSync(tokPath);
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 登录：支持 password 换发 deviceToken（桌面客户端 / CLI 用）
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseBody(req).catch(() => ({}));
    // 防爆破：同一 IP+用户名 连续失败 5 次锁定 5 分钟
    const loginKey = (req.socket.remoteAddress || 'unknown') + '|' + String(body?.username || '').slice(0, 50);
    const lock = checkLoginLock(loginKey);
    if (lock.locked) {
      return sendJson(res, 429, { success: false, error: `尝试次数过多，请 ${Math.ceil(lock.retryAfterSec / 60)} 分钟后再试` });
    }
    try {
      let user = null;
      try {
        user = auth.verify(body.username, body.password);
      } catch (verr) {
        const msg = String(verr.message || '');
        if (msg.includes('禁用')) return sendJson(res, 403, { success: false, error: msg });
        throw verr;
      }
      if (!user) {
        recordLoginFailure(loginKey);
        const lock2 = checkLoginLock(loginKey);
        const left = lock2.locked ? '' : `（剩余尝试 ${5 - lock2.failures} 次）`;
        return sendJson(res, 401, { success: false, error: '用户名或密码错误' + left });
      }
      clearLoginFailures(loginKey);
      // deviceToken=true 时返回长期 Token（不写 Cookie），桌面客户端 / CLI 使用
      if (body.deviceToken) {
        const deviceToken = auth.issueToken(body.label || ('device-' + String(body.deviceName || 'unknown').slice(0, 30)), user.userId, 'device');
        return sendJson(res, 200, { success: true, deviceToken, userId: user.userId, username: user.username, role: user.role });
      }
      const token = auth.issueToken(body.label || 'login', user.userId, 'session');
      setSessionCookie(res, token);
      return sendJson(res, 200, { success: true, token, userId: user.userId, username: user.username, role: user.role });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 游客凭据：仅限迁移相关接口
  if (pathname === '/api/auth/guest' && req.method === 'POST') {
    try {
      if (!auth.isConfigured()) return sendJson(res, 400, { success: false, error: 'Hub 尚未初始化' });
      const guestToken = auth.issueToken('guest', null, 'guest');
      return sendJson(res, 200, { success: true, guestToken });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getCookieToken(req) || auth.extractToken(req, url);
    if (token) auth.revokeToken(token);
    clearSessionCookie(res);
    return sendJson(res, 200, { success: true });
  }

  if (pathname === '/api/auth/change-password' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      if (!me?.userId) {
        if (isLocalRequest(req) && !auth.isConfigured()) {
          return sendJson(res, 400, { success: false, error: '尚未初始化账号' });
        }
        return sendJson(res, 401, { success: false, error: '未授权' });
      }
      const result = auth.changePassword(me.userId, body.oldPassword, body.newPassword);
      const token = auth.issueToken('password-reset', me.userId, 'session');
      setSessionCookie(res, token);
      return sendJson(res, 200, { success: true, ...result, token });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // ===== 多用户管理（admin only）=====
  if (pathname === '/api/auth/users' && req.method === 'GET') {
    const me = currentUser(req, url);
    if (!me || me.role !== 'admin') return sendJson(res, 403, { success: false, error: '仅 admin 可管理用户' });
    return sendJson(res, 200, { success: true, users: auth.listUsers() });
  }

  if (pathname === '/api/auth/users' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      if (!me || me.role !== 'admin') return sendJson(res, 403, { success: false, error: '仅 admin 可管理用户' });
      const result = auth.addUser(body.username, body.password, body.role || 'member');
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/users' && req.method === 'DELETE') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      if (!me || me.role !== 'admin') return sendJson(res, 403, { success: false, error: '仅 admin 可管理用户' });
      if (body.userId === me.userId) return sendJson(res, 400, { success: false, error: '不能删除自己' });
      const ok = auth.removeUser(body.userId);
      return ok ? sendJson(res, 200, { success: true }) : sendJson(res, 404, { success: false, error: '用户不存在' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/users/password' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      if (!me || me.role !== 'admin') return sendJson(res, 403, { success: false, error: '仅 admin 可重置密码' });
      const ok = auth.changeUserPassword(body.userId, body.newPassword);
      return ok ? sendJson(res, 200, { success: true }) : sendJson(res, 404, { success: false, error: '用户不存在' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/tokens' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      const token = auth.issueToken(body.label || 'device', me?.userId || null, 'device');
      return sendJson(res, 200, { success: true, token });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/auth/tokens/label' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const ok = auth.updateTokenLabel(body.token, body.label);
      return ok ? sendJson(res, 200, { success: true }) : sendJson(res, 404, { success: false, error: 'Token 不存在' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 个人资料（本人）
  if (pathname === '/api/auth/profile' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      if (!me?.userId) return sendJson(res, 401, { success: false, error: '未授权' });
      const ok = auth.updateProfile(me.userId, { displayName: body.displayName, avatarColor: body.avatarColor });
      return ok ? sendJson(res, 200, { success: true }) : sendJson(res, 404, { success: false, error: '用户不存在' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 用户状态（admin）：active | disabled
  if (pathname === '/api/auth/users/status' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      if (!me || me.role !== 'admin') return sendJson(res, 403, { success: false, error: '仅 admin 可操作' });
      if (body.userId === me.userId) return sendJson(res, 400, { success: false, error: '不能禁用自己' });
      const ok = auth.setStatus(body.userId, body.status);
      return ok ? sendJson(res, 200, { success: true }) : sendJson(res, 400, { success: false, error: '操作失败' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // Token 吊销权限：admin 可吊销任意；member 只能吊销自己的
  if (pathname === '/api/auth/tokens/revoke' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const me = currentUser(req, url);
      const meta = auth.verifyToken(body.token);
      if (!meta) return sendJson(res, 404, { success: false, error: 'Token 不存在' });
      if (me?.role !== 'admin' && meta.userId !== me?.userId) {
        return sendJson(res, 403, { success: false, error: '只能吊销自己的设备 Token' });
      }
      const ok = auth.revokeToken(body.token);
      return ok ? sendJson(res, 200, { success: true }) : sendJson(res, 404, { success: false, error: 'Token 不存在' });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }


  if (pathname === '/api/request-log' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, logs: requestLog.list(Number(url.searchParams.get('limit')) || 50) });
  }

  // 0. API: 从目标 Agent 自己的数据源实时读取项目列表
  if (pathname === '/api/projects' && req.method === 'GET') {
    const agent = url.searchParams.get('agent') || 'codex';
    if (!['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude', 'zcode', 'opencode', 'grok', 'cursor'].includes(agent)) {
      return sendJson(res, 400, { success: false, error: `不支持的目标 Agent: ${agent}` });
    }

    try {
      let projects;
      const warnings = [];
      if (agent === 'codex') {
        projects = CodexReader.listProjects();
      } else if (agent === 'workbuddy') {
        const workBuddyProjects = WorkBuddyReader.listProjects();
        let codexProjects = [];
        try {
          codexProjects = CodexReader.listProjects();
        } catch (err) {
          warnings.push({ source: 'codex_state_db', error: err.message });
        }
        projects = applyCodexLabelsToWorkBuddy(codexProjects, workBuddyProjects);
      } else {
        projects = PiReader.listProjects();
      }

      return sendJson(res, 200, {
        success: true,
        agent,
        source: agent === 'codex' ? 'codex_state_db' : agent === 'workbuddy' ? 'workbuddy_db' : agent === 'pi' ? 'pi_sessions_dir' : 'gemini_brain_dir',
        readAt: Date.now(),
        count: projects.length,
        projects,
        warnings
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, agent, error: err.message });
    }
  }

  // 1. API: 获取多 Agent 本地会话列表
  // ===== 备份 API =====
  if (pathname === '/api/backup/config' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, config: backup.maskSecrets(backup.config), providers: PROVIDER_DEFAULTS, rcloneAvailable: fs.existsSync(path.resolve(process.cwd(), 'tools/rclone.exe')) });
  }

  if (pathname === '/api/backup/config' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const cfg = backup.config;
      if (body.enabled !== undefined) cfg.enabled = Boolean(body.enabled);
      if (Number.isFinite(body.frequencyHours)) cfg.frequencyHours = Math.min(168, Math.max(1, body.frequencyHours));
      if (body.localMirror !== undefined) cfg.localMirror = body.localMirror;
      if (Array.isArray(body.destinations)) {
        // 合并：保留前端未重传的 secretKey（masked 时回填原值）
        const old = new Map((cfg.destinations || []).map(d => [d.id, d]));
        cfg.destinations = body.destinations.map(d => {
          const prev = old.get(d.id);
          if (d.secretKey && String(d.secretKey).endsWith('****') && prev) d.secretKey = prev.secretKey;
          return d;
        });
      }
      backup.saveConfig(cfg);
      backup.ensureTimer(() => backup.runNow());
      return sendJson(res, 200, { success: true, config: backup.maskSecrets(backup.config) });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/backup/state' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, state: backup.state });
  }

  if (pathname === '/api/backup/run' && req.method === 'POST') {
    try {
      const result = await backup.runNow();
      return sendJson(res, 200, { success: true, ...result, state: backup.state });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/sessions/local' && req.method === 'GET') {
    if (scanPromise) {
      await scanPromise;
    } else if (cachedLocalItems.length === 0) {
      await rebuildLocalCache();
    }
    const agentFilter = url.searchParams.get('agent');
    let items = cachedLocalItems;
    if (agentFilter && agentFilter !== 'all') {
      items = items.filter(s => s.agent === agentFilter);
    }
    return sendJson(res, 200, {
      success: true,
      totalFound: totalFoundSessions || cachedLocalItems.length,
      items,
      projectSourceErrors
    });
  }

  // 2. API: 勾选批量推送到云端
  if (pathname === '/api/sessions/push' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const sessionIds = body.sessionIds || [];
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return sendJson(res, 400, { success: false, error: '请勾选至少一个会话' });
      }

      const allCodex = CodexReader.scanAllSessions();
      const allWb = WorkBuddyReader.scanAllSessions();
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      const pushed = [];

      for (const id of sessionIds) {
        // 先在 Codex 找
        const codexFile = allCodex.find(f => f.includes(id));
        if (codexFile) {
          const canonical = await CodexReader.parseSession(codexFile, { includeToolExecution: true });
          canonical.sourceAgent = 'codex';
          canonical.project.name = projectResolver(canonical.project.originalCwd);
          canonical.ownerId = currentUser(req, url)?.userId || null;
          const cloudFilePath = path.join(CLOUD_STORAGE_DIR, `${canonical.id}.json`);
          fs.writeFileSync(cloudFilePath, JSON.stringify(canonical, null, 2), 'utf-8');
          pushed.push({ id: canonical.id, title: canonical.title, agent: 'codex' });
          continue;
        }

        // 再在 WorkBuddy 找
        const wbFile = allWb.find(f => f.includes(id));
        if (wbFile) {
          const canonical = await WorkBuddyReader.parseSession(wbFile, projectResolver);
          canonical.sourceAgent = 'workbuddy';
          canonical.ownerId = currentUser(req, url)?.userId || null;
          const cloudFilePath = path.join(CLOUD_STORAGE_DIR, `${canonical.id}.json`);
          fs.writeFileSync(cloudFilePath, JSON.stringify(canonical, null, 2), 'utf-8');
          pushed.push({ id: canonical.id, title: canonical.title, agent: 'workbuddy' });
        }
      }

      return sendJson(res, 200, { success: true, count: pushed.length, pushed, projectSourceErrors: catalogs.errors });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 2.5 云端存储统计
  if (pathname === '/api/cloud/stats' && req.method === 'GET') {
    cloudIndex.refresh();
    return sendJson(res, 200, { success: true, stats: cloudIndex.stats() });
  }

  // 自动上云配置与状态
  if (pathname === '/api/auto-sync' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, config: autoSync.config, state: autoSync.getState() });
  }

  if (pathname === '/api/auto-sync' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const cfg = autoSync.config;
      if (body.enabled !== undefined) cfg.enabled = Boolean(body.enabled);
      if (Array.isArray(body.agents)) cfg.agents = body.agents.filter(a => ['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude', 'zcode', 'opencode', 'grok', 'cursor'].includes(a));
      if (Number.isFinite(body.intervalSec)) cfg.intervalSec = Math.min(86400, Math.max(60, Number(body.intervalSec)));
      autoSync.saveConfig(cfg);
      autoSync.ensureTimer(runAutoSync);
      if (body.runNow) {
        const result = await runAutoSync();
        return sendJson(res, 200, { success: true, config: cfg, state: autoSync.getState(), lastRunPushed: result.pushed });
      }
      return sendJson(res, 200, { success: true, config: cfg, state: autoSync.getState() });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 批量清理云端垃圾会话（系统注入会话/无内容会话）
  if (pathname === '/api/cloud/cleanup-junk' && req.method === 'POST') {
    try {
      cloudIndex.refresh();
      let removed = 0;
      for (const [, v] of cloudIndex.map) {
        const t = (v.meta.title || '').trim();
        if (!t || t.startsWith('The following is the Codex') || t.includes('assessing') || t === 'Codex 对话会话' || (v.meta.messageCount === 0 && v.meta.toolCallCount === 0)) {
          const p = path.join(CLOUD_STORAGE_DIR, `${v.meta.id}.json`);
          if (fs.existsSync(p)) { fs.rmSync(p); cloudIndex.removeOne(v.meta.id); removed++; }
        }
      }
      return sendJson(res, 200, { success: true, removed });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 回收站：已删除本地会话的备份
  if (pathname === '/api/recycle-bin' && req.method === 'GET') {
    try {
      const meBin = currentUser(req, url);
      if (meBin && meBin.role !== 'admin') return sendJson(res, 200, { success: true, items: [] });
      const binDir = path.join(HUB_DATA_DIR, 'deleted-backups');
      const items = [];
      if (fs.existsSync(binDir)) {
        for (const agent of fs.readdirSync(binDir)) {
          const agentDir = path.join(binDir, agent);
          if (!fs.statSync(agentDir).isDirectory()) continue;
          for (const f of fs.readdirSync(agentDir)) {
            const st = fs.statSync(path.join(agentDir, f));
            items.push({ agent, file: f, sizeBytes: st.size, deletedAt: st.birthtimeMs });
          }
        }
      }
      items.sort((a, b) => b.deletedAt - a.deletedAt);
      return sendJson(res, 200, { success: true, items });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname.startsWith('/api/recycle-bin/') && req.method === 'DELETE') {
    try {
      const parts = pathname.replace('/api/recycle-bin/', '').split('/');
      if (parts.length !== 2) return sendJson(res, 400, { success: false, error: '非法路径' });
      const [agent, file] = parts.map(decodeURIComponent);
      if (agent.includes('..') || file.includes('..')) return sendJson(res, 400, { success: false, error: '非法路径' });
      const p = path.join(HUB_DATA_DIR, 'deleted-backups', agent, file);
      if (!fs.existsSync(p)) return sendJson(res, 404, { success: false, error: '备份不存在' });
      fs.rmSync(p);
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 清空回收站
  if (pathname === '/api/recycle-bin' && req.method === 'DELETE') {
    try {
      const binDir = path.join(HUB_DATA_DIR, 'deleted-backups');
      let removed = 0;
      if (fs.existsSync(binDir)) {
        for (const agent of fs.readdirSync(binDir)) {
          const agentDir = path.join(binDir, agent);
          if (!fs.statSync(agentDir).isDirectory()) continue;
          for (const f of fs.readdirSync(agentDir)) {
            fs.rmSync(path.join(agentDir, f));
            removed++;
          }
        }
      }
      return sendJson(res, 200, { success: true, removed });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 会话导出为 Markdown
  if (pathname.startsWith('/api/sessions/export-md/') && req.method === 'GET') {
    try {
      const id = decodeURIComponent(pathname.replace('/api/sessions/export-md/', ''));
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      const resolved = await resolveSessionCanonical(id, catalogs, projectResolver);
      if (!resolved) return sendJson(res, 404, { success: false, error: '未找到会话' });
      const s = resolved.session;
      const lines = [
        `# ${s.title || '未命名会话'}`, '',
        `- 来源：${(s.sourceAgent || 'codex').toUpperCase()}`,
        `- 项目：${s.project?.name || '未分组'}`,
        `- 时间：${new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}`, '',
        '---', ''
      ];
      for (const ev of (s.events || [])) {
        if (ev.kind === 'message') {
          lines.push(`## ${ev.role === 'user' ? '👤 用户' : '🤖 助手'}`, '', ev.content || '', '');
        } else if (ev.kind === 'tool_call') {
          let cmd = '';
          try { const p = JSON.parse(ev.arguments || '{}'); cmd = p.command || p.cmd || JSON.stringify(p); } catch { cmd = ev.arguments || ''; }
          lines.push(`### 🔧 ${ev.name || 'Bash'}`, '', '```', String(cmd).slice(0, 2000), '```', '');
        } else if (ev.kind === 'tool_result') {
          const out = String(ev.output || '').slice(0, 3000);
          lines.push('```', out, '```', '');
        }
      }
      return sendJson(res, 200, { success: true, markdown: lines.join('\n'), filename: (s.title || id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.md' });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 会话集打包导出 zip
  if (pathname.startsWith('/api/collections/') && pathname.endsWith('/export-zip') && req.method === 'GET') {
    try {
      const collectionId = pathname.match(/^\/api\/collections\/([A-Za-z0-9]+)\/export-zip$/)?.[1];
      const record = collections.get(collectionId);
      if (!record) return sendJson(res, 404, { success: false, error: '会话集不存在' });
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      const entries = [];
      const usedNames = new Set();
      for (const id of record.sessionIds) {
        try {
          const resolved = await resolveSessionCanonical(id, catalogs, projectResolver);
          if (!resolved) continue;
          const s = resolved.session;
          const lines = [`# ${s.title || id}`, '', `- 来源：${(s.sourceAgent || '').toUpperCase()}`, `- 项目：${s.project?.name || '未分组'}`, `- 时间：${new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}`, '', '---', ''];
          for (const ev of (s.events || [])) {
            if (ev.kind === 'message') lines.push(`## ${ev.role === 'user' ? '👤 用户' : '🤖 助手'}`, '', ev.content || '', '');
            else if (ev.kind === 'tool_call') { let cmd = ''; try { const p = JSON.parse(ev.arguments || '{}'); cmd = p.command || p.cmd || JSON.stringify(p); } catch { cmd = ev.arguments || ''; } lines.push(`### 🔧 ${ev.name || 'Bash'}`, '', '```', String(cmd).slice(0, 2000), '```', ''); }
            else if (ev.kind === 'tool_result') lines.push('```', String(ev.output || '').slice(0, 3000), '```', '');
          }
          let name = (s.title || id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) + '.md';
          let n = 1;
          while (usedNames.has(name)) name = name.replace(/\.md$/, `_${n++}.md`);
          usedNames.add(name);
          entries.push({ name, data: Buffer.from(lines.join('\n'), 'utf-8') });
        } catch {}
      }
      if (!entries.length) return sendJson(res, 404, { success: false, error: '会话集内无可导出内容' });
      const zip = createZip(entries);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}.zip`, 'Content-Length': zip.length });
      return res.end(zip);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 3. API: 获取云端中心资产列表
  // 全文搜索：云端会话正文
  if (pathname === '/api/sessions/search' && req.method === 'GET') {
    try {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2) return sendJson(res, 200, { success: true, results: [] });
      cloudIndex.refresh();
      const results = [];
      const meSearch = currentUser(req, url);
      const isAdminSearch = !meSearch || meSearch.role === 'admin';
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      for (const [, v] of cloudIndex.map) {
        if (!isAdminSearch && v.meta.ownerId && v.meta.ownerId !== meSearch.userId) continue;
        const p = path.join(CLOUD_STORAGE_DIR, `${v.meta.id}.json`);
        if (!fs.existsSync(p)) continue;
        try {
          const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
          let hit = null;
          for (const ev of (s.events || [])) {
            if (ev.kind !== 'message' || !ev.content) continue;
            const idx = ev.content.toLowerCase().indexOf(q);
            if (idx >= 0) {
              hit = { role: ev.role, snippet: ev.content.slice(Math.max(0, idx - 80), idx + 120) };
              break;
            }
          }
          if (hit) {
            results.push({ id: v.meta.id, title: v.meta.title, sourceAgent: v.meta.sourceAgent, projectName: v.meta.projectName || projectResolver(v.meta.originalCwd), updatedAt: v.meta.updatedAt, snippet: hit.snippet, hitRole: hit.role });
            if (results.length >= 30) break;
          }
        } catch {}
      }
      return sendJson(res, 200, { success: true, count: results.length, results });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/sessions/cloud' && req.method === 'GET') {
    try {
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      cloudIndex.refresh();
      const me = currentUser(req, url);
      let items = [...cloudIndex.map.values()].map(({ meta }) => ({
        ...meta,
        projectName: meta.projectName || projectResolver(meta.originalCwd)
      }));
      if (me && me.role !== 'admin') items = items.filter(it => it.ownerId === me.userId);
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      // 分页：?page=1&pageSize=100；缺省返回全部（兼容旧前端）
      const page = parseInt(url.searchParams.get('page') || '0', 10);
      const pageSize = parseInt(url.searchParams.get('pageSize') || '0', 10);
      const total = items.length;
      if (page > 0 && pageSize > 0) {
        items = items.slice((page - 1) * pageSize, page * pageSize);
      }
      return sendJson(res, 200, { success: true, count: items.length, total, page: page || 1, pageSize: pageSize || total, items, projectSourceErrors: catalogs.errors });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname.startsWith('/api/sessions/cloud/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(pathname.replace('/api/sessions/cloud/', ''));
      if (!id || path.basename(id) !== id) {
        return sendJson(res, 400, { success: false, error: '非法会话 ID' });
      }
      const cloudFilePath = path.join(CLOUD_STORAGE_DIR, `${id}.json`);
      if (!fs.existsSync(cloudFilePath)) {
        return sendJson(res, 404, { success: false, error: '云端不存在该会话' });
      }
      fs.rmSync(cloudFilePath);
      cloudIndex.removeOne(id);
      return sendJson(res, 200, { success: true, id });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname.startsWith('/api/sessions/local/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(pathname.replace('/api/sessions/local/', ''));
      if (!id || path.basename(id) !== id) {
        return sendJson(res, 400, { success: false, error: '非法会话 ID' });
      }
      const targetAgent = url.searchParams.get('agent');
      if (!['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude', 'zcode', 'opencode', 'grok', 'cursor'].includes(targetAgent)) {
        return sendJson(res, 400, { success: false, error: '缺少 agent 参数（codex/workbuddy/pi）' });
      }

      const files = targetAgent === 'codex' ? CodexReader.scanAllSessions()
        : targetAgent === 'workbuddy' ? WorkBuddyReader.scanAllSessions()
        : targetAgent === 'pi' ? PiReader.scanAllSessions()
        : targetAgent === 'gemini' ? GeminiReader.scanAllSessions()
        : targetAgent === 'claude' ? ClaudeReader.scanAllSessions()
        : targetAgent === 'zcode' ? ZCodeReader.scanAllSessions()
        : targetAgent === 'opencode' ? OpenCodeReader.scanAllSessions()
        : targetAgent === 'grok' ? GrokReader.scanAllSessions()
        : targetAgent === 'cursor' ? CursorReader.scanAllSessions()
        : DshReader.scanAllSessions();
      const filePath = findSessionFile(files, id);
      if (!filePath) {
        return sendJson(res, 404, { success: false, error: `${targetAgent} 本地不存在该会话` });
      }

      const backupDir = path.join(HUB_DATA_DIR, 'deleted-backups', targetAgent);
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `${Date.now()}_${path.basename(filePath)}`);
      if (targetAgent === 'gemini') {
        const realPath = GeminiReader.resolveRealPath(filePath);
        fs.copyFileSync(realPath, backupPath);
        fs.rmSync(realPath);
      } else {
        fs.copyFileSync(filePath, backupPath);
        fs.rmSync(filePath);
      }

      if (targetAgent === 'workbuddy') {
        const dbPath = path.join(WorkBuddyReader.getWorkBuddyHome(), 'workbuddy.db');
        if (fs.existsSync(dbPath)) {
          try {
            execSqlite(dbPath, 'DELETE FROM sessions WHERE id = ?', [id]);
          } catch (dbErr) {
            console.error('WorkBuddy sessions 索引清理失败:', dbErr.message);
          }
        }
      }

      // 删除本地会话后同步刷新本地缓存，避免列表仍显示已删会话
      await rebuildLocalCache();

      return sendJson(res, 200, { success: true, id, agent: targetAgent, backupPath });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 4. API: 详情预览
  if (pathname.startsWith('/api/sessions/detail/') && req.method === 'GET') {
    try {
      const id = pathname.replace('/api/sessions/detail/', '');
      const cloudFile = path.join(CLOUD_STORAGE_DIR, `${id}.json`);
      if (fs.existsSync(cloudFile)) {
        const s = JSON.parse(fs.readFileSync(cloudFile, 'utf-8'));
        return sendJson(res, 200, { success: true, session: s });
      }

      const allCodex = CodexReader.scanAllSessions();
      const localCodex = allCodex.find(f => f.includes(id));
      if (localCodex) {
        const s = await CodexReader.parseSession(localCodex, { includeToolExecution: true });
        return sendJson(res, 200, { success: true, session: s });
      }

      const allWb = WorkBuddyReader.scanAllSessions();
      const localWb = allWb.find(f => f.includes(id));
      if (localWb) {
        const s = await WorkBuddyReader.parseSession(localWb);
        return sendJson(res, 200, { success: true, session: s });
      }

      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      const piFile = findSessionFile(PiReader.scanAllSessions(), id);
      if (piFile) {
        const s = await PiReader.parseSession(piFile, projectResolver);
        return sendJson(res, 200, { success: true, session: s });
      }

  const geminiFile = findSessionFile(GeminiReader.scanAllSessions(), id);
  if (geminiFile) {
    const s = await GeminiReader.parseSession(geminiFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }

  const dshFile = findSessionFile(DshReader.scanAllSessions(), id);
  if (dshFile) {
    const s = await DshReader.parseSession(dshFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }


  const claudeFile = findSessionFile(ClaudeReader.scanAllSessions(), id);
  if (claudeFile) {
    const s = await ClaudeReader.parseSession(claudeFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }

  const zcodeFile = findSessionFile(ZCodeReader.scanAllSessions(), id);
  if (zcodeFile) {
    const s = await ZCodeReader.parseSession(zcodeFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }

  const opencodeFile = findSessionFile(OpenCodeReader.scanAllSessions(), id);
  if (opencodeFile) {
    const s = await OpenCodeReader.parseSession(opencodeFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }

  const grokFile = findSessionFile(GrokReader.scanAllSessions(), id);
  if (grokFile) {
    const s = await GrokReader.parseSession(grokFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }

  const cursorFile = findSessionFile(CursorReader.scanAllSessions(), id);
  if (cursorFile) {
    const s = await CursorReader.parseSession(cursorFile, projectResolver);
    return sendJson(res, 200, { success: true, session: s });
  }
      return sendJson(res, 404, { success: false, error: '未找到指定会话' });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 5. API: 从本地或云端解析会话，并注入到指定 Agent
  if (pathname === '/api/sessions/pull' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const sessionIds = body.sessionIds || (body.sessionId ? [body.sessionId] : []);
      const targetAgent = body.targetAgent || 'workbuddy';
      const targetProjectRoot = body.targetProjectRoot;

      if (!Array.isArray(sessionIds) || sessionIds.length === 0 ||
          sessionIds.some(id => typeof id !== 'string' || !id || path.basename(id) !== id) ||
          typeof targetProjectRoot !== 'string' || !targetProjectRoot.trim()) {
        return sendJson(res, 400, { success: false, error: '缺少 sessionIds 或 targetProjectRoot' });
      }
      if (!['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude', 'zcode', 'opencode', 'grok', 'cursor'].includes(targetAgent)) {
        return sendJson(res, 400, { success: false, error: `不支持的目标 Agent: ${targetAgent}` });
      }

      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      const sources = {
        codexFiles: CodexReader.scanAllSessions(),
        workBuddyFiles: WorkBuddyReader.scanAllSessions(),
        piFiles: PiReader.scanAllSessions(),
        geminiFiles: GeminiReader.scanAllSessions(),
        dshFiles: DshReader.scanAllSessions(),
        claudeFiles: ClaudeReader.scanAllSessions(),
        zcodeFiles: ZCodeReader.scanAllSessions(),
        opencodeFiles: OpenCodeReader.scanAllSessions(),
        grokFiles: GrokReader.scanAllSessions(),
        cursorFiles: CursorReader.scanAllSessions()
      };
      const resolvedSessions = [];
      const missingIds = [];
      for (const id of sessionIds) {
        const resolved = await resolveSessionForTransfer(id, targetAgent, sources, projectResolver);
        if (resolved) resolvedSessions.push({ id, ...resolved });
        else missingIds.push(id);
      }
      if (missingIds.length > 0) {
        return sendJson(res, 404, {
          success: false,
          error: `本地与云端均未找到 ${missingIds.length} 个会话`,
          missingIds
        });
      }

      const injected = [];
      for (const item of resolvedSessions) {
        const canonical = item.canonical;
        if (targetAgent === 'codex') {
          const r = await CodexWriter.injectSession(canonical, targetProjectRoot);
          injected.push({ id: item.id, target: 'codex', path: r.fullPath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
        } else if (targetAgent === 'workbuddy') {
          const r = await WorkBuddyWriter.injectSession(canonical, targetProjectRoot);
          injected.push({ id: item.id, target: 'workbuddy', path: r.jsonlPath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
        } else {
          let r;
          if (targetAgent === 'pi') {
            r = await PiWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'pi', path: r.filePath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'gemini') {
            r = await GeminiWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'gemini', path: r.filePath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'dsh') {
            r = await DshWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'dsh', path: r.filePath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'claude') {
            r = await ClaudeWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'claude', path: r.filePath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'zcode') {
            r = await ZCodeWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'zcode', path: r.path, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'opencode') {
            r = await OpenCodeWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'opencode', path: r.path, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'grok') {
            r = await GrokWriter.injectSession(canonical, targetProjectRoot);
            injected.push({ id: item.id, target: 'grok', path: r.filePath, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          } else if (targetAgent === 'cursor') {
            r = await CursorWriter.injectSession(canonical);
            injected.push({ id: item.id, target: 'cursor', path: r.path, sourceLocation: item.sourceLocation, sourceAgent: item.sourceAgent });
          }
        }
      }

      await rebuildLocalCache();

      return sendJson(res, 200, {
        success: true,
        message: `成功将 ${injected.length} 个会话注入到 ${targetAgent.toUpperCase()}`,
        count: injected.length,
        injected
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // Shares API（创建/管理需要授权；访问分享内容只需要有效分享 ID + 访问码）
  if (pathname === '/api/shares' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const record = shares.create({
        sessionIds: body.sessionIds,
        expiresAt: body.expiresAt || Date.now() + 7 * 24 * 3600 * 1000,
        accessCode: body.accessCode,
        allowImport: body.allowImport,
        createdByDevice: body.createdByDevice,
        ownerId: currentUser(req, url)?.userId || null,
        maxViews: body.maxViews
      });
      return sendJson(res, 200, {
        success: true,
        share: record,
        url: `/s/${record.shareId}`
      });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/shares' && req.method === 'GET') {
    const shareList = [];
    const meShares = currentUser(req, url);
    const isAdminShares = !meShares || meShares.role === 'admin';
    const catalogs = loadProjectCatalogs();
    const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
    for (const s of shares.list()) {
        if (!isAdminShares && s.ownerId && s.ownerId !== meShares.userId) continue;
        const titles = [];
        for (const id of s.sessionIds.slice(0, 5)) {
          // 优先内存索引（毫秒级），避免逐个全盘扫描导致接口缓慢
          if (titleCache.has(id)) { titles.push(titleCache.get(id)); continue; }
          const meta = cloudIndex.map.get(id)?.meta;
          if (meta?.title) { titleCache.set(id, meta.title); titles.push(meta.title); continue; }
          try {
            const resolved = await resolveSessionCanonical(id, catalogs, projectResolver);
            const t = resolved?.session?.title || id;
            titleCache.set(id, t);
            titles.push(t);
          } catch {
            titleCache.set(id, id);
            titles.push(id);
          }
        }
        shareList.push({
          shareId: s.shareId,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          allowImport: s.allowImport,
          revoked: s.revoked,
          sessionCount: s.sessionIds.length,
          hasAccessCode: Boolean(s.accessCodeHash),
          sessionTitles: titles,
          source: s.createdByDevice || ''
        });
    }
    return sendJson(res, 200, { success: true, shares: shareList });
  }

  const shareMatch = pathname.match(/^\/api\/shares\/([A-Za-z0-9]+)(\/.*)?$/);
  if (shareMatch) {
    const shareId = shareMatch[1];
    const action = shareMatch[2] || '';

    if (action === '' && req.method === 'GET') {
      const check = shares.validate(shareId, url.searchParams.get('code'));
      if (!check.ok) {
        const statusMap = { not_found: 404, revoked: 410, expired: 410, access_code: 401, view_limit: 410 };
        return sendJson(res, statusMap[check.reason] || 400, { success: false, reason: check.reason });
      }
      return sendJson(res, 200, {
        success: true,
        share: {
          shareId: check.record.shareId,
          expiresAt: check.record.expiresAt,
          allowImport: check.record.allowImport,
          sessionCount: check.record.sessionIds.length,
          createdAt: check.record.createdAt
        }
      });
    }

    if (action === '/sessions' && req.method === 'GET') {
      const check = shares.validate(shareId, url.searchParams.get('code'));
      if (!check.ok) {
        const statusMap = { not_found: 404, revoked: 410, expired: 410, access_code: 401, view_limit: 410 };
        return sendJson(res, statusMap[check.reason] || 403, { success: false, reason: check.reason });
      }
      // 查看次数限制
      if (!shares.recordView(shareId)) {
        return sendJson(res, 410, { success: false, reason: 'view_limit' });
      }
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      const items = [];
      for (const id of check.record.sessionIds) {
        let s = null;
        try {
          const resolved = await resolveSessionCanonical(id, catalogs, projectResolver);
          s = resolved?.session || null;
        } catch {}
        if (s) {
          items.push({
            id: s.id,
            title: s.title,
            updatedAt: s.updatedAt,
            sourceAgent: s.sourceAgent,
            projectName: s.project?.name || projectResolver(s.project?.originalCwd),
            messageCount: s.messages?.length || (s.events || []).filter(e => e.kind === 'message').length,
            toolCallCount: (s.events?.filter(e => e.kind === 'tool_call')?.length) || 0
          });
        }
      }
      return sendJson(res, 200, { success: true, allowImport: check.record.allowImport, count: items.length, items });
    }

    if (action === '/preview' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      const check = shares.validate(shareId, url.searchParams.get('code'));
      if (!check.ok) {
        const statusMap = { not_found: 404, revoked: 410, expired: 410, access_code: 401, view_limit: 410 };
        return sendJson(res, statusMap[check.reason] || 403, { success: false, reason: check.reason });
      }
      if (!sessionId || !check.record.sessionIds.includes(sessionId)) {
        return sendJson(res, 403, { success: false, error: '该会话不在此分享中' });
      }
      try {
        const catalogs = loadProjectCatalogs();
        const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
        const resolved = await resolveSessionCanonical(sessionId, catalogs, projectResolver);
        if (!resolved) {
          return sendJson(res, 404, { success: false, error: '会话内容不可用' });
        }
        return sendJson(res, 200, { success: true, session: resolved.session });
      } catch (err) {
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    if (action === '/import' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const check = shares.validate(shareId, body.accessCode);
        if (!check.ok) {
          return sendJson(res, 403, { success: false, reason: check.reason });
        }
        if (!check.record.allowImport) {
          return sendJson(res, 403, { success: false, error: '该分享仅允许在线查看，不允许导入' });
        }

        const hubUrl = String(body.hubUrl || '').replace(/\/+$/, '');
        const hubToken = String(body.hubToken || '');
        if (!/^https?:\/\//.test(hubUrl)) {
          return sendJson(res, 400, { success: false, error: '请提供有效的目标 Hub 地址（http/https）' });
        }

        const imported = [];
        const failed = [];
        const catalogs = loadProjectCatalogs();
        const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
        for (const id of check.record.sessionIds) {
          let payload = null;
          try {
            const resolved = await resolveSessionCanonical(id, catalogs, projectResolver);
            payload = resolved?.session || null;
          } catch {}
          if (!payload) {
            failed.push({ id, reason: 'source_missing' });
            continue;
          }
          try {
            payload.metadata = { ...(payload.metadata || {}), shareOrigin: { shareId, importedAt: Date.now(), originalAgent: payload.sourceAgent } };
            const push = await fetch(`${hubUrl}/api/sessions/import-incoming`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${hubToken}` },
              body: JSON.stringify({ session: payload })
            });
            const pushData = await push.json().catch(() => ({}));
            if (push.ok && pushData.success) {
              imported.push({ id, hubUrl });
            } else {
              failed.push({ id, reason: pushData.error || `HTTP ${push.status}` });
            }
          } catch (err) {
            failed.push({ id, reason: err.message });
          }
        }

        return sendJson(res, 200, { success: true, imported: imported.length, failed, importedItems: imported });
      } catch (err) {
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    if (action === '/revoke' && req.method === 'POST') {
      if (!isAuthorized(req, url)) {
        return sendJson(res, 401, { success: false, error: '未授权' });
      }
      const ok = shares.revoke(shareId);
      if (!ok) return sendJson(res, 404, { success: false, error: '分享不存在' });
      // 可选：同时清理该分享导入到云端的副本
      if (url.searchParams.get('purgeImported') === 'true') {
        const record = shares.get(shareId);
        let purged = 0;
        if (record) {
          for (const id of record.sessionIds) {
            const p = path.join(CLOUD_STORAGE_DIR, `${id}.json`);
            if (fs.existsSync(p)) {
              try {
                const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
                if (s.metadata?.shareOrigin?.shareId === shareId) {
                  fs.rmSync(p);
                  cloudIndex.removeOne(id);
                  purged++;
                }
              } catch {}
            }
          }
        }
        return sendJson(res, 200, { success: true, purged });
      }
      return sendJson(res, 200, { success: true, purged: 0 });
    }
  }

  // Collections API（会话集）
  if (pathname === '/api/collections' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const record = collections.create(body, currentUser(req, url)?.userId || null);
      return sendJson(res, 200, { success: true, collection: record });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  const collectionItemMatch = pathname.match(/^\/api\/collections\/([A-Za-z0-9]+)\/items\/([A-Za-z0-9-]+)$/);
  if (collectionItemMatch && req.method === 'DELETE') {
    const collectionId = collectionItemMatch[1];
    const sessionId = collectionItemMatch[2];
    const record = collections.get(collectionId);
    if (!record) return sendJson(res, 404, { success: false, error: '会话集不存在' });
    if (!record.sessionIds.includes(sessionId)) {
      return sendJson(res, 404, { success: false, error: '该会话不在此会话集中' });
    }
    try {
      const updated = collections.update(collectionId, { sessionIds: record.sessionIds.filter(sid => sid !== sessionId) });
      return sendJson(res, 200, { success: true, collection: updated });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/collections' && req.method === 'GET') {
    const meColl = currentUser(req, url);
    const all = collections.list();
    const filtered = (!meColl || meColl.role === 'admin') ? all : all.filter(c => !c.ownerId || c.ownerId === meColl.userId);
    return sendJson(res, 200, { success: true, collections: filtered });
  }

  const collectionMatch = pathname.match(/^\/api\/collections\/([A-Za-z0-9]+)(\/.*)?$/);
  if (collectionMatch) {
    const collectionId = collectionMatch[1];
    const meCollMut = currentUser(req, url);
    const collRec = collections.get(collectionId);
    if (collRec && meCollMut && meCollMut.role !== 'admin' && collRec.ownerId && collRec.ownerId !== meCollMut.userId) {
      return sendJson(res, 403, { success: false, error: '无权操作该会话集' });
    }
    const action = collectionMatch[2] || '';

    if (action === '' && req.method === 'GET') {
      const record = collections.get(collectionId);
      return record ? sendJson(res, 200, { success: true, collection: record }) : sendJson(res, 404, { success: false, error: '会话集不存在' });
    }

    if (action === '' && req.method === 'PUT') {
      try {
        const body = await parseBody(req);
        const record = collections.update(collectionId, body);
        return record ? sendJson(res, 200, { success: true, collection: record }) : sendJson(res, 404, { success: false, error: '会话集不存在' });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    if (action === '' && req.method === 'DELETE') {
      return collections.remove(collectionId)
        ? sendJson(res, 200, { success: true })
        : sendJson(res, 404, { success: false, error: '会话集不存在' });
    }

    if (action === '/share' && req.method === 'POST') {
      try {
        const record = collections.get(collectionId);
        if (!record) return sendJson(res, 404, { success: false, error: '会话集不存在' });
        const body = await parseBody(req);
        const share = shares.create({
          sessionIds: record.sessionIds,
          expiresAt: body.expiresAt || Date.now() + 7 * 24 * 3600 * 1000,
          accessCode: body.accessCode,
          allowImport: body.allowImport,
          createdByDevice: `collection:${record.name}`
        });
        return sendJson(res, 200, { success: true, share, url: `/s/${share.shareId}` });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }
  }

  // 接收方 Hub：接收导入的会话（需要目标 Hub 的授权）
  if (pathname === '/api/sessions/import-incoming' && req.method === 'POST') {
    try {
      if (auth.isConfigured() && !isAuthorized(req, url)) {
        return sendJson(res, 401, { success: false, error: '未授权：导入需要目标 Hub 的 Token' });
      }
      const body = await parseBody(req);
      const session = body.session;
      if (!session || typeof session !== 'object' || typeof session.id !== 'string' || !session.id || path.basename(session.id) !== session.id) {
        return sendJson(res, 400, { success: false, error: '缺少合法的 session 对象' });
      }
      if (!session.sourceAgent || !['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude', 'zcode', 'opencode', 'grok', 'cursor'].includes(session.sourceAgent)) {
        session.sourceAgent = session.sourceAgent || 'codex';
      }
      const catalogs = loadProjectCatalogs();
      const projectResolver = buildProjectResolver(catalogs.codexProjects, catalogs.workBuddyProjects);
      session.project = { ...(session.project || {}) };
      session.project.name = session.project.name || projectResolver(session.project.originalCwd);
      session.ownerId = currentUser(req, url)?.userId || null;
      const cloudFilePath = path.join(CLOUD_STORAGE_DIR, `${session.id}.json`);
      fs.writeFileSync(cloudFilePath, JSON.stringify(session, null, 2), 'utf-8');
      cloudIndex.updateOne(session.id, session);
      return sendJson(res, 200, { success: true, id: session.id, importedFrom: session.metadata?.shareOrigin?.shareId || null });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 6. 静态资源托管
  if (pathname.startsWith('/s/')) {
    const shareId = pathname.slice(3);
    const check = shares.validate(shareId, url.searchParams.get('code'));
    const htmlPath = path.join(__dirname, 'public/share.html');
    if (check.ok && fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(htmlPath));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const reasonText = { not_found: '分享不存在或已被删除', revoked: '分享已被创建者撤销', expired: '分享链接已过期', access_code: '访问码错误' }[check.reason] || '分享不可用';
    return res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>分享不可用</title></head><body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:18px">${reasonText}</h1><p style="color:#a1a1aa;font-size:13px">请联系分享者重新生成链接</p></div></body></html>`);
  }

  if (pathname === '/' || pathname === '/index.html') {
    if (!isCookieAuthorized(req)) {
      const loginPath = path.join(__dirname, 'public/login.html');
      if (fs.existsSync(loginPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(loginPath));
      }
      return sendJson(res, 401, { success: false, error: '未授权：请先登录' });
    }
    const reactHtml = path.join(__dirname, 'public-react/index.html');
    if (fs.existsSync(reactHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      return res.end(fs.readFileSync(reactHtml));
    }
    const htmlPath = path.join(__dirname, 'public/index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(htmlPath));
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4891;
server.listen(PORT, '0.0.0.0', () => {
  // 启动时清理过期 Token + 回收站（30 天保留），之后每小时一次
  auth.pruneExpiredTokens();
  const cleanRecycleBin = () => {
    try {
      const binDir = path.join(HUB_DATA_DIR, 'deleted-backups');
      if (!fs.existsSync(binDir)) return 0;
      const cutoff = Date.now() - 30 * 86400000;
      let removed = 0;
      for (const agent of fs.readdirSync(binDir)) {
        const agentDir = path.join(binDir, agent);
        if (!fs.statSync(agentDir).isDirectory()) continue;
        for (const f of fs.readdirSync(agentDir)) {
          const fp = path.join(agentDir, f);
          try { if (fs.statSync(fp).mtimeMs < cutoff) { fs.rmSync(fp); removed++; } } catch {}
        }
      }
      if (removed) console.log(`♻️ 回收站自动清理：删除 ${removed} 个超过 30 天的备份`);
      return removed;
    } catch { return 0; }
  };
  cleanRecycleBin();
  backup.ensureTimer(() => backup.runNow());
  // 自动上云归属：第一个 admin
  const firstAdmin = auth.users.find(u => u.role === 'admin');
  if (firstAdmin) autoSync.ownerId = firstAdmin.id;
  setInterval(() => { auth.pruneExpiredTokens(); cleanRecycleBin(); }, 3600 * 1000);
  console.log(`🚀 Agent Sync Hub 多助手控制台已启动: http://0.0.0.0:${PORT}`);
});
