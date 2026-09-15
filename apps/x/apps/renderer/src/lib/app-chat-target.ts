import type { ChatTab } from '@/components/tab-bar'

export type AppChatTarget = { conversationId?: string; chatId?: string }

/** Resolve by conversation identity, never by whichever tab became active
 * while the assistant picker was open. A draft has a chatId before a session. */
export function resolveAppChatTarget(
  tabs: ChatTab[],
  saved: AppChatTarget | undefined,
  original: AppChatTarget
): { tab?: ChatTab; conversationId?: string } {
  const identity = saved?.conversationId || saved?.chatId ? saved : original
  const conversationId = identity.conversationId
  if (conversationId)
    return {
      conversationId,
      tab: tabs.find((tab) => tab.runId === conversationId)
    }
  const chatId = identity.chatId
  const tab = tabs.find((tab) => tab.chatId === chatId)
  return { tab, conversationId: tab?.runId ?? undefined }
}
