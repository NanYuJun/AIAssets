import { useEffect, useState } from 'react'
import { api, copyText } from '../lib/api'
import { useDialog } from '../components/DialogProvider'
import { SessionPreviewModal } from '../components/SessionShared'

export default function Collections({ showToast, globalLoading, setGlobalLoading }) {
  const dialog = useDialog()
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [collections, setCollections] = useState([])
  const [detail, setDetail] = useState(null)
  const [detailSessions, setDetailSessions] = useState([])
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const d = await api('/api/collections')
      setCollections(d.collections || [])
    } catch (e) { showToast(e.message, false) } finally { setLoading(false) }
  }
  useEffect(() => {
    load()
    const h = () => load()
    window.addEventListener('collections-changed', h)
    return () => window.removeEventListener('collections-changed', h)
  }, [])

  const openDetail = async (c) => {
    setDetail(c)
    setDetailSessions([])
    const results = await Promise.all(c.sessionIds.map(id => api('/api/sessions/detail/' + id).catch(() => null)))
    setDetailSessions(results.map((r, i) => r?.session ? r.session : { id: c.sessionIds[i], title: c.sessionIds[i], events: [] }))
  }

  const syncIcon = (s) => {
    if (s.metadata && s.metadata.shareOrigin) {
      return <span title={`朋友分享导入（/s/${s.metadata.shareOrigin.shareId}）`} className="shrink-0 inline-flex items-center">
        <svg className="w-4 h-4 text-fuchsia-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>
      </span>
    }
    return <span title="已上云 / 仅云端" className="shrink-0 inline-flex items-center">
      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" /></svg>
    </span>
  }

  const removeItem = async (sessionId) => {
    const ok = await dialog.confirm({ title: '从会话集移除', message: '仅将会话从此会话集中移除，不会删除会话资产本身。', confirmText: '移除', danger: true })
    if (!ok) return
    try {
      await api(`/api/collections/${detail.id}/items/${sessionId}`, { method: 'DELETE' })
      showToast('已从会话集移除')
      await openDetail(detail)
    } catch (e) { showToast(e.message, false) }
  }

  const shareCollection = async (c) => {
    try {
      const d = await api(`/api/collections/${c.id}/share`, { method: 'POST', body: { expiresAt: Date.now() + 7 * 86400000 } })
      const url = location.origin + d.url
      const copied = await copyText(url)
      showToast(copied ? '分享链接已复制：' + url : '分享已创建，请手动复制：' + url, copied)
    } catch (e) { showToast(e.message, false) }
  }

  const removeCollection = async (c) => {
    const ok = await dialog.confirm({ title: '删除会话集', message: `确定删除会话集「${c.name}」？该操作不可恢复。`, confirmText: '删除', danger: true })
    if (!ok) return
    setGlobalLoading(true)
    try {
      await api('/api/collections/' + c.id, { method: 'DELETE' })
      showToast('已删除')
      if (detail?.id === c.id) setDetail(null)
      await load()
    } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center gap-2.5">
        {detail && <button onClick={() => setDetail(null)} className="text-zinc-400 hover:text-zinc-100 text-xs">← 返回</button>}
        <h2 className="text-sm font-semibold text-zinc-200">{detail ? `会话集 · ${detail.name}` : '会话集'}</h2>
        {!detail && <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-400">{collections.length} 个</span>}
      </div>
      <div className="p-4 space-y-2 max-h-[calc(100vh-230px)] overflow-y-auto">
        {loading ? <div className="text-center py-16 text-zinc-500 text-xs">加载中...</div>
          : detail ? (
            detailSessions.map(s => (
              <div key={s.id} className="group flex items-start gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 transition-all">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-xs font-semibold text-zinc-200 truncate">{s.title || s.id}</div>
                    {s.metadata && s.metadata.shareOrigin && <span title={`朋友分享导入（/s/${s.metadata.shareOrigin.shareId}）`} className="shrink-0 inline-flex items-center">
                      <svg className="w-4 h-4 text-fuchsia-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>
                    </span>}
                    {!(s.metadata && s.metadata.shareOrigin) && <span title="已上云 / 仅云端" className="shrink-0 inline-flex items-center">
                      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" /></svg>
                    </span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${s.sourceAgent === 'workbuddy' ? 'bg-purple-500/15 text-purple-400 border-purple-500/30' : s.sourceAgent === 'pi' ? 'bg-orange-500/15 text-orange-400 border-orange-500/30' : 'bg-blue-500/15 text-blue-400 border-blue-500/30'}`}>{s.sourceAgent === 'workbuddy' ? 'WorkBuddy' : s.sourceAgent === 'pi' ? 'Pi' : 'Codex'}</span>
                    <span className="text-[11px] text-zinc-400">{(s.events || s.messages || []).filter(e => e.kind === 'message').length} 消息</span>
                    <span className="text-[11px] text-zinc-400">{(s.events || []).filter(e => e.kind === 'tool_call').length} 工具</span>
                    <span className="text-[11px] text-zinc-500">{new Date(s.updatedAt).toLocaleDateString()}</span>
                    {s.project?.name && <span className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-300">{s.project.name}</span>}
                  </div>
                </div>
                <button onClick={() => setPreview(s)} className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-all shrink-0">预览</button>
                <button onClick={() => removeItem(s.id)} className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all shrink-0">移除</button>
              </div>
            ))
          ) : collections.length === 0 ? (
            <div className="text-center py-16 text-zinc-500 text-xs">还没有会话集。在会话资产页勾选会话后点「加入会话集」创建。</div>
          ) : collections.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 transition-colors">
              <button onClick={() => openDetail(c)} className="min-w-0 flex-1 text-left">
                <div className="text-xs font-semibold text-zinc-200">{c.name}</div>
                <div className="text-[11px] text-zinc-500">{c.sessionIds.length} 个会话 · 更新于 {new Date(c.updatedAt).toLocaleString('zh-CN', { hour12: false })}</div>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => shareCollection(c)} className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30">分享</button>
                <button onClick={() => { location.href = `/api/collections/${c.id}/export-zip` }} className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700">导出 zip</button>
                <button onClick={() => removeCollection(c)} className="text-[11px] px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30">删除</button>
              </div>
            </div>
          ))
        }
      </div>
      {preview && <SessionPreviewModal session={preview} onClose={() => setPreview(null)} />}
    </div>
  )}
