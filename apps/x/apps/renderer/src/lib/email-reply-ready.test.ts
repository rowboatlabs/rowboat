import { describe, expect, it } from 'vitest'
import type { blocks } from '@x/shared'
import { isReplyReady, replyReadyThreads } from './email-reply-ready'

// Only the fields the helpers read — the rest of the thread shape is inert here.
function thread(threadId: string, over: Partial<blocks.GmailThread> = {}): blocks.GmailThread {
  return { threadId, ...over } as blocks.GmailThread
}

describe('isReplyReady', () => {
  it('is true exactly when the thread carries a drafted reply', () => {
    expect(isReplyReady(thread('a', { draft_response: 'Sounds good — Thursday works.' }))).toBe(true)
    expect(isReplyReady(thread('b'))).toBe(false)
    expect(isReplyReady(thread('c', { draft_response: undefined }))).toBe(false)
  })
})

describe('replyReadyThreads', () => {
  it('keeps only reply-ready threads across lists, newest first', () => {
    const important = [
      thread('old', { draft_response: 'hi', date: '2026-09-01T10:00:00Z' }),
      thread('none', { date: '2026-09-03T10:00:00Z' }),
    ]
    const other = [thread('new', { draft_response: 'hello', date: '2026-09-02T10:00:00Z' })]
    expect(replyReadyThreads(important, other).map((t) => t.threadId)).toEqual(['new', 'old'])
  })

  it('dedupes a thread appearing in both sections mid-flip', () => {
    const a = thread('dup', { draft_response: 'x', date: '2026-09-01T10:00:00Z' })
    expect(replyReadyThreads([a], [a])).toHaveLength(1)
  })

  it('tolerates missing dates', () => {
    const rows = replyReadyThreads([
      thread('undated', { draft_response: 'x' }),
      thread('dated', { draft_response: 'y', date: '2026-09-01T10:00:00Z' }),
    ])
    expect(rows.map((t) => t.threadId)).toEqual(['dated', 'undated'])
  })
})
