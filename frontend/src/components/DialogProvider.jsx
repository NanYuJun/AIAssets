import { createContext, useCallback, useContext, useState } from 'react'

const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const [state, setState] = useState(null)

  const close = (result) => {
    setState(null)
    if (state?.resolve) state.resolve(result)
  }

  const prompt = useCallback((options) => {
    return new Promise(resolve => {
      setState({ type: 'prompt', ...options, resolve })
    })
  }, [])

  const confirm = useCallback((options) => {
    return new Promise(resolve => {
      setState({ type: 'confirm', ...options, resolve })
    })
  }, [])

  const submit = () => {
    if (state.type === 'prompt' && state.required !== false && !state.value?.trim()) return
    close(state.type === 'prompt' ? state.value : true)
  }

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) close(state.type === 'confirm' ? false : null) }}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6">
            <h3 className="text-sm font-semibold text-zinc-100 mb-1.5">{state.title}</h3>
            {state.message && <p className="text-xs text-zinc-400 leading-relaxed mb-1">{state.message}</p>}
            {state.type === 'prompt' && (
              <input
                autoFocus
                type={state.inputType || 'text'}
                value={state.value || ''}
                onChange={e => setState(s => ({ ...s, value: e.target.value }))}
                placeholder={state.placeholder || ''}
                className="w-full mt-3 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-brand-500"
              />
            )}
            <div className="flex justify-end gap-2.5 pt-4">
              <button onClick={() => close(state.type === 'confirm' ? false : null)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800/60">
                {state.cancelText || '取消'}
              </button>
              <button onClick={submit} className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white ${state.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-brand-600 hover:bg-brand-500'}`}>
                {state.confirmText || '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog() {
  return useContext(DialogContext)
}