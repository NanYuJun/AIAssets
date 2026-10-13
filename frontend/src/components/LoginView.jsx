import { useState } from 'react'
import { isElectron } from '../lib/api'

export default function LoginView({ onLogin, showToast }) {
  const [hub, setHub] = useState(() => window.hubDesktop?.getAuth()?.hub || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [mode, setMode] = useState('login') // login | init
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!hub.trim()) { setError('请填写 Hub 地址'); return }
    if (!username.trim() || !password) { setError('请填写用户名和密码'); return }
    if (mode === 'init') {
      if (password.length < 8) { setError('密码至少 8 位'); return }
      if (password !== password2) { setError('两次输入的密码不一致'); return }
    }
    setBusy(true)
    try {
      const hubBase = hub.trim().replace(/\/+$/, '')
      // 检测 Hub 是否已初始化
      const statusRes = await fetch(hubBase + '/api/auth/status')
      const status = await statusRes.json()
      const needInit = status.success && status.configured === false
      if (needInit && mode === 'login') {
        setMode('init')
        setBusy(false)
        return
      }
      if (needInit) {
        const res = await fetch(hubBase + '/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, confirmPassword: password2 })
        })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || '初始化失败')
      }
      // 设备登录换发 Token
      const d = await window.hubDesktop.deviceLogin(hubBase, username, password)
      window.hubDesktop.setAuth(d.hub, d.token)
      localStorage.removeItem('hub-guest')
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const skipLogin = async () => {
    setError('')
    if (!hub.trim()) { setError('请先填写 Hub 地址'); return }
    setBusy(true)
    try {
      const hubBase = hub.trim().replace(/\/+$/, '')
      const res = await fetch(hubBase + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceName: 'guest' }) })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || '获取游客凭据失败')
      window.hubDesktop.setAuth(hubBase, data.guestToken)
      localStorage.setItem('hub-guest', '1')
      await window.hubDesktop.saveConfig({ ...(window.hubDesktop.getConfig() || {}), hub: hubBase, token: data.guestToken, guest: true })
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-8">
        <div className="flex items-center gap-2.5 mb-1"><img src="mascot-128.png" className="h-9 w-9" alt="AIAssets" /><h1 className="text-lg font-semibold">AIAssets</h1></div>
        <p className="text-xs text-zinc-400 mb-6">{mode === 'init' ? '该 Hub 尚未初始化，请设置管理员账号密码' : '输入 Hub 地址与账号密码连接'}</p>
        <label className="block text-xs text-zinc-300 mb-1.5">Hub 地址</label>
        <input value={hub} onChange={e => setHub(e.target.value)} placeholder="http://192.168.1.100:4891" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mb-4" />
        <label className="block text-xs text-zinc-300 mb-1.5">用户名</label>
        <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mb-4" />
        <label className="block text-xs text-zinc-300 mb-1.5">{mode === 'init' ? '设置密码（至少 8 位）' : '密码'}</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'init' ? 'new-password' : 'current-password'} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mb-4" />
        {mode === 'init' && (
          <>
            <label className="block text-xs text-zinc-300 mb-1.5">确认密码</label>
            <input type="password" value={password2} onChange={e => setPassword2(e.target.value)} autoComplete="new-password" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mb-4" />
          </>
        )}
        {error && <p className="text-xs text-rose-400 mb-4">{error}</p>}
        <button type="submit" disabled={busy} className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:bg-zinc-700 text-sm font-semibold text-white">
          {busy ? '连接中...' : mode === 'init' ? '初始化并连接' : '登录'}
        </button>
        {isElectron() && (
        <button type="button" onClick={skipLogin} disabled={busy} className="w-full mt-2 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors">
          跳过登录，仅使用会话迁移功能
        </button>
        )}
      </form>
    </div>
  )
}
