import { useState } from 'react'
import { api } from '../lib/api'
import { useDialog } from '../components/DialogProvider'

export default function UserAdminSection({ auth, users, isAdmin, onUpdated, showToast }) {
  const dialog = useDialog()
  const me = auth?.me
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('member')

  if (!isAdmin) return null

  const addUser = async () => {
    try {
      await api('/api/auth/users', { method: 'POST', body: { username: newUsername, password: newPassword, role: newRole } })
      showToast('用户 ' + newUsername + ' 已创建')
      setNewUsername(''); setNewPassword(''); setNewRole('member')
      onUpdated?.()
    } catch (e) { showToast(e.message, false) }
  }

  const removeUser = async (userId, username) => {
    const ok = await dialog.confirm({ title: '删除用户', message: '将删除用户 ' + username + ' 并吊销其全部 Token。确定继续？', confirmText: '删除', danger: true })
    if (!ok) return
    try {
      await api('/api/auth/users', { method: 'DELETE', body: { userId } })
      showToast('已删除用户 ' + username)
      onUpdated?.()
    } catch (e) { showToast(e.message, false) }
  }

  const resetPwd = async (userId, username) => {
    const np = await dialog.prompt({ title: '重置密码', message: '为 ' + username + ' 设置新密码（至少 8 位）', placeholder: '新密码' })
    if (np === null || np === undefined) return
    try {
      await api('/api/auth/users/password', { method: 'POST', body: { userId, newPassword: np } })
      showToast('密码已重置')
    } catch (e) { showToast(e.message, false) }
  }

  const toggleStatus = async (u) => {
    const target = u.status === 'disabled' ? 'active' : 'disabled'
    const ok = await dialog.confirm({
      title: target === 'disabled' ? '禁用账号' : '启用账号',
      message: target === 'disabled' ? '禁用后 ' + u.username + ' 将无法登录，且其所有设备被吊销。确定？' : '恢复 ' + u.username + ' 的登录权限？',
      confirmText: target === 'disabled' ? '禁用' : '启用',
      danger: target === 'disabled'
    })
    if (!ok) return
    try {
      await api('/api/auth/users/status', { method: 'POST', body: { userId: u.id, status: target } })
      showToast(target === 'disabled' ? '已禁用' : '已启用')
      onUpdated?.()
    } catch (e) { showToast(e.message, false) }
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-200">用户管理</h2>
        <span className="text-[11px] text-zinc-500">{users.length} 个账号</span>
      </div>
      <div className="space-y-1.5 mb-4">
        {users.map(u => (
          <div key={u.id} className={`flex items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 ${u.status === 'disabled' ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0" style={{ background: u.avatarColor || '#3f3f46' }}>
                {(u.displayName || u.username).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-zinc-200">{u.displayName || u.username} <span className="text-zinc-500 font-normal">({u.username})</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-1.5 ${u.role === 'admin' ? 'bg-blue-500/10 text-blue-300' : 'bg-zinc-800 text-zinc-400'}`}>{u.role === 'admin' ? '管理员' : '成员'}</span>
                  {u.status === 'disabled' && <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-1 bg-rose-500/10 text-rose-300">已禁用</span>}
                </div>
                <div className="text-[11px] text-zinc-500">最近登录 {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '从未'}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => toggleStatus(u)} className="text-[11px] px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200">{u.status === 'disabled' ? '启用' : '禁用'}</button>
              <button onClick={() => resetPwd(u.id, u.username)} className="text-[11px] px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200">重置密码</button>
              {u.id !== me?.userId && <button onClick={() => removeUser(u.id, u.username)} className="text-[11px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30">删除</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-zinc-800">
        <div className="text-[11px] text-zinc-500 mb-2">添加用户</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="用户名" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs" />
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="密码（8 位以上）" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs" />
          <select value={newRole} onChange={e => setNewRole(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="member">成员（member）</option>
            <option value="admin">管理员（admin）</option>
          </select>
        </div>
        <button onClick={addUser} disabled={newUsername.trim().length < 2 || newPassword.length < 8} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white">+ 添加用户</button>
      </div>
    </div>
  )
}
