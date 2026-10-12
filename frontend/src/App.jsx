import { useEffect, useState } from 'react'
import AssetLibrary from './pages/AssetLibrary'
import Collections from './pages/Collections'
import ShareManage from './pages/ShareManage'
import Settings from './pages/Settings'
import AccountPage from './pages/AccountPage'
import UserAdminPage from './pages/UserAdminPage'
import { DialogProvider } from './components/DialogProvider'
import LoginView from './components/LoginView'
import { isElectron, rawFetch } from './lib/api'

const NAV_ITEMS = [
  { key: 'sessions', label: '会话仓库', icon: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155' },
  { key: 'collections', label: '会话集', icon: 'M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776' },
  { key: 'shares', label: '分享管理', icon: 'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.935-2.186 2.25 2.25 0 0 0-3.935 2.186Z' }
  ,{ key: 'useradmin', label: '用户管理', icon: 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z' },
  { key: 'settings', label: '设置', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.077-.124.072-.044.146-.086.22-.128.331-.183.581-.495.644-.869l.213-1.28Z' }
]
const FUTURE_ITEMS = [
  { key: 'devices', label: '设备管理', icon: 'M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 16.5h3m-6-5h6' },
]

export default function App() {
  const [page, setPageState] = useState(() => {
    const hash = location.hash.replace('#/', '')
    return ['sessions', 'collections', 'shares', 'settings', 'account', 'useradmin'].includes(hash) ? hash : 'sessions'
  })
  const setPage = (p) => {
    setPageState(p)
    location.hash = '#/' + p
  }
  const [toast, setToast] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [authConfigured, setAuthConfigured] = useState(false)
  const [me, setMe] = useState(null)
  const [authChecked, setAuthChecked] = useState(!isElectron())
  const [isAdmin, setIsAdmin] = useState(false)
  const [authStatus, setAuthStatus] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('hub-theme') || 'dark')
  const [isGuest, setIsGuest] = useState(() => localStorage.getItem('hub-guest') === '1')
  const [users, setUsers] = useState([])
  const [globalLoading, setGlobalLoading] = useState(false)

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok, at: Date.now() })
    setTimeout(() => setToast(null), 3500)
  }

  const handleLogout = async () => {
    try {
      if (isElectron()) {
        await window.hubDesktop.logout()
      } else {
        await rawFetch('/api/auth/logout', { method: 'POST' })
      }
      setMe(null)
      setAuthChecked(false)
      localStorage.removeItem('hub-guest')
      setIsGuest(false)
      showToast('已退出登录')
    } catch { showToast('退出失败', false) }
  }

  const applyTheme = (t) => {
    setTheme(t)
    localStorage.setItem('hub-theme', t)
    document.documentElement.classList.toggle('light-mode', t === 'light')
    document.documentElement.classList.toggle('dark', t !== 'light')
  }

  const refreshAuth = () => {
    rawFetch('/api/auth/status').then(r => r.json()).then(d => {
      setAuthStatus(d)
      setMe(d.me || null)
      setIsAdmin(d.isAdmin)
      if (d.isAdmin) {
        rawFetch('/api/auth/users').then(r => r.json()).then(ul => setUsers(ul.users || [])).catch(() => {})
      }
    }).catch(() => {})
  }

  const withLoading = async (fn) => {
    setGlobalLoading(true)
    try { await fn() } finally { setGlobalLoading(false) }
  }

  useEffect(() => {
    const onHash = () => {
      const hash = location.hash.replace('#/', '')
      if (['sessions', 'collections', 'shares', 'settings', 'account', 'useradmin'].includes(hash)) setPageState(isGuest && hash !== 'sessions' ? 'sessions' : hash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    rawFetch('/api/auth/status').then(r => r.json()).then(d => {
      setAuthConfigured(d.configured)
      setMe(d.me || null)
      setIsAdmin(d.isAdmin)
      setIsGuest(Boolean(d.isGuest))
      setAuthStatus(d)
      setAuthChecked(true)
      if (d.isAdmin) {
        rawFetch('/api/auth/users').then(r => r.json()).then(ul => setUsers(ul.users || [])).catch(() => {})
      }
    }).catch(() => setAuthChecked(true))
  }, [])

  if (isElectron() && (!authChecked || !me)) {
    return (
      <div className="h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <LoginView onLogin={() => window.location.reload()} showToast={showToast} />
      </div>
    )
  }

  return (
    <DialogProvider>
    <div className="h-screen overflow-hidden bg-zinc-950 text-zinc-100 flex">
      <aside className="fixed left-0 top-0 bottom-0 w-[224px] z-30 bg-zinc-950 border-r border-zinc-800/80 flex flex-col">
        <div className="px-5 py-4 flex items-center gap-2.5 border-b border-zinc-800/60">
          <img src={theme === 'light' ? 'brand-logo-light.png' : 'brand-logo-dark.png'} className="h-10 w-auto shrink-0 rounded-lg" alt="AIAssets" />
          <button onClick={() => applyTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? '切换黑夜模式' : '切换白天模式'} className="ml-auto w-7 h-7 rounded-md hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-100 shrink-0">
            {theme === 'light'
              ? <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646Z" /></svg>
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>}
          </button>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-3 overflow-y-auto">
          {NAV_ITEMS.filter(item => (item.key !== 'useradmin' || isAdmin) && (!isGuest || item.key === 'sessions')).map(item => (
            <button key={item.key} onClick={() => setPage(item.key)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${page === item.key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'}`}>
              <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
          <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-zinc-600">后续扩展</div>
          {FUTURE_ITEMS.map(item => (
            <button key={item.key} onClick={() => showToast('即将上线')} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-colors">
              <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-zinc-800/60 space-y-1">
          {me && (
            <button onClick={() => setPage('account')} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-zinc-900 transition-colors text-left">
              <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold text-white" style={{ background: me.avatarColor || 'linear-gradient(135deg, #3b82f6, #9333ea)' }}>{(me.displayName || me.username).slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-zinc-200 truncate">{me.displayName || me.username}</div>
                <div className="text-[10px] text-zinc-500">{me.role === 'admin' ? '管理员' : '成员'} · 点击查看账号</div>
              </div>
            </button>
          )}
          {authConfigured && (
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-rose-300 hover:bg-zinc-900 transition-colors">
              <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" /></svg>
              <span>退出登录</span>
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col ml-[224px] min-w-0 h-full overflow-hidden">
        <div className="sticky top-0 z-40 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-800/80 px-6 py-3.5 flex items-center justify-between electron-drag">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-zinc-200">{NAV_ITEMS.find(i => i.key === page)?.label}</h1>
          </div>
          {window.hubDesktop?.isElectron && (
            <div className="flex items-center gap-1">
              <button onClick={() => window.hubDesktop.minimize()} title="最小化" className="w-8 h-8 rounded-md hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-100">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="M5 12h14" /></svg>
              </button>
              <button onClick={() => window.hubDesktop.close()} title="关闭（隐藏到托盘）" className="w-8 h-8 rounded-md hover:bg-rose-600/80 flex items-center justify-center text-zinc-400 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}
        </div>

        <main className="flex-1 p-3 sm:p-6 max-w-[1600px] w-full mx-auto overflow-y-auto min-h-0 flex flex-col">
          {page === 'sessions' && <AssetLibrary showToast={showToast} isGuest={isGuest} refreshKey={refreshKey} onRefresh={() => withLoading(async () => setRefreshKey(k => k + 1))} globalLoading={globalLoading} setGlobalLoading={setGlobalLoading} />}
          {page === 'collections' && <Collections showToast={showToast} globalLoading={globalLoading} setGlobalLoading={setGlobalLoading} />}
          {page === 'shares' && <ShareManage showToast={showToast} globalLoading={globalLoading} setGlobalLoading={setGlobalLoading} />}
          {page === 'settings' && <Settings showToast={showToast} globalLoading={globalLoading} setGlobalLoading={setGlobalLoading} />}
          {page === 'account' && <AccountPage auth={authStatus} isAdmin={isAdmin} onUpdated={refreshAuth} showToast={showToast} />}
          {page === 'useradmin' && isAdmin && <UserAdminPage auth={authStatus} users={users} isAdmin={isAdmin} onUpdated={refreshAuth} showToast={showToast} />}
        </main>
      </div>

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] max-w-lg w-auto flex justify-center">
          <div className={`px-5 py-3 rounded-xl shadow-2xl text-sm font-medium border flex items-center gap-2.5 ${toast.ok ? 'bg-zinc-800 text-emerald-300 border-emerald-500/40 ring-1 ring-emerald-500/20' : 'bg-zinc-800 text-rose-300 border-rose-500/40 ring-1 ring-rose-500/20'}`}>
            {toast.ok
              ? <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
              : <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>}
            <span className="whitespace-pre-wrap">{toast.msg}</span>
          </div>
        </div>
      )}

      {globalLoading && (
        <div className="fixed inset-0 z-[65] bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-6 py-4 flex items-center gap-3 shadow-2xl">
            <svg className="w-5 h-5 animate-spin text-brand-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            <span className="text-sm text-zinc-200">处理中，请稍候...</span>
          </div>
        </div>
      )}
    </div>
    </DialogProvider>
  )
}
