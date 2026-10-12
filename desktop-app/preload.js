const { contextBridge, ipcRenderer } = require('electron');

// 同步获取配置，避免 renderer 首次调用 getAuth() 时缓存未就绪
let cachedConfig = null;
try { cachedConfig = ipcRenderer.sendSync('get-config-sync'); } catch {}

contextBridge.exposeInMainWorld('hubDesktop', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  quit: () => ipcRenderer.send('window-quit'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  deviceLogin: (hub, username, password) => ipcRenderer.invoke('device-login', { hub, username, password }),
  logout: () => ipcRenderer.invoke('client-logout'),
  getAuth: () => ({ hub: cachedConfig?.hub || '', token: cachedConfig?.token || '' }),
  setAuth: (hub, token) => { cachedConfig = { ...(cachedConfig || {}), hub, token }; },
  isElectron: true
});
