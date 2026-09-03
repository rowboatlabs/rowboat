import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Hash, MessageSquare, PenTool, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { useDebounce } from '@/hooks/use-debounce'
import { STREAM_READ_KEY } from '@/hooks/use-space-chat'
import { cn } from '@/lib/utils'
import { hasKind, parseSearchQuery } from '@/lib/spaces-corpus'
import { requestJump } from '@/lib/spaces-jump'
import { chord } from '@/lib/shortcut'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import type { RailSelection } from '@/lib/spaces-selection'
import { useMemberNames } from './member-text'

// The space's search bar (header, top right). ⌘⇧K focuses it while a space is
// open — registered on window in the CAPTURE phase so it wins over App.tsx's
// document-level listener. Shift on purpose: plain ⌘K stays the app's global
// palette everywhere, spaces included. Results are the org's categorized
// search (spaces:search → harbor /search): three vertical sections, one flat
// keyboard order across them. Snippets arrive as raw wire text; mentions
// resolve here, like any body.
//
// The filter grammar (from: / in: / has: / mentions:, `me` for yourself) is
// parsed client-side and layered on the server's word search: mentions: adds
// the name as a search word (the org expands a member's name to their id, and
// bodies index mention ids); from:, in: and has: narrow the returned message
// hits — so a filtered query asks for the org's max page and filters that.
// A query of ONLY from:/in:/has: has no word for the org to search; the bar
// says so instead of guessing.

interface Props {
    orgId: string
    spaceId: string
    /** Resolves `me` in from:/mentions: to the viewer. */
    selfMemberId?: string
    /** The wrapper's size — the header gives it the centre of the row. */
    className?: string
    onNavigate: (sel: RailSelection) => void
}

/** One pickable row, whatever its section — the keyboard walks this flat list. */
interface Item {
    key: string
    pick: () => void
    row: ReactNode
}

const EMPTY: spaces.SearchResults = { messages: [], topics: [], assets: [], truncated: { messages: false, topics: false, assets: false } }
const PAGE = 5
/** The org's per-category cap — a filtered query fetches this and narrows it here. */
const FILTERED_PAGE = 50

