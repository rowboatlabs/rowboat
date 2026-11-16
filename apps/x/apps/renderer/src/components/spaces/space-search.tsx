import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AtSign, ChevronDown, FileText, Hash, Image, Link as LinkIcon, MessageSquare, Paperclip, PenTool, Search, User } from 'lucide-react'
import type { spaces } from '@x/shared'
import { useDebounce } from '@/hooks/use-debounce'
import { STREAM_READ_KEY } from '@/hooks/use-space-chat'
import { useSpaceMembers } from '@/hooks/use-space-members'
import { useSpaceNames } from '@/hooks/use-spaces'
import { cn } from '@/lib/utils'
import { parseSearchQuery } from '@/lib/spaces-corpus'
import { requestJump } from '@/lib/spaces-jump'
import { FIND_SEARCH_EVENT } from '@/lib/spaces-find'
import { chord } from '@/lib/shortcut'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import type { RailSelection } from '@/lib/spaces-selection'
import { highlight } from './highlight'
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
// the org's since 2026-11-06 ("search" in Main): the raw query goes to the
// server, which filters in the store, so a filter never misses older messages
// and a filter alone ("from:me") is a search. The bar's part is making the
// grammar discoverable: focusing it lists the filters, and a half-typed
// from:/mentions:/has: offers its values.

interface Props {
    orgId: string
    spaceId: string
    /** The viewer: offered as `me` rather than by name in from:/mentions:. */
    selfMemberId?: string
    /** The wrapper's size — the header gives it the centre of the row. */
    className?: string
    onNavigate: (sel: RailSelection) => void
}

/** One pickable row, whatever its section — the keyboard walks this flat list. */
interface Item {
    key: string
    /** A filter or a filter's value: Tab takes it as well as Enter. */
    suggestion?: boolean
    pick: () => void
    row: ReactNode
}

interface Section {
    label: string
    items: Item[]
    /** Shown beside the label. */
    note?: string
}

const EMPTY: spaces.SearchResults = { messages: [], topics: [], assets: [], truncated: { messages: false, topics: false, assets: false } }
const PAGE = 5
/** A filtered query is about messages alone, so it gets the room of all three sections. */
const FILTERED_PAGE = 20
/** The org's per-category cap — what "Show more" asks for. */
const MORE_PAGE = 50
const FILTER_KEY = /^(from|mentions|in|has):(.*)$/

/** The filters a focused, empty bar lists — picking one types it. */
const FILTER_HINTS: Array<{ token: string; label: string; icon: typeof User }> = [
    { token: 'from:', label: 'Messages from a person', icon: User },
    { token: 'mentions:', label: 'Messages that mention a person', icon: AtSign },
    { token: 'in:', label: 'Messages in a discussion or session, by title', icon: Hash },
    { token: 'has:link', label: 'Messages with a link', icon: LinkIcon },
    { token: 'has:image', label: 'Messages with an image', icon: Image },
    { token: 'has:file', label: 'Messages with a file', icon: Paperclip },
]
const HAS_VALUES: Array<{ value: string; label: string; icon: typeof User }> = [
    { value: 'link', label: 'a link', icon: LinkIcon },
    { value: 'image', label: 'an image', icon: Image },
    { value: 'file', label: 'a file', icon: Paperclip },
]

/** What the org is asked: the query less a half-typed filter at its end. */
function serverQueryOf(raw: string): string {
    const t = /\S+$/.exec(raw)?.[0]?.toLowerCase() ?? ''
    const m = FILTER_KEY.exec(t)
    // An empty filter value has nothing to filter by; a partial has: value
    // is only complete once it names a kind.
    const incomplete = m && (m[2] === '' || (m[1] === 'has' && !HAS_VALUES.some((h) => h.value === m[2])))
    return (incomplete ? raw.slice(0, raw.length - t.length) : raw).trim()
}

/** A filter alone is a search; words need two characters between them. */
function searchable(q: string): boolean {
    const p = parseSearchQuery(q)
    return p.filtered || p.terms.join(' ').length >= 2
}

