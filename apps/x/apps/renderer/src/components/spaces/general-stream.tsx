import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Composer, type AgentOptions } from '@/components/spaces/composer'
import { MemberName } from '@/components/spaces/member-text'
import { DayDivider, MessageRow, NewDivider, TypingIndicator, type ThreadRowData } from '@/components/spaces/message-row'
import type { GeneralState, SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import {
    buildPendingMessage, failPendingGeneralMessage, ingestGeneralMessage, rememberThread, removeGeneralMessage,
    resolvePendingGeneralMessage, updateGeneralMessage, usePresenceSender,
} from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { buildThreadSeed, dayKey, explicitTitle, formatDayLabel, isContinuation, isGeneralSeedMessage } from '@/lib/spaces-conventions'
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
    org, space, general, threads, topics, presence, members, memberNames, entries = [], onOpenThread, onOpenSession,
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
    useEffect(() => {
        const el = scrollRef.current
        if (!el || !general.ready) return
        if (!restoredRef.current) {
            restoredRef.current = true
            const saved = scrollMemory.get(memoryKey)
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
        const hasNew = !mark || topic.lastActivityAt > mark
        // A renamed thread shows its name on the chip; auto-titled ones stay
        // compact. Without the seed prefetch the parent message stands in —
        // the seed's first line IS the parent's, so the comparison holds.
        const named = explicitTitle(topic, threads.byTopic.get(topicId)?.firstMessage?.body ?? message.body)
        return {
            topicId,
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

    const replyInThread = async (parent: spaces.Message) => {
        try {
            // anchorMessageId is the contract linkage; the seed's marker stays for
            // teammates on pre-contract builds to parse.
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, body: buildThreadSeed(parent), anchorMessageId: parent.id })
            rememberThread(org.id, space.id, result.topic, result.message)
            markTopicRead(org.id, space.id, result.topic.id)
            analytics.spacesTopicStarted()
            onOpenThread(result.topic.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not start the topic', 'error')
        }
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

    // Render: day dividers, compaction, the New line, thread rows.
    const rows: ReactNode[] = []
    let prev: spaces.Message | undefined
    let prevDay = ''
    let newShown = false
    if (hiddenCount > 0) {
        rows.push(
            <div key="earlier" className="flex justify-center py-2">
                <button
                    type="button"
                    onClick={() => setRenderCap((c) => c + 200)}
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                >
                    Show earlier messages ({hiddenCount} more)
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
                onReplyInThread={(m) => void replyInThread(m)}
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
                }}
            >
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
