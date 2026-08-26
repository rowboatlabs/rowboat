import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Loader2, MoreHorizontal, Pencil, Tag } from 'lucide-react'
import type { spaces } from '@x/shared'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DayDivider, MessageRow, type ThreadRowData } from '@/components/spaces/message-row'
import type { SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import { updateGeneralMessage } from '@/hooks/use-space-chat'
import { refreshSpaceFeed, type OrgWithSpaces } from '@/hooks/use-spaces'
import { dayKey, explicitTitle, formatDayLabel, mergeMessages } from '@/lib/spaces-conventions'
import { resolveMentions } from '@/lib/spaces-presentation'
import { getTopicLastReadAt } from '@/lib/spaces-read-state'
import { toast } from '@/lib/toast'

// A topic's view (a label on the wire): every message someone tagged with it,
// across the stream, each with its thread chip — the curation layer over the
// chat. Nothing is posted HERE: messages live in the stream and in threads;
// this pane groups them. Threads inherit the topic from their anchor message,
// so opening one from a chip keeps the topic's context.

export function LabelPane({
    org, space, labelId, labels, threads, topics, presence, memberNames, refreshTick,
    onBack, onOpenThread, onStartThread,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    labelId: string
    /** The feed store's labels — name/archived state stay live between refetches. */
    labels: spaces.LabelListing[]
    threads: ThreadIndex
    topics: spaces.Topic[]
    presence: SpacePresence
    memberNames: Map<string, string>
    refreshTick: number
    onBack: () => void
    onOpenThread: (topicId: string) => void
    /** Reply on a tagged message with no thread yet — same draft flow as the stream. */
    onStartThread: (parent: spaces.Message) => void
}) {
    const [label, setLabel] = useState<spaces.Label | null>(labels.find((l) => l.id === labelId) ?? null)
    const [messages, setMessages] = useState<spaces.Message[]>([])
    const [loaded, setLoaded] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [loadingOlder, setLoadingOlder] = useState(false)
    // The deepest (oldest) offset any fetch reached — a refetch of the newest
    // page must not reset hasMore after the reader paged further back.
    const oldestLoadedRef = useRef<number | null>(null)

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:listLabelMessages', { orgId: org.id, spaceId: space.id, labelId })
            .then((res) => {
                if (cancelled) return
                setLabel(res.label)
                // A refetch merges — and drops rows whose label moved away.
                setMessages((prev) => mergeMessages(prev, res.messages).filter((m) => m.labelId === labelId))
                const windowOldest = res.messages[0]?.offset ?? null
                if (oldestLoadedRef.current === null || windowOldest === null || windowOldest <= oldestLoadedRef.current) {
                    oldestLoadedRef.current = windowOldest ?? oldestLoadedRef.current
                    setHasMore(res.hasMore)
                }
                setLoaded(true)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, labelId, refreshTick])

    const loadOlder = async () => {
        const oldest = messages[0]
        if (!oldest || loadingOlder) return
        setLoadingOlder(true)
        try {
            const res = await window.ipc.invoke('spaces:listLabelMessages', {
                orgId: org.id, spaceId: space.id, labelId, beforeOffset: oldest.offset,
            })
            setMessages((prev) => mergeMessages(prev, res.messages))
            oldestLoadedRef.current = res.messages[0]?.offset ?? oldestLoadedRef.current
            setHasMore(res.hasMore)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not load earlier messages', 'error')
        } finally {
            setLoadingOlder(false)
        }
    }

    const manage = async (action: spaces.SpacesManageLabelAction) => {
        try {
            const res = await window.ipc.invoke('spaces:manageLabel', { orgId: org.id, spaceId: space.id, labelId, action })
            setLabel(res.label)
            await refreshSpaceFeed(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the topic', 'error')
        }
    }
    const [editingName, setEditingName] = useState<string | null>(null)
    const commitName = async () => {
        const name = editingName?.trim()
        setEditingName(null)
        if (!name || name === label?.name) return
        await manage({ action: 'rename', name })
    }

    // The change/remove gesture from inside the view. A removed message drops
    // out on the spot — the refetch would say the same thing, later.
    const setMessageLabel = async (message: spaces.Message, nextLabelId: string | null) => {
        try {
            const { message: updated } = await window.ipc.invoke('spaces:setMessageLabel', {
                orgId: org.id, spaceId: space.id, messageId: message.id, labelId: nextLabelId,
            })
            setMessages((prev) => (updated.labelId === labelId ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev.filter((m) => m.id !== updated.id)))
            updateGeneralMessage(org.id, space.id, updated)
            await refreshSpaceFeed(org.id, space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not set the topic', 'error')
        }
    }
    const createAndSet = async (message: spaces.Message, name: string) => {
        try {
            const { label: created } = await window.ipc.invoke('spaces:createLabel', { orgId: org.id, spaceId: space.id, name })
            await setMessageLabel(message, created.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the topic', 'error')
        }
    }
    const labeling = {
        options: labels.filter((l) => !l.archived).map((l) => ({ id: l.id, name: l.name })),
        onSet: (message: spaces.Message, next: string | null) => void setMessageLabel(message, next),
        onCreate: (message: spaces.Message, name: string) => void createAndSet(message, name),
    }

    const toggleReaction = async (message: spaces.Message, emoji: string) => {
        const mine = (message.reactions ?? []).find((g) => g.emoji === emoji)?.memberIds.includes(org.memberId)
        try {
            const { message: updated } = await window.ipc.invoke('spaces:reactToMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, emoji, action: mine ? 'remove' : 'add',
            })
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            updateGeneralMessage(org.id, space.id, updated)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not react', 'error')
        }
    }

    const copyLink = async (message: spaces.Message) => {
        try {
            await navigator.clipboard.writeText(`https://${org.address}/s/${space.id}/t/${message.topicId}#${message.id}`)
            toast('Link copied', 'success')
        } catch {
            toast('Could not copy the link', 'error')
        }
    }

    const topicsById = new Map(topics.map((t) => [t.id, t]))
    const threadRowFor = (message: spaces.Message): ThreadRowData | null => {
        const topicId = threads.byParent.get(message.id)
        if (!topicId) return null
        const topic = topicsById.get(topicId)
        if (!topic) return null
        const mark = getTopicLastReadAt(org.id, space.id, topicId)
        const hasNew = !mark || topic.lastActivityAt > mark
        const named = explicitTitle(topic, threads.byTopic.get(topicId)?.firstMessage?.body ?? message.body)
        return {
            topicId,
            replyCount: Math.max(0, topic.messageCount - 1),
            lastActivityAt: topic.lastActivityAt,
            unreadCount: hasNew && topic.messageCount > 1 ? 1 : 0,
            workingAgents: presence.working.get(topicId) ?? [],
            title: named ? resolveMentions(named, memberNames) : null,
        }
    }

    const visible = messages.filter((m) => !m.deletedAt || threadRowFor(m))
    const name = label?.name ?? labels.find((l) => l.id === labelId)?.name ?? 'Topic'

    return (
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 h-11 shrink-0">
                <button
                    type="button"
                    title="Back to Messages"
                    onClick={onBack}
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <ArrowLeft className="size-3.5" />
                </button>
                <Tag className="size-3.5 shrink-0 text-muted-foreground" />
                {editingName !== null ? (
                    <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitName()
                            if (e.key === 'Escape') setEditingName(null)
                        }}
                        onBlur={() => void commitName()}
                        className="min-w-0 flex-1 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[13.5px] font-semibold outline-none"
                    />
                ) : (
                    <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{name}</h2>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {visible.length}{hasMore ? '+' : ''} {visible.length === 1 && !hasMore ? 'message' : 'messages'}
                </span>
                {label?.archived && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">archived</span>}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Topic actions" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                            <MoreHorizontal className="size-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingName(name)}>
                            <Pencil className="size-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        {label?.archived ? (
                            <DropdownMenuItem onClick={() => void manage({ action: 'unarchive' })}>
                                <ArchiveRestore className="size-3.5 mr-2" /> Unarchive
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem onClick={() => void manage({ action: 'archive' })}>
                                <Archive className="size-3.5 mr-2" /> Archive
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
                {!loaded && (
                    <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</div>
                )}
                {loaded && visible.length === 0 && (
                    <div className="px-2 py-6 text-sm text-muted-foreground">
                        Nothing here yet — add this topic to a message in the stream and it shows up here, thread and all.
                    </div>
                )}
                {hasMore && (
                    <div className="flex justify-center py-2">
                        <button
                            type="button"
                            onClick={() => void loadOlder()}
                            disabled={loadingOlder}
                            className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                        >
                            {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                        </button>
                    </div>
                )}
                {(() => {
                    // Tagged messages are sparse — every row keeps its author
                    // header (no compaction), day dividers keep the timeline.
                    const rows: React.ReactNode[] = []
                    let prevDay = ''
                    for (const message of visible) {
                        const day = dayKey(message.postedAt)
                        if (day !== prevDay) {
                            rows.push(<DayDivider key={`day:${day}`} label={formatDayLabel(message.postedAt)} />)
                            prevDay = day
                        }
                        rows.push(
                            <MessageRow
                                key={message.id}
                                message={message}
                                memberNames={memberNames}
                                continuation={false}
                                thread={threadRowFor(message)}
                                labeling={labeling}
                                selfMemberId={org.memberId}
                                onOpenThread={onOpenThread}
                                onReplyInThread={(m) => {
                                    const existing = threads.byParent.get(m.id)
                                    if (existing) onOpenThread(existing)
                                    else onStartThread(m)
                                }}
                                onCopyLink={(m) => void copyLink(m)}
                                onReact={(m, emoji) => void toggleReaction(m, emoji)}
                            />,
                        )
                    }
                    return rows
                })()}
            </div>
            <div className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                Messages are written in the stream — this view groups the ones tagged “{name}”.
            </div>
        </section>
    )
}
