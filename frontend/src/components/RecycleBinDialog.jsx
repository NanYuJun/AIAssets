import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useDialog } from './DialogProvider'

const AGENT_LABEL = { codex: 'Codex', workbuddy: 'WorkBuddy', pi: 'Pi', gemini: 'Gemini', dsh: 'DSH' }

export default function RecycleBinDialog({ open, onClose, showToast, onChanged }) {
  const dialog = useDialog()
  const [items, setItems] = useState(null)
  const [view, setView] = useState('group') // group | flat
  const [collapsed, setCollapsed] = useState({})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const d = await api('/api/recycle-bin')
      setItems(d.items || [])
    } catch (e) { showToast(e.message, false); setItems([]) }
  }

  useEffect(() => { if (open) load() }, [open])

  const grouped = useMemo(() => {
    if (!items) return []
    const m = new Map()
    for (const it of items) {
      const key = it.agent
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(it)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [items])

  const fmtTime = (ts) => new Date(ts).toLocaleString('zh-CN', { hour12: false })
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(0) + ' KB' : b + ' B'

  const purgeOne = async (it) => {
    const ok = await dialog.confirm({ title: '彻底删除', message: '备份文件将永久删除，无法恢复。确定？', confirmText: '彻底删除', danger: true })
    if (!ok) return
    try {
      await api('/api/recycle-bin/' + encodeURIComponent(it.agent) + '/' + encodeURIComponent(it.file), { method: 'DELETE' })
      showToast('已彻底删除')
      await load()
      onChanged?.()
    } catch (e) { showToast(e.message, false) }
  }

  const purgeAgent = async (agent, list) => {
    const ok = await dialog.confirm({ title: '清空分组', message: `将彻底删除 ${AGENT_LABEL[agent] || agent} 下的 ${list.length} 个备份，无法恢复。确定？`, confirmText: '全部删除', danger: true })
    if (!ok) return
    setBusy(true)
    try {
      for (const it of list) {
        await api('/api/recycle-bin/' + encodeURIComponent(it.agent) + '/' + encodeURIComponent(it.file), { method: 'DELETE' })
      }
      showToast('分组已清空')
      await load()
      onChanged?.()
    } catch (e) { showToast(e.message, false) }
    setBusy(false)
  }

  const clearAll = async () => {
    const ok = await dialog.confirm({ title: '清空回收站', message: `将彻底删除全部 ${items?.length || 0} 个备份文件，无法恢复。确定？`, confirmText: '清空', danger: true })
    if (!ok) return
    setBusy(true)
    try {
      const d = await api('/api/recycle-bin', { method: 'DELETE' })
      showToast(`已清空 ${d.removed} 个备份`)
      await load()
      onChanged?.()
    } catch (e) { showToast(e.message, false) }
    setBusy(false)
  }

  if (!open) return null

  const ItemRow = ({ it }) => (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-zinc-200 font-mono truncate">{it.file}</div>
        <div className="text-[11px] text-zinc-500">{fmtSize(it.sizeBytes)} · 删除于 {fmtTime(it.deletedAt)}</div>
      </div>
      <button onClick={() => purgeOne(it)} className="text-[11px] px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 shrink-0">彻底删除</button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-zinc-200">回收站</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-400">{items?.length ?? '...'} 个备份</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
              <button onClick={() => setView('group')} className={`px-2.5 py-1 rounded-md text-[11px] ${view === 'group' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}>按分组</button>
              <button onClick={() => setView('flat')} className={`px-2.5 py-1 rounded-md text-[11px] ${view === 'flat' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}>平铺列表</button>
            </div>
            <button onClick={clearAll} disabled={busy || !items?.length} className="px-2.5 py-1 rounded-md text-[11px] bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white">清空</button>
            <button onClick={onClose} className="w-7 h-7 rounded-md hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-100">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {items === null ? <div className="text-xs text-zinc-500 py-4 text-center">加载中...</div>
            : items.length === 0 ? <div className="text-xs text-zinc-500 py-8 text-center">回收站为空</div>
            : view === 'flat' ? (
              <div className="space-y-1.5">
                {items.map((it, i) => <ItemRow key={i} it={it} />)}
              </div>
            ) : (
              <div className="space-y-2">
                {grouped.map(([agent, list]) => (
                  <div key={agent} className="rounded-lg border border-zinc-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/60">
                      <button onClick={() => setCollapsed(c => ({ ...c, [agent]: !c[agent] }))} className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                        <svg className={`w-3 h-3 transition-transform ${collapsed[agent] ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="m9 5 7 7-7 7" /></svg>
                        {AGENT_LABEL[agent] || agent}
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-800 text-zinc-400">{list.length} 个备份</span>
                      </button>
                      <button onClick={() => purgeAgent(agent, list)} disabled={busy} className="text-[11px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 disabled:opacity-40">清空分组</button>
                    </div>
                    {!collapsed[agent] && (
                      <div className="p-2 space-y-1.5">
                        {list.map((it, i) => <ItemRow key={i} it={it} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
