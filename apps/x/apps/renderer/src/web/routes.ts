import type { RailSelection } from '@/lib/spaces-selection'

// The web app's addresses: the desktop's Spaces navigation (an org, a space,
// what is open inside it, or an org-level surface) as a path, so a reload, a
// shared link and the browser's back button all land where they should. The
// shapes follow Harbor's own org links where one exists (/s/<space>,
// /s/<space>/a/<asset>), under the org's slug.
//
//   /<org>                      the org (its first space opens)
//   /<org>/activity | /browse   an org-level surface
//   /<org>/s/<space>            the stream
//   …/discussions | …/files     the space's lists
//   …/t/<root>                  a thread
//   …/a/<asset> | …/w/<asset>   a file | a whiteboard
//
// A previewed attachment has no address of its own: it rides history.state
// and a reload lands on its space.

export interface WebRoute {
    orgKey?: string
    spaceId?: string
    view?: 'activity' | 'browse'
    rail: RailSelection
}

const GENERAL: RailSelection = { kind: 'general' }

export function parseRoute(pathname: string): WebRoute {
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const [orgKey, section, spaceId, kind, id] = parts
    if (!orgKey) return { rail: GENERAL }
    if (section === 'activity' || section === 'browse') return { orgKey, view: section, rail: GENERAL }
    if (section !== 's' || !spaceId) return { orgKey, rail: GENERAL }
    const rail: RailSelection =
        kind === 'discussions' ? { kind: 'discussions' }
        : kind === 'files' ? { kind: 'files' }
        : kind === 't' && id ? { kind: 'thread', rootMessageId: id }
        : kind === 'a' && id ? { kind: 'file', assetId: id }
        : kind === 'w' && id ? { kind: 'whiteboard', assetId: id }
        : GENERAL
    return { orgKey, spaceId, rail }
}

export function routePath(orgKey: string, target: { spaceId?: string; view?: 'activity' | 'browse'; rail?: RailSelection }): string {
    const org = `/${encodeURIComponent(orgKey)}`
    if (target.view) return `${org}/${target.view}`
    if (!target.spaceId) return org
    const space = `${org}/s/${encodeURIComponent(target.spaceId)}`
    const rail = target.rail ?? GENERAL
    switch (rail.kind) {
        case 'discussions':
        case 'files':
            return `${space}/${rail.kind}`
        case 'thread':
            return `${space}/t/${encodeURIComponent(rail.rootMessageId)}`
        case 'file':
            return `${space}/a/${encodeURIComponent(rail.assetId)}`
        case 'whiteboard':
            return `${space}/w/${encodeURIComponent(rail.assetId)}`
        default:
            return space
    }
}
