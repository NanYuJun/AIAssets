import { useEffect, useState } from 'react'
import { api, copyText } from '../lib/api'
import { useDialog } from '../components/DialogProvider'

export default function ShareManage({ showToast, globalLoading, setGlobalLoading }) {
  const dialog = useDialog()
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const d = await api('/api/shares')
      setShares(d.shares || [])
    } catch (e) { showToast(e.message, false) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const statusBadge = (s) => {
    const expired = Date.now() > s.expiresAt
    if (s.revoked) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20">已撤销</span>
    if (expired) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-500 border border-zinc-700">已过期</span>
    return <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">生效中</span>
  }

  const copyLink = async (s) => {
    let url = location.origin + '/s/' + s.shareId
    if (s.hasAccessCode) {
      const code = await dialog.prompt({ title: '复制分享链接', message: '此分享设置了访问码，输入以拼入链接（留空则复制不带码的链接）', placeholder: '访问码', confirmText: '复制' })
      if (code === null) return
      if (code.trim()) url += `?code=${encodeURIComponent(code.trim())}`
    }
    const copied = await copyText(url)
    showToast(copied ? '链接已复制：' + url : '复制失败，请手动复制：' + url, copied)
  }

  const revoke = async (s) => {
    const ok = await dialog.confirm({ title: '撤销分享', message: `确定撤销分享 /s/${s.shareId}？撤销后立即失效，不可恢复。`, confirmText: '撤销', danger: true })
    if (!ok) return
    setGlobalLoading(true)
    try {
      await api(`/api/shares/${s.shareId}/revoke`, { method: 'POST' })
      showToast('分享已撤销')
      await load()
    } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center gap-2.5">
        <h2 className="text-sm font-semibold text-zinc-200">分享管理</h2>
        <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-400">{shares.length} 条</span>
      </div>
      <div className="p-4 space-y-2 max-h-[calc(100vh-230px)] overflow-y-auto">
        {loading ? <div className="text-center py-16 text-zinc-500 text-xs">加载中...</div>
          : shares.length === 0 ? <div className="text-center py-16 text-zinc-500 text-xs">还没有创建过分享。在会话资产页勾选会话后点「分享」创建。</div>
          : shares.map(s => (
            <div key={s.shareId} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                  <span className="font-mono">/s/{s.shareId}</span>
                  {statusBadge(s)}
                </div>
                <div className="text-[11px] text-zinc-300 mt-1 truncate" title={s.sessionTitles?.join('；')}>
                  {s.sessionCount === 1
                    ? (s.sessionTitles?.[0] || '未知会话')
                    : `${s.sessionTitles?.[0] || '未知会话'} 等 ${s.sessionCount} 个会话`}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {s.allowImport ? '可导入' : '仅查看'}{s.hasAccessCode ? ' · 有访问码' : ''} · {s.revoked ? '已撤销' : '有效期至 ' + new Date(s.expiresAt).toLocaleString('zh-CN', { hour12: false })}{s.source?.startsWith('collection:') ? ` · 来自会话集「${s.source.slice(10)}」` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!s.revoked && <button onClick={() => copyLink(s)} className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300">复制链接</button>}
                {!s.revoked && <button onClick={() => revoke(s)} className="text-[11px] px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30">撤销</button>}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}
