import type { spaces } from '@x/shared'

// Pure presentation helpers for the Spaces surfaces (design: "App shell scope
// planning" artboard). Everything here is data → display data; no IPC, no React.

// ---------------------------------------------------------------------------
// Identity visuals — initials + a stable colour per member / org
// ---------------------------------------------------------------------------

/** "Ramnique Sharma" → "RS"; "arjun" → "AR"; "" → "?" */
export function initials(name: string): string {
    const words = name.trim().split(/[\s._-]+/).filter(Boolean)
    if (words.length === 0) return '?'
    if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
    return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

/** Org monogram: "rowboat.team" → "RT", "Rowboat Labs (dev)" → "RL". */
export function orgMonogram(org: { name: string; address: string }): string {
    const fromAddress = org.address.replace(/^https?:\/\//, '').split(/[.:/]/).filter(Boolean)
    if (fromAddress.length >= 2 && !/^\d+$/.test(fromAddress[1]!)) {
        return (fromAddress[0]![0]! + fromAddress[1]![0]!).toUpperCase()
    }
    return initials(org.name.replace(/\(.*?\)/g, ''))
}

/** Tailwind classes for the avatar palette (design: blue / orange / teal / amber / indigo …). */
const AVATAR_PALETTE = [
    'bg-sky-600 text-white',
    'bg-orange-600 text-white',
    'bg-teal-600 text-white',
    'bg-amber-500 text-white',
    'bg-indigo-600 text-white',
    'bg-rose-600 text-white',
    'bg-emerald-600 text-white',
    'bg-violet-600 text-white',
] as const

export function avatarColorClass(id: string): string {
    let hash = 0
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!
}

// ---------------------------------------------------------------------------
// Attribution — person first, acting mode as a suffix (brief principle 2)
// ---------------------------------------------------------------------------

export type Attribution = spaces.ChangeSet['attribution']

export function attributionLabel(a: Attribution, members: Map<string, string>): string {
    const name = members.get(a.memberId) ?? a.memberId
    if (a.actingMode === 'direct') return name
    const agent = a.agentName ?? 'agent'
    return a.actingMode === 'scheduled' ? `${name} (via ${agent}, scheduled)` : `${name} (via ${agent})`
}

// ---------------------------------------------------------------------------
// Time — the feed shows clock time for today, "Yesterday 17:20", else "Aug 12"
// ---------------------------------------------------------------------------

export function formatFeedTime(iso: string, now: Date = new Date()): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    if (date.toDateString() === now.toDateString()) return clock
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${clock}`
    const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`
}

// ---------------------------------------------------------------------------
// File tree — flat asset paths → nested folders, files first-level sorted
// ---------------------------------------------------------------------------

export interface FileTreeNode {
    name: string
    path: string
    kind: 'file' | 'dir'
    children: FileTreeNode[]
    entry?: spaces.SpacesAssetEntry
}

export function buildFileTree(entries: spaces.SpacesAssetEntry[], draftFolders: readonly string[] = []): FileTreeNode[] {
    const root: FileTreeNode = { name: '', path: '', kind: 'dir', children: [] }
    const addPath = (fullPath: string, entry?: spaces.SpacesAssetEntry) => {
        const parts = fullPath.split('/').filter(Boolean)
        let cursor = root
        parts.forEach((part, i) => {
            const isLeaf = entry !== undefined && i === parts.length - 1
            const path = parts.slice(0, i + 1).join('/')
            let node = cursor.children.find((c) => c.name === part && c.kind === (isLeaf ? 'file' : 'dir'))
            if (!node) {
                node = { name: part, path, kind: isLeaf ? 'file' : 'dir', children: [] }
                if (isLeaf) node.entry = entry
                cursor.children.push(node)
            }
            cursor = node
        })
    }
    for (const entry of entries) addPath(entry.path, entry)
    // Draft folders: local-only empty folders (folders are key prefixes, so a
    // folder with no files exists only in the creator's view until one lands).
    for (const folder of draftFolders) addPath(folder)
    const sort = (nodes: FileTreeNode[]): FileTreeNode[] => {
        nodes.sort((a, b) => {
            // README first, then files, then folders — each alphabetical.
            const aReadme = a.kind === 'file' && /^readme\.md$/i.test(a.name)
            const bReadme = b.kind === 'file' && /^readme\.md$/i.test(b.name)
            if (aReadme !== bReadme) return aReadme ? -1 : 1
            if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1
            return a.name.localeCompare(b.name)
        })
        nodes.forEach((n) => sort(n.children))
        return nodes
    }
    return sort(root.children)
}

// ---------------------------------------------------------------------------
// Unread — client-side read marks (the protocol has no read cursors yet; a
// Latitude item). A change is unread when it landed after the member's mark
// and the member didn't make it themselves (chat unread lives in use-space-chat).
// ---------------------------------------------------------------------------

export function isUnreadChange(cs: spaces.ChangeSet, lastReadAt: string | null, selfMemberId: string): boolean {
    if (lastReadAt && cs.committedAt <= lastReadAt) return false
    return cs.attribution.memberId !== selfMemberId || cs.attribution.actingMode !== 'direct'
}

/** Short id for chips like "anchored to c4f9a1 · roadmap.md". */
export function shortId(id: string): string {
    return id.slice(-6).toLowerCase()
}

// ---------------------------------------------------------------------------
// Blobs — uploads referenced from markdown (contract decision 1, amended).
// The wire form is the link grammar's canonical https URL on the org address
// (stable for other clients and agents); display resolves it to the app://
// protocol main serves through the content-addressed cache.
// ---------------------------------------------------------------------------

export interface SpaceRefs {
    orgId: string
    /** host[:port] — the org address links are minted on. */
    orgAddress: string
    spaceId: string
}

/**
 * The canonical wire link for a blob — what goes INTO a message body.
 * `name` and `w`/`h` are display-only hints (the filename, and the pixel
 * dimensions from BlobInfo so renderers reserve the exact box before the
 * image loads) — storage is content-addressed and ignores them.
 */
export function blobWireUrl(refs: SpaceRefs, hash: string, name?: string, dims?: { width: number; height: number }): string {
    // Hand-built query: names keep the established %20 form (URLSearchParams
    // would switch to '+', silently changing the wire bytes of blob links).
    const parts: string[] = []
    if (name) parts.push(`name=${encodeURIComponent(name)}`)
    if (dims) parts.push(`w=${dims.width}`, `h=${dims.height}`)
    const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
    return `https://${refs.orgAddress}/s/${refs.spaceId}/b/${hash}${qs}`
}

/** The renderable form — app://space-blob/… served by main's protocol handler. */
export function blobAppUrl(refs: { orgId: string; spaceId: string }, hash: string, opts?: { thumb?: number; width?: number; height?: number }): string {
    const parts: string[] = []
    if (opts?.thumb) parts.push(`thumb=${opts.thumb}`)
    if (opts?.width && opts?.height) parts.push(`w=${opts.width}`, `h=${opts.height}`)
    const qs = parts.length > 0 ? `?${parts.join('&')}` : ''
    return `app://space-blob/${encodeURIComponent(refs.orgId)}/${encodeURIComponent(refs.spaceId)}/${hash}${qs}`
}

/** The w/h display hints off a blob URL (wire or app form) — null unless both parse positive. */
export function imageDimsFromUrl(url: string): { width: number; height: number } | null {
    try {
        const u = new URL(url)
        const width = Number(u.searchParams.get('w'))
        const height = Number(u.searchParams.get('h'))
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
        return { width, height }
    } catch {
        return null
    }
}

const BLOB_APP_URL_RE = /^app:\/\/space-blob\/([^/]+)\/([^/]+)\/([0-9a-f]{64})/

/** Parse an app://space-blob URL back into its parts (anchor-click interception). */
export function parseBlobAppUrl(url: string): { orgId: string; spaceId: string; hash: string } | null {
    const m = BLOB_APP_URL_RE.exec(url)
    if (!m) return null
    return { orgId: decodeURIComponent(m[1]!), spaceId: decodeURIComponent(m[2]!), hash: m[3]! }
}

/**
 * Rewrite the org's blob links inside a markdown body to their app:// form so
 * plain <img>/<a> rendering just works. Any space on the org is matched — the
 * serving path re-checks membership; a link the viewer can't fetch 404s into
 * a broken image, never into leaked bytes. Code regions stay literal.
 */
export function rewriteBlobLinks(body: string, refs: SpaceRefs): string {
    const host = refs.orgAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`https://${host}/s/([0-9A-HJKMNP-TV-Z]{26})/b/([0-9a-f]{64})`, 'g')
    const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    return parts
        .map((part, i) => {
            if (i % 2 === 1) return part // a code region — cite, not render
            return part.replace(re, (_m, spaceId: string, hash: string) =>
                blobAppUrl({ orgId: refs.orgId, spaceId }, hash),
            )
        })
        .join('')
}

