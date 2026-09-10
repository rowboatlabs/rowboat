/** Preserve the active tab when possible, otherwise prefer its next surviving neighbor. */
export function closeTabs<T>(tabs: T[], activeId: string | null, closingIds: string[], getId: (tab: T) => string) {
  const closing = new Set(closingIds)
  const remaining = tabs.filter((tab) => !closing.has(getId(tab)))
  if (remaining.some((tab) => getId(tab) === activeId)) return { tabs: remaining, activeId }
  const index = tabs.findIndex((tab) => getId(tab) === activeId)
  const next = tabs.slice(index + 1).find((tab) => !closing.has(getId(tab)))
    ?? tabs.slice(0, Math.max(0, index)).reverse().find((tab) => !closing.has(getId(tab)))
    ?? remaining[0]
  return { tabs: remaining, activeId: next ? getId(next) : null }
}