export function SpaceSearch({ orgId, spaceId, selfMemberId, onNavigate, className }: Props) {
    const names = useMemberNames()
    const inputRef = useRef<HTMLInputElement>(null)
    const [query, setQuery] = useState('')
    const [focused, setFocused] = useState(false)
    const [results, setResults] = useState<spaces.SearchResults>(EMPTY)
    const [loading, setLoading] = useState(false)
    const debounced = useDebounce(query, 250)

    // ⌘⇧K focuses THIS search while a space pane exists. Capture on window
    // fires before App.tsx's document-bubble listener; stopPropagation keeps
    // anything else off the press.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                e.stopPropagation()
                inputRef.current?.focus()
                inputRef.current?.select()
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [])

    // `me` resolves to the viewer's display name (the org expands names to ids).
    const selfName = selfMemberId ? (names.get(selfMemberId) ?? selfMemberId).toLowerCase() : null
    const nameFor = (frag: string) => (frag === 'me' && selfName ? selfName : frag)
    const parsed = parseSearchQuery(query)
    // What the org searches: free words plus mentioned names (expanded server-side).
    const serverQueryOf = (raw: string) => {
        const p = parseSearchQuery(raw)
        return [...p.terms, ...p.mentions.map(nameFor)].join(' ')
    }
    const serverQuery = serverQueryOf(query)
    const needsWord = parsed.filtered && serverQuery.length < 2

    // Fetch on the debounced query; a stale response never overwrites a newer one.
    const seq = useRef(0)
    useEffect(() => {
        const q = serverQueryOf(debounced)
        // Too short to search: nothing to fetch. The render derives EMPTY for
        // this case below rather than setting state here, and bumping `seq`
        // orphans any fetch still in flight for the longer text before it.
        if (q.length < 2) {
            ++seq.current
            return
        }
        const mine = ++seq.current
        setLoading(true)
        const filtered = parseSearchQuery(debounced).filtered
        void window.ipc
            .invoke('spaces:search', { orgId, spaceId, q, limit: filtered ? FILTERED_PAGE : PAGE })
            .then((r) => {
                if (seq.current !== mine) return
                setResults(r)
                setLoading(false)
            })
            .catch(() => {
                if (seq.current !== mine) return
                setResults(EMPTY)
                setLoading(false)
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- serverQueryOf/nameFor derive from `names`, which only widens the name map; the debounced text is the trigger.
    }, [debounced, orgId, spaceId])

    const words = parsed.terms
    const mark = (text: string) => highlight(resolveMentions(text, names), words)

    const pick = (sel: RailSelection) => {
        onNavigate(sel)
        setFocused(false)
        inputRef.current?.blur()
    }

    // Below the search threshold the last fetched page is stale by definition:
    // show nothing (derived, so no state write on the way down).
    const shown = serverQuery.length >= 2 ? results : EMPTY
    const searching = loading && serverQuery.length >= 2

    // Filters narrow the message hits client-side; a filtered query is about
    // messages, so discussion and file sections step aside for it.
    const authorOf = (m: spaces.MessageSearchHit) => (names.get(m.author.memberId) ?? m.author.memberId).toLowerCase()
    const messages = parsed.filtered
        ? shown.messages.filter((m) => {
              if (!parsed.from.every((f) => authorOf(m).includes(nameFor(f)) || m.author.memberId.toLowerCase() === nameFor(f))) return false
              if (!parsed.inTopic.every((f) => (m.topicTitle ?? '').toLowerCase().includes(f))) return false
              if (!parsed.has.every((kind) => hasKind(m.snippet, kind))) return false
              return true
          })
        : shown.messages
    const topics = parsed.filtered ? [] : shown.topics
    const assets = parsed.filtered ? [] : shown.assets
    const messagesTruncated = shown.truncated.messages && !parsed.filtered
    // A filtered query narrowed the org's whole page: more may exist beyond it.
    const filteredTruncated = parsed.filtered && shown.truncated.messages

    const items: Item[] = [
        ...messages.map((m): Item => {
            const isRoot = m.threadRootId === m.messageId
            return {
                key: `m:${m.messageId}`,
                pick: () => {
                    // Land on the row, not just its pane: the destination scrolls to
                    // data-mid and flashes once it has the message.
                    requestJump({ topicId: isRoot ? STREAM_READ_KEY : m.threadRootId, messageId: m.messageId })
                    pick(isRoot ? { kind: 'general' } : { kind: 'thread', rootMessageId: m.threadRootId })
                },
                row: (
                    <>
                        <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                                <span className="truncate text-xs font-medium">
                                    {names.get(m.author.memberId) ?? m.author.memberId}
                                    {m.author.agentName ? <span className="font-normal text-muted-foreground"> · {m.author.agentName}</span> : null}
                                </span>
                                {m.topicTitle && <span className="truncate text-[11px] text-muted-foreground">{mark(m.topicTitle)}</span>}
                                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatFeedTime(m.postedAt)}</span>
                            </span>
                            <span className="line-clamp-2 text-xs text-muted-foreground">{mark(m.snippet)}</span>
                        </span>
                    </>
                ),
            }
        }),
        ...topics.map((t): Item => ({
            key: `t:${t.topic.id}`,
            pick: () => pick({ kind: 'thread', rootMessageId: t.topic.rootMessageId }),
            row: (
                <>
                    <Hash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                            <span className="truncate text-xs font-medium">{mark(t.topic.title)}</span>
                            {t.topic.archived && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">archived</span>}
                            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatFeedTime(t.topic.createdAt)}</span>
                        </span>
                    </span>
                </>
            ),
        })),
        ...assets.map((a): Item => {
            const board = /\.excalidraw$/i.test(a.path)
            return {
                key: `a:${a.path}`,
                pick: () => pick(board ? { kind: 'whiteboard', path: a.path } : { kind: 'file', path: a.path }),
                row: (
                    <>
                        {board
                            ? <PenTool className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            : <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                                <span className="truncate font-mono text-[11px]">{mark(a.path)}</span>
                                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatFeedTime(a.updatedAt)}</span>
                            </span>
                            {a.snippet && <span className="line-clamp-1 text-xs text-muted-foreground">{mark(a.snippet)}</span>}
                        </span>
                    </>
                ),
            }
        }),
    ]

    // Selection resets when the result set changes — adjust during render,
    // not in an effect (the composer's candidate-list idiom).
    const [sel, setSel] = useState(0)
    const itemsKey = items.map((i) => i.key).join('|')
    const prevItemsKey = useRef(itemsKey)
    if (prevItemsKey.current !== itemsKey) {
        prevItemsKey.current = itemsKey
        if (sel !== 0) setSel(0)
    }

    const open = focused && (serverQuery.length >= 2 || parsed.filtered)
    const sections: Array<{ label: string; hint: boolean; from: number; count: number }> = []
    {
        let at = 0
        for (const [label, count, hint] of [
            ['Messages', messages.length, messagesTruncated],
            ['Discussions', topics.length, shown.truncated.topics],
            ['Files', assets.length, shown.truncated.assets],
        ] as const) {
            if (count > 0) sections.push({ label, hint, from: at, count })
            at += count
        }
    }

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!open) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (items.length > 0) setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            items[sel]?.pick()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            setFocused(false)
            inputRef.current?.blur()
        }
    }

    return (
        <div className={cn('relative', className)}>
            <label
                className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md border border-transparent bg-muted/60 px-2.5 text-[13px] text-muted-foreground',
                    'transition-colors focus-within:border-foreground/25 focus-within:bg-background hover:bg-muted',
                )}
                title={`Search this space (${chord('K', { shift: true })})`}
            >
                <Search className="size-3.5 shrink-0" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={onKeyDown}
                    placeholder="Search this space"
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
                {!focused && <kbd className="rounded border border-border bg-background px-1 text-[10px]">{chord('K', { shift: true })}</kbd>}
            </label>
            {open && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 min-w-[26rem] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
                    {sections.map((s) => (
                        <div key={s.label}>
                            <div className="flex items-baseline justify-between px-2 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                {s.label}
                                {s.hint && <span className="normal-case tracking-normal">top {s.count} — refine to see more</span>}
                            </div>
                            {items.slice(s.from, s.from + s.count).map((item, i) => {
                                const index = s.from + i
                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={item.pick}
                                        onMouseMove={() => setSel(index)}
                                        className={cn(
                                            'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left',
                                            index === sel ? 'bg-accent' : 'hover:bg-accent/60',
                                        )}
                                    >
                                        {item.row}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                    {items.length === 0 && (
                        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                            {needsWord
                                ? 'Add a word to search — from:, in: and has: narrow a text search'
                                : searching
                                  ? 'Searching…'
                                  : 'No matches in this space'}
                        </div>
                    )}
                    {filteredTruncated && (
                        <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">
                            Filtered the newest {FILTERED_PAGE} matches — add a word to narrow further
                        </div>
                    )}
                    <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">
                        {items.length > 0 ? '↑↓ · ↵ to open · esc · ' : ''}
                        filters: from:name in:discussion has:link|image|file mentions:name (me works)
                    </div>
                </div>
            )}
        </div>
    )
}

/** Bold every query-word occurrence (case-insensitive) in already-resolved text. */
function highlight(text: string, words: string[]): ReactNode {
    if (words.length === 0) return text
    const lower = text.toLowerCase()
    const parts: ReactNode[] = []
    let at = 0
    while (at < text.length) {
        let hit = -1
        let hitLen = 0
        for (const w of words) {
            const idx = lower.indexOf(w, at)
            if (idx !== -1 && (hit === -1 || idx < hit)) {
                hit = idx
                hitLen = w.length
            }
        }
        if (hit === -1) {
            parts.push(text.slice(at))
            break
        }
        if (hit > at) parts.push(text.slice(at, hit))
        parts.push(
            <span key={`${hit}`} className="font-semibold text-foreground">
                {text.slice(hit, hit + hitLen)}
            </span>,
        )
        at = hit + hitLen
    }
    return <>{parts}</>
}
