import { useState } from 'react'
import { marked } from 'marked'

const AGENT_LABELS = { codex: 'Codex', workbuddy: 'WorkBuddy', pi: 'Pi' }
const AGENT_STYLES = {
  codex: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  workbuddy: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  pi: 'bg-orange-500/15 text-orange-400 border-orange-500/30'
}

export function SessionPreviewModal({ session, onClose }) {
  if (!session) return null
  const renderContent = (text) => {
    try { return marked.parse(String(text || '')) } catch { return String(text || '') }
  }
  const events = session.events || session.messages || []
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{session.title || '会话详情'}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 px-2">关闭</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {events.length === 0 && <div className="text-center py-12 text-zinc-500 text-xs">此会话暂无内容</div>}
          {events.map(ev => ev.kind === 'message'
            ? <div key={ev.id}><div className="text-[11px] text-zinc-500 mb-1">{ev.role === 'user' ? '用户' : '助手'}</div><div className={`rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap ${ev.role === 'user' ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-950 border-blue-500/25 md-content'}`} dangerouslySetInnerHTML={{ __html: ev.role === 'user' ? (ev.content || '') : renderContent(ev.content) }} /></div>
            : ev.kind === 'tool_call'
              ? <div key={ev.id}><div className="text-[11px] text-yellow-400/80 mb-1">[工具] {ev.name}</div><div className="rounded-lg border border-yellow-500/20 bg-zinc-950 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{(() => { try { const p = JSON.parse(ev.arguments); return p.command || p.cmd || ev.arguments } catch { return ev.arguments } })()}</div></div>
              : ev.kind === 'tool_result'
                ? <div key={ev.id} className="rounded-lg border border-yellow-500/20 bg-zinc-950 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{(ev.output || '').slice(0, 500)}</div>
                : null
          )}
        </div>
      </div>
    </div>
  )
}

export function useSessionRowState() {
  const [preview, setPreview] = useState(null)
  return { preview, setPreview }
}