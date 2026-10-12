import { useEffect, useState } from 'react'
import { api, copyText } from '../lib/api'
import { useDialog } from '../components/DialogProvider'

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#6366f1']

export default function AccountSection({ auth, isAdmin, onUpdated, showToast }) {
  const dialog = useDialog()
  const me = auth?.me
  const [displayName, setDisplayName] = useState(me?.displayName || '')
  const [avatarColor, setAvatarColor] = useState(me?.avatarColor || '#3b82f6')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)

  useEffect(() => {
    setDisplayName(me?.displayName || '')
    setAvatarColor(me?.avatarColor || '#3b82f6')
  }, [me?.userId])

  if (!me) return null
  if (me.role === 'guest') return (<div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 text-xs text-zinc-400">游客模式：仅可使用会话仓库中的迁移与预览功能。退出后用账号密码登录可管理完整资产。</div>)

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      await api('/api/auth/profile', { method: 'POST', body: { displayName, avatarColor } })
      showToast('资料已保存')
      onUpdated?.()
    } catch (e) { showToast(e.message, false) }
    setSavingProfile(false)
  }

  const changePwd = async () => {
    if (newPwd.length < 8) { showToast('新密码至少 8 位', false); return }
    if (newPwd !== newPwd2) { showToast('两次输入的密码不一致', false); return }
    setSavingPwd(true)
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { oldPassword: oldPwd, newPassword: newPwd } })
      showToast('密码已修改，请重新登录')
      setTimeout(() => location.reload(), 1200)
    } catch (e) { showToast(e.message, false) }
    setSavingPwd(false)
  }

  const myTokens = (auth.tokens || []).filter(t => t.userId === me.userId && t.type !== 'session')
  const revoke = async (token) => {
    const ok = await dialog.confirm({ title: '吊销设备', message: '该设备将无法再同步。确定吊销？', confirmText: '吊销', danger: true })
    if (!ok) return
    try {
      await api('/api/auth/tokens/revoke', { method: 'POST', body: { token } })
      showToast('已吊销')
      onUpdated?.()
    } catch (e) { showToast(e.message, false) }
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">我的账号</h2>
        <span className="px-2 py-0.5 rounded-full text-[11px] bg-blue-500/10 text-blue-300 border border-blue-500/20">{me.role === 'admin' ? '管理员' : '成员'}</span>
      </div>

      {/* 资料 */}
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-semibold text-white shrink-0" style={{ background: avatarColor }}>
          {(displayName || me.username).slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="昵称" className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs" />
            <div className="flex items-center gap-1">
              {AVATAR_COLORS.map(c => (
                <button key={c} onClick={() => setAvatarColor(c)} className={`h-5 w-5 rounded-full border-2 ${avatarColor === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">用户名 {me.username} · 最近登录 {me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
            <button onClick={saveProfile} disabled={savingProfile} className="px-3 py-1 rounded-md text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white">保存资料</button>
          </div>
        </div>
      </div>

      {/* 修改密码 */}
      <div className="pt-4 border-t border-zinc-800">
        <div className="text-[11px] text-zinc-500 mb-2">修改密码（修改后所有设备需重新登录）</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="原密码" autoComplete="current-password" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs" />
          <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="新密码（8 位以上）" autoComplete="new-password" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs" />
          <input type="password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} placeholder="确认新密码" autoComplete="new-password" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs" />
        </div>
        <button onClick={changePwd} disabled={savingPwd || !oldPwd || !newPwd} className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200">修改密码</button>
      </div>

      {/* 我的设备 */}
      <div className="pt-4 border-t border-zinc-800">
        <div className="text-[11px] text-zinc-500 mb-2">我的设备（{myTokens.length}）</div>
        {myTokens.length === 0 ? <div className="text-xs text-zinc-600 py-1">暂无已连接设备</div> : (
          <div className="space-y-1.5">
            {myTokens.map(t => (
              <div key={t.token} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <div className="min-w-0">
                  <div className="text-xs text-zinc-200">{t.label || '未命名设备'}</div>
                  <div className="text-[11px] text-zinc-500 font-mono">{t.tokenPreview} · {new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
                </div>
                <button onClick={() => revoke(t.token)} className="text-[11px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 shrink-0">吊销</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
