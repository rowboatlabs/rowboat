import { getDirectorySpace, loadSpaceDirectory } from '@/hooks/use-space-directory'
import { findSpace, getSpacesOrgs, refreshSpacesOrgs } from '@/hooks/use-spaces'
import type { SpacesLinkTarget } from '@/lib/spaces-navigation'
import type { RailSelection } from '@/lib/spaces-selection'

// Where a spaces link opens (2026-10-13). The desktop gets a browser-opened
// link as a rowboat:// deep link and the web app as its /open address, with
// the same query, and both resolve it here; each then navigates its own way.
// What the link names is checked before anything opens: the org by address
// from the signed-in list, a reply's thread from the org, a person's DM
// created on first use. An invite is joined, not opened.

export interface SpacesPlace {
    orgId: string
    spaceId?: string
    view?: 'activity'
    rail?: RailSelection
    /** The message to land on, and its offset, so the pane can load around it without asking. */
    messageId?: string
    messageOffset?: number
}

export type SpacesLinkOutcome =
    | { kind: 'place'; place: SpacesPlace }
    /** The https invite link, for the join dialog, which resolves it pre-auth and shows the card. */
    | { kind: 'invite'; inviteUrl: string }
    /** The link's org is not one this person is signed in to. */
    | { kind: 'unknown-org'; orgAddress: string }
    /** The org could not open it; `place` is where to land instead, when anywhere. */
    | { kind: 'refused'; message: string; place?: SpacesPlace }

export async function resolveSpacesLink(target: SpacesLinkTarget): Promise<SpacesLinkOutcome> {
    if (getSpacesOrgs().length === 0) await refreshSpacesOrgs()
    const org = getSpacesOrgs().find((o) => o.address === target.orgAddress)
    if (target.inviteToken) {
        // Rebuilt from a signed-in org's own base URL, else https on the address.
        const base = org?.baseUrl ?? `https://${target.orgAddress}`
        return { kind: 'invite', inviteUrl: `${base}/join/${target.inviteToken}` }
    }
    if (!org) return { kind: 'unknown-org', orgAddress: target.orgAddress }
    try {
        if (target.memberId) {
            const { space } = await window.ipc.invoke('spaces:openDirect', { orgId: org.id, memberId: target.memberId })
            await refreshSpacesOrgs()
            return { kind: 'place', place: { orgId: org.id, spaceId: space.id, rail: { kind: 'general' } } }
        }
        if (!target.spaceId) return { kind: 'place', place: { orgId: org.id, view: 'activity' } }
        if (!findSpace(org, target.spaceId)) await loadSpaceDirectory(org.id)
        if (!findSpace(org, target.spaceId) && !getDirectorySpace(org.id, target.spaceId)) {
            return { kind: 'refused', message: 'This space is unavailable or you do not have access', place: { orgId: org.id, view: 'activity' } }
        }
        if (target.assetId) {
            return { kind: 'place', place: { orgId: org.id, spaceId: target.spaceId, rail: { kind: 'file', assetId: target.assetId } } }
        }
        if (target.messageId) {
            // A reply lands in its thread; the org says which one.
            const { message } = await window.ipc.invoke('spaces:getMessage', { orgId: org.id, spaceId: target.spaceId, messageId: target.messageId })
            return {
                kind: 'place',
                place: {
                    orgId: org.id,
                    spaceId: target.spaceId,
                    rail: message.threadRoot ? { kind: 'thread', rootMessageId: message.threadRoot } : { kind: 'general' },
                    messageId: target.messageId,
                    messageOffset: message.offset,
                },
            }
        }
        return { kind: 'place', place: { orgId: org.id, spaceId: target.spaceId, rail: { kind: 'general' } } }
    } catch (err) {
        return { kind: 'refused', message: err instanceof Error ? err.message : 'Could not open that link' }
    }
}
