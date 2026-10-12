import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useDialog } from './DialogProvider'

const TYPE_LABEL = { r2: 'Cloudflare R2', oss: '阿里云 OSS', cos: '腾讯云 COS', s3: 'AWS S3 / 自定义' }

export default function BackupSection({ showToast }) {
  const dialog = useDialog()
  const [config, setConfig] = useState(null)
  const [providers, setProviders] = useState({})
  const [rcloneOk, setRcloneOk] = useState(true)
  const [state, setState] = useState(null)
  const [running, setRunning] = useState(false)
  const [savingFreq, setSavingFreq] = useState(false)
  const [editing, setEditing] = useState(null) // 当前编辑的目标

  const load = async () => {
    try {
      const [c, s] = await Promise.all([api('/api/backup/config'), api('/api/backup/state')])
      setConfig(c.config); setProviders(c.providers); setRcloneOk(c.rcloneAvailable); setState(s.state)
    } catch (e) { showToast(e.message, false) }
  }
  useEffect(() => { load() }, [])

  const save = async (cfg) => {
    try {
      const d = await api('/api/backup/config', { method: 'POST', body: cfg })
      setConfig(d.config)
      showToast('备份配置已保存')
    } catch (e) { showToast(e.message, false) }
  }

  const setFreq = async (hours) => {
    setSavingFreq(true)
    try {
      const d = await api('/api/backup/config', { method: 'POST', body: { frequencyHours: hours } })
      setConfig(d.config)
      showToast('备份频率已更新：每 ' + hours + ' 小时')
    } catch (e) { showToast(e.message, false) }
    setSavingFreq(false)
  }

  const toggleEnabled = async () => {
    try {
      const d = await api('/api/backup/config', { method: 'POST', body: { enabled: !config.enabled } })
      setConfig(d.config)
      showToast(d.config.enabled ? '定时备份已开启（每 6 小时）' : '定时备份已关闭')
    } catch (e) { showToast(e.message, false) }
  }

  const toggleMirror = async () => {
    const dir = config.localMirror?.dir
    if (!config.localMirror?.enabled && (!dir || !dir.trim())) {
      const input = await dialog.prompt({ title: '本地镜像目录', message: '输入镜像目标目录（如 D:\\hub-backup）', placeholder: 'D:\\hub-backup', value: dir || '' })
      if (input === null || input === undefined) return
      await save({ localMirror: { enabled: true, dir: input } })
      return
    }
    await save({ localMirror: { ...config.localMirror, enabled: !config.localMirror.enabled } })
    showToast(config.localMirror.enabled ? '本地镜像已关闭' : '本地镜像已开启：' + config.localMirror.dir)
  }

  const changeMirrorDir = async () => {
    const input = await dialog.prompt({ title: '修改本地镜像目录', message: '输入新的镜像目标目录', placeholder: 'D:\\hub-backup', value: config.localMirror?.dir || '' })
    if (input === null || input === undefined || !input.trim()) return
    await save({ localMirror: { enabled: config.localMirror?.enabled || false, dir: input.trim() } })
    showToast('镜像目录已更新：' + input.trim() + (config.localMirror?.enabled ? '（已开启）' : '，请点击开启'))
  }

  const addDest = (type) => {
    setEditing({ id: 'dest-' + Date.now(), type, name: TYPE_LABEL[type], bucket: '', endpoint: providers[type]?.endpoint || '', accessKey: '', secretKey: '', prefix: 'agent-sync-hub', keepVersions: 14, enabled: true })
  }

  const saveDest = async () => {
    const dests = [...(config.destinations || []).filter(d => d.id !== editing.id), editing]
    await save({ destinations: dests })
    setEditing(null)
  }

  const removeDest = async (id) => {
    const ok = await dialog.confirm({ title: '删除备份目标', message: '确定删除该备份目标？', confirmText: '删除', danger: true })
    if (!ok) return
    await save({ destinations: (config.destinations || []).filter(d => d.id !== id) })
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const d = await api('/api/backup/run', { method: 'POST' })
      setState(d.state)
      const okCount = (d.results || []).filter(r => r.ok).length
      showToast(`备份完成：${okCount}/${d.results.length} 个目标成功`)
      load()
    } catch (e) { showToast(e.message, false) }
    setRunning(false)
  }

  if (!config) return <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 text-xs text-zinc-500">加载中...</div>

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-zinc-200">异地容灾备份</h2>
        {config.enabled && <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">运行中</span>}
      </div>
      <p className="text-xs text-zinc-500 mb-3">将云端会话库与账号配置打包为 ZIP，上传到你配置的云存储目标（R2 / OSS / COS），并保留最近多份用于恢复。</p>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={runNow} disabled={running} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50">{running ? '备份中...' : '立即备份'}</button>
        <button onClick={toggleEnabled} className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white ${config.enabled ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>{config.enabled ? '关闭定时备份' : '开启定时备份'}</button>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-zinc-500">备份频率：</div>
          <select value={config.frequencyHours || 6} onChange={e => setFreq(parseInt(e.target.value))} disabled={savingFreq} className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs">
            <option value={1}>每 1 小时</option>
            <option value={6}>每 6 小时（默认）</option>
            <option value={12}>每 12 小时</option>
            <option value={24}>每天一次</option>
          </select>
        </div>
      </div>

      {!rcloneOk && <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">未找到 rclone.exe（tools/rclone.exe），云端目标不可用，本地镜像不受影响</div>}

      {/* 本地镜像 */}
      <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-zinc-200">本地镜像 <span className="text-zinc-500">（robocopy /MIR 到另一块盘）</span></div>
          <div className="text-[11px] text-zinc-500 truncate">{config.localMirror?.dir || '未设置目录'}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={changeMirrorDir} className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700">修改目录</button>
          <button onClick={toggleMirror} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${config.localMirror?.enabled ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-300 border border-zinc-700'}`}>{config.localMirror?.enabled ? '已开启' : '未开启'}</button>
        </div>
      </div>

      {/* 云端目标列表 */}
      <div className="space-y-2">
        {(config.destinations || []).map(d => (
          <div key={d.id} className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-zinc-200">{TYPE_LABEL[d.type] || d.type} · {d.bucket} {d.enabled === false && <span className="text-[10px] text-zinc-500">（已停用）</span>}</div>
              <div className="text-[11px] text-zinc-500 truncate">{d.endpoint} · 保留 {d.keepVersions || 14} 份</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setEditing({ ...d })} className="text-[11px] px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200">编辑</button>
              <button onClick={() => removeDest(d.id)} className="text-[11px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30">删除</button>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2">
          {Object.keys(TYPE_LABEL).map(t => (
            <button key={t} onClick={() => addDest(t)} className="px-2.5 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700">+ {TYPE_LABEL[t]}</button>
          ))}
        </div>
      </div>

      {/* 编辑目标弹层 */}
      {editing && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-100">编辑备份目标 — {TYPE_LABEL[editing.type]}</h3>
            <label className="block text-xs text-zinc-400 mb-0">Bucket 名称</label>
            <input value={editing.bucket} onChange={e => setEditing({ ...editing, bucket: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs" />
            <label className="block text-xs text-zinc-400 mb-0">Endpoint{editing.type === 'r2' && '（含你的 account_id）'}</label>
            <input value={editing.endpoint} onChange={e => setEditing({ ...editing, endpoint: e.target.value })} placeholder={providers[editing.type]?.endpoint} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs" />
            <label className="block text-xs text-zinc-400 mb-0">Access Key ID</label>
            <input value={editing.accessKey} onChange={e => setEditing({ ...editing, accessKey: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs" />
            <label className="block text-xs text-zinc-400 mb-0">Secret Access Key</label>
            <input type="password" value={editing.secretKey} onChange={e => setEditing({ ...editing, secretKey: e.target.value })} placeholder={editing.secretKey?.endsWith('****') ? '已保存（留空保持不变需重新输入）' : ''} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-zinc-400 mb-0">路径前缀</label>
                <input value={editing.prefix} onChange={e => setEditing({ ...editing, prefix: e.target.value })} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-0">保留份数</label>
                <input type="number" value={editing.keepVersions} onChange={e => setEditing({ ...editing, keepVersions: parseInt(e.target.value) || 14 })} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={editing.enabled !== false} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} /> 启用该目标
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700">取消</button>
              <button onClick={saveDest} disabled={!editing.bucket || !editing.accessKey} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 disabled:bg-zinc-700 text-white">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 最近一次备份结果 */}
      {state?.results?.length > 0 && (
        <div className="pt-3 border-t border-zinc-800">
          <div className="text-[11px] text-zinc-500 mb-1.5">最近一次备份 {state.lastRun ? '· ' + new Date(state.lastRun).toLocaleString('zh-CN', { hour12: false }) : ''}</div>
          <div className="space-y-1">
            {state.results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-zinc-950/40">
                <span className={r.ok ? 'text-emerald-400' : 'text-rose-400'}>{r.ok ? '✓' : '✗'}</span>
                <span className="text-zinc-300">{r.name}</span>
                {!r.ok && r.error && <span className="text-rose-300/70 truncate flex-1">{r.error}</span>}
                {!r.ok && r.steps?.filter(s => !s.ok).map((s, j) => <span key={j} className="text-rose-300/70 truncate">{s.step}: {s.error}</span>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
