import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Bot, FileText, Hash, Megaphone } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { MemberAvatar } from '@/components/spaces/atoms'
import { caretContext, type CaretContext } from '@/components/spaces/composer-editor'
import { useSpaceRefs } from '@/components/spaces/space-markdown'
import { useOrgListings } from '@/hooks/use-space-boards'
import { useOrgRoster, useSpaceMembers } from '@/hooks/use-space-members'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { assetWireUrl } from '@/lib/spaces-presentation'

// The @ autocomplete behind every mention surface — the composer and the
// inline message editor. The hook owns the popup's whole lifecycle off the
// editor's own events; the host renders <MentionMenu> inside its relative
// box and routes keydowns through onKeyDown ahead of its other bindings.
// What it offers comes from the pane's refs alone (both hosts get the same
// sources): the whole org's people, its shared spaces, and the files of
// every shared space the reader is in — this space's ranking first.

export interface MentionCandidate {
    id: string
    label: string
    hint?: string
    isAgent?: boolean
    isBroadcast?: boolean
    /** A space suggestion — picking it inserts a `#Name` reference (a space mention node). */
    space?: { id: string; name: string }
    /** A file suggestion — picking it inserts a markdown link naming the file by id, on its own space. `spaceName` is set when that is not this space. */
    file?: { assetId: string; path: string; spaceId: string; spaceName?: string }
}

