import type { blocks } from '@x/shared'

// "Reply ready" means the thread carries a classifier-drafted reply
// (thread.draft_response, written during sync and refreshed whenever the
// thread changes) — the same condition behind the row chip. This is a view
// over the loaded sections, not a stored status: send or receive a message
// and the re-classified snapshot decides again whether a draft belongs.

export function isReplyReady(thread: blocks.GmailThread): boolean {
  return Boolean(thread.draft_response)
}

/** Reply-ready threads from the given lists, deduped by threadId (a thread
 *  mid-flip between sections must not render twice), newest first. */
export function replyReadyThreads(...lists: blocks.GmailThread[][]): blocks.GmailThread[] {
  const seen = new Set<string>()
  const out: blocks.GmailThread[] = []
  for (const thread of lists.flat()) {
    if (!isReplyReady(thread) || seen.has(thread.threadId)) continue
    seen.add(thread.threadId)
    out.push(thread)
  }
  return out.sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0))
}