export function isImageMime(mime: string | undefined): boolean {
    return !!mime && mime.startsWith('image/')
}

/** "1234567" → "1.2 MB" — file cards and upload chips. */
export function formatBytes(size: number): string {
    if (!Number.isFinite(size) || size < 0) return ''
    if (size < 1024) return `${size} B`
    const units = ['KB', 'MB', 'GB']
    let value = size
    let unit = 'B'
    for (const u of units) {
        if (value < 1024) break
        value /= 1024
        unit = u
    }
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

// The wire-address → person walker lives in @x/shared (main's notification
// text resolves through the same code); re-exported to keep the renderer's
// import path.
export { decorateMentions, resolveMentions } from '@x/shared/dist/spaces.js'

/**
 * The inverse, for the composer: people type/pick "@Display Name" but the wire
 * address is "@<memberId>" (that's what mention notifications and agent
 * invocation scan for). Longest name first so "Ramnique Singh" wins over a
 * teammate named "Ramnique"; case-insensitive; code regions stay literal.
 * A member named "rowboat" or "here" never captures those addresses.
 */
export function encodeMentions(body: string, members: readonly { id: string; displayName: string }[]): string {
    const ordered = members
        .filter((m) => m.displayName && m.displayName !== m.id && !['rowboat', 'here'].includes(m.displayName.toLowerCase()))
        .sort((a, b) => b.displayName.length - a.displayName.length)
    if (ordered.length === 0) return body
    const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    return parts
        .map((part, i) => {
            if (i % 2 === 1) return part // a code region — cite, not address
            let out = part
            for (const m of ordered) {
                const escaped = m.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                out = out.replace(new RegExp(`(^|[\\s([{])@${escaped}(?![\\w.-])`, 'gi'), `$1@${m.id}`)
            }
            return out
        })
        .join('')
}

// ---------------------------------------------------------------------------
// File links — plain relative markdown links resolve against the space's file
// tree (GitHub README semantics): in a file, against the file's own folder; in
// a message, against the space root. Leading "/" always means the root. The
// wire form is just standard markdown — nothing special for agents to learn.
// ---------------------------------------------------------------------------

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * A markdown href → the asset path it points at, or null when the link is not
 * ours (absolute URL, mailto:, in-page #anchor, or a ".." walk past the root).
 */
export function resolveSpaceLink(raw: string, baseDir: string): string | null {
    if (!raw || raw.startsWith('#') || raw.startsWith('//') || SCHEME_RE.test(raw)) return null
    let target = raw.split('#')[0]!.split('?')[0]!
    try {
        target = decodeURIComponent(target)
    } catch {
        // malformed escapes — treat the text literally
    }
    if (!target.replace(/\//g, '')) return null
    const segments = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean)
    for (const seg of target.split('/')) {
        if (!seg || seg === '.') continue
        if (seg === '..') {
            if (segments.length === 0) return null
            segments.pop()
            continue
        }
        segments.push(seg)
    }
    return segments.length > 0 ? segments.join('/') : null
}

/** An asset path → a markdown link target that survives spaces and parens. */
export function encodeSpaceLinkTarget(path: string): string {
    return path
        .split('/')
        .map((seg) => encodeURIComponent(seg).replace(/[()]/g, (ch) => (ch === '(' ? '%28' : '%29')))
        .join('/')
}

/** The contract's canonical asset link (…/s/<spaceId>/f/<path>) → its path, for THIS space. */
export function parseAssetWireUrl(url: string, refs: SpaceRefs): string | null {
    const prefix = `https://${refs.orgAddress}/s/${refs.spaceId}/f/`
    if (!url.startsWith(prefix)) return null
    const rest = url.slice(prefix.length).split('#')[0]!.split('?')[0]!
    return resolveSpaceLink(`/${rest}`, '')
}

/**
 * The renderable form of a file link — a render-time-only internal URL (never
 * persisted). Chat markdown goes through Streamdown, whose harden pass strips
 * relative hrefs (a bare `a/b.md` isn't parseable as a URL) but passes custom
 * protocols untouched — so relative links rewrite to this before parsing, and
 * the anchor component maps it back to the path.
 */
export function spaceFileAppUrl(refs: { orgId: string; spaceId: string }, path: string): string {
    return `app://space-file/${encodeURIComponent(refs.orgId)}/${encodeURIComponent(refs.spaceId)}/${encodeSpaceLinkTarget(path)}`
}

const SPACE_FILE_APP_URL_RE = /^app:\/\/space-file\/([^/]+)\/([^/]+)\/(.+)$/

export function parseSpaceFileAppUrl(url: string): { orgId: string; spaceId: string; path: string } | null {
    const m = SPACE_FILE_APP_URL_RE.exec(url)
    if (!m) return null
    const path = resolveSpaceLink(`/${m[3]!}`, '')
    if (!path) return null
    return { orgId: decodeURIComponent(m[1]!), spaceId: decodeURIComponent(m[2]!), path }
}

/**
 * Rewrite relative markdown LINKS (not images) in a message body to their
 * app://space-file form so they survive Streamdown's URL hardening. Code
 * regions are cites; absolute URLs and in-page anchors stay literal.
 */
export function rewriteFileLinks(body: string, refs: { orgId: string; spaceId: string }): string {
    const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    return parts
        .map((part, i) => {
            if (i % 2 === 1) return part
            return part.replace(/(!?)\[([^\]]*)\]\(([^()\s]+)(\s+"[^"]*")?\)/g, (m, bang: string, text: string, target: string, title?: string) => {
                if (bang) return m
                const path = resolveSpaceLink(target, '')
                return path ? `[${text}](${spaceFileAppUrl(refs, path)}${title ?? ''})` : m
            })
        })
        .join('')
}

/**
 * Rewrite relative image references in a markdown body to renderable URLs
 * (app://space-blob through srcFor). Only references that resolve to a real
 * image asset change; everything else — external URLs, text files, broken
 * paths — stays literal. Code regions are cites, never rewritten.
 */
export function rewriteRelativeImages(body: string, baseDir: string, srcFor: (path: string) => string | null): string {
    const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    return parts
        .map((part, i) => {
            if (i % 2 === 1) return part
            return part.replace(/!\[([^\]]*)\]\(([^()\s]+)(\s+"[^"]*")?\)/g, (m, alt: string, target: string, title?: string) => {
                const path = resolveSpaceLink(target, baseDir)
                const src = path ? srcFor(path) : null
                return src ? `![${alt}](${src}${title ?? ''})` : m
            })
        })
        .join('')
}

// ---------------------------------------------------------------------------
// Tasks — the file view renders checkboxes live; a tap flips the Nth task
// line and proposes the edit. The index counts rendered task items in
// document order, so the scan must skip fenced code (not a task, not a node).
// ---------------------------------------------------------------------------

const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\]\s)/

/** Flip the checkbox on the index-th task line (document order); null when out of range. */
export function toggleTaskAt(content: string, index: number): string | null {
    const lines = content.split('\n')
    let fence: string | null = null
    let seen = 0
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!
        const fenceMark = line.match(/^\s*(```+|~~~+)/)?.[1]
        if (fenceMark) {
            if (fence === null) fence = fenceMark[0]!
            else if (fenceMark[0] === fence) fence = null
            continue
        }
        if (fence !== null) continue
        const m = line.match(TASK_LINE_RE)
        if (!m) continue
        if (seen === index) {
            lines[i] = line.replace(TASK_LINE_RE, (_all, pre: string, state: string, post: string) =>
                `${pre}${state === ' ' ? 'x' : ' '}${post}`)
            return lines.join('\n')
        }
        seen += 1
    }
    return null
}
