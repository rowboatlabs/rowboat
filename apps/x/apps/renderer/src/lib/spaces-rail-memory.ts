import type { RailSelection } from '@/lib/spaces-selection'

/**
 * What was open inside each space for this app session — the discussion, the
 * file, the board. Opening a space without naming what to open inside it (a
 * sidebar row, the server switcher, the command palette) landed on the stream,
 * so stepping out to another channel and back lost the discussion you were
 * reading. Recalled here instead, a space comes back as you left it
 * (2026-09-23).
 *
 * Written from App's one route into Spaces, so every navigation — a click, the
 * ‹ ›, a deep link — is what it remembers. Not persisted: like the per-space
 * column memory, a relaunch lands on the conversation, clean. Which channel or
 * DM a server itself opens on is the visit record's answer (spaces-visits).
 */
const rails = new Map<string, RailSelection>()

const key = (orgId: string, spaceId: string) => `${orgId}/${spaceId}`

export function rememberRail(orgId: string, spaceId: string, rail: RailSelection): void {
    if (!orgId || !spaceId) return
    rails.set(key(orgId, spaceId), rail)
}

/** What the space was left showing, or null for one not opened this session. */
export function recallRail(orgId: string, spaceId: string): RailSelection | null {
    return rails.get(key(orgId, spaceId)) ?? null
}

/**
 * What opening a space should show. A caller that names it wins — a deep link,
 * a message in Activity, a file someone shared point at one thing and must
 * land on it. A caller that only names the room (a sidebar row, the server
 * switcher, the palette) gets it back as it was left, and the stream for a
 * room this session has not been in.
 */
export function railForOpening(orgId: string, spaceId: string, named?: RailSelection): RailSelection {
    return named ?? recallRail(orgId, spaceId) ?? { kind: 'general' }
}

/** Tests only: the memory is module state, so a test must not leak into the next. */
export function clearRailMemory(): void {
    rails.clear()
}
