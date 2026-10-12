import fs from 'node:fs';

const path = new URL('../src/pages/AssetLibrary.jsx', import.meta.url);
let s = fs.readFileSync(path, 'utf8');

const oldButtons = `      <div className="flex items-center gap-1.5 shrink-0">
        {s.isCloud && <button onClick={() => removeSharedFromCloud(s)} title="从云端删除" className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all">删云端</button>}
        {s.isLocal && (s.localAgents || s.agents).map(a => (
          <button key={a} onClick={() => deleteLocal(s, a)} title={\`删除 \${AGENT_LABELS[a]} 本地会话\`} className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all">删{a === 'codex' ? 'Codex' : a === 'workbuddy' ? 'WB' : 'Pi'}</button>
        ))}
      </div>`;

const newButtons = `      <button onClick={() => setDeleteTarget({ type: 'multi', session: s })} title="删除会话" className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all shrink-0">删除</button>`;

if (!s.includes(oldButtons)) { console.error('BUTTONS NOT FOUND'); process.exit(1); }
s = s.replace(oldButtons, newButtons);

const oldModal = `      {deleteTarget && (() => {
        const s = deleteTarget.session
        const isCloud = deleteTarget.type === 'cloud'
        const agentLabel = isCloud ? null : AGENT_LABELS[deleteTarget.agent]
        return (`;

const newModal = `      {deleteTarget && (() => {
        const s = deleteTarget.session
        if (deleteTarget.type === 'multi') {
          const targets = []
          if (s.isCloud) targets.push({ key: 'cloud', label: '云端 Hub 备份' })
          ;(s.localAgents || s.agents || []).filter(a => s.isLocal).forEach(a => targets.push({ key: 'local:' + a, label: AGENT_LABELS[a] + ' 本地会话' }))
          const toggle = (key) => setDeleteTarget(d => ({ ...d, selected: { ...d.selected, [key]: !d.selected?.[key] } }))
          const anySelected = targets.some(t => deleteTarget.selected?.[t.key])
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
                  <button disabled={!anySelected} onClick={async () => {
                    const tasks = []
                    for (const t of targets) {
                      if (!deleteTarget.selected?.[t.key]) continue
                      if (t.key === 'cloud') tasks.push(api('/api/sessions/cloud/' + encodeURIComponent(s.id), { method: 'DELETE' }))
                      else tasks.push(api('/api/sessions/local/' + encodeURIComponent(s.id) + '?agent=' + t.key.split(':')[1], { method: 'DELETE' }))
                    }
                    try {
                      await Promise.all(tasks)
                      showToast('删除完成')
                      setDeleteTarget(null)
                      setSelected(new Set())
                      await load()
                    } catch (e) { showToast(e.message, false) }
                  }} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white">确认删除</button>
                </div>
              </div>
            </div>
          )
        }
        const isCloud = deleteTarget.type === 'cloud'
        const agentLabel = isCloud ? null : AGENT_LABELS[deleteTarget.agent]
        return (`;

if (!s.includes(oldModal)) { console.error('MODAL NOT FOUND'); process.exit(1); }
s = s.replace(oldModal, newModal);

fs.writeFileSync(path, s, 'utf8');
console.log('multi-delete refactor done');
