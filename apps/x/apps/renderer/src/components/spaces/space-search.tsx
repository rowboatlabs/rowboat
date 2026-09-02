import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Hash, MessageSquare, PenTool, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import type { RailSelection } from '@/lib/spaces-selection'
import { useMemberNames } from './member-text'

// The space's search bar (header, top right). ⌘K focuses it while a space is
// open — registered on window in the CAPTURE phase so it wins over App.tsx's
// document-level ⌘K (the global palette), which stays the shortcut everywhere
// else. Results are the org's categorized search (spaces:search → harbor
// /search): three vertical sections, one flat keyboard order across them.
// Snippets arrive as raw wire text; mentions resolve here, like any body.

interface Props {
    orgId: string
    spaceId: string
    onNavigate: (sel: RailSelection) => void
}

/** One pickable row, whatever its section — the keyboard walks this flat list. */
interface Item {
    key: string
    pick: () => void
    row: ReactNode
}

const EMPTY: spaces.SearchResults = { messages: [], topics: [], assets: [], truncated: { messages: false, topics: false, assets: false } }

export function SpaceSearch({ orgId, spaceId, onNavigate }: Props) {
    const names = useMemberNames()
    const inputRef = useRef<HTMLInputElement>(null)
    const [query, setQuery] = useState('')
    const [focused, setFocused] = useState(false)
    const [results, setResults] = useState<spaces.SearchResults>(EMPTY)
    const [loading, setLoading] = useState(false)
    const debounced = useDebounce(query, 250)

    // ⌘K focuses THIS search while a space pane exists. Capture on window
    // fires before App.tsx's document-bubble listener; stopPropagation keeps
    // the global palette closed.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                e.stopPropagation()
                inputRef.current?.focus()
                inputRef.current?.select()
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [])

    // Fetch on the debounced query; a stale response never overwrites a newer one.
    const seq = useRef(0)
    useEffect(() => {
        const q = debounced.trim()
        if (q.length < 2) {
            setResults(EMPTY)
            setLoading(false)
            return
        }
        const mine = ++seq.current
        setLoading(true)
        void window.ipc
            .invoke('spaces:search', { orgId, spaceId, q, limit: 5 })
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
    }, [debounced, orgId, spaceId])

    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const mark = (text: string) => highlight(resolveMentions(text, names), words)

    const pick = (sel: RailSelection) => {
        onNavigate(sel)
        setFocused(false)
        inputRef.current?.blur()
    }

    const items: Item[] = [
        ...results.messages.map((m): Item => ({
            key: `m:${m.messageId}`,
            pick: () => pick({ kind: 'thread', rootMessageId: m.threadRootId }),
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
        })),
        ...results.topics.map((t): Item => ({
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
        ...results.assets.map((a): Item => {
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

    const open = focused && query.trim().length >= 2
    const sections: Array<{ label: string; hint: boolean; from: number; count: number }> = []
    {
        let at = 0
        for (const [label, count, hint] of [
            ['Messages', results.messages.length, results.truncated.messages],
            ['Discussions', results.topics.length, results.truncated.topics],
            ['Files', results.assets.length, results.truncated.assets],
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
        <div className="relative">
            <label
                className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground',
                    'w-40 transition-[width] focus-within:w-64 focus-within:border-foreground/30',
                )}
            >
                <Search className="size-3 shrink-0" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={onKeyDown}
                    placeholder="Search"
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
                {!focused && <kbd className="rounded border border-border bg-muted px-1 text-[10px]">⌘K</kbd>}
            </label>
            {open && (
                <div className="absolute right-0 top-full z-30 mt-1 max-h-96 w-[26rem] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
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
                            {loading ? 'Searching…' : 'No matches in this space'}
                        </div>
                    )}
                    {items.length > 0 && (
                        <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">↑↓ · ↵ to open · esc</div>
                    )}
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