// "/" so typing into a folder ("@design/sc…") keeps the file query alive.
export const MENTION_RE = /(^|[\s([{])@([\w./-]*)$/

/** The menu's row cap — ten fit the scroll box; a narrower query brings the rest up. */
const MAX_ROWS = 10

const NO_SPACE_IDS: readonly string[] = []

export function useMentionAutocomplete(editor: Editor | null) {
    /** Where the caret sits (text-before-caret + doc position) — what the trigger matches against. */
    const [context, setContext] = useState<CaretContext | null>(null)
    const [open, setOpen] = useState(false)
    const [index, setIndex] = useState(0)

    // The sources. Without refs (a host outside a space pane) every store
    // read is empty and no request is fired.
    const refs = useSpaceRefs()
    const orgId = refs?.orgId ?? ''
    const spaceId = refs?.spaceId ?? ''
    const { orgs } = useSpacesOrgs()
    const org = orgs.find((o) => o.id === orgId)
    const selfMemberId = org?.memberId
    const sharedIds = useMemo(() => org?.spaces.map((s) => s.id) ?? NO_SPACE_IDS, [org])
    // Files: every shared space's, plus this one's when it is a DM (a DM's
    // own files open for its participants; other DMs' files open for nobody).
    const listingOrgs = useMemo(
        () => (orgId ? [{ id: orgId, spaceIds: spaceId && !sharedIds.includes(spaceId) ? [spaceId, ...sharedIds] : sharedIds }] : []),
        [orgId, spaceId, sharedIds],
    )
    const spaceMembers = useSpaceMembers(orgId, spaceId)
    const orgRoster = useOrgRoster(orgId, sharedIds)
    const listings = useOrgListings(listingOrgs).get(orgId)

    // Open on "@" at a word start; stay open while the query grows. A plain
    // caret move only retargets the match — clicking beside an "@word" that
    // is already text must not pop the menu.
    useEffect(() => {
        if (!editor) return
        const onUpdate = ({ editor: ed }: { editor: Editor }) => {
            const ctx = caretContext(ed)
            setContext(ctx)
            setOpen(!!ctx && MENTION_RE.test(ctx.text))
        }
        const onSelectionUpdate = ({ editor: ed }: { editor: Editor }) => setContext(caretContext(ed))
        editor.on('update', onUpdate)
        editor.on('selectionUpdate', onSelectionUpdate)
        return () => {
            editor.off('update', onUpdate)
            editor.off('selectionUpdate', onSelectionUpdate)
        }
    }, [editor])

    const match = useMemo(() => {
        if (!open || !context) return null
        const m = MENTION_RE.exec(context.text)
        if (!m) return null
        const query = m[2] ?? ''
        return { query: query.toLowerCase(), from: context.from - query.length - 1, to: context.from }
    }, [context, open])

    const candidates = useMemo<MentionCandidate[]>(() => {
        if (!match) return []
        const q = match.query
        const people: MentionCandidate[] = []
        if ('rowboat'.startsWith(q)) people.push({ id: 'rowboat', label: 'rowboat', hint: 'your agent — acts only when asked', isAgent: true })
        if ('here'.startsWith(q)) people.push({ id: 'here', label: 'here', hint: 'notify everyone online', isBroadcast: true })
        // This space's people first, then the rest of the org. Someone not in
        // this space can be named but is not notified (the org drops their
        // stamp) — the hint says so.
        const inSpace = new Set(spaceMembers.map((m) => m.id))
        // A name matches anywhere; an id only as a prefix — a one-letter query
        // is a substring of most ULIDs and would drown the files below.
        const matches = (m: spaces.Member) => !q || m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().startsWith(q)
        for (const m of spaceMembers) {
            if (matches(m)) people.push({ id: m.id, label: m.displayName, ...(m.id === selfMemberId ? { hint: 'you' } : {}) })
        }
        for (const m of orgRoster) {
            if (!inSpace.has(m.id) && matches(m)) people.push({ id: m.id, label: m.displayName, hint: 'not in this space' })
        }
        // Shared spaces, as #Name references (a DM is nobody's to point at).
        const spaceRows: MentionCandidate[] = (org?.spaces ?? [])
            .filter((s) => !q || s.name.toLowerCase().includes(q))
            .map((s) => ({ id: `space:${s.id}`, label: s.name, space: { id: s.id, name: s.name } }))
        if (!q) return [...people, ...spaceRows].slice(0, MAX_ROWS)
        // Files join once a query exists (a bare "@" is a people gesture);
        // picking one inserts a markdown link, not a mention. This space's
        // files first, then every shared space's.
        const files: MentionCandidate[] = []
        const fileRows = (fromSpaceId: string, spaceName?: string) => {
            for (const e of listings?.get(fromSpaceId) ?? []) {
                if (!e.path.toLowerCase().includes(q)) continue
                const folder = e.path.includes('/')
                const hint = spaceName ? (folder ? `${e.path} · in ${spaceName}` : `in ${spaceName}`) : folder ? e.path : undefined
                files.push({
                    id: `file:${fromSpaceId}/${e.id}`,
                    label: e.path.split('/').pop() ?? e.path,
                    ...(hint ? { hint } : {}),
                    file: { assetId: e.id, path: e.path, spaceId: fromSpaceId, ...(spaceName ? { spaceName } : {}) },
                })
            }
        }
        if (spaceId) fileRows(spaceId)
        for (const s of org?.spaces ?? []) if (s.id !== spaceId) fileRows(s.id, s.name)
        // Files keep a few rows of their own: a query heading for a file must
        // not be buried under every person whose name shares its letters.
        const fileQuota = Math.min(files.length, 4)
        return [...[...people, ...spaceRows].slice(0, MAX_ROWS - fileQuota), ...files].slice(0, MAX_ROWS)
    }, [match, spaceMembers, orgRoster, org, listings, spaceId, selfMemberId])

    // Reset the highlighted row whenever the query changes (adjust-on-change, not an effect).
    const query = match?.query ?? null
    const [lastQuery, setLastQuery] = useState<string | null>(null)
    if (query !== lastQuery) {
        setLastQuery(query)
        setIndex(0)
    }
    const show = open && !!match && candidates.length > 0

    // A person, a space, @rowboat, or @here becomes ONE mention node
    // (composer-editor MentionNode): a pill holding the id, serialized to the
    // wire's token on send. A file becomes a live link — the contract's
    // canonical asset URL naming the file by id on ITS space (stable across
    // renames; the anchor opens another space's file there), labelled with
    // its name; standard markdown on the wire. Inserted as literal nodes,
    // never re-parsed as markdown.
    const pick = (c: MentionCandidate) => {
        if (!match || !editor) return
        const chain = editor.chain().focus().deleteRange({ from: match.from, to: match.to })
        if (c.file) {
            // Files come from the org listing, so refs are there whenever a file is.
            if (!refs) return
            const href = assetWireUrl({ orgAddress: refs.orgAddress, spaceId: c.file.spaceId }, c.file.assetId)
            chain.insertContent([
                { type: 'text', text: c.file.path.split('/').pop() ?? c.file.path, marks: [{ type: 'link', attrs: { href } }] },
                { type: 'text', text: ' ' },
            ]).run()
        } else if (c.space) {
            chain.insertContent([{ type: 'mention', attrs: { kind: 'space', id: c.space.id, label: c.space.name } }, { type: 'text', text: ' ' }]).run()
        } else if (c.isAgent || c.isBroadcast) {
            chain.insertContent([{ type: 'mention', attrs: { kind: c.id, id: null, label: c.id } }, { type: 'text', text: ' ' }]).run()
        } else {
            chain.insertContent([{ type: 'mention', attrs: { kind: 'member', id: c.id, label: c.label } }, { type: 'text', text: ' ' }]).run()
        }
        setOpen(false)
    }

    /** Arrow/Enter/Tab/Escape while the menu shows; true = consumed. */
    const onKeyDown = (e: KeyboardEvent): boolean => {
        if (!show) return false
        if (e.key === 'ArrowDown') {
            setIndex((i) => (i + 1) % candidates.length)
            return true
        }
        if (e.key === 'ArrowUp') {
            setIndex((i) => (i - 1 + candidates.length) % candidates.length)
            return true
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            const c = candidates[index]
            if (c) pick(c)
            return true
        }
        if (e.key === 'Escape') {
            setOpen(false)
            return true
        }
        return false
    }

    return { show, candidates, index, pick, onKeyDown, close: () => setOpen(false) }
}

/**
 * The dropdown. Anchored just above the host's box — but portalled and
 * fixed-positioned, because the inline editor lives inside the stream's
 * scroll container, which would clip an absolutely-positioned menu at its
 * top edge. Flips below the box when there isn't room above.
 */
export function MentionMenu({ anchor, candidates, index, onPick }: {
    /** The host's bordered box — the menu hugs its top-left. */
    anchor: HTMLElement | null
    candidates: readonly MentionCandidate[]
    index: number
    onPick: (c: MentionCandidate) => void
}) {
    const menuRef = useRef<HTMLDivElement | null>(null)
    // Placement writes straight to the node instead of going through state:
    // a scroll handler that setState'd would re-render the menu on every
    // scroll event AND land a frame late, so the menu would visibly lag the
    // box it is pinned to. Direct writes happen in the same frame as the
    // scroll. Measured, not estimated — the row count drives the height.
    useLayoutEffect(() => {
        const place = () => {
            const el = menuRef.current
            const box = anchor?.getBoundingClientRect()
            if (!el || !box) return
            const gap = 4
            const menu = el.getBoundingClientRect()
            const above = box.top - gap - menu.height
            const left = Math.max(8, Math.min(box.left + 8, window.innerWidth - menu.width - 8))
            const top = above >= 8 ? above : Math.max(8, Math.min(box.bottom + gap, window.innerHeight - menu.height - 8))
            el.style.left = `${left}px`
            el.style.top = `${top}px`
            // Revealed only once placed — the first paint is already correct
            // (a layout effect runs before it), so there is no flash at 0,0.
            el.style.visibility = 'visible'
        }
        place()
        // Capture phase: the stream scrolls, not the window.
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return () => {
            window.removeEventListener('scroll', place, true)
            window.removeEventListener('resize', place)
        }
    }, [anchor, candidates.length])

    // The list scrolls once it is full: the arrowed-to row must stay in view.
    useLayoutEffect(() => {
        menuRef.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView?.({ block: 'nearest' })
    }, [index])

    return createPortal(
        <div
            ref={menuRef}
            data-slot="mention-menu"
            // left/top/visibility are owned by place() above. React never
            // rewrites them: this object is value-identical on every render,
            // so the style diff is empty and the imperative values stand.
            style={{ position: 'fixed', visibility: 'hidden' }}
            className="z-50 max-h-80 w-72 overflow-y-auto rounded-2xl border-none bg-popover p-1.5 shadow-[var(--rowboat-shadow)]"
        >
            {candidates.map((c, i) => (
                <button
                    key={c.id}
                    type="button"
                    data-active={i === index ? '' : undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(c)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === index ? 'bg-accent' : 'hover:bg-accent/60')}
                >
                    {c.isAgent ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Bot className="size-3.5" /></span>
                    ) : c.isBroadcast ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Megaphone className="size-3.5" /></span>
                    ) : c.file ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileText className="size-3.5" /></span>
                    ) : c.space ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Hash className="size-3.5" /></span>
                    ) : (
                        <MemberAvatar id={c.id} name={c.label} size="sm" className="size-6 text-[10px]" />
                    )}
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{c.label}</span>
                        {c.hint && <span className="block truncate text-[11px] text-muted-foreground">{c.hint}</span>}
                    </span>
                </button>
            ))}
            <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">↑↓ · ↵ or ⇥ to pick · esc</div>
        </div>,
        document.body,
    )
}
