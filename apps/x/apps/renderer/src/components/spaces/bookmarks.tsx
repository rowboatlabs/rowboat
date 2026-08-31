import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Loader2, Pin, X as XIcon } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MemberAvatar } from '@/components/spaces/atoms'
import { useMemberNames } from '@/components/spaces/member-text'
import { loadSpaceCorpus, peekSpaceCorpus, pinnedMessages } from '@/lib/spaces-corpus'
import { removeSaved, useSaved } from '@/lib/spaces-saved'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'

// The header's bookmark panel: two lists over the same gesture — Pinned
// (shared, the 📌 reaction; everyone sees the same list) and Saved (personal,
// this install only). Both rows click through to the message itself.

/** One notification-sized line: markdown scaffolding and image embeds dropped. */
export function messageExcerpt(body: string, memberNames: ReadonlyMap<string, string>, max = 120): string {
    const flat = resolveMentions(body, memberNames)
        .replace(/```[\s\S]*?(```|$)/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/^[ \t]*>.*$/gm, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/[`*_#]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || '(attachment)'
}

function BookmarkRow({ authorId, authorName, postedAt, excerpt, topicLabel, onOpen, onRemove }: {
    authorId: string
    authorName: string
    postedAt: string
    excerpt: string
    topicLabel: string
    onOpen: () => void
    onRemove?: (() => void) | undefined
}) {
    return (
        <div className="group/bm relative">
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
            >
                <MemberAvatar id={authorId} name={authorName} size="sm" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[11px]">
                        <span className="font-semibold text-foreground">{authorName}</span>
                        <span className="text-muted-foreground">{formatFeedTime(postedAt)}</span>
                        <span className="min-w-0 truncate text-muted-foreground">· {topicLabel}</span>
                    </span>
                    <span className="block truncate text-xs text-foreground/90">{excerpt}</span>
                </span>
            </button>
            {onRemove && (
                <button
                    type="button"
                    aria-label="Remove from saved"
                    onClick={onRemove}
                    className="absolute right-1.5 top-1.5 hidden rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground group-hover/bm:block"
                >
                    <XIcon className="size-3" />
                </button>
            )}
        </div>
    )
}

export function BookmarksPopover({ orgId, spaceId, generalId, topics, onNavigate }: {
    orgId: string
    spaceId: string
    /** The stream topic's id — its messages label as "Messages". */
    generalId: string | null
    topics: spaces.Topic[]
    /** Open the message's surface and scroll to it. */
    onNavigate: (topicId: string, messageId: string) => void
}) {
    const memberNames = useMemberNames()
    const [tab, setTab] = useState<'pinned' | 'saved'>('pinned')
    const [open, setOpen] = useState(false)
    const [corpus, setCorpus] = useState<spaces.Message[] | null>(() => peekSpaceCorpus(orgId, spaceId))
    const [loading, setLoading] = useState(false)
    const saved = useSaved(orgId, spaceId)

    // The pinned list needs the corpus (every topic's newest page) — fetch on
    // open, paint the cached copy meanwhile.
    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        void loadSpaceCorpus(orgId, spaceId)
            .then((messages) => {
                if (cancelled) return
                setCorpus(messages)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open, orgId, spaceId])

    const pinned = useMemo(() => pinnedMessages(corpus ?? []), [corpus])
    const topicLabel = (topicId: string): string => {
        if (topicId === generalId) return 'Messages'
        const topic = topics.find((t) => t.id === topicId)
        return topic ? resolveMentions(topic.title, memberNames) : 'topic'
    }
    const nameOf = (id: string) => memberNames.get(id) ?? id

    const count = tab === 'pinned' ? pinned.length : saved.length

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title="Pinned & saved messages"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                >
                    <Bookmark className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-1.5">
                <div className="flex items-center gap-1 px-1 pb-1.5 pt-0.5">
                    {(['pinned', 'saved'] as const).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTab(t)}
                            className={cn(
                                'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs capitalize',
                                tab === t ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {t === 'pinned' ? <Pin className="size-3" /> : <Bookmark className="size-3" />}
                            {t}
                        </button>
                    ))}
                    <span className="flex-1" />
                    {loading && tab === 'pinned' ? (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    ) : (
                        <span className="pr-1 text-[11px] text-muted-foreground">{count}</span>
                    )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {tab === 'pinned' &&
                        pinned.map((m) => (
                            <BookmarkRow
                                key={m.id}
                                authorId={m.author.memberId}
                                authorName={nameOf(m.author.memberId)}
                                postedAt={m.postedAt}
                                excerpt={messageExcerpt(m.body, memberNames)}
                                topicLabel={topicLabel(m.topicId)}
                                onOpen={() => {
                                    setOpen(false)
                                    onNavigate(m.topicId, m.id)
                                }}
                                onRemove={undefined}
                            />
                        ))}
                    {tab === 'pinned' && pinned.length === 0 && !loading && (
                        <div className="px-2 py-4 text-xs text-muted-foreground">
                            Nothing pinned. Pin a message from its ⋯ menu — pins are shared with the whole space.
                        </div>
                    )}
                    {tab === 'saved' &&
                        saved.map((s) => (
                            <BookmarkRow
                                key={s.messageId}
                                authorId={s.authorId}
                                authorName={nameOf(s.authorId)}
                                postedAt={s.postedAt}
                                excerpt={messageExcerpt(s.body, memberNames)}
                                topicLabel={topicLabel(s.topicId)}
                                onOpen={() => {
                                    setOpen(false)
                                    onNavigate(s.topicId, s.messageId)
                                }}
                                onRemove={() => removeSaved(orgId, spaceId, s.messageId)}
                            />
                        ))}
                    {tab === 'saved' && saved.length === 0 && (
                        <div className="px-2 py-4 text-xs text-muted-foreground">
                            Nothing saved. Save a message from its ⋯ menu — saved items are just for you.
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
