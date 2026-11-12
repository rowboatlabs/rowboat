import { isOrgView, type OrgView } from '@/lib/spaces-navigation'
import type { RailSelection } from '@/lib/spaces-selection'

// The web app's addresses: the desktop's Spaces navigation (a space, what is
// open inside it, or a server-level surface) as a path, so a reload, a shared
// link and the browser's back button all land where they should. The shapes
// follow Harbor's own links where one exists (/s/<space>, /s/<space>/a/<asset>).
// One server since 2026-11-09: nothing prefixes the path (it was the org's slug).
//
//   /                           the server (its last chat opens)
//   /activity | /threads | /agents   a server-level surface
//   /s/<space>                  the stream
//   …/discussions | …/files     the space's lists
//   …/discussions/t/<root>      a thread beside the Threads list (2026-11-03)
//   …/t/<root>                  a thread
//   …/a/<asset> | …/w/<asset>   a file | a whiteboard
//
// A previewed attachment has no address of its own: it rides history.state
// and a reload lands on its space.

export interface WebRoute {
    spaceId?: string
    view?: OrgView
    rail: RailSelection
}

const GENERAL: RailSelection = { kind: 'general' }

export function parseRoute(pathname: string): WebRoute {
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const [section, spaceId, kind, id] = parts
    if (!section) return { rail: GENERAL }
    if (isOrgView(section)) return { view: section, rail: GENERAL }
    if (section !== 's' || !spaceId) return { rail: GENERAL }
    const rail: RailSelection =
        kind === 'discussions' ? { kind: 'discussions', ...(id === 't' && parts[4] ? { rootMessageId: parts[4] } : {}) }
        : kind === 'settings' ? { kind: 'settings' }
        : kind === 'files' ? { kind: 'files' }
        : kind === 't' && id ? { kind: 'thread', rootMessageId: id }
        : kind === 'a' && id ? { kind: 'file', assetId: id }
        : kind === 'w' && id ? { kind: 'whiteboard', assetId: id }
        : GENERAL
    return { spaceId, rail }
}

export function routePath(target: { spaceId?: string; view?: OrgView; rail?: RailSelection }): string {
    if (target.view) return `/${target.view}`
    if (!target.spaceId) return '/'
    const space = `/s/${encodeURIComponent(target.spaceId)}`
    const rail = target.rail ?? GENERAL
    switch (rail.kind) {
        case 'discussions':
            return `${space}/discussions${rail.rootMessageId ? `/t/${encodeURIComponent(rail.rootMessageId)}` : ''}`
        case 'settings':
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
