// Apps pinned to the nav sidebar: a per-machine UI preference persisted in
// localStorage (same pattern as pinned chats). A window event keeps the
// sidebar and the Apps view in sync within the session.

const STORAGE_KEY = 'x:pinned-apps'
export const PINNED_APPS_CHANGED_EVENT = 'x:pinned-apps-changed'

export function getPinnedApps(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function save(folders: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(folders))
  } catch { /* keep in-memory behavior */ }
  window.dispatchEvent(new Event(PINNED_APPS_CHANGED_EVENT))
}

export function pinApp(folder: string): void {
  const current = getPinnedApps()
  if (!current.includes(folder)) save([...current, folder])
}

export function unpinApp(folder: string): void {
  const current = getPinnedApps()
  if (current.includes(folder)) save(current.filter((f) => f !== folder))
}

export function onPinnedAppsChanged(cb: (folders: string[]) => void): () => void {
  const handler = () => cb(getPinnedApps())
  window.addEventListener(PINNED_APPS_CHANGED_EVENT, handler)
  return () => window.removeEventListener(PINNED_APPS_CHANGED_EVENT, handler)
}
