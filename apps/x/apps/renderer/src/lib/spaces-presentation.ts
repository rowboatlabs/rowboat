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

export function buildFileTree(entries: spaces.SpacesAssetEntry[]): FileTreeNode[] {
    const root: FileTreeNode = { name: '', path: '', kind: 'dir', children: [] }
    for (const entry of entries) {
        const parts = entry.path.split('/').filter(Boolean)
        let cursor = root
        parts.forEach((part, i) => {
            const isLeaf = i === parts.length - 1
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

/**
 * The one walker that turns wire member addresses ("@<memberId>") into
 * people. Code regions stay literal (same address-vs-cite line the trigger
 * logic draws); unknown ids pass through untouched; @rowboat keeps its
 * handle. Every mention-rendering path goes through here — fix it once.
 */
function mapMentions(body: string, memberNames: ReadonlyMap<string, string>, wrap: (handle: string) => string): string {
    const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    return parts
        .map((part, i) => {
            if (i % 2 === 1) return part // a code region — cite, not address
            return part.replace(/(^|[\s([{])@([A-Za-z0-9][\w.-]*)/g, (match, pre: string, id: string) => {
                if (id.toLowerCase() === 'rowboat') return `${pre}${wrap('@rowboat')}`
                const name = memberNames.get(id)
                return name ? `${pre}${wrap(`@${name}`)}` : match
            })
        })
        .join('')
}

/**
 * For markdown surfaces (message bodies): "@<memberId>" becomes
 * "**@Display Name**" so the pipeline sets it off in bold.
 */
export function decorateMentions(body: string, memberNames: ReadonlyMap<string, string>): string {
    return mapMentions(body, memberNames, (h) => `**${h}**`)
}

/**
 * For plain-text surfaces (topic titles, crumbs, reasons): same resolution,
 * no markup — safe for search haystacks and tooltips too.
 */
export function resolveMentions(body: string, memberNames: ReadonlyMap<string, string>): string {
    return mapMentions(body, memberNames, (h) => h)
}

/**
 * The inverse, for the composer: people type/pick "@Display Name" but the wire
 * address is "@<memberId>" (that's what mention notifications and agent
 * invocation scan for). Longest name first so "Ramnique Singh" wins over a
 * teammate named "Ramnique"; case-insensitive; code regions stay literal.
 * A member named "rowboat" never captures the agent's address.
 */
export function encodeMentions(body: string, members: readonly { id: string; displayName: string }[]): string {
    const ordered = members
        .filter((m) => m.displayName && m.displayName !== m.id && m.displayName.toLowerCase() !== 'rowboat')
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
