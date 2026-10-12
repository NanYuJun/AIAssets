import fs from 'node:fs';

const path = new URL('../src/App.jsx', import.meta.url);
let s = fs.readFileSync(path, 'utf8');

// import Settings
if (!s.includes("import Settings")) {
  s = s.replace("import ShareManage from './pages/ShareManage'", "import ShareManage from './pages/ShareManage'\nimport Settings from './pages/Settings'");
}

// move settings from FUTURE_ITEMS to NAV_ITEMS
const settingsEntry = /\n\s*\{ key: 'settings', label: '设置', icon: '[^']+' \}/;
const settingsMatch = s.match(settingsEntry);
if (settingsMatch) {
  s = s.replace(settingsEntry, '');
  s = s.replace(
    /    \{ key: 'shares', label: '分享管理', icon: '[^']+' \}/,
    m => m + settingsMatch[0].replace(/^\n/, '\n')
  );
}

// render Settings page
if (!s.includes("page === 'settings' && <Settings")) {
  s = s.replace(
    "          {page === 'shares' && <ShareManage showToast={showToast} />}",
    "          {page === 'shares' && <ShareManage showToast={showToast} />}\n          {page === 'settings' && <Settings showToast={showToast} />}"
  );
}

// allow settings in hash validation (both occurrences)
s = s.replaceAll("['sessions', 'collections', 'shares']", "['sessions', 'collections', 'shares', 'settings']");

fs.writeFileSync(path, s, 'utf8');
console.log('App updated: nav has settings =', s.includes("key: 'settings', label: '设置'"), '; render =', s.includes("page === 'settings'"), '; FUTURE has settings =', /FUTURE_ITEMS = \[[\s\S]*?key: 'settings'/.test(s));
