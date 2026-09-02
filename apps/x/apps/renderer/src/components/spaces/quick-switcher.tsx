import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Hash, Loader2, MessagesSquare, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { MemberAvatar } from '@/components/spaces/atoms'
import { messageExcerpt } from '@/components/spaces/bookmarks'
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { loadSpaceCorpus, parseSearchQuery, peekSpaceCorpus, searchMessages } from '@/lib/spaces-corpus'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'

// ⌘⇧K inside Spaces: one box that finds topics (this space), messages (this
// space — searched over the corpus of every topic's newest page; the protocol
// has no search route yet, so this is recent history, not an archive crawl),
// and other spaces. Enter opens; messages also scroll into view and flash.

type Result =
    | { kind: 'general'; label: string }
    | { kind: 'topic'; topic: spaces.TopicListing; title: string }
    | { kind: 'message'; message: spaces.Message; topicLabel: string }
    | { kind: 'space'; orgId: string; spaceId: string; label: string; orgLabel: string }

export function QuickSwitcher({ orgId, spaceId, topics, streamKey, open, onClose, onOpenGeneral, onOpenTopic, onOpenMessage, onSwitchSpace }: {
    orgId: string
    spaceId: string
    topics: spaces.TopicListing[]
    /** The read-state key standing for the stream. */
    streamKey: string
    open: boolean
    onClose: () => void
    onOpenGeneral: () => void
    onOpenTopic: (rootMessageId: string) => void
    onOpenMessage: (rootMessageId: string, messageId: string) => void
    onSwitchSpace: (orgId: string, spaceId: string) => void
}) {
    const memberNames = useMemberNames()
    const { selfId } = useSpaceProfiles()
    const { orgs } = useSpacesOrgs()
    const [query, setQuery] = useState('')
    const [index, setIndex] = useState(0)
    const [corpus, setCorpus] = useState<spaces.Message[] | null>(() => peekSpaceCorpus(orgId, spaceId))
    const [loading, setLoading] = useState(false)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const listRef = useRef<HTMLDivElement | null>(null)

    // Dismissal plays a short fade/zoom-out before the parent unmounts us:
    // `closing` keeps the overlay rendered (inert) for the animation beat.
    const [closing, setClosing] = useState(false)
    const closeTimerRef = useRef<number | null>(null)
    const close = () => {
        if (closing) return
        setClosing(true)
        closeTimerRef.current = window.setTimeout(() => {
            setClosing(false)
            onClose()
        }, 90)
    }
    useEffect(
        () => () => {
            if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
        },
        [],
    )

    // Opening resets and warms the message corpus (cached — reopening is free).
    useEffect(() => {
        if (!open) return
        setClosing(false)
        setQuery('')
        setIndex(0)
        // Direct focus, no rAF: the input is committed by the time this
        // effect runs, and the extra frame reads as input lag.
        inputRef.current?.focus()
        let cancelled = false
        setLoading(true)
        void loadSpaceCorpus(orgId, spaceId)
            .then((messages) => {
                if (!cancelled) setCorpus(messages)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open, orgId, spaceId])

    const q = query.trim().toLowerCase()
    const topicLabelOf = (rootMessageId: string): string => {
        if (rootMessageId === streamKey) return 'Messages'
        const t = topics.find((x) => x.rootMessageId === rootMessageId)
        return t ? resolveMentions(t.title, memberNames) : 'thread'
    }

    const results = useMemo<Result[]>(() => {
        const out: Result[] = []
        // The Discord filter grammar: from:/in:/has:/mentions: tokens scope
        // the message search; topics and spaces match on the free text only,
        // and a filtered query is a message search — no topic/space rows.
        const parsed = parseSearchQuery(q)
        const tq = parsed.terms.join(' ')
        const selfName = selfId ? memberNames.get(selfId) ?? null : null
        const rows = topics
            .filter((t) => !t.archived)
            .map((t) => ({ topic: t, title: resolveMentions(t.title, memberNames) }))
            .sort((a, b) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt))
        if (!q) {
            out.push({ kind: 'general', label: 'Messages' })
            for (const r of rows.slice(0, 8)) out.push({ kind: 'topic', ...r })
        } else {
            if (!parsed.filtered) {
                if ('messages'.includes(tq) && tq) out.push({ kind: 'general', label: 'Messages' })
                for (const r of rows.filter((r) => tq && r.title.toLowerCase().includes(tq)).slice(0, 8)) out.push({ kind: 'topic', ...r })
            }
            for (const m of searchMessages(corpus ?? [], q, memberNames, { limit: 12, topicLabelOf, selfName })) {
                out.push({ kind: 'message', message: m, topicLabel: topicLabelOf(m.threadRoot ?? streamKey) })
            }
        }
        if (!parsed.filtered) {
            for (const org of orgs) {
                for (const s of org.spaces) {
                    if (org.id === orgId && s.id === spaceId) continue
                    const hay = `${s.name} ${org.name}`.toLowerCase()
                    if (q && !hay.includes(tq)) continue
                    out.push({ kind: 'space', orgId: org.id, spaceId: s.id, label: s.name, orgLabel: org.name })
                }
            }
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q, topics, streamKey, memberNames, corpus, orgs, orgId, spaceId, selfId])

    // Clamp the highlight when the result set shrinks (adjust-on-change).
    const [lastQ, setLastQ] = useState(q)
    if (q !== lastQ) {
        setLastQ(q)
        setIndex(0)
    }
    const clamped = Math.min(index, Math.max(0, results.length - 1))

    const pick = (r: Result) => {
        close()
        if (r.kind === 'general') onOpenGeneral()
        else if (r.kind === 'topic') onOpenTopic(r.topic.rootMessageId)
        else if (r.kind === 'message') onOpenMessage(r.message.threadRoot ?? streamKey, r.message.id)
        else onSwitchSpace(r.orgId, r.spaceId)
    }

    useEffect(() => {
        listRef.current
            ?.querySelector<HTMLElement>(`[data-idx="${clamped}"]`)
            ?.scrollIntoView({ block: 'nearest' })
    }, [clamped])

    if (!open && !closing) return null

    const header = (label: string) => (
        <div key={`h:${label}`} className="px-2.5 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
        </div>
    )
    const rows: ReactNode[] = []
    let prevKind: Result['kind'] | null = null
    results.forEach((r, i) => {
        if (r.kind !== prevKind) {
            prevKind = r.kind
            if (r.kind === 'general' || (r.kind === 'topic' && results[i - 1]?.kind !== 'general')) rows.push(header('Topics'))
            else if (r.kind === 'message') rows.push(header('Messages'))
            else if (r.kind === 'space') rows.push(header('Spaces'))
        }
        const active = i === clamped
        const rowClass = cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100',
            active ? 'bg-accent text-foreground' : 'hover:bg-accent/60',
        )
        if (r.kind === 'general') {
            rows.push(
                <button key="general" data-idx={i} type="button" className={rowClass} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                    <MessagesSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">Messages</span>
                    <span className="truncate text-xs text-muted-foreground">the space's stream</span>
                </button>,
            )
        } else if (r.kind === 'topic') {
            rows.push(
                <button key={`t:${r.topic.id}`} data-idx={i} type="button" className={rowClass} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                    <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    {r.topic.archived && <span className="shrink-0 text-[11px] text-muted-foreground">archived</span>}
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatFeedTime(r.topic.lastActivityAt)}</span>
                </button>,
            )
        } else if (r.kind === 'message') {
            const name = memberNames.get(r.message.author.memberId) ?? r.message.author.memberId
            rows.push(
                <button key={`m:${r.message.id}`} data-idx={i} type="button" className={rowClass} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                    <MemberAvatar id={r.message.author.memberId} name={name} size="sm" className="shrink-0" />
                    <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5 text-[11px]">
                            <span className="font-semibold text-foreground">{name}</span>
                            <span className="text-muted-foreground">{formatFeedTime(r.message.postedAt)}</span>
                            <span className="min-w-0 truncate text-muted-foreground">· {r.topicLabel}</span>
                        </span>
                        <span className="block truncate text-xs">{messageExcerpt(r.message.body, memberNames)}</span>
                    </span>
                </button>,
            )
        } else {
            rows.push(
                <button key={`s:${r.orgId}/${r.spaceId}`} data-idx={i} type="button" className={rowClass} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{r.orgLabel}</span>
                </button>,
            )
        }
    })

    return (
        <div
            className={cn(
                'absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-[10vh]',
                closing ? 'pointer-events-none animate-out fade-out-0 duration-100 fill-mode-forwards' : 'animate-in fade-in-0 duration-100',
            )}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) close()
            }}
        >
            <div
                className={cn(
                    'w-[560px] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-popover shadow-lg',
                    closing
                        ? 'animate-out fade-out-0 zoom-out-[0.98] slide-out-to-top-1 duration-100 fill-mode-forwards'
                        : 'animate-in fade-in-0 zoom-in-[0.98] slide-in-from-top-1 duration-150 ease-out',
                )}
            >
                <label className="flex h-11 items-center gap-2 border-b border-border px-3">
                    <Search className="size-4 shrink-0 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search topics, messages, spaces…"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        onKeyDown={(e) => {
                            // ⌘⇧K toggles closed too — the pane's opener stands
                            // down while we're open, and the app's global
                            // palette must not grab this press either.
                            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'k') {
                                e.preventDefault()
                                e.stopPropagation()
                                close()
                                return
                            }
                            if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setIndex((i) => Math.min(i + 1, results.length - 1))
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setIndex((i) => Math.max(i - 1, 0))
                            } else if (e.key === 'Enter') {
                                e.preventDefault()
                                const r = results[clamped]
                                if (r) pick(r)
                            } else if (e.key === 'Escape') {
                                e.preventDefault()
                                close()
                            }
                        }}
                    />
                    {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
                </label>
                <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
                    {rows}
                    {results.length === 0 && <div className="px-2.5 py-4 text-sm text-muted-foreground">No matches{loading ? ' yet…' : '.'}</div>}
                </div>
                <div className="border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground/80">
                    ↑↓ · ↵ to open · esc · filters: <span className="font-mono">from:name</span> <span className="font-mono">in:topic</span>{' '}
                    <span className="font-mono">has:link|image|file</span> <span className="font-mono">mentions:name</span> (<span className="font-mono">me</span> works) — recent history only
                </div>
            </div>
        </div>
    )
}
