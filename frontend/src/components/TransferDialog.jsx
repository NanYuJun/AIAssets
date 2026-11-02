import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

const AGENT_LABELS = { codex: 'Codex', workbuddy: 'WorkBuddy', claude: 'Claude Code', pi: 'Pi', gemini: 'Gemini CLI', dsh: 'DSH (DeepSeek)', zcode: 'ZCode', opencode: 'OpenCode', grok: 'Grok Build', cursor: 'Cursor' }
const AGENT_STYLES = {
  codex: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  workbuddy: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  claude: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  pi: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  gemini: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  dsh: 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  zcode: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  opencode: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  grok: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  cursor: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
}

/**
 * 双面板穿梭迁移对话框：
 * - 左侧固定为会话仓库中勾选的会话（按项目分组展示）
 * - 右侧为目标 Agent 项目列表（实时读取该 Agent 本地的项目数据）
 * 迁移始终为 勾选会话 → 右侧选中的某一个目标项目。
 */
export default function TransferDialog({ open, onClose, sessions, onDone, showToast }) {
  const [targetAgent, setTargetAgent] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [targetProjects, setTargetProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState('')
  const [loading, setLoading] = useState(false)

  const grouped = useMemo(() => {
    const g = new Map()
    for (const s of sessions) {
      const k = s.projectName || '未分类'
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(s)
    }
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [sessions])

  const loadTargetProjects = async (agent) => {
    setProjectsLoading(true)
    setProjectsError('')
    try {
      const d = await api('/api/projects?agent=' + agent)
      setTargetProjects(d.projects || [])
    } catch (e) {
      setTargetProjects([])
      setProjectsError(e.message)
    } finally {
      setProjectsLoading(false)
    }
  }

  useEffect(() => {
    setTargetPath('')
    if (targetAgent) loadTargetProjects(targetAgent)
  }, [targetAgent])

  const doMigrate = async () => {
    if (!targetPath.trim()) return showToast('请选择右侧的目标项目，或输入自定义路径', false)
    setLoading(true)
    try {
      await api('/api/sessions/pull', {
        method: 'POST',
        body: { sessionIds: sessions.map(s => s.id), targetAgent, targetProjectRoot: targetPath.trim() }
      })
      showToast('成功迁移 ' + sessions.length + ' 个会话到 ' + (AGENT_LABELS[targetAgent] || targetAgent))
      onDone?.()
      onClose?.()
    } catch (e) {
      showToast(e.message, false)
    }
    setLoading(false)
  }

  if (!open) return null

  return (
    <div className='fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4' onClick={e => { if (e.target === e.currentTarget && !loading) onClose() }}>
      <div className='bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-5xl max-h-[88vh] flex flex-col'>
        {/* header */}
        <div className='px-6 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0'>
          <div>
            <h3 className='text-sm font-semibold text-zinc-100'>迁移会话</h3>
            <p className='text-[11px] text-zinc-500 mt-0.5'>左侧为勾选的 {sessions.length} 个会话 · 选择右侧目标 Agent 项目后迁移</p>
          </div>
          <button onClick={() => !loading && onClose()} disabled={loading} className='text-zinc-400 hover:text-zinc-100 p-1 disabled:opacity-40'>
            <svg className='w-4 h-4' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'><path strokeLinecap='round' d='M6 18 18 6M6 6l12 12' /></svg>
          </button>
        </div>

        {/* body: dual panel */}
        <div className='flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 p-5 overflow-hidden'>

          {/* LEFT: source sessions grouped by project */}
          <div className='flex flex-col min-h-0 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/40'>
            <div className='px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/70 flex items-center justify-between shrink-0'>
              <span className='text-xs font-semibold text-zinc-200 flex items-center gap-1.5'>
                <span className='w-2 h-2 rounded-full bg-blue-400'></span>
                来源 — 勾选的会话
              </span>
              <span className='text-[10px] text-zinc-500'>{sessions.length} 个 · {grouped.length} 个项目</span>
            </div>
            <div className='flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3'>
              {grouped.map(([proj, items]) => (
                <div key={proj}>
                  <div className='text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 px-1'>{proj} ({items.length})</div>
                  <div className='space-y-1'>
                    {items.map(s => (
                      <div key={s.id} className='flex items-center gap-2 py-1.5 px-1.5 rounded bg-zinc-900/60 border border-zinc-800/70'>
                        <span className={'px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 ' + (AGENT_STYLES[s.sourceAgent] || '')}>{AGENT_LABELS[s.sourceAgent] || s.sourceAgent}</span>
                        <span className='text-xs text-zinc-300 truncate flex-1' title={s.title}>{s.title}</span>
                        <span className='text-[10px] text-zinc-600 shrink-0'>{s.messageCount} 消息</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: target agent + project */}
          <div className='flex flex-col min-h-0 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/40'>
            <div className='px-3 py-2.5 border-b border-zinc-800 bg-zinc-900/70 shrink-0'>
              <span className='text-xs font-semibold text-zinc-200 flex items-center gap-1.5'>
                <span className='w-2 h-2 rounded-full bg-emerald-400'></span>
                目标 — Agent 项目
              </span>
              <div className='flex flex-wrap gap-1.5 mt-2'>
                {Object.keys(AGENT_LABELS).map(a => (
                  <button key={a} onClick={() => setTargetAgent(a)}
                    className={'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ' + (targetAgent === a ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50' : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700')}>
                    {AGENT_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
            <div className='flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1'>
              {!targetAgent && <p className='text-xs text-zinc-600 text-center py-8'>先在上方选择目标 Agent</p>}
              {targetAgent && projectsLoading && <p className='text-xs text-zinc-500 text-center py-8 flex items-center justify-center gap-2'><svg className='w-3.5 h-3.5 animate-spin' fill='none' viewBox='0 0 24 24'><circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' /><path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z' /></svg>正在读取 {AGENT_LABELS[targetAgent]} 项目列表...</p>}
              {targetAgent && !projectsLoading && projectsError && (
                <div className='text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5'>
                  读取项目列表失败：{projectsError}
                  <p className='text-[10px] text-zinc-500 mt-1'>可在下方输入自定义路径继续迁移。</p>
                </div>
              )}
              {targetAgent && !projectsLoading && !projectsError && targetProjects.length === 0 && (
                <p className='text-xs text-zinc-600 text-center py-8'>该 Agent 暂无本地项目记录，可使用下方自定义路径。</p>
              )}
              {targetAgent && !projectsLoading && targetProjects.map(p => (
                <button key={p.id || p.path} onClick={() => setTargetPath(p.path)}
                  className={'w-full text-left px-3 py-2 rounded-md text-xs transition-colors border ' + (targetPath === p.path ? 'bg-emerald-600/15 text-emerald-200 border-emerald-500/40' : 'text-zinc-300 hover:bg-zinc-800/40 border-transparent')}>
                  <div className='font-medium flex items-center gap-2'>
                    <span className='truncate'>{p.label}</span>
                    {p.exists === false && <span className='text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 shrink-0'>路径不存在</span>}
                  </div>
                  <div className='text-[10px] text-zinc-500 font-mono mt-0.5 truncate' title={p.path}>{p.path}</div>
                </button>
              ))}
            </div>
            {targetAgent && (
              <div className='p-2.5 border-t border-zinc-800 shrink-0'>
                <input value={targetPath} onChange={e => setTargetPath(e.target.value)} placeholder='或输入自定义目标路径...'
                  className='w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500' />
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div className='px-6 py-4 border-t border-zinc-800 flex items-center justify-between shrink-0'>
          <p className='text-[11px] text-zinc-500 truncate'>
            {targetPath ? <>目标：<span className='font-mono text-zinc-400'>{targetPath}</span></> : '尚未选择目标项目'}
          </p>
          <div className='flex gap-2.5 shrink-0'>
            <button onClick={onClose} disabled={loading} className='px-4 py-2 rounded-lg text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50'>取消</button>
            <button onClick={doMigrate} disabled={loading || !targetAgent || !targetPath.trim()} className='px-5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 inline-flex items-center gap-2'>
              {loading && <svg className='w-3.5 h-3.5 animate-spin' fill='none' viewBox='0 0 24 24'><circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' /><path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z' /></svg>}
              {loading ? '迁移中...' : '确认迁移'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
