// API 基地址与鉴权：
// - 浏览器（Hub Web 模式）：相对路径 + Cookie
// - Electron 内嵌模式：绝对地址（Hub URL）+ Bearer deviceToken
function getApiBase() {
  if (window.hubDesktop?.isElectron) {
    return (window.hubDesktop.getAuth()?.hub || '').replace(/\/+$/, '')
  }
  return ''
}

function authHeaders(extra = {}) {
  if (window.hubDesktop?.isElectron) {
    const token = window.hubDesktop.getAuth()?.token
    if (token) return { ...extra, Authorization: 'Bearer ' + token }
  }
  return extra
}

export async function api(path, options = {}) {
  const res = await fetch(getApiBase() + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.reason || `HTTP ${res.status}`)
  }
  return data
}

export async function rawFetch(path, options = {}) {
  return fetch(getApiBase() + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
}

export function isElectron() {
  return Boolean(window.hubDesktop?.isElectron)
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  // Fallback: hidden textarea + execCommand（HTTP / 旧浏览器兼容）
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