export function SpaceSearch({ orgId, spaceId, selfMemberId, onNavigate, className }: Props) {
    const names = useMemberNames()
    const spaceNames = useSpaceNames(orgId)
    const roster = useSpaceMembers(orgId, spaceId)
    const inputRef = useRef<HTMLInputElement>(null)
    const [query, setQuery] = useState('')
    const [focused, setFocused] = useState(false)
    const [results, setResults] = useState<spaces.SearchResults>(EMPTY)
    /** The query (and Show more) the current results answer: anything else is still loading. */
    const [answered, setAnswered] = useState('')
    /** The section "Show more" widened to the org's cap, for this query only. */
    const [more, setMore] = useState<spaces.SearchKind | null>(null)

    // /find's "Search instead" (2026-09-24): the query arrives prefilled and
    // focused, and the debounced fetch below takes it from there.
    useEffect(() => {
        const onFind = (e: Event) => {
            const q = (e as CustomEvent<{ query?: string }>).detail?.query ?? ''
            setQuery(q)
            inputRef.current?.focus()
        }
        window.addEventListener(FIND_SEARCH_EVENT, onFind)
        return () => window.removeEventListener(FIND_SEARCH_EVENT, onFind)
    }, [])

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

    // The chunk under the caret when the query doesn't end in a space: a
    // half-typed filter there gets suggestions, and stays out of the search
    // until it is complete.
    const tail = /\S+$/.exec(query)?.[0] ?? ''
    const pending = FILTER_KEY.exec(tail.toLowerCase())
    const pendingFilter = pending && (pending[2] === '' || pending[1] !== 'in') ? pending : null
    const serverQuery = serverQueryOf(query)
    const parsed = parseSearchQuery(serverQuery)
    const canSearch = searchable(serverQuery)

    // Show more belongs to the query it was asked for (adjust during render).
    const [moreFor, setMoreFor] = useState(serverQuery)
    if (moreFor !== serverQuery) {
        setMoreFor(serverQuery)
        if (more !== null) setMore(null)
    }

    const debounced = useDebounce(serverQuery, 250)

    // Fetch on the debounced query; a stale response never overwrites a newer one.
    const seq = useRef(0)
    useEffect(() => {
        // Too short to search: nothing to fetch. The render derives EMPTY for
        // this case below rather than setting state here, and bumping `seq`
        // orphans any fetch still in flight for the longer text before it.
        if (!searchable(debounced)) {
            ++seq.current
            return
        }
        const mine = ++seq.current
        const asked = `${debounced}|${more ?? ''}`
        const filtered = parseSearchQuery(debounced).filtered
        const ask = more
            ? window.ipc.invoke('spaces:search', { orgId, spaceId, q: debounced, kinds: [more], limit: MORE_PAGE })
            : window.ipc.invoke('spaces:search', { orgId, spaceId, q: debounced, limit: filtered ? FILTERED_PAGE : PAGE })
        void ask
            .then((r) => {
                if (seq.current !== mine) return
                // Show more replaces one section and keeps the others as they were.
                setResults((prev) => (more ? { ...prev, [more]: r[more], truncated: { ...prev.truncated, [more]: r.truncated[more] } } : r))
                setAnswered(asked)
            })
            .catch(() => {
                if (seq.current !== mine) return
                if (!more) setResults(EMPTY)
                setAnswered(asked)
            })
    }, [debounced, more, orgId, spaceId])

    const words = parsed.terms
    const mark = (text: string) => highlight(resolveMentions(text, names, spaceNames), words)

    const pick = (sel: RailSelection) => {
        onNavigate(sel)
        setFocused(false)
        inputRef.current?.blur()
    }

    /** Replace the chunk under the caret (or append) with `token`, and keep typing. */
    const complete = (token: string, finished: boolean) => {
        const base = tail && FILTER_KEY.test(tail.toLowerCase()) ? query.slice(0, query.length - tail.length) : query
        const sep = base === '' || /\s$/.test(base) ? '' : ' '
        // Rows keep the input's focus (onMouseDown below), so typing goes on.
        setQuery(`${base}${sep}${token}${finished ? ' ' : ''}`)
    }

    /** What from:/mentions: write for a member: the first word of their name, or their id when that word is shared. */
    const tokenFor = (m: spaces.Member) => {
        const first = m.displayName.toLowerCase().split(/\s+/)[0] ?? ''
        const shared = roster.some((o) => o.id !== m.id && o.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(first)))
        return first && !shared ? first : m.id
    }

    const sections: Section[] = []

    // Suggestions: the filters themselves on an empty bar, a filter's values
    // while one is half-typed.
    if (query.trim() === '') {
        sections.push({
            label: 'Filters',
            note: 'combine with words',
            items: FILTER_HINTS.map((f) => ({
                key: `f:${f.token}`,
                suggestion: true,
                pick: () => complete(f.token, f.token.startsWith('has:')),
                row: (
                    <>
                        <f.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="w-20 shrink-0 font-mono text-[11px]">{f.token}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{f.label}</span>
                    </>
                ),
            })),
        })
    } else if (pendingFilter && (pendingFilter[1] === 'from' || pendingFilter[1] === 'mentions')) {
        const key = pendingFilter[1]
        const typed = pendingFilter[2]!.replace(/^@/, '')
        const people = roster
            .filter((m) => m.id !== selfMemberId)
            .filter((m) => typed === '' || m.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(typed)))
            .slice(0, 6)
        const items: Item[] = []
        if ('me'.startsWith(typed)) {
            items.push({
                key: 'p:me',
                suggestion: true,
                pick: () => complete(`${key}:me`, true),
                row: (
                    <>
                        <User className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-medium">me</span>
                        <span className="text-xs text-muted-foreground">{key === 'from' ? 'messages you wrote' : 'messages that mention you'}</span>
                    </>
                ),
            })
        }
        for (const m of people) {
            items.push({
                key: `p:${m.id}`,
                suggestion: true,
                pick: () => complete(`${key}:${tokenFor(m)}`, true),
                row: (
                    <>
                        <User className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-medium">{m.displayName}</span>
                    </>
                ),
            })
        }
        if (items.length > 0) sections.push({ label: key === 'from' ? 'From' : 'Mentions', items })
    } else if (pendingFilter && pendingFilter[1] === 'has') {
        const typed = pendingFilter[2]!
        const items = HAS_VALUES.filter((h) => h.value.startsWith(typed) && h.value !== typed).map((h): Item => ({
            key: `h:${h.value}`,
            suggestion: true,
            pick: () => complete(`has:${h.value}`, true),
            row: (
                <>
                    <h.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="w-20 shrink-0 font-mono text-[11px]">has:{h.value}</span>
                    <span className="text-xs text-muted-foreground">Messages with {h.label}</span>
                </>
            ),
        }))
        if (items.length > 0) sections.push({ label: 'Has', items })
    }

    // Below the search threshold the last fetched page is stale by definition:
    // show nothing (derived, so no state write on the way down).
    const shown = canSearch ? results : EMPTY
    const searching = canSearch && answered !== `${serverQuery}|${more ?? ''}`

    /** "Show more" closes a truncated section, until the org's cap. */
    const moreItem = (kind: spaces.SearchKind, noun: string): Item[] => {
        if (!shown.truncated[kind]) return []
        if (more === kind) return []
        return [{
            key: `more:${kind}`,
            pick: () => setMore(kind),
            row: (
                <>
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Show more {noun}</span>
                </>
            ),
        }]
    }
    const cappedNote = (kind: spaces.SearchKind) =>
        shown.truncated[kind] && more === kind ? `newest ${MORE_PAGE} — add a word or filter to narrow` : undefined

    const messages = shown.messages.map((m): Item => {
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
                            {m.topicTitle
                                ? <span className="truncate text-[11px] text-muted-foreground">in {mark(m.topicTitle)}</span>
                                : !isRoot && <span className="shrink-0 text-[11px] text-muted-foreground">in a thread</span>}
                            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatFeedTime(m.postedAt)}</span>
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">{mark(m.snippet)}</span>
                    </span>
                </>
            ),
        }
    })
    const topics = shown.topics.map((t): Item => ({
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
    }))
    const assets = shown.assets.map((a): Item => {
        const board = /\.excalidraw$/i.test(a.path)
        return {
            key: `a:${a.id}`,
            pick: () => pick(board ? { kind: 'whiteboard', assetId: a.id } : { kind: 'file', assetId: a.id }),
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
    })
    if (messages.length > 0) sections.push({ label: 'Messages', note: cappedNote('messages'), items: [...messages, ...moreItem('messages', 'messages')] })
    if (topics.length > 0) sections.push({ label: 'Discussions', note: cappedNote('topics'), items: [...topics, ...moreItem('topics', 'discussions')] })
    if (assets.length > 0) sections.push({ label: 'Files', note: cappedNote('assets'), items: [...assets, ...moreItem('assets', 'files')] })

    const items = sections.flatMap((s) => s.items)
    const hasResults = messages.length + topics.length + assets.length > 0

    // Selection resets when the result set changes — adjust during render,
    // not in an effect (the composer's candidate-list idiom).
    const [sel, setSel] = useState(0)
    const itemsKey = items.map((i) => i.key).join('|')
    const [selFor, setSelFor] = useState(itemsKey)
    if (selFor !== itemsKey) {
        setSelFor(itemsKey)
        if (sel !== 0) setSel(0)
    }

    const open = focused
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!open) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (items.length > 0) setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && items[sel]?.suggestion)) {
            // Tab completes a suggestion; Enter opens a result or takes a suggestion.
            e.preventDefault()
            items[sel]?.pick()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            if (query !== '') setQuery('')
            else {
                setFocused(false)
                inputRef.current?.blur()
            }
        }
    }

    // What the panel says when it has no results to show.
    const status = !canSearch
        ? null
        : searching && !hasResults
          ? 'Searching…'
          : !hasResults
            ? parsed.filtered
                ? 'No messages match — try fewer words or filters'
                : 'No matches in this space — try fewer or shorter words'
            : null

    let at = 0
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
                    placeholder="Search messages, discussions, files"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
                {!focused && <kbd className="rounded border border-border bg-background px-1 text-[10px]">{chord('K', { shift: true })}</kbd>}
            </label>
            {open && (sections.length > 0 || status) && (
                // Spaces redesign (2026-10-21): the box sits at the header's right edge now,
                // so results open leftward from it at a fixed width.
                <div className="absolute right-0 top-full z-30 mt-1 flex max-h-[min(32rem,70vh)] w-[min(32rem,85vw)] flex-col rounded-lg border border-border bg-popover shadow-md animate-in fade-in-0 slide-in-from-top-1 duration-150">
                    <div className="min-h-0 flex-1 overflow-y-auto p-1">
                        {sections.map((s) => {
                            const from = at
                            at += s.items.length
                            return (
                                <div key={s.label}>
                                    <div className="flex items-baseline justify-between gap-2 px-2 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                        {s.label}
                                        {s.note && <span className="truncate normal-case tracking-normal">{s.note}</span>}
                                    </div>
                                    {s.items.map((item, i) => {
                                        const index = from + i
                                        return (
                                            <button
                                                key={item.key}
                                                type="button"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={item.pick}
                                                onMouseMove={() => setSel(index)}
                                                ref={index === sel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
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
                            )
                        })}
                        {status && <div className="px-2 py-3 text-center text-xs text-muted-foreground">{status}</div>}
                    </div>
                    <div className="border-t border-border px-3 py-1 text-[10.5px] text-muted-foreground/80">
                        {hasResults ? '↑↓ to move · ↵ to open · esc to clear' : '↑↓ to move · ↵ or tab to pick · from: in: has: mentions: narrow a search'}
                    </div>
                </div>
            )}
        </div>
    )
}
