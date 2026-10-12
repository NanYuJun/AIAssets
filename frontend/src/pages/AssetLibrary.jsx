import { useEffect, useMemo, useState } from 'react'
import { api, copyText } from '../lib/api'
import { useDialog } from '../components/DialogProvider'
import RecycleBinDialog from '../components/RecycleBinDialog'

const AGENT_LABELS = { codex: 'Codex', workbuddy: 'WorkBuddy', pi: 'Pi', gemini: 'Gemini', dsh: 'DSH', claude: 'Claude', zcode: 'ZCode', opencode: 'OpenCode', grok: 'Grok', cursor: 'Cursor' }
const AGENT_STYLES = {
  codex: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  workbuddy: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  pi: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  gemini: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  dsh: 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  claude: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  zcode: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  opencode: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  grok: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  cursor: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
}

const genAccessCode = () => Array.from({ length: 6 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('')

export default function AssetLibrary({ showToast, refreshKey, onRefresh, isGuest, globalLoading, setGlobalLoading }) {
  const dialog = useDialog()
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [pullDialogOpen, setPullDialogOpen] = useState(false)
  const [pullAgent, setPullAgent] = useState('workbuddy')
  const [pullPath, setPullPath] = useState('')
  const [pullCount, setPullCount] = useState(0)
  const [pullLoading, setPullLoading] = useState(false)
  const [pullProjects, setPullProjects] = useState([])
  const [pullProjectsStatus, setPullProjectsStatus] = useState('')
  const [sessions, setSessions] = useState([])
  const [cloud, setCloud] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [agentFilter, setAgentFilter] = useState('all')
  const [view, setView] = useState('group')
  const [expanded, setExpanded] = useState(new Set())
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [local, cloudData] = await Promise.all([
        api('/api/sessions/local'),
        api('/api/sessions/cloud')
      ])
      setSessions(local.items || [])
      setCloud(cloudData.items || [])
    } catch (e) {
      showToast(e.message, false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [refreshKey])

  const unified = useMemo(() => {
    const cloudById = new Map(cloud.map(s => [s.id, s]))
    const localById = new Map()
    for (const s of sessions) {
      const existing = localById.get(s.id)
      if (!existing) {
        localById.set(s.id, { ...s, localAgents: [s.agent] })
      } else {
        if (!existing.localAgents.includes(s.agent)) existing.localAgents.push(s.agent)
        if ((s.updatedAt || 0) > (existing.updatedAt || 0)) {
          Object.assign(existing, s, { localAgents: existing.localAgents })
        }
      }
    }
    const merged = [...localById.values()].map(s => {
      const c = cloudById.get(s.id)
      if (c) cloudById.delete(s.id)
      return { ...s, projectName: s.projectName || c?.projectName || '' , agents: [...new Set([...s.localAgents, ...(c?.sourceAgent ? [c.sourceAgent] : [])])], isLocal: true, isCloud: !!c, shareOrigin: c?.shareOrigin || null, originalCwd: s.cwd || c?.originalCwd || '' }
    })
    for (const c of cloudById.values()) {
      merged.push({ id: c.id, agent: c.sourceAgent || 'codex', title: c.title, originalCwd: c.originalCwd || '', projectName: c.projectName, messageCount: c.messageCount, toolCallCount: c.toolCallCount, updatedAt: c.updatedAt || c.createdAt, agents: [c.sourceAgent || 'codex'], isLocal: false, isCloud: true, shareOrigin: c.shareOrigin || null })
    }
    return merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }, [sessions, cloud])

  const filtered = useMemo(() => {
    let list = unified
    if (agentFilter !== 'all') list = list.filter(s => s.agents.includes(agentFilter))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(s => (s.title || '').toLowerCase().includes(q) || (s.projectName || '').toLowerCase().includes(q))
    return list
  }, [unified, agentFilter, search])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) { setSearchResults(null); return }
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const d = await api('/api/sessions/search?q=' + encodeURIComponent(q))
        setSearchResults(d.results || [])
      } catch { setSearchResults(null) } finally { setSearchLoading(false) }
    }, 600)
    return () => clearTimeout(timer)
  }, [search])

  const groups = useMemo(() => {
    const g = {}
    for (const s of filtered) {
      const p = s.projectName || '未分类'
      ;(g[p] = g[p] || []).push(s)
    }
    return g
  }, [filtered])

  const toggleSelect = (id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleSelectAll = () => {
    const ids = filtered.map(s => s.id)
    const all = ids.every(id => selected.has(id))
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => all ? n.delete(id) : n.add(id)); return n })
  }
  const selectedAssets = unified.filter(s => selected.has(s.id))

  const pushSelected = async () => {
    const ids = selectedAssets.filter(s => s.isLocal).map(s => s.id)
    if (!ids.length) return showToast('所选内容中没有可上传的本地会话', false)
    setGlobalLoading(true)
    try {
      const d = await api('/api/sessions/push', { method: 'POST', body: { sessionIds: ids } })
      showToast(`成功将 ${d.count} 个会话推送到云端`)
      setSelected(new Set()); await load()
    } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
  }

  const removeSharedFromCloud = async (s) => {
    setDeleteTarget({ type: 'cloud', session: s })
  }

  const deleteLocal = (s, agent) => {
    setDeleteTarget({ type: 'local', session: s, agent })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const { type, session: s, agent } = deleteTarget
    setGlobalLoading(true)
    try {
      if (type === 'cloud') {
        await api(`/api/sessions/cloud/${encodeURIComponent(s.id)}`, { method: 'DELETE' })
        showToast('已从云端移除')
      } else {
        const d = await api(`/api/sessions/local/${encodeURIComponent(s.id)}?agent=${agent}`, { method: 'DELETE' })
        showToast(`已删除 ${AGENT_LABELS[agent]} 本地会话（已备份）`)
      }
      setDeleteTarget(null)
      setSelected(new Set())
      await load()
    } catch (e) {
      showToast(e.message, false)
    } finally {
      setGlobalLoading(false)
    }
  }
  const pullSelected = async () => {
    if (!selectedAssets.length) return showToast('请至少勾选一个会话', false)
    const ids = selectedAssets.map(s => s.id)
    const agents = new Set(selectedAssets.flatMap(s => s.agents))
    const known = ['codex', 'workbuddy', 'pi', 'gemini', 'dsh']
    const missing = known.filter(a => !agents.has(a))
    const preferred = missing.length === known.length - 1 ? missing[0] : 'workbuddy'
    window.__pendingPullIds = ids
    setPullAgent(preferred); setPullCount(ids.length); setPullPath('')
    setPullDialogOpen(true)
    loadPullProjects(preferred)
  }
  const saveRecentProject = (agent, p) => {
    try {
      const store = JSON.parse(localStorage.getItem('recent-projects') || '{}')
      const list = store[agent] || []
      const next = [p, ...list.filter(x => x !== p)].slice(0, 5)
      store[agent] = next
      localStorage.setItem('recent-projects', JSON.stringify(store))
    } catch {}
  }
  const getRecentProjects = (agent) => {
    try { return JSON.parse(localStorage.getItem('recent-projects') || '{}')[agent] || [] } catch { return [] }
  }
  const confirmPull = async () => {
    if (!pullPath.trim()) return
    setPullLoading(true)
    try {
      const d = await api('/api/sessions/pull', { method: 'POST', body: { sessionIds: window.__pendingPullIds, targetAgent: pullAgent, targetProjectRoot: pullPath.trim() } })
      saveRecentProject(pullAgent, pullPath.trim())
      showToast(`已同步 ${d.count} 个会话到 ${AGENT_LABELS[pullAgent]}`)
      setPullDialogOpen(false)
      setSelected(new Set()); await load()
    } catch (e) { showToast(e.message, false) } finally { setPullLoading(false) }
  }
  const loadPullProjects = async (agent) => {
    setPullProjects([])
    setPullProjectsStatus('正在实时读取项目...')
    try {
      const d = await api('/api/projects?agent=' + encodeURIComponent(agent) + '&ts=' + Date.now())
      setPullProjects(d.projects || [])
      setPullProjectsStatus('实时读取 '+d.projects.length+' 个项目')
    } catch (e) {
      setPullProjectsStatus('项目读取失败，可手动输入路径：'+e.message)
    }
  }
  const shareSelected = async () => {
    if (!selectedAssets.length) return showToast('请先勾选会话', false)
    const code = await dialog.prompt({ title: '分享选中的会话', message: `将创建包含 ${selectedAssets.length} 个会话的分享链接（7 天有效，50 次查看上限）。访问码：`, placeholder: '访问码（留空自动生成）', confirmText: '生成分享' })
    if (code === null) return
    const accessCode = code.trim() || genAccessCode()
    setGlobalLoading(true)
    try {
      const d = await api('/api/shares', { method: 'POST', body: { sessionIds: selectedAssets.map(s => s.id), expiresAt: Date.now() + 7 * 86400000, accessCode, maxViews: 50, allowImport: true } })
      const url = location.origin + d.url + `?code=${encodeURIComponent(accessCode)}`
      const copied = await copyText(url)
      showToast((copied ? '分享链接已复制（含访问码）：' : '分享已创建：') + url, true)
    } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
  }
  
  const shareSingle = async (s) => {
    const code = await dialog.prompt({ title: '分享此会话', message: (s.title || '').slice(0, 40) + '（7 天有效，50 次查看上限）', placeholder: '访问码（留空自动生成）', confirmText: '生成分享' })
    if (code === null) {
      showToast('已取消分享')
      return
    }
    const accessCode = code.trim() || genAccessCode()
    setGlobalLoading(true)
    try {
      const d = await api('/api/shares', { method: 'POST', body: { sessionIds: [s.id], expiresAt: Date.now() + 7 * 86400000, accessCode, maxViews: 50, allowImport: true } })
      const url = location.origin + d.url + `?code=${encodeURIComponent(accessCode)}`
      const copied = await copyText(url)
      
      showToast(copied ? '单会话分享链接已复制：' + url : '分享已创建，链接：' + url, true)
    } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
  }
  const createCollection = async () => {
    if (!selectedAssets.length) return showToast('请先勾选会话', false)
    const name = await dialog.prompt({ title: '创建会话集', message: `将把 ${selectedAssets.length} 个勾选的会话加入新会话集`, placeholder: '会话集名称', confirmText: '创建' })
    if (!name?.trim()) return
    setGlobalLoading(true)
    try {
      const d = await api('/api/collections', { method: 'POST', body: { name: name.trim(), sessionIds: selectedAssets.map(s => s.id) } })
      showToast(`已创建会话集「${d.collection.name}」`)
      setSelected(new Set())
      window.dispatchEvent(new Event('collections-changed'))
    } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
  }
  const openPreview = async (id) => {
    try {
      const d = await api('/api/sessions/detail/' + id)
      setPreview(d.session)
    } catch (e) { showToast(e.message, false) }
  }
  const exportMd = async (s) => {
    try {
      const d = await api('/api/sessions/export-md/' + encodeURIComponent(s.id))
      const blob = new Blob([d.markdown], { type: 'text/markdown;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = d.filename
      a.click()
      URL.revokeObjectURL(a.href)
      showToast('已导出：' + d.filename)
    } catch (e) { showToast(e.message, false) }
  }

  const syncIcon = (s) => {
    if (s.shareOrigin) {
      return <span title={`朋友分享导入（/s/${s.shareOrigin.shareId}）`} className="shrink-0 inline-flex items-center">
        <svg className="w-4 h-4 text-fuchsia-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8.25c0-.207-.012-.412-.036-.615m-16.464 3.72 7.423 7.423c.39.39 1.024.39 1.414 0l7.423-7.423M18 8.25A4.5 4.5 0 0 0 4.5 8.25m13.5 0c0 .206-.014.41-.04.612M4.5 8.25c0 .206.014.41.04.612m0 0a4.498 4.498 0 0 0 6.366 5.492L12 15.75l1.094-1.396a4.498 4.498 0 0 0 6.366-5.492" /></svg>
      </span>
    }
    if (s.isCloud) {
      return <span title="已上云 / 仅云端" className="shrink-0 inline-flex items-center">
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" /></svg>
      </span>
    }
    return null
  }

  const renderSession = (s) => (
    <div key={s.id} className="group flex items-start gap-3 p-3 rounded-lg bg-zinc-900/60 hover:bg-zinc-850 border border-zinc-800/80 hover:border-zinc-700/80 transition-all">
      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-blue-500 cursor-pointer" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs font-semibold text-zinc-200 truncate">{s.title || '（未命名会话）'}</div>
          {s.shareOrigin && <span title={`朋友分享导入（/s/${s.shareOrigin.shareId}）`} className="shrink-0 inline-flex items-center">
            <svg className="w-4 h-4 text-fuchsia-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>
          </span>}
          {s.isCloud && <span title="已上云 / 仅云端" className="shrink-0 inline-flex items-center">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" /></svg>
          </span>}
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[11px] text-zinc-400">{s.messageCount} 消息</span>
          <span className="text-[11px] text-zinc-400">{s.toolCallCount} 工具</span>
          <span className="text-[11px] text-zinc-500">{new Date(s.updatedAt).toLocaleDateString()}</span>
          {s.agents.map(a => <span key={a} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${AGENT_STYLES[a] || AGENT_STYLES.codex}`}>{AGENT_LABELS[a] || a}</span>)}
          {view === 'flat' && <span className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-300">{s.projectName || '未分类'}</span>}
        </div>
      </div>
      <button onClick={() => openPreview(s.id)} className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-all shrink-0">预览</button>
      {!isGuest && (<>
      <button onClick={() => shareSingle(s)} className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-all shrink-0">分享</button>
      <button onClick={() => exportMd(s)} title="导出为 Markdown" className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-all shrink-0">导出</button>
      <button onClick={() => setDeleteTarget({ type: 'multi', session: s })} title="删除会话" className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all shrink-0">删除</button>
      </>)}
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 sm:px-5 py-4 border-b border-zinc-800/80 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 bg-zinc-900/30">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-zinc-200">会话仓库</h2>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-400" title="合并去重后的总数（本地+云端同 ID 只算一条）· 本地=本机各 Agent 会话文件数 · 云端=Hub 备份数">{filtered.length} 项（去重后） · 本地副本 {sessions.length} · 云端备份 {cloud.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isGuest && (<button onClick={() => setRecycleOpen(true)} title="回收站" className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 inline-flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            回收站
          </button>)}
          <button onClick={onRefresh} disabled={globalLoading} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5">
            {globalLoading ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
            刷新数据
          </button>
          {!isGuest && (<input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标题或项目..." className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs w-44" />)}
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
            {['all', 'codex', 'workbuddy', 'claude', 'pi', 'gemini', 'dsh', 'zcode', 'opencode', 'grok', 'cursor'].map(a => (
              <button key={a} onClick={() => setAgentFilter(a)} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${agentFilter === a ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400 hover:text-zinc-200'}`}>{a === 'all' ? '全部' : AGENT_LABELS[a]}</button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
            {[['group', '按项目分组'], ['flat', '平铺列表']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${view === v ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400 hover:text-zinc-200'}`}>{label}</button>
            ))}
          </div>
          {view === 'group' && (
            <button onClick={() => {
              const projects = Object.keys(groups)
              const allExpanded = projects.length > 0 && projects.every(p => expanded.has(p))
              setExpanded(allExpanded ? new Set() : new Set(projects))
            }} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800">
              {Object.keys(groups).length > 0 && Object.keys(groups).every(p => expanded.has(p)) ? '全部折叠' : '全部展开'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {searchResults !== null && search.trim().length >= 2 ? (
          <div className="space-y-2">
            <div className="text-[11px] text-zinc-500">全文搜索：{searchLoading ? '搜索中...' : `命中 ${searchResults.length} 条（最多显示 30 条）`}</div>
            {searchResults.map(r => (
              <div key={r.id} className="group flex items-start gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 transition-all cursor-pointer" onClick={() => openPreview(r.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-zinc-200 truncate">{r.title}</div>
                  <div className="text-[11px] text-zinc-400 mt-1 line-clamp-2 bg-zinc-950/60 rounded p-1.5 border-l-2 border-brand-500/50">…{r.snippet}…</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${AGENT_STYLES[r.sourceAgent] || AGENT_STYLES.codex}`}>{AGENT_LABELS[r.sourceAgent] || r.sourceAgent}</span>
                    <span className="text-[11px] text-zinc-500">{r.projectName}</span>
                    <span className="text-[11px] text-zinc-500">{new Date(r.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
            {!searchLoading && searchResults.length === 0 && <div className="text-center py-16 text-zinc-500 text-xs">正文中未找到“{search}”</div>}
          </div>
        ) : loading ? <div className="text-center py-16 text-zinc-500 text-xs">加载中...</div>
          : view === 'flat'
            ? filtered.map(renderSession)
            : Object.entries(groups).map(([project, items]) => (
              <div key={project} className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
                <div className="px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <input type="checkbox" checked={items.every(i => selected.has(i.id))} onChange={e => items.forEach(i => { if (e.target.checked !== selected.has(i.id)) toggleSelect(i.id) })} className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-blue-500 cursor-pointer" />
                    <span className="text-xs font-semibold text-zinc-200">{project}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-800 text-zinc-400">{items.length} 个会话</span>
                  </div>
                  <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(project) ? n.delete(project) : n.add(project); return n })} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800">
                    {expanded.has(project) ? '折叠' : '展开'}
                  </button>
                </div>
                {expanded.has(project) && <div className="p-3 space-y-2 bg-zinc-950/20">{items.map(renderSession)}</div>}
              </div>
            ))}
      </div>

      <div className="px-4 sm:px-5 py-3.5 border-t border-zinc-800/80 bg-zinc-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <span className="text-xs text-zinc-400">已选择 {selected.size} 项 · 可上传 {selectedAssets.filter(s => s.isLocal).length} · 可同步 {selectedAssets.length}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={toggleSelectAll} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800">全选/反选</button>
          {!isGuest && (<>
          <button onClick={shareSelected} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800">分享</button>
          <button onClick={createCollection} className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700">加入会话集</button>
          <button onClick={pushSelected} disabled={globalLoading} className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 inline-flex items-center gap-2">
            {globalLoading && <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
            同步云端
          </button>
          </>)}
          <button onClick={pullSelected} disabled={globalLoading} className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 inline-flex items-center gap-2">
            {globalLoading && <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
            同步/迁移本地
          </button>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setPreview(null) }}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100 truncate">{preview.title}</h3>
              <button onClick={() => setPreview(null)} className="text-zinc-400 hover:text-zinc-100 px-2">关闭</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {(preview.events || []).map(ev => ev.kind === 'message'
                ? <div key={ev.id}><div className="text-[11px] text-zinc-500 mb-1">{ev.role === 'user' ? '用户' : '助手'}</div><div className={`rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap ${ev.role === 'user' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-950 border-blue-500/25 md-content'}`} dangerouslySetInnerHTML={{ __html: ev.role === 'user' ? ev.content : (window.marked ? marked.parse(ev.content || '') : ev.content) }} /></div>
                : ev.kind === 'tool_call'
                  ? <div key={ev.id}><div className="text-[11px] text-yellow-400/80 mb-1">[工具] {ev.name}</div><div className="rounded-lg border border-yellow-500/20 bg-zinc-950 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{(() => { try { const p = JSON.parse(ev.arguments); return p.command || p.cmd || ev.arguments } catch { return ev.arguments } })()}</div></div>
                  : ev.kind === 'tool_result'
                    ? <div key={ev.id} className="rounded-lg border border-yellow-500/20 bg-zinc-950 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{(ev.output || '').slice(0, 500)}</div>
                    : null
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (() => {
        const s = deleteTarget.session
        if (deleteTarget.type === 'multi') {
          const targets = []
          if (s.isCloud) targets.push({ key: 'cloud', label: '云端 Hub 备份' })
          ;(s.localAgents || s.agents || []).filter(a => s.isLocal).forEach(a => targets.push({ key: 'local:' + a, label: AGENT_LABELS[a] + ' 本地会话' }))
          const toggle = (key) => setDeleteTarget(d => ({ ...d, selected: { ...d.selected, [key]: !d.selected?.[key] } }))
          const anySelected = targets.some(t => deleteTarget.selected?.[t.key])
        const handleMultiDelete = async () => {
          setGlobalLoading(true)
          try {
            const tasks = []
            for (const t of targets) {
              if (!deleteTarget.selected?.[t.key]) continue
              if (t.key === 'cloud') tasks.push(api('/api/sessions/cloud/' + encodeURIComponent(s.id), { method: 'DELETE' }))
              else tasks.push(api('/api/sessions/local/' + encodeURIComponent(s.id) + '?agent=' + t.key.split(':')[1], { method: 'DELETE' }))
            }
            await Promise.all(tasks)
            showToast('删除完成')
            setDeleteTarget(null)
            setSelected(new Set())
            await load()
          } catch (e) { showToast(e.message, false) } finally { setGlobalLoading(false) }
        }
          return (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6">
                <h3 className="text-sm font-semibold text-zinc-100 mb-2">删除会话</h3>
                <p className="text-xs text-zinc-400 mb-3">会话：{s.title || '（未命名会话）'}</p>
                <div className="space-y-2 mb-4">
                  {targets.map(t => (
                    <label key={t.key} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 cursor-pointer">
                      <input type="checkbox" checked={!!deleteTarget.selected?.[t.key]} onChange={() => toggle(t.key)} className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-rose-500" />
                      <span className="text-xs text-zinc-200">{t.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-rose-300 mb-1">删除本地会话前会自动备份到 deleted-backups 目录。</p>
                <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
                  <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800/60">取消</button>
                  <button disabled={!anySelected || globalLoading} onClick={handleMultiDelete} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white">确认删除</button>
                </div>
              </div>
            </div>
          )
        }
        const isCloud = deleteTarget.type === 'cloud'
        const agentLabel = isCloud ? null : AGENT_LABELS[deleteTarget.agent]
        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6">
              <h3 className="text-sm font-semibold text-zinc-100 mb-2">确认删除</h3>
              <p className="text-xs text-zinc-400 leading-relaxed mb-1">会话：{s.title || '（未命名会话）'}</p>
              {isCloud
                ? <p className="text-xs text-rose-300 mb-4">将从云端 Hub 删除该会话备份，朋友将无法再通过导入获取它。本地会话不受影响。</p>
                : <p className="text-xs text-rose-300 mb-4">将删除 {agentLabel} 中的本地会话文件。删除前会自动备份到 Hub 的 deleted-backups 目录，可通过文件系统恢复。</p>}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
                <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800/60">取消</button>
                <button onClick={confirmDelete} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white">确认删除</button>
              </div>
            </div>
          </div>
        )
      })()}

      {pullDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setPullDialogOpen(false) }}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6">
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">同步到本地 Agent</h3>
            <p className="text-xs text-zinc-400 mb-4">将 {pullCount} 个会话注入到 {AGENT_LABELS[pullAgent]}，会话内路径将自动重写到目标项目路径。</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-300 mb-1.5">目标 Agent</label>
                <select value={pullAgent} onChange={e => { setPullAgent(e.target.value); loadPullProjects(e.target.value) }} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100">
                  {['workbuddy', 'codex', 'pi', 'gemini', 'dsh'].map(a => <option key={a} value={a}>{AGENT_LABELS[a]}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-xs text-zinc-300">目标项目分组</label>
                  <button type="button" onClick={() => loadPullProjects(pullAgent)} className="text-[11px] text-zinc-400 hover:text-zinc-100">重新读取</button>
                </div>
                <select value={pullProjects.some(p => p.path === pullPath) ? pullPath : '__custom__'} onChange={e => setPullPath(e.target.value === '__custom__' ? '' : e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100">
                  {pullProjects.map(p => <option key={p.path} value={p.path}>{p.label} ({p.path}){p.exists === false ? ' · 路径不存在' : ''}</option>)}
                  {getRecentProjects(pullAgent).filter(p => !pullProjects.some(pp => pp.path === p)).map(p => <option key={'recent-' + p} value={p}>{p}（最近使用）</option>)}
                  <option value="__custom__">自定义路径...</option>
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">{pullProjectsStatus}</p>
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1.5">目标项目路径（可自定义 / 跨设备路径）</label>
                <input autoFocus value={pullPath} onChange={e => setPullPath(e.target.value)} placeholder="如 E:/cobazaar/1Ton" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-brand-500" onKeyDown={e => { if (e.key === 'Enter' && pullPath.trim() && !pullLoading) confirmPull() }} />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-4">
              <button onClick={() => setPullDialogOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800/60">取消</button>
              <button onClick={confirmPull} disabled={!pullPath.trim() || pullLoading} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white">{pullLoading ? '同步中...' : '确认同步'}</button>
            </div>
          </div>
        </div>
      )}

      <RecycleBinDialog open={recycleOpen} onClose={() => setRecycleOpen(false)} showToast={showToast} onChanged={onRefresh} />
    </div>
  )
}
