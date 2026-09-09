import type { ChatTab } from '@/components/tab-bar'

export const ASSISTANT_TABS_KEY = 'rowboat-assistant-tabs'

export function readAssistantPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function writeAssistantPreference(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { return }
}

export function createAssistantTab(runId: string | null = null): ChatTab {
  return { id: crypto.randomUUID(), chatId: runId ?? crypto.randomUUID(), runId }
}

export function restoreAssistantTabs(raw: string | null): ChatTab[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (!Array.isArray(parsed)) return []
    const ids = new Set<string>()
    const chats = new Set<string>()
    const runs = new Set<string>()
    return parsed.filter((tab): tab is ChatTab => {
      if (!tab || typeof tab !== 'object' || typeof tab.id !== 'string' || !tab.id
        || typeof tab.chatId !== 'string' || !tab.chatId
        || !(tab.runId === null || (typeof tab.runId === 'string' && tab.runId))
        || ids.has(tab.id) || chats.has(tab.chatId) || (tab.runId && runs.has(tab.runId))) return false
      ids.add(tab.id)
      chats.add(tab.chatId)
      if (tab.runId) runs.add(tab.runId)
      return true
    }).map(({ id, chatId, runId }) => ({ id, chatId, runId }))
  } catch {
    return []
  }
}

export function tabsAfterClose(tabs: ChatTab[], tabId: string, activeId: string) {
  const index = tabs.findIndex((tab) => tab.id === tabId)
  const remaining = tabs.filter((tab) => tab.id !== tabId)
  return {
    tabs: remaining,
    activeId: activeId === tabId ? remaining[Math.max(0, index - 1)]?.id ?? null : activeId,
  }
}
