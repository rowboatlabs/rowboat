import type { spaces } from '@x/shared'

// Chat-first conventions. The contract now carries the real fields —
// Topic.kind, Topic.anchorMessageId, ChangeSet.topicId (Harbor migration 004
// backfilled pre-contract data from exactly the legacy shapes parsed here).
// The legacy parsers below remain as fallbacks for topics minted by pre-004
// servers (a teammate's stale local Harbor); delete them once none are left.

// ---------------------------------------------------------------------------
// Messages — the space's open stream (internally still "general")
// ---------------------------------------------------------------------------

/** The stream topic's title. "general" was the first spike build's name; still recognised. */
export const GENERAL_TITLE = 'messages'
const LEGACY_GENERAL_TITLES = new Set(['messages', 'general'])
/** Body of the seed message that creates the stream topic (its first line becomes the title). Hidden in the UI. */
export const GENERAL_SEED_BODY = 'messages'

/**
 * The space's stream: the topic the server marked kind 'general' (seeded at
 * space creation, unique per space). Fallback for pre-004 servers: the oldest
 * open topic titled "messages"/"general" — ties (a seed race) resolve older.
 */
export function findGeneralTopic(topics: spaces.Topic[]): spaces.Topic | null {
    const marked = topics.find((t) => t.kind === 'general' && !t.archived)
    if (marked) return marked
    const candidates = topics.filter((t) => !t.archived && LEGACY_GENERAL_TITLES.has(t.title.trim().toLowerCase()))
    if (candidates.length === 0) return null
    candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    return candidates[0] ?? null
}

/** The seed message is scaffolding, never shown. */
export function isGeneralSeedMessage(general: spaces.Topic, message: spaces.Message, index: number): boolean {
    return index === 0 && message.topicId === general.id && LEGACY_GENERAL_TITLES.has(message.body.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Topics born from a message in the stream ("reply"). The first message
// is the parent's text (so the server-derived title is the parent text) plus a
// marker the client reads. deriveTitle strips headings/bullets but not ">",
// so the parent text goes in as a plain first line, never a blockquote.
// ---------------------------------------------------------------------------

export interface ThreadMarker {
    parentMessageId: string
    parentAuthorId: string
    parentPostedAt: string
}

// Reads both spellings: "topic" is current, "thread" was the first spike build.
const MARKER_RE = /<!--\s*rowboat:(?:topic|thread)\s+parent=msg:([0-9A-Za-z_-]+)\s+by=(\S+)\s+at=(\S+)\s*-->/

export function buildThreadSeed(parent: spaces.Message): string {
    const text = parent.body.trim()
    return `${text}\n\n<!-- rowboat:topic parent=msg:${parent.id} by=${parent.author.memberId} at=${parent.postedAt} -->`
}

export function parseThreadMarker(body: string): ThreadMarker | null {
    const m = MARKER_RE.exec(body)
    if (!m) return null
    return { parentMessageId: m[1]!, parentAuthorId: m[2]!, parentPostedAt: m[3]! }
}

/** The first message without its marker — what the parent card renders. */
export function stripThreadMarker(body: string): string {
    return body.replace(MARKER_RE, '').trimEnd()
}

// ---------------------------------------------------------------------------
// Artifacts — change-sets made from a topic carry its id at the end of the
// reason. Two producers only: the Fold gesture and the topic agent's prompt.
// ---------------------------------------------------------------------------

const THREAD_REF_RE = /\s*·\s*(?:topic|thread):([0-9A-Za-z_-]+)\s*$/

export function withThreadRef(reason: string, topicId: string): string {
    const base = stripThreadRef(reason).trim()
    return base ? `${base} · topic:${topicId}` : `topic:${topicId}`
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

/** Change-sets made from this topic, grouped by file, newest group first. */
export function artifactsForThread(changeSets: spaces.ChangeSet[], topicId: string): ArtifactGroup[] {
    const mine = changeSets.filter((c) => (c.topicId ?? threadRefOf(c.reason)) === topicId)
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
