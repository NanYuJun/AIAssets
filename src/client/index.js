#!/usr/bin/env node
/**
 * Agent Sync Hub 轻量客户端
 * 运行在本机（Mac/笔记本/台式机），与中心 Hub 双向同步本地 Agent 会话。
 *
 * 用法：
 *   node client.js config --hub http://hub:4891 --token <token>   # 配置中心 Hub
 *   node client.js sync                                            # 双向同步（推本地新会话 + 拉云端新会话）
 *   node client.js push                                            # 仅推送本地新会话到 Hub
 *   node client.js pull                                            # 仅拉取云端新会话注入本地
 *   node client.js status                                          # 查看配置和状态
 *   node client.js daemon                                          # 后台守护：定时双向同步
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CONFIG_DIR = path.join(os.homedir(), '.agent-sync-hub');
const CONFIG_PATH = path.join(CONFIG_DIR, 'client-config.json');
const STATE_PATH = path.join(CONFIG_DIR, 'client-state.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('尚未配置。请先运行: node client.js config --hub http://hub:4891 --token <token>');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); } catch { return { knownFiles: {} } }
}

function saveState(st) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2), 'utf-8');
}

async function hubFetch(cfg, apiPath, options = {}) {
  const res = await fetch(cfg.hub.replace(/\/+$/, '') + apiPath, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, ...(options.headers || {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Hub ${res.status}: ${body.error || body.reason || res.statusText}`);
  }
  return res.json();
}

// 动态导入本项目的适配器
const adaptersDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'adapters');

async function getReaders() {
  const readers = {};
  for (const name of ['codex', 'workbuddy', 'pi', 'gemini', 'dsh']) {
    try {
      const mod = await import(`file:///${adaptersDir.replace(/\\/g, '/')}/${name}/reader.js`);
      readers[name] = mod[Object.keys(mod).find(k => k.endsWith('Reader'))];
    } catch {}
  }
  return readers;
}

async function scanLocalSessions(readers, projectResolver) {
  const sessions = [];
  for (const [agent, Reader] of Object.entries(readers)) {
    try {
      for (const file of Reader.scanAllSessions()) {
        try {
          const summary = await Reader.fastScanSummary(file, projectResolver);
          if (summary) { summary.filePath = file; sessions.push(summary); }
        } catch {}
      }
    } catch {}
  }
  return sessions;
}

async function cmdPush(cfg) {
  const readers = await getReaders();
  const state = loadState();
  const known = state.knownFiles || {};
  const sessions = await scanLocalSessions(readers);
  let pushed = 0;
  for (const s of sessions) {
    const mtime = fs.statSync(s.filePath).mtimeMs;
    if (known[s.filePath] === mtime) continue;
    known[s.filePath] = mtime;
    try {
      const Reader = readers[s.agent];
      const canonical = await Reader.parseSession(s.filePath);
      canonical.sourceAgent = s.agent;
      canonical.metadata = { ...(canonical.metadata || {}), pushedFrom: os.hostname() };
      const res = await fetch(cfg.hub.replace(/\/+$/, '') + '/api/sessions/import-incoming', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify({ session: canonical })
      });
      if (res.ok) pushed++;
    } catch {}
  }
  state.knownFiles = known;
  state.lastPush = Date.now();
  state.lastPushCount = pushed;
  saveState(state);
  console.log(`推送完成：${pushed} 个会话`);
}

async function cmdPull(cfg) {
  const readers = await getReaders();
  const state = loadState();
  const pulledIds = state.pulledIds || [];
  const cloud = await hubFetch(cfg, '/api/sessions/cloud');
  let pulled = 0;
  for (const item of cloud.items) {
    if (pulledIds.includes(item.id)) continue;
    try {
      const detail = await hubFetch(cfg, '/api/sessions/detail/' + encodeURIComponent(item.id));
      const canonical = detail.session;
      const targetAgent = canonical.sourceAgent || 'codex';
      if (!readers[targetAgent]) continue; // 本机未安装该 Agent
      // 写入本机
      const mod = await import(`file:///${adaptersDir.replace(/\\/g, '/')}/${targetAgent}/writer.js`);
      const Writer = mod[Object.keys(mod).find(k => k.endsWith('Writer'))];
      if (!Writer) continue;
      const root = canonical.project?.originalCwd || path.join(os.homedir(), 'Documents');
      await Writer.injectSession(canonical, root);
      pulledIds.push(item.id);
      pulled++;
    } catch {}
  }
  state.pulledIds = pulledIds;
  state.lastPull = Date.now();
  state.lastPullCount = pulled;
  saveState(state);
  console.log(`拉取完成：${pulled} 个会话`);
}

async function cmdSync(cfg) {
  console.log('推送本地会话到 Hub...');
  await cmdPush(cfg);
  console.log('拉取 Hub 会话到本地...');
  await cmdPull(cfg);
}

function cmdStatus() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    console.log('Hub 地址:', cfg.hub);
    console.log('Token:', cfg.token?.slice(0, 12) + '...');
    const st = loadState();
    console.log('上次推送:', st.lastPush ? new Date(st.lastPush).toLocaleString('zh-CN', { hour12: false }) + `（${st.lastPushCount || 0} 个）` : '从未');
    console.log('上次拉取:', st.lastPull ? new Date(st.lastPull).toLocaleString('zh-CN', { hour12: false }) + `（${st.lastPullCount || 0} 个）` : '从未');
  } catch { console.log('未配置'); }
}

function cmdDaemon(cfg) {
  console.log('守护模式启动，每 60 秒自动双向同步。Ctrl+C 退出。');
  const run = async () => {
    try { await cmdSync(cfg); } catch (e) { console.error('同步失败:', e.message); }
  };
  run();
  setInterval(run, 60000);
}

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'config': {
    const hubIdx = args.indexOf('--hub');
    const userIdx = args.indexOf('--user');
    const tokenIdx = args.indexOf('--token');
    const hub = hubIdx >= 0 ? args[hubIdx + 1] : null;
    const token = tokenIdx >= 0 ? args[tokenIdx + 1] : null;
    const user = userIdx >= 0 ? args[userIdx + 1] : null;
    if (!hub) { console.error('用法: node client.js config --hub http://hub:4891 --user <username> 或 --token <token>'); process.exit(1); }
    if (user) {
      // 账号密码登录，换取设备 Token
      const password = process.env.HUB_PASSWORD || (() => { process.stderr.write('密码: '); const buf = Buffer.alloc(1024); const n = require('node:fs').readSync(0, buf, 0, 1024, null); return buf.toString('utf8').trim(); })();
      const res = await fetch(hub.replace(/\/+$/, '') + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: user, password, deviceToken: true, deviceName: os.hostname() })
      });
      const data = await res.json();
      if (!res.ok || !data.success) { console.error('登录失败:', data.error || res.statusText); process.exit(1); }
      saveConfig({ hub, token: data.deviceToken, username: user });
      console.log('登录成功，设备 Token 已保存:', hub, '（用户: ' + user + '）');
    } else if (token) {
      saveConfig({ hub, token });
      console.log('配置已保存:', hub);
    } else {
      console.error('需要 --user <username> 或 --token <token>');
      process.exit(1);
    }
    break;
  }
  case 'sync': await cmdSync(loadConfig()); break;
  case 'push': await cmdPush(loadConfig()); break;
  case 'pull': await cmdPull(loadConfig()); break;
  case 'status': cmdStatus(); break;
  case 'daemon': cmdDaemon(loadConfig()); break;
  default:
    console.log('Agent Sync Hub 轻量客户端');
    console.log('用法:');
    console.log('  config --hub <url> --user <username>   配置中心 Hub（账号密码登录，自动换发设备 Token）');
    console.log('  config --hub <url> --token <token>   配置中心 Hub（直接使用 Token）');
    console.log('  sync                                  双向同步');
    console.log('  push                                  仅推送');
    console.log('  pull                                  仅拉取');
    console.log('  status                                查看状态');
    console.log('  daemon                                守护模式（60 秒自动同步）');
}
