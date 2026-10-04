import type { ChatTab } from '@/components/tab-bar'

// BAARALI(04/10/2026): the chats a window reopens at start live on the
// server the app was on when it closed. Joined since to another account's
// instance, that server does not have them: the tab opens as a new chat
// instead of « session not found ». Only that answer counts; a server still
// waking up keeps its tabs.

export function isMissingSession(error: unknown): boolean {
  return /session not found/i.test(error instanceof Error ? error.message : String(error))
}

/** The sessions among `ids` the server says it does not have. */
export async function missingSessions(
  ids: Array<string | null>,
  get: (sessionId: string) => Promise<unknown>,
): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  const missing = new Set<string>()
  await Promise.all(unique.map((id) => get(id).catch((error: unknown) => {
    if (isMissingSession(error)) missing.add(id)
  })))
  return missing
}

/** The tabs, those showing a missing session turned into new chats. */
export function forgetSessions(tabs: ChatTab[], missing: Set<string>): ChatTab[] {
  return tabs.map((tab) => (tab.runId && missing.has(tab.runId) ? { ...tab, runId: null, chatId: crypto.randomUUID() } : tab))
}
