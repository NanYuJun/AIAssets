import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import BackupSection from '../components/BackupSection'

const AGENT_LABELS = { codex: 'Codex', workbuddy: 'WorkBuddy', pi: 'Pi', gemini: 'Gemini', dsh: 'DSH', claude: 'Claude' }
const ALL_AGENTS = ['codex', 'workbuddy', 'pi', 'gemini', 'dsh', 'claude']

export default function Settings({ showToast }) {
  const [auth, setAuth] = useState(null)
  const [cloudStats, setCloudStats] = useState(null)
  const [requestLog, setRequestLog] = useState([])
  const [autoSync, setAutoSync] = useState(null)
  const [savingAgents, setSavingAgents] = useState(false)
  const [savingInterval, setSavingInterval] = useState(false)
  const [logTab, setLogTab] = useState('sync') // sync | request

  const load = async () => {
    try {
      const [a, cs, logs, as] = await Promise.all([
        api('/api/auth/status'),
        api('/api/cloud/stats'),
        api('/api/request-log?limit=20'),
        api('/api/auto-sync')
      ])
      setAuth(a)
      setCloudStats(cs.stats)
      setRequestLog(logs.logs || [])
      setAutoSync(as)
    } catch (e) { showToast(e.message, false) }
  }
  useEffect(() => { load() }, [])

  const fmtBytes = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(0) + ' KB' : b + ' B'

  const toggleAgent = async (agent) => {
    if (!autoSync?.config) return
    const cur = autoSync.config.agents || []
    const next = cur.includes(agent) ? cur.filter(a => a !== agent) : [...cur, agent]
    setSavingAgents(true)
    try {
      const d = await api('/api/auto-sync', { method: 'POST', body: { agents: next } })
      setAutoSync(d)
      showToast('监听范围已更新')
    } catch (e) { showToast(e.message, false) }
    setSavingAgents(false)
  }

  const setIntervalSec = async (sec) => {
    setSavingInterval(true)
    try {
      const d = await api('/api/auto-sync', { method: 'POST', body: { intervalSec: sec } })
      setAutoSync(d)
      showToast('同步频率已更新：每 ' + Math.round(sec / 60) + ' 分钟')
    } catch (e) { showToast(e.message, false) }
    setSavingInterval(false)
  }

  const history = autoSync?.state?.history || []

  return (
    <div className="space-y-4">
      {/* 云端存储统计（置顶） */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">云端存储统计</h2>
        {cloudStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-zinc-950/60 rounded-lg p-3">
              <div className="text-[11px] text-zinc-500">会话总数</div>
              <div className="text-lg font-semibold text-zinc-100">{cloudStats.count}</div>
            </div>
            <div className="bg-zinc-950/60 rounded-lg p-3">
              <div className="text-[11px] text-zinc-500">总占用</div>
              <div className="text-lg font-semibold text-zinc-100">{fmtBytes(cloudStats.totalBytes)}</div>
            </div>
            <div className="bg-zinc-950/60 rounded-lg p-3">
              <div className="text-[11px] text-zinc-500">分享导入</div>
              <div className="text-lg font-semibold text-fuchsia-300">{cloudStats.sharedCount}</div>
            </div>
            <div className="bg-zinc-950/60 rounded-lg p-3">
              <div className="text-[11px] text-zinc-500">分享占用</div>
              <div className="text-lg font-semibold text-fuchsia-300">{fmtBytes(cloudStats.sharedBytes)}</div>
            </div>
          </div>
        ) : <div className="text-xs text-zinc-500">加载中...</div>}
      </div>


      {/* 同步云端 */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-zinc-200">同步云端</h2>
          {autoSync?.config?.enabled && <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">运行中</span>}
        </div>
        <p className="text-xs text-zinc-500 mb-3">开启后每 {Math.round((autoSync?.config?.intervalSec || 1800) / 60)} 分钟轮询本机 Agent 会话目录，新会话/有更新的会话自动备份到云端。多设备场景下每台电脑开启即可实现自动同步。</p>
        {autoSync ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <button onClick={async () => {
                try {
                  const d = await api('/api/auto-sync', { method: 'POST', body: { enabled: !autoSync.config.enabled } })
                  setAutoSync(d); showToast(d.config.enabled ? '同步云端已开启' : '同步云端已关闭')
                } catch (e) { showToast(e.message, false) }
              }} className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white ${autoSync.config.enabled ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
                {autoSync.config.enabled ? '关闭自动上云' : '开启自动上云'}
              </button>
              <button onClick={async () => {
                try {
                  const d = await api('/api/auto-sync', { method: 'POST', body: { runNow: true } })
                  showToast(`手动执行完成：本次备份 ${d.lastRunPushed} 个会话`)
                  await load()
                } catch (e) { showToast(e.message, false) }
              }} className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200">立即执行一次</button>
            </div>

            {/* Agent 选择 */}
            <div className="mb-3">
              <div className="text-[11px] text-zinc-500 mb-1.5">监听哪些 Agent 工具：</div>
              <div className="flex flex-wrap items-center gap-2">
                {ALL_AGENTS.map(a => {
                  const active = (autoSync.config.agents || []).includes(a)
                  return (
                    <button key={a} onClick={() => toggleAgent(a)} disabled={savingAgents}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${active ? 'bg-brand-600/20 text-brand-300 border-brand-500/40' : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700'}`}>
                      {active ? '✓ ' : ''}{AGENT_LABELS[a] || a}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 同步频率 */}
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[11px] text-zinc-500">同步频率：</div>
              <select value={autoSync.config.intervalSec || 1800} onChange={e => setIntervalSec(parseInt(e.target.value))} disabled={savingInterval} className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs">
                <option value={600}>每 10 分钟</option>
                <option value={1800}>每 30 分钟（默认）</option>
                <option value={3600}>每 1 小时</option>
                <option value={7200}>每 2 小时</option>
                <option value={21600}>每 6 小时</option>
              </select>
            </div>
          </>
        ) : <div className="text-xs text-zinc-500">加载中...</div>}
      </div>


      <BackupSection showToast={showToast} />
      {/* 日志（Tab：同步云端记录 / 远程访问日志） */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
            <button onClick={() => setLogTab('sync')} className={`px-3 py-1 rounded-md text-xs font-medium ${logTab === 'sync' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>同步云端记录{history.length > 0 && ` (${history.length})`}</button>
            <button onClick={() => setLogTab('request')} className={`px-3 py-1 rounded-md text-xs font-medium ${logTab === 'request' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>远程访问日志{requestLog.length > 0 && ` (${requestLog.length})`}</button>
          </div>
        </div>

        {logTab === 'sync' && (
          <div>
            {autoSync?.state?.lastRun && <div className="text-[11px] text-zinc-500 mb-2">上次运行：{new Date(autoSync.state.lastRun).toLocaleString('zh-CN', { hour12: false })} · 累计备份 {autoSync.state.syncedCount || 0} 次</div>}
            {history.length === 0
              ? <div className="text-xs text-zinc-600 py-2">暂无执行记录（每次自动/手动执行后记录在此）</div>
              : <div className="space-y-1 max-h-64 overflow-y-auto">
                  {[...history].reverse().map((h, i) => (
                    <div key={i} className="flex items-center gap-3 text-[11px] p-2 rounded bg-zinc-950/40">
                      <span className="text-zinc-600 shrink-0">{new Date(h.ts).toLocaleString('zh-CN', { hour12: false })}</span>
                      <span className="text-zinc-300 shrink-0">备份 {h.pushed} 个会话</span>
                      <span className="text-zinc-500 truncate flex-1">{(h.agents || []).map(a => AGENT_LABELS[a] || a).join('、')}</span>
                    </div>
                  ))}
                </div>}
          </div>
        )}

        {logTab === 'request' && (
          requestLog.length === 0
            ? <div className="text-xs text-zinc-500 py-4">暂无远程访问记录</div>
            : <div className="space-y-1 max-h-64 overflow-y-auto">
              {requestLog.map((l, i) => (
                <div key={i} className="flex items-center gap-3 text-[11px] p-1.5 rounded bg-zinc-950/40">
                  <span className="text-zinc-600">{new Date(l.ts).toLocaleString('zh-CN', { hour12: false })}</span>
                  <span className="font-mono text-zinc-400">{l.method}</span>
                  <span className="font-mono text-zinc-300 truncate flex-1">{l.path}</span>
                  <span className={l.authed ? 'text-emerald-400' : 'text-rose-400'}>{l.authed ? '已授权' : '未授权'}</span>
                </div>
              ))}
            </div>
        )}
      </div>
    </div>
  )
}
