const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'client-config.json');
const STATE_PATH = path.join(CONFIG_DIR, 'client-state.json');
const APP_ICON = path.join(__dirname, 'icon.png');

let tray = null;
let mainWindow = null;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return null; }
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); } catch { return {} }
}

function saveState(st) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2), 'utf-8');
}

async function syncNow() {
  const cfg = loadConfig();
  if (!cfg) return { pushed: 0, pulled: 0, error: '未配置' };
  try {
    const res = await fetch(cfg.hub.replace(/\/+$/, '') + '/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ deviceName: require('node:os').hostname() })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || res.statusText);
    const st = loadState();
    st.lastSync = Date.now();
    st.lastPushed = data.pushed || 0;
    st.lastPulled = data.pulled || 0;
    saveState(st);
    return data;
  } catch (e) {
    return { pushed: 0, pulled: 0, error: e.message };
  }
}

// ===== 自动更新（Hub 作为分发源）=====
function getUpdateFeed() {
  // 优先 GitHub Releases（package.json build.publish 配置了真实 owner 时）
  const pub = (require('./package.json').build || {}).publish || [];
  const gh = Array.isArray(pub) ? pub.find(p => p.provider === 'github') : null;
  if (gh && gh.owner && gh.owner !== 'YOUR_GITHUB_USERNAME') {
    return { provider: 'github', owner: gh.owner, repo: gh.repo };
  }
  // 否则回退 Hub 分发源
  const cfg = loadConfig();
  if (cfg?.hub) return { provider: 'generic', url: cfg.hub.replace(/\/+$/, '') + '/updates/' };
  return null;
}

function setupAutoUpdater() {
  const feed = getUpdateFeed();
  if (!feed) return; // 无可用更新源
  try {
    autoUpdater.setFeedURL(feed);
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-downloaded', (info) => {
      dialog.showMessageBox({
        type: 'info',
        title: 'AIAssets 更新',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '重启应用即可完成更新。',
        buttons: ['立即重启', '稍后']
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', () => {}); // 静默（Hub 离线/无更新时不出提示）

    // 启动 30 秒后检查一次，之后每 6 小时
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 30000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
  } catch {}
}

async function checkForUpdatesManual() {
  const feed = getUpdateFeed();
  if (!feed) { dialog.showMessageBox({ message: '未配置更新源（先配对 Hub 或设置 GitHub 发布）' }); return; }
  try {
    autoUpdater.setFeedURL(feed);
    const result = await autoUpdater.checkForUpdates();
    const v = result?.updateInfo?.version;
    if (v && v !== app.getVersion()) {
      dialog.showMessageBox({ type: 'info', message: `发现新版本 ${v}，正在后台下载…`, detail: '下载完成后会提示你重启安装。' });
    } else {
      dialog.showMessageBox({ message: '当前已是最新版本 ' + app.getVersion() });
    }
  } catch (e) {
    dialog.showMessageBox({ type: 'warning', message: '检查更新失败', detail: '无法连接 Hub 的更新源，请确认 Hub 在线且已发布更新文件。' });
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开 AIAssets', click: () => { createMainWindow(); } },
    { label: '立即同步', click: async () => { const r = await syncNow(); dialog.showMessageBox({ message: `同步完成：推 ${r.pushed || 0} / 拉 ${r.pulled || 0}` }); } },
    { label: '检查更新', click: () => checkForUpdatesManual() },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } }
  ]);
  tray.setToolTip('AIAssets');
  tray.setContextMenu(contextMenu);
}

async function resolveLocalHubUrl(cfg) {
  try {
    const u = new URL(cfg.hub);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return cfg.hub.replace(/\/+$/, '');
    const local = 'http://127.0.0.1:' + (u.port || 80);
    const res = await fetch(local + '/api/auth/status', { signal: AbortSignal.timeout(1500) });
    if (res.ok) return local;
  } catch {}
  return cfg.hub.replace(/\/+$/, '');
}

async function createMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }
  const cfg = loadConfig();
  if (cfg?.hub) {
    const hubUrl = await resolveLocalHubUrl(cfg);
    const localUi = path.join(__dirname, 'app-ui', 'index.html');
    const useLocalUi = fs.existsSync(localUi);
    mainWindow = new BrowserWindow({
      width: 1200, height: 800,
      frame: false,
      icon: APP_ICON,
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      webPreferences: { preload: path.join(__dirname, 'preload.js') }
    });
    mainWindow.webContents.on('did-finish-load', () => { mainWindow.webContents.executeJavaScript("document.documentElement.classList.add('electron-app')").catch(() => {}); });
    if (useLocalUi) {
      mainWindow.loadFile(localUi);
    } else {
      mainWindow.loadURL(hubUrl + '/#/sessions');
    }
    mainWindow.on('closed', () => { mainWindow = null; });
  } else {
    mainWindow = new BrowserWindow({
      width: 480, height: 360, autoHideMenuBar: true, resizable: false, icon: APP_ICON,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    mainWindow.loadFile(path.join(__dirname, 'setup.html'));
    mainWindow.on('closed', () => { mainWindow = null; });
  }
}

ipcMain.handle('save-config', (e, cfg) => {
  saveConfig(cfg);
  createMainWindow();
  return { ok: true };
});

ipcMain.handle('get-config', () => loadConfig());
ipcMain.on('get-config-sync', (e) => { e.returnValue = loadConfig(); });

ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-close', () => { if (mainWindow) mainWindow.hide(); });
ipcMain.on('window-quit', () => { app.quit(); });

ipcMain.handle('device-login', async (e, { hub, username, password }) => {
  const hubBase = String(hub || '').replace(/\/+$/, '');
  const res = await fetch(hubBase + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, deviceToken: true, deviceName: require('node:os').hostname() })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || '登录失败');
  saveConfig({ ...loadConfig(), hub: hubBase, token: data.deviceToken });
  return { ok: true, hub: hubBase, token: data.deviceToken };
});

ipcMain.handle('client-logout', async () => {
  const cfg = loadConfig();
  if (cfg?.hub && cfg?.token) {
    try {
      await fetch(cfg.hub.replace(/\/+$/, '') + '/api/auth/logout', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + cfg.token }
      });
    } catch {}
  }
  return { ok: true };
});

app.whenReady().then(() => {
  // 清除渲染缓存，确保最新 Logo/界面资源生效
  session.defaultSession.clearCache().catch(() => {});
  setupAutoUpdater();
  createTray();
  createMainWindow();
  // 自动同步：每 60 秒
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg?.hub && cfg?.autoSync) await syncNow();
  }, 60000);
});

app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
