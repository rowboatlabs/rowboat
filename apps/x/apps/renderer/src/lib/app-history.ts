const KEY = 'x:app-history'
type Entry = {
  codeMode?: 'claude' | 'codex' | null
  openedAt?: number
  chatId?: string
  conversationId?: string
  runtimeError?: string | null
}
export function getAppHistory(): Record<string, Entry> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  } catch {
    return {}
  }
}
export function rememberApp(folder: string, entry: Entry) {
  try {
    const entries = getAppHistory()
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...entries, [folder]: { ...entries[folder], ...entry } })
    )
  } catch {
    /* Optional navigation history must never prevent opening an app. */
  }
}
