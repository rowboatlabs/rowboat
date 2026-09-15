import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { readRailSelection, type RailSelection } from '@/lib/spaces-selection'

export const LAST_SPACE_STORAGE_KEY = 'x:last-space'

/**
 * Where Spaces was left. The space is only half of it: an open discussion, a
 * file, a board — or the org's Activity surface instead of a space — is part
 * of the location too, so re-entering the section restores the whole thing
 * rather than dropping the reader back on the stream.
 */
export type SpaceLocation = {
    orgId: string
    spaceId: string
    /** What was open inside the space (a discussion, a file, a board). */
    rail?: RailSelection
    /** An org-level surface instead of a space (spaceId is '' then): Activity. */
    view?: 'activity'
}

/**
 * Where "open this server" lands: its first shared space, or its first DM when
 * it has no channels, or nothing at all on an empty server. One answer, so the
 * switcher, the sidebar and a restored location all enter a server the same way.
 */
export function serverLandingSpaceId(org: Pick<OrgWithSpaces, 'spaces' | 'directs'>): string {
    return org.spaces[0]?.id ?? org.directs[0]?.id ?? ''
}

/** Restore a valid location, preferring another space on the same server if it was deleted. */
export function resolveSpacesLocation(orgs: OrgWithSpaces[], previous: unknown): SpaceLocation | null {
    const saved = readLocation(previous)
    const previousOrg = saved ? orgs.find((org) => org.id === saved.orgId) : undefined
    // An org-level surface has no space to validate against — the server being
    // there is the whole of it.
    if (previousOrg && saved?.view === 'activity') return { orgId: previousOrg.id, spaceId: '', view: 'activity' }
    if (previousOrg && saved && [...previousOrg.spaces, ...previousOrg.directs].some((space) => space.id === saved.spaceId)) {
        // The space survived, so what was open inside it comes back with it.
        return { orgId: previousOrg.id, spaceId: saved.spaceId, ...(saved.rail ? { rail: saved.rail } : {}) }
    }
    // Landing on a different space than the saved one: its rail selection named
    // a discussion or a file in the space that is gone, so it stays behind.
    const org = previousOrg ?? orgs.find((org) => org.spaces.length > 0 || org.directs.length > 0) ?? orgs[0]
    return org ? { orgId: org.id, spaceId: serverLandingSpaceId(org) } : null
}

/**
 * Shape-check a remembered location. It arrives either as live app state or as
 * whatever JSON.parse handed back from storage, so every field is checked —
 * the rail included: a stored selection from before files were named by id
 * (a path-shaped file or board rail) comes back as the stream, not a crash.
 */
function readLocation(previous: unknown): SpaceLocation | null {
    if (!previous || typeof previous !== 'object') return null
    const { orgId, spaceId, rail, view } = previous as Partial<SpaceLocation>
    if (typeof orgId !== 'string' || typeof spaceId !== 'string') return null
    const checked = rail ? readRailSelection(rail) : undefined
    return { orgId, spaceId, ...(checked && checked.kind !== 'general' ? { rail: checked } : {}), ...(view === 'activity' ? { view } : {}) }
}

/**
 * The last space opened, persisted by App. Carries the space (and Activity),
 * not the rail: a relaunch lands on the conversation, clean — the same call
 * the per-space column memory makes.
 */
export function readLastSpace(): unknown {
    try { return JSON.parse(localStorage.getItem(LAST_SPACE_STORAGE_KEY) ?? 'null') }
    catch { return null }
}

/**
 * The org link landings (Harbor http.ts) hand a browser-opened link into the
 * app as rowboat://open?type=spaces&org=<address>&…: a space, a file in it, a
 * message in it (root or reply), or a person. What they name is resolved
 * before navigating — the org by address from the signed-in list, a reply's
 * thread from the org, a person's DM created on first use.
 */
export interface SpacesLinkTarget {
  orgAddress: string
  spaceId?: string
  assetId?: string
  messageId?: string
  memberId?: string
  /** An invite (the /join landing): the token, to be joined — not something to navigate to. */
  inviteToken?: string
}

export function parseSpacesLink(input: string): SpacesLinkTarget | null {
  // Some OS handlers normalise the authority form to rowboat://open/?… — the
  // same tolerance every other rowboat:// parser has.
  const m = /^rowboat:\/\/open\/?\?(.*)$/.exec(input)
  if (!m) return null
  const params = new URLSearchParams(m[1]!)
  const orgAddress = params.get('org')
  if (params.get('type') !== 'spaces' || !orgAddress) return null
  const pick = (k: string) => params.get(k) || undefined
  const target: SpacesLinkTarget = { orgAddress }
  const spaceId = pick('spaceId'), assetId = pick('assetId'), messageId = pick('messageId'), memberId = pick('memberId')
  const inviteToken = pick('invite')
  if (spaceId) target.spaceId = spaceId
  if (assetId) target.assetId = assetId
  if (messageId) target.messageId = messageId
  if (memberId) target.memberId = memberId
  if (inviteToken) target.inviteToken = inviteToken
  return target
}

