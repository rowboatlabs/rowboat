import type { spaces } from '@x/shared'

// Chat conventions under the annotation model (spec §7, 2026-09-01): one
// stream of root messages per space, flat threads behind reply chips
// (Message.threadRoot), topics as archivable annotation rows on threads.
// Nothing here invents structure — these are display folds and the
// provenance-suffix grammar shared with the agent prompt.

/** The thread a message lives in: its root's id — its own when it IS a root. */
export function threadRootOf(message: spaces.Message): string {
    return message.threadRoot ?? message.id
}

/** What to call a thread when no topic annotates it: the root's first line, trimmed. */
export function threadLabelOf(rootBody: string, max = 80): string {
    const firstLine = rootBody
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0)
    if (!firstLine) return 'Thread'
    const stripped = firstLine.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()
    const label = stripped.length > 0 ? stripped : 'Thread'
    return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

// ---------------------------------------------------------------------------
// Artifacts — change-sets made from a thread carry its root id at the end of
// the reason ("· thread:<id>"; the legacy spelling "topic:<id>" still parses).
// Two producers only: the Fold gesture and the thread agent's prompt.
// ---------------------------------------------------------------------------

const THREAD_REF_RE = /\s*·\s*(?:topic|thread):([0-9A-Za-z_-]+)\s*$/

export function withThreadRef(reason: string, threadRootId: string): string {
    const base = stripThreadRef(reason).trim()
    return base ? `${base} · thread:${threadRootId}` : `thread:${threadRootId}`
}

export function threadRefOf(reason: string | undefined): string | null {
    if (!reason) return null
    const m = THREAD_REF_RE.exec(reason)
    if (m) return m[1]!
    const bare = /^(?:topic|thread):([0-9A-Za-z_-]+)$/.exec(reason.trim())
    return bare ? bare[1]! : null
}

/** The reason as people should read it — without the provenance suffix. */
export function stripThreadRef(reason: string): string {
    return reason.replace(THREAD_REF_RE, '').replace(/^(?:topic|thread):[0-9A-Za-z_-]+$/, '').trim()
}

export interface ArtifactGroup {
    assetPath: string
    /** 0 when the thread created the file. */
    fromVersion: number
    toVersion: number
    /** Newest change in the group. */
    latest: spaces.ChangeSet
    changeSets: spaces.ChangeSet[]
}

/** Change-sets made from this thread, grouped by file, newest group first. */
export function artifactsForThread(changeSets: spaces.ChangeSet[], threadRootId: string): ArtifactGroup[] {
    const mine = changeSets.filter((c) => (c.threadRootId ?? threadRefOf(c.reason)) === threadRootId)
    const byPath = new Map<string, spaces.ChangeSet[]>()
    for (const cs of mine) {
        const list = byPath.get(cs.assetPath) ?? []
        list.push(cs)
        byPath.set(cs.assetPath, list)
    }
    const groups: ArtifactGroup[] = []
    for (const [assetPath, list] of byPath) {
        list.sort((a, b) => a.committedAt.localeCompare(b.committedAt))
        const first = list[0]!
        const latest = list[list.length - 1]!
        groups.push({
            assetPath,
            fromVersion: first.baseVersion,
            toVersion: latest.resultVersion,
            latest,
            changeSets: [...list].reverse(),
        })
    }
    return groups.sort((a, b) => b.latest.committedAt.localeCompare(a.latest.committedAt))
}

// ---------------------------------------------------------------------------
// Reactions — fold a live reaction event into a message's display groups.
// Mirrors the org's fold exactly (first-reacted order, per-member dedupe), so
// applying the delta and refetching land on the same pixels.
// ---------------------------------------------------------------------------

export function applyReaction(
    groups: spaces.ReactionGroup[] | undefined,
    event: { emoji: string; memberId: string; action: 'added' | 'removed' },
): spaces.ReactionGroup[] {
    const current = groups ?? []
    const existing = current.find((g) => g.emoji === event.emoji)
    if (event.action === 'added') {
        if (existing?.memberIds.includes(event.memberId)) return current
        if (!existing) return [...current, { emoji: event.emoji, memberIds: [event.memberId] }]
        return current.map((g) => (g.emoji === event.emoji ? { ...g, memberIds: [...g.memberIds, event.memberId] } : g))
    }
    if (!existing?.memberIds.includes(event.memberId)) return current
    return current
        .map((g) => (g.emoji === event.emoji ? { ...g, memberIds: g.memberIds.filter((id) => id !== event.memberId) } : g))
        .filter((g) => g.memberIds.length > 0)
}

// ---------------------------------------------------------------------------
// Stream compaction — consecutive messages by the same author within a short
// window render without repeating the avatar/name.
// ---------------------------------------------------------------------------

const CONTINUATION_WINDOW_MS = 5 * 60 * 1000

export function isContinuation(prev: spaces.Message | undefined, next: spaces.Message, windowMs = CONTINUATION_WINDOW_MS): boolean {
    if (!prev) return false
    const a = prev.author
    const b = next.author
    if (a.memberId !== b.memberId || a.actingMode !== b.actingMode || (a.agentName ?? '') !== (b.agentName ?? '')) return false
    return new Date(next.postedAt).getTime() - new Date(prev.postedAt).getTime() <= windowMs
}

/** Calendar-day key for day dividers (local time). */
export function dayKey(iso: string): string {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDayLabel(iso: string, now: Date = new Date()): string {
    const d = new Date(iso)
    if (d.toDateString() === now.toDateString()) return 'Today'
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    if (d.toDateString() === y.toDateString()) return 'Yesterday'
    const sameYear = d.getFullYear() === now.getFullYear()
    return d.toLocaleDateString([], sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Windowed messages (listMessages returns the newest page; older pages load
// on demand). One merge everywhere: union by id, offset order — so a resync
// never throws away older loaded pages, and echoes dedupe against the frame
// that eventually arrives. The incoming copy wins (fresh reads carry folded
// reactions).
// ---------------------------------------------------------------------------

export function mergeMessages<M extends spaces.Message>(existing: readonly M[], incoming: readonly M[]): M[] {
    const byId = new Map(existing.map((m) => [m.id, m]))
    for (const m of incoming) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) => a.offset - b.offset)
}
