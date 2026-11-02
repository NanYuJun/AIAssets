#!/usr/bin/env node
/**
 * AIAssets CLI 入口（npm 全局安装后的 bin 命令）
 *
 * 服务端管理:
 *   aiassets start [--port 4891] [--data <dir>] [--storage <dir>]   前台启动
 *   aiassets daemon [--port 4891] [--data <dir>] [--storage <dir>]  后台守护启动
 *   aiassets stop      停止后台守护进程
 *   aiassets restart   重启后台守护进程
 *   aiassets status    查看运行状态
 *
 * 轻客户端（连接远端 Hub）:
 *   aiassets sync --hub <url> --token <t>    双向同步
 *
 * PID 文件: <data>/aiassets.pid；后台日志: <data>/aiassets.log
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(PKG_ROOT, 'src', 'server', 'index.js');
const CLIENT_ENTRY = path.join(PKG_ROOT, 'src', 'client', 'index.js');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = argv[++i];
    else if (a === '--data') opts.data = argv[++i];
    else if (a === '--storage') opts.storage = argv[++i];
    else if (a === '--hub') opts.hub = argv[++i];
    else if (a === '--token') opts.token = argv[++i];
  }
  return opts;
}

function dataDir(opts) {
  return path.resolve(opts.data || process.env.AIASSETS_DATA || path.join(PKG_ROOT, 'hub-data'));
}

const pidFile = (opts) => path.join(dataDir(opts), 'aiassets.pid');
const logFile = (opts) => path.join(dataDir(opts), 'aiassets.log');

function readPid(opts) {
  try { return parseInt(fs.readFileSync(pidFile(opts), 'utf-8').trim(), 10); } catch { return null; }
}

function isRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function writePid(opts, pid) {
  fs.mkdirSync(dataDir(opts), { recursive: true });
  fs.writeFileSync(pidFile(opts), String(pid), 'utf-8');
}

function clearPid(opts) { try { fs.rmSync(pidFile(opts), { force: true }); } catch {} }

function startDetached(opts) {
  const dd = dataDir(opts);
  fs.mkdirSync(dd, { recursive: true });
  const out = fs.openSync(logFile(opts), 'a');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: opts.port || process.env.PORT || '4891',
      HUB_DATA_DIR: dd,
      CLOUD_STORAGE_DIR: path.resolve(opts.storage || path.join(dd, '..', 'cloud-hub-storage'))
    },
    detached: true,
    stdio: ['ignore', out, out]
  });
  child.unref();
  writePid(opts, child.pid);
  return child.pid;
}

function stopProcess(opts) {
  const pid = readPid(opts);
  if (!pid || !isRunning(pid)) { clearPid(opts); return false; }
  try { process.kill(pid, 'SIGTERM'); } catch { clearPid(opts); return false; }
  for (let i = 0; i < 50; i++) {
    if (!isRunning(pid)) { clearPid(opts); return true; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
  clearPid(opts);
  return true;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  switch (cmd) {
    case 'start': {
      process.env.PORT = opts.port || process.env.PORT || '4891';
      if (opts.data) process.env.HUB_DATA_DIR = path.resolve(opts.data);
      if (opts.storage) process.env.CLOUD_STORAGE_DIR = path.resolve(opts.storage);
      await import(pathToFileURL(SERVER_ENTRY).href);
      break;
    }
    case 'daemon': {
      const pid = readPid(opts);
      if (pid && isRunning(pid)) { console.log('AIAssets 已在运行 (PID ' + pid + ')'); break; }
      const newPid = startDetached(opts);
      console.log('AIAssets 后台已启动: PID ' + newPid + ' · 日志: ' + logFile(opts));
      break;
    }
    case 'stop': {
      const ok = stopProcess(opts);
      console.log(ok ? 'AIAssets 已停止' : 'AIAssets 未在运行');
      break;
    }
    case 'restart': {
      stopProcess(opts);
      const pid = startDetached(opts);
      console.log('AIAssets 已重启: PID ' + pid);
      break;
    }
    case 'status': {
      const pid = readPid(opts);
      const running = isRunning(pid);
      console.log(running ? '● 运行中 (PID ' + pid + ') · 日志: ' + logFile(opts) : '○ 未运行');
      break;
    }
    case 'sync': {
      if (!opts.hub) { console.error('用法: aiassets sync --hub <url> --token <token>'); process.exit(1); }
      process.argv = [process.argv[0], CLIENT_ENTRY, 'sync'];
      await import(pathToFileURL(CLIENT_ENTRY).href);
      break;
    }
    default:
      console.log([
        'AIAssets — AI 资产管理中心',
        '',
        '用法:',
        '  aiassets start [--port 4891]           前台启动服务端',
        '  aiassets daemon [--port 4891]          后台守护启动',
        '  aiassets stop                          停止后台守护',
        '  aiassets restart                       重启后台守护',
        '  aiassets status                        查看运行状态',
        '  aiassets sync --hub <url> --token <t>  轻客户端双向同步',
        '',
        '服务端数据目录: --data <dir> 或环境变量 AIASSETS_DATA（默认 <包目录>/hub-data）',
        '云端存储目录:   --storage <dir> 或环境变量 CLOUD_STORAGE_DIR'
      ].join('\n'));
  }
}

main().catch(err => { console.error('aiassets:', err.message); process.exit(1); });

