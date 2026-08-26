import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Composer, type AgentOptions } from '@/components/spaces/composer'
import { MemberName } from '@/components/spaces/member-text'
import { DayDivider, MessageRow, NewDivider, TypingIndicator, type ThreadRowData } from '@/components/spaces/message-row'
import type { GeneralState, SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import {
    buildPendingMessage, failPendingGeneralMessage, ingestGeneralMessage, loadOlderGeneralMessages,
    removeGeneralMessage, resolvePendingGeneralMessage, updateGeneralMessage, usePresenceSender,
} from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { dayKey, explicitTitle, formatDayLabel, isContinuation, isGeneralSeedMessage } from '@/lib/spaces-conventions'
import { resolveMentions } from '@/lib/spaces-presentation'
import { getTopicLastReadAt, markTopicRead } from '@/lib/spaces-read-state'
import { maybeInvokeRowboat } from '@/lib/spaces-rowboat'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// Messages — the space's open stream. What people say, in order; a message
// that gets replies becomes a topic (shown as a row under it here).

/** Scroll position per space, so coming back (a topic, a file, the top ‹ ›) lands where you were. */
const scrollMemory = new Map<string, number>()

/** How many messages render at first; the data is local, so expanding is instant. */
const RENDER_CAP = 100

export function GeneralStream({
    org, space, general, threads, topics, presence, members, memberNames, entries = [], onOpenThread, onStartThread, onOpenSession,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    general: GeneralState
    threads: ThreadIndex
    topics: spaces.Topic[]
    presence: SpacePresence
    members: spaces.Member[]
    memberNames: Map<string, string>
    /** The space's files — the composer's @ typeahead offers them as links. */
    entries?: spaces.SpacesAssetEntry[]
    onOpenThread: (topicId: string) => void
    /** Reply on a message with no thread yet — open a draft pane (no topic until first send). */
    onStartThread: (parent: spaces.Message) => void
    onOpenSession?: (sessionId: string) => void
}) {
    const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const generalId = general.topic?.id ?? null
    const { onType } = usePresenceSender(org.id, space.id, generalId ?? undefined)

    // Agents invoked straight from the stream hold their working lease on the
    // stream's own topic — surface it here, typing-indicator position.
    const workingHere = presence.working.get(generalId ?? '') ?? []
    const openStreamSession = async () => {
        if (!generalId) return
        try {
            const { sessionId } = await window.ipc.invoke('spaces:topicSession', { orgId: org.id, spaceId: space.id, topicId: generalId })
            if (sessionId && onOpenSession) onOpenSession(sessionId)
            else if (!sessionId) toast('No agent session here yet', 'info')
        } catch {
            toast('Could not open the agent session', 'error')
        }
    }

    // "New" divider: snapshot the read mark when general opens; mark read from then on.
    const [newSince] = useState<string | null>(() => (generalId ? getTopicLastReadAt(org.id, space.id, generalId) : null))
    useEffect(() => {
        if (!generalId || !general.ready) return
        markTopicRead(org.id, space.id, generalId)
    }, [org.id, space.id, generalId, general.ready, general.messages.length])

    // First paint: restore the remembered position (or start at the bottom).
    // After that: keep the tail in view when new messages land, unless the
    // reader scrolled up. Remember the position on the way out.
    const memoryKey = `${org.id}/${space.id}`
    const restoredRef = useRef(false)
    const lastScrollTopRef = useRef<number | null>(null)
    // Layout effect: the anchor lands before paint — no flash of the top.
    useLayoutEffect(() => {
        const el = scrollRef.current
        if (!el || !general.ready) return
        if (!restoredRef.current) {
            restoredRef.current = true
            const saved = scrollMemory.get(memoryKey)
            // A saved position is never the bottom (bottom deletes it) — mark
            // follow-mode off NOW, before the scroll event lands, so the tail
            // pin can't yank a restored position down meanwhile.
            if (saved !== undefined) lastScrollTopRef.current = saved
            el.scrollTop = saved ?? el.scrollHeight
            return
        }
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
        if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
    }, [general.ready, general.messages.length, presence.typing, workingHere.length, memoryKey])
    useEffect(() => {
        return () => {
            if (lastScrollTopRef.current !== null) scrollMemory.set(memoryKey, lastScrollTopRef.current)
        }
    }, [memoryKey])

    const topicsById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics])

    const threadRowFor = (message: spaces.Message): ThreadRowData | null => {
        const topicId = threads.byParent.get(message.id)
        if (!topicId) return null
        const topic = topicsById.get(topicId)
        if (!topic) return null
        const mark = getTopicLastReadAt(org.id, space.id, topicId)
        // Archived threads never read as unread — consistent with the rail
        // badge and countSpaceUnread, which both skip archived topics.
        const hasNew = !topic.archived && (!mark || topic.lastActivityAt > mark)
        // A renamed thread shows its name on the chip; auto-titled ones stay
        // compact. Without the seed prefetch the parent message stands in —
        // the seed's first line IS the parent's, so the comparison holds.
        const named = explicitTitle(topic, threads.byTopic.get(topicId)?.firstMessage?.body ?? message.body)
        return {
            topicId,
            archived: topic.archived,
            replyCount: Math.max(0, topic.messageCount - 1),
            lastActivityAt: topic.lastActivityAt,
            // Count isn't known without the thread's messages; 1 reads as "has new" on the row.
            unreadCount: hasNew && topic.messageCount > 1 ? 1 : 0,
            workingAgents: presence.working.get(topicId) ?? [],
            title: named ? resolveMentions(named, memberNames) : null,
        }
    }

    // Optimistic send (the Slack pattern): the message renders the moment
    // Enter lands, dimmed as pending; the org's write confirms — or fails,
    // leaving a retry/discard row — in the background. The composer never
    // waits on the round trip.
    const post = async (body: string, agent?: AgentOptions) => {
        if (!generalId) return
        const pending = buildPendingMessage(space.id, generalId, org.memberId, body)
        ingestGeneralMessage(org.id, space.id, pending)
        markTopicRead(org.id, space.id, generalId)
        void window.ipc
            .invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId: generalId, body })
            .then((result) => {
                resolvePendingGeneralMessage(org.id, space.id, pending.id, result.message)
                markTopicRead(org.id, space.id, generalId)
                analytics.spacesMessagePosted({ kind: 'general', mentionsRowboat: containsRowboatAddress(body) })
                maybeInvokeRowboat(org, space, result.topic, result.message.id, body, agent)
            })
            .catch(() => {
                failPendingGeneralMessage(org.id, space.id, pending.id)
            })
    }

    const retryFailed = (message: spaces.Message) => {
        removeGeneralMessage(org.id, space.id, message.id)
        void post(message.body)
    }
    const discardFailed = (message: spaces.Message) => removeGeneralMessage(org.id, space.id, message.id)

    // Reply creates NOTHING: an existing thread opens (even a 0-reply one left
    // by an older build), otherwise a draft pane — the topic is created only
    // when the first reply is actually sent (DraftThreadPane).
    const replyInThread = (parent: spaces.Message) => {
        const existing = threads.byParent.get(parent.id)
        if (existing) onOpenThread(existing)
        else onStartThread(parent)
    }

    const askRowboat = (message: spaces.Message) => {
        const name = memberNames.get(message.author.memberId) ?? message.author.memberId
        // Quote with names, not wire ids — the composer re-encodes on send.
        const quote = resolveMentions(message.body, memberNames).split('\n').map((l) => `> ${l}`).join('\n')
        setSeed({ text: `@rowboat \n\n${quote}\n— ${name}`, nonce: Date.now() })
    }

    // Toggle: add when the viewer isn't in the group yet, remove when they are.
    const toggleReaction = async (message: spaces.Message, emoji: string) => {
        const mine = (message.reactions ?? []).find((g) => g.emoji === emoji)?.memberIds.includes(org.memberId)
        const action = mine ? 'remove' : 'add'
        try {
            const { message: updated } = await window.ipc.invoke('spaces:reactToMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, emoji, action,
            })
            updateGeneralMessage(org.id, space.id, updated)
            analytics.spacesReactionToggled({ action })
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

    const deleteMessage = async (message: spaces.Message) => {
        if (!window.confirm('Delete this message? This cannot be undone.')) return
        try {
            const { message: deleted } = await window.ipc.invoke('spaces:deleteMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id,
            })
            updateGeneralMessage(org.id, space.id, deleted)
            analytics.spacesMessageDeleted()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete', 'error')
        }
    }

    // Long histories: render only the tail — every message is markdown through
    // Streamdown, so an uncapped list makes the first paint crawl. "Show
    // earlier" just lifts the cap; the messages are already in memory.
    const streamMessages = useMemo(
        () => general.messages.filter((m, i) => !(general.topic && isGeneralSeedMessage(general.topic, m, i))),
        [general.messages, general.topic],
    )
    const [renderCap, setRenderCap] = useState(RENDER_CAP)
    useEffect(() => setRenderCap(RENDER_CAP), [memoryKey])
    const hiddenCount = Math.max(0, streamMessages.length - renderCap)
    const visibleMessages = hiddenCount > 0 ? streamMessages.slice(hiddenCount) : streamMessages

    // "Earlier" is one gesture with two gears: locally-hidden rows reveal
    // instantly (the render cap), and once local rows run out the page below
    // the loaded window is fetched (the server sends only the newest page).
    // Either way the pre-action scroll geometry is restored — no jump.
    const pendingRestoreRef = useRef<{ height: number; top: number; oldest?: number } | null>(null)
    const loadEarlier = () => {
        const el = scrollRef.current
        if (!el || pendingRestoreRef.current) return
        if (hiddenCount > 0) {
            pendingRestoreRef.current = { height: el.scrollHeight, top: el.scrollTop }
            setRenderCap((c) => c + 200)
        } else if (general.hasMore && !general.loadingOlder) {
            const oldest = general.messages.find((m) => !m.pending && !m.failed)?.offset
            if (oldest === undefined) return
            pendingRestoreRef.current = { height: el.scrollHeight, top: el.scrollTop, oldest }
            // The fetched page must also render: lift the cap along with it.
            setRenderCap((c) => c + 200)
            void loadOlderGeneralMessages(org.id, space.id)
        }
    }
    // A reveal restores immediately — the rows are local.
    useLayoutEffect(() => {
        const el = scrollRef.current
        const pending = pendingRestoreRef.current
        if (!el || !pending || pending.oldest !== undefined) return
        el.scrollTop = el.scrollHeight - pending.height + pending.top
        lastScrollTopRef.current = el.scrollTop
        pendingRestoreRef.current = null
    }, [renderCap])
    // A fetch restores once the older page actually prepended.
    useLayoutEffect(() => {
        const el = scrollRef.current
        const pending = pendingRestoreRef.current
        if (!el || !pending || pending.oldest === undefined) return
        const oldestNow = general.messages.find((m) => !m.pending && !m.failed)?.offset
        if (oldestNow !== undefined && oldestNow < pending.oldest) {
            el.scrollTop = el.scrollHeight - pending.height + pending.top
            lastScrollTopRef.current = el.scrollTop
            pendingRestoreRef.current = null
        } else if (!general.loadingOlder) {
            // Settled without a prepend (failed, or raced empty).
            pendingRestoreRef.current = null
        }
    }, [general.messages, general.loadingOlder])

    // The bottom anchor is not one-shot: message bodies keep growing after
    // first layout (lazy images have no reserved height, code highlighting and
    // mermaid render async), and every late growth ABOVE the viewport shoves a
    // one-time anchor to a random middle point. While the reader is following
    // the tail (hasn't scrolled up), any content-size change re-pins the
    // bottom; the moment they scroll away, the pin lets go.
    const contentRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        const el = scrollRef.current
        const content = contentRef.current
        if (!el || !content) return
        const ro = new ResizeObserver(() => {
            if (lastScrollTopRef.current === null && !pendingRestoreRef.current) {
                el.scrollTop = el.scrollHeight
            }
        })
        ro.observe(content)
        return () => ro.disconnect()
    }, [])

    // Render: day dividers, compaction, the New line, thread rows.
    const rows: ReactNode[] = []
    let prev: spaces.Message | undefined
    let prevDay = ''
    let newShown = false
    if (hiddenCount > 0 || general.hasMore) {
        rows.push(
            <div key="earlier" className="flex justify-center py-2">
                <button
                    type="button"
                    onClick={loadEarlier}
                    disabled={general.loadingOlder}
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                >
                    {general.loadingOlder
                        ? 'Loading earlier messages…'
                        : hiddenCount > 0
                          ? `Show earlier messages (${hiddenCount} more)`
                          : 'Load earlier messages'}
                </button>
            </div>,
        )
    }
    visibleMessages.forEach((message) => {
        // Deleted messages disappear — unless a thread grew from one, which
        // keeps a tombstone row so the thread stays reachable.
        const thread = threadRowFor(message)
        if (message.deletedAt && !thread) return
        const day = dayKey(message.postedAt)
        if (day !== prevDay) {
            rows.push(<DayDivider key={`day:${day}`} label={formatDayLabel(message.postedAt)} />)
            prevDay = day
            prev = undefined
        }
        if (!newShown && newSince && message.postedAt > newSince && message.author.memberId !== org.memberId) {
            rows.push(<NewDivider key="new" />)
            newShown = true
            prev = undefined
        }
        rows.push(
            <MessageRow
                key={message.id}
                message={message}
                memberNames={memberNames}
                continuation={isContinuation(prev, message)}
                thread={thread}
                selfMemberId={org.memberId}
                onOpenThread={onOpenThread}
                onReplyInThread={replyInThread}
                onAskRowboat={askRowboat}
                onCopyLink={(m) => void copyLink(m)}
                onReact={(m, emoji) => void toggleReaction(m, emoji)}
                onDelete={(m) => void deleteMessage(m)}
                onRetryFailed={retryFailed}
                onDiscardFailed={discardFailed}
            />,
        )
        prev = message
    })

    const typingNames = (presence.typing.get(generalId ?? '') ?? []).map((id) => memberNames.get(id) ?? id)

    return (
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="flex items-center gap-2.5 px-5 h-9 shrink-0">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Messages</span>
                <span className="text-xs text-muted-foreground truncate">What the team says, in order. Reply to one to start a topic.</span>
                <span className="flex-1" />
                {general.error && <span className="text-xs text-destructive truncate" title={general.error}>messages unavailable</span>}
            </div>
            <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto px-3 pb-1"
                onScroll={(e) => {
                    const el = e.currentTarget
                    // At the bottom = "follow the tail"; remember that as "no saved position".
                    lastScrollTopRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8 ? null : el.scrollTop
                    if (lastScrollTopRef.current === null) scrollMemory.delete(memoryKey)
                    if (el.scrollTop < 80) loadEarlier()
                }}
            >
                {/* One measurable child — the tail pin observes its size. */}
                <div ref={contentRef}>
                {!general.ready && (
                    <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading messages…</div>
                )}
                {general.ready && rows.length === 0 && (
                    <div className="px-2 py-6 text-sm text-muted-foreground">Nothing here yet — say hello, or @rowboat to ask your agent.</div>
                )}
                {rows}
                {workingHere.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pl-10 pt-1">
                        {workingHere.map((memberId) => {
                            const own = memberId === org.memberId
                            const label = own ? 'Your Rowboat is working…' : <><MemberName id={memberId} />’s Rowboat is working…</>
                            return own ? (
                                <button key={memberId} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Open the agent session" onClick={() => void openStreamSession()}>
                                    <Loader2 className="size-3 animate-spin" />{label}
                                </button>
                            ) : (
                                <span key={memberId} className="flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground"><Bot className="size-3" />{label}</span>
                            )
                        })}
                    </div>
                )}
                <TypingIndicator names={typingNames} />
                <div ref={bottomRef} />
                </div>
            </div>
            <Composer
                placeholder={`Message ${space.name} — @rowboat to ask your agent`}
                busy={!generalId}
                onSend={post}
                onType={onType}
                seed={seed}
                members={members}
                entries={entries}
                selfMemberId={org.memberId}
            />
        </section>
    )
}
