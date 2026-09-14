import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { directAvatarId, isSelfDirect } from '@/lib/spaces-direct'
import { NO_BADGE, type SpaceBadge } from '@/lib/spaces-read-state'

// The sidebar's working set: per server, the few channels and DMs the reader
// is likeliest to open next. The siderail stays the full tree — this is a
// short, STABLE list, so the rows must not shuffle under the pointer: only an
// item entering or leaving the set moves anything.

/** Rows one expanded server shows. Constant: the section's height is 1 + K per server. */
export const ITEMS_PER_SERVER = 3

/**
 * One row. A discussion is never one of these: it belongs to its parent
 * channel and is shown only in the siderail.
 */
export interface WorkingSetItem {
    id: string
    kind: 'channel' | 'direct'
    /** What the row shows, and the alphabetical backfill's sort key. */
    name: string
    /** From the shared read-state store — the same badge the siderail reads. */
    badge: SpaceBadge
    /** Newest activity, ISO; the space's createdAt until something happens in it. */
    lastActivityAt: string
    /** When this install last opened it (epoch ms); null = never. */
    lastVisitedAt: number | null
    /** The server's landing channel — first in the deterministic backfill. */
    isDefault?: boolean
    /** DMs: the face the row wears. */
    avatarId?: string
    /** DMs: your notes-to-self, which is a DM like any other. */
    self?: boolean
}

function hasUnread(item: WorkingSetItem): boolean {
    return item.badge.unread > 0 || item.badge.forYou > 0
}

/** The server's own number: its items' badges, summed (a collapsed server shows it). */
export function sumBadges(items: readonly { badge: SpaceBadge }[]): SpaceBadge {
    let unread = 0
    let forYou = 0
    for (const item of items) {
        unread += item.badge.unread
        forYou += item.badge.forYou
    }
    return unread === 0 ? NO_BADGE : { unread, forYou }
}

/**
 * A server's channels and DMs as rows — the one place the "threads are not
 * items" rule is kept, by reading only the org's spaces and directs.
 */
export function serverItems(
    org: OrgWithSpaces,
    read: {
        badge: (spaceId: string) => SpaceBadge
        visitedAt: (spaceId: string) => number | null
        activityAt: (spaceId: string) => string | null
        label: (space: spaces.Space) => string
    },
): WorkingSetItem[] {
    // The first shared space is the server's landing channel: every "open this
    // server" path in the app lands there.
    const channels = org.spaces.map((space, index): WorkingSetItem => ({
        id: space.id,
        kind: 'channel',
        name: space.name,
        badge: read.badge(space.id),
        lastActivityAt: read.activityAt(space.id) ?? space.createdAt,
        lastVisitedAt: read.visitedAt(space.id),
        isDefault: index === 0,
    }))
    const directs = org.directs.map((dm): WorkingSetItem => ({
        id: dm.id,
        kind: 'direct',
        name: read.label(dm),
        badge: read.badge(dm.id),
        lastActivityAt: read.activityAt(dm.id) ?? dm.createdAt,
        lastVisitedAt: read.visitedAt(dm.id),
        avatarId: directAvatarId(dm, org.memberId),
        self: isSelfDirect(dm, org.memberId),
    }))
    return [...channels, ...directs]
}

function byName(a: WorkingSetItem, b: WorkingSetItem): number {
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

/**
 * Every item, best claim on a row first: the open one, then what is waiting
 * (newest activity first), then what the reader keeps coming back to, then a
 * deterministic backfill so the list is never short and never arbitrary.
 */
function rankItems(items: readonly WorkingSetItem[], currentItemId: string | null): WorkingSetItem[] {
    const current = items.find((item) => item.id === currentItemId)
    const rest = items.filter((item) => item.id !== current?.id)
    const unread = rest.filter(hasUnread)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || byName(a, b))
    const visited = rest.filter((item) => !hasUnread(item) && item.lastVisitedAt !== null)
        .sort((a, b) => (b.lastVisitedAt ?? 0) - (a.lastVisitedAt ?? 0) || byName(a, b))
    const cold = rest.filter((item) => !hasUnread(item) && item.lastVisitedAt === null)
    const backfill = [
        ...cold.filter((item) => item.kind === 'channel' && item.isDefault),
        ...cold.filter((item) => item.kind === 'channel' && !item.isDefault).sort(byName),
        ...cold.filter((item) => item.kind === 'direct').sort(byName),
    ]
    return [...(current ? [current] : []), ...unread, ...visited, ...backfill]
}

/**
 * The K rows one server shows, in the order they should render.
 *
 * `previous` is the ids showing now: a row already on screen keeps its place,
 * however its unread or recency has moved since — revisiting what is already
 * there must not make the list jump. Only an item joining or dropping out
 * moves anything, and a joining one lands where its rank puts it.
 */
export function selectServerItems(
    items: readonly WorkingSetItem[],
    currentItemId: string | null,
    k: number = ITEMS_PER_SERVER,
    previous: readonly string[] = [],
): WorkingSetItem[] {
    const chosen = rankItems(items, currentItemId).slice(0, Math.max(0, k))
    const rank = new Map(chosen.map((item, index) => [item.id, index]))
    const order: string[] = []
    for (const id of previous) if (rank.has(id) && !order.includes(id)) order.push(id)
    for (const item of chosen) {
        if (order.includes(item.id)) continue
        // Behind everything already showing that outranks it, ahead of the rest.
        let at = order.length
        while (at > 0 && rank.get(order[at - 1])! > rank.get(item.id)!) at -= 1
        order.splice(at, 0, item.id)
    }
    const byId = new Map(chosen.map((item) => [item.id, item]))
    return order.map((id) => byId.get(id)!)
}

/**
 * Is this server's list open? Automatic until the reader says otherwise: a
 * server holding the open space, or anything unread, opens itself; every
 * other one stays shut. `manualOverride` is that reader's standing answer.
 */
export function resolveExpanded(
    server: { items: readonly WorkingSetItem[] },
    currentItemId: string | null,
    manualOverride?: boolean | null,
): boolean {
    if (typeof manualOverride === 'boolean') return manualOverride
    if (currentItemId && server.items.some((item) => item.id === currentItemId)) return true
    return server.items.some(hasUnread)
}
