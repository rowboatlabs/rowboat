// Per-machine open counts for spaces, backing the sidebar's "top 5" fold.
// Frequency, not recency: the fold should hold the spaces someone lives in,
// not whichever was clicked last.

const KEY = 'x:space-open-counts'

export function spaceUseKey(orgId: string, spaceId: string): string {
    return `${orgId}/${spaceId}`
}

export function readSpaceUse(): Record<string, number> {
    try {
        const raw = localStorage.getItem(KEY)
        const parsed = raw ? (JSON.parse(raw) as unknown) : {}
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
    } catch {
        return {}
    }
}

export function bumpSpaceUse(orgId: string, spaceId: string): void {
    try {
        const counts = readSpaceUse()
        const key = spaceUseKey(orgId, spaceId)
        counts[key] = (counts[key] ?? 0) + 1
        localStorage.setItem(KEY, JSON.stringify(counts))
    } catch {
        // Counting is best-effort; the sidebar falls back to declaration order.
    }
}
