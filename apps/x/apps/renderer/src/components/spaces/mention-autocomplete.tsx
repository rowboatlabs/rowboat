import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Bot, FileText, Megaphone } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { MemberAvatar } from '@/components/spaces/atoms'
import { caretContext, type CaretContext } from '@/components/spaces/composer-editor'
import { encodeSpaceLinkTarget } from '@/lib/spaces-presentation'

// The @ autocomplete behind every mention surface — the composer and the
// inline message editor. The hook owns the popup's whole lifecycle off the
// editor's own events; the host renders <MentionMenu> inside its relative
// box and routes keydowns through onKeyDown ahead of its other bindings.

export interface MentionCandidate {
    id: string
    label: string
    hint?: string
    isAgent?: boolean
    isBroadcast?: boolean
    /** A file suggestion — picking it inserts a plain markdown link to the path. */
    filePath?: string
}

// "/" so typing into a folder ("@design/sc…") keeps the file query alive.
export const MENTION_RE = /(^|[\s([{])@([\w./-]*)$/

export function useMentionAutocomplete(editor: Editor | null, { members = [], entries = [], selfMemberId }: {
    /** Space members — the people the popup offers. */
    members?: readonly spaces.Member[]
    /** Space files — the same popup offers them once a query exists. */
    entries?: readonly spaces.SpacesAssetEntry[]
    selfMemberId?: string
}) {
    /** Where the caret sits (text-before-caret + doc position) — what the trigger matches against. */
    const [context, setContext] = useState<CaretContext | null>(null)
    const [open, setOpen] = useState(false)
    const [index, setIndex] = useState(0)

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
        for (const m of members) {
            const hay = `${m.id} ${m.displayName}`.toLowerCase()
            if (!q || hay.includes(q)) people.push({ id: m.id, label: m.displayName, ...(m.id === selfMemberId ? { hint: 'you' } : {}) })
        }
        // Files join once a query exists (a bare "@" is a people gesture);
        // picking one inserts a markdown link, not a mention.
        const files: MentionCandidate[] = q
            ? entries
                  .filter((e) => e.state !== 'deleted' && e.path.toLowerCase().includes(q))
                  .slice(0, 4)
                  .map((e) => ({
                      id: `file:${e.path}`,
                      label: e.path.split('/').pop() ?? e.path,
                      ...(e.path.includes('/') ? { hint: e.path } : {}),
                      filePath: e.path,
                  }))
            : []
        return [...people.slice(0, 8 - files.length), ...files]
    }, [match, members, entries, selfMemberId])

    // Reset the highlighted row whenever the query changes (adjust-on-change, not an effect).
    const query = match?.query ?? null
    const [lastQuery, setLastQuery] = useState<string | null>(null)
    if (query !== lastQuery) {
        setLastQuery(query)
        setIndex(0)
    }
    const show = open && !!match && candidates.length > 0

    // The draft shows the person's name; send/save encodes it back to the
    // wire address @<memberId> (what notifications and agent invocation scan
    // for). A file becomes a live link to the space path — standard markdown
    // on the wire. Inserted as literal nodes, never re-parsed as markdown.
    const pick = (c: MentionCandidate) => {
        if (!match || !editor) return
        const chain = editor.chain().focus().deleteRange({ from: match.from, to: match.to })
        if (c.filePath) {
            chain.insertContent([
                { type: 'text', text: c.filePath, marks: [{ type: 'link', attrs: { href: encodeSpaceLinkTarget(c.filePath) } }] },
                { type: 'text', text: ' ' },
            ]).run()
        } else {
            chain.insertContent({ type: 'text', text: `@${c.label} ` }).run()
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

    return createPortal(
        <div
            ref={menuRef}
            data-slot="mention-menu"
            // left/top/visibility are owned by place() above. React never
            // rewrites them: this object is value-identical on every render,
            // so the style diff is empty and the imperative values stand.
            style={{ position: 'fixed', visibility: 'hidden' }}
            className="z-50 w-72 overflow-hidden rounded-2xl border-none bg-popover p-1.5 shadow-[var(--rowboat-shadow)]"
        >
            {candidates.map((c, i) => (
                <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(c)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === index ? 'bg-accent' : 'hover:bg-accent/60')}
                >
                    {c.isAgent ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Bot className="size-3.5" /></span>
                    ) : c.isBroadcast ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Megaphone className="size-3.5" /></span>
                    ) : c.filePath ? (
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileText className="size-3.5" /></span>
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
