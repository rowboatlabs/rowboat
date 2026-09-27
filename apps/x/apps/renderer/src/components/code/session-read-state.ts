import { useEffect, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'x:code-unread-completions'
const listeners = new Set<() => void>()
const readers = new Set<string>()

function restore(): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

let unread = restore()

function update(next: Set<string>) {
  unread = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch { /* Read state still works in memory if storage is unavailable. */ }
  listeners.forEach((listener) => listener())
}

function markRead(sessionId: string) {
  if (!unread.has(sessionId)) return
  const next = new Set(unread)
  next.delete(sessionId)
  update(next)
}

function isFocused() {
  return document.visibilityState === 'visible' && document.hasFocus()
}

// 2026-09-22: completed project turns remain unread until their own chat is
// viewed; visiting Projects or a sibling session must not clear the badge.
export function noteCodeSessionCompleted(sessionId: string) {
  if (readers.has(sessionId) && isFocused()) return
  if (!unread.has(sessionId)) update(new Set([...unread, sessionId]))
}

export function useUnreadCodeSessions() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => unread,
    () => unread,
  )
}

export function useCodeSessionReader(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return
    readers.add(sessionId)
    const readIfFocused = () => { if (isFocused()) markRead(sessionId) }
    readIfFocused()
    window.addEventListener('focus', readIfFocused)
    document.addEventListener('visibilitychange', readIfFocused)
    return () => {
      readers.delete(sessionId)
      window.removeEventListener('focus', readIfFocused)
      document.removeEventListener('visibilitychange', readIfFocused)
    }
  }, [sessionId])
}
