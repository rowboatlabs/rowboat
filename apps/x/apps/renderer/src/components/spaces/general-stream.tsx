import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Composer, type AgentOptions } from '@/components/spaces/composer'
import { DayDivider, MessageRow, NewDivider, TypingIndicator, type ThreadRowData } from '@/components/spaces/message-row'
import type { SpacePresence, StreamState } from '@/hooks/use-space-chat'
import {
    STREAM_READ_KEY, buildPendingMessage, failPendingStreamMessage, ingestStreamMessage, loadOlderStreamMessages,
    removeStreamMessage, resolvePendingStreamMessage, updateStreamMessage, usePresenceSender,
} from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { applyReaction, threadLabelOf } from '@/lib/spaces-conventions'
import { dayKey, formatDayLabel, isContinuation } from '@/lib/spaces-conventions'
import { resolveMentions } from '@/lib/spaces-presentation'
import { getTopicLastReadAt, markRead, markTopicRead } from '@/lib/spaces-read-state'
import { maybeInvokeRowboat } from '@/lib/spaces-rowboat'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// The space's one stream: ROOT messages in order; each message's flat thread
// lives behind its reply chip (annotation model — replying creates nothing,
// a Discussion is a deliberate annotation on a thread).

/** The first frame renders a short tail — markdown is the paint cost; the full window follows right after. */
const FIRST_PAINT_CAP = 16

/** The steady-state window; the data is local, so expanding is instant. */
const RENDER_CAP = 100

/** How long the New line lingers once the reader has caught up with it. */
const NEW_LINGER_MS = 5_000
/** Clear delay after the fade starts — must outlast the divider's duration-700. */
const NEW_FADE_MS = 800

export function GeneralStream({
    org, space, stream, presence, members, memberNames, entries = [], onOpenThread, visible = true,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    stream: StreamState
    presence: SpacePresence
    members: spaces.Member[]
    memberNames: Map<string, string>
    /** The space's files — the composer's @ typeahead offers them as links. */
    entries?: spaces.SpacesAssetEntry[]
    /** Open a thread pane on this root (replying to a fresh message included — no draft state exists). */
    onOpenThread: (rootMessageId: string) => void
    /**
     * The keep-alive flag: the stream stays MOUNTED while a thread, a file, or
     * another app section covers it, and this goes false. Hidden means no
     * presence lease, no read marks — the reader isn't actually looking.
     */
    visible?: boolean
}) {
    const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const { onType } = usePresenceSender(org.id, space.id, undefined, visible)

    // "New" divider: snapshot the read mark when the stream opens; mark read
    // from then on — but only while actually on screen. A kept-alive hidden
    // stream must not mark messages read as they arrive; the flip back to
    // visible re-runs this and marks the catch-up read.
    const [newSince, setNewSince] = useState<string | null>(() => getTopicLastReadAt(org.id, space.id, STREAM_READ_KEY))
    const [newFading, setNewFading] = useState(false)
    // Each return to the stream re-arms the line at the catch-up point: the
    // read mark as it stood while hidden. Declared BEFORE the mark-read
    // effect below — same flip, and the snapshot must win the race.
    const newArmedVisibleRef = useRef(visible)
    useEffect(() => {
        const was = newArmedVisibleRef.current
        newArmedVisibleRef.current = visible
        if (!visible || was) return
        setNewFading(false)
        setNewSince(getTopicLastReadAt(org.id, space.id, STREAM_READ_KEY))
    }, [visible, org.id, space.id])
    useEffect(() => {
        if (!visible || !stream.ready) return
        markTopicRead(org.id, space.id, STREAM_READ_KEY)
    }, [org.id, space.id, stream.ready, stream.messages.length, visible])

    // First paint: start at the bottom — the newest messages, always. After
    // that: keep the tail in view when new messages land, unless the reader
    // scrolled up.
    const memoryKey = `${org.id}/${space.id}`
    const restoredRef = useRef(false)
    const lastScrollTopRef = useRef<number | null>(null)
    // Only a scroll the READER made may turn follow-mode off. The browser
    // fires scroll events of its own: scroll anchoring compensates when a
    // lazy image finishes and its tile row wraps taller, and that event lands
    // mid-stream — indistinguishable from a reader scroll by position alone.
    // So track intent: wheel/touch stamps a time, a pointer held down (the
    // scrollbar, a text-selection drag) counts for as long as it's down.
    const userScrollAtRef = useRef(0)
    const pointerDownRef = useRef(false)
    useEffect(() => {
        const up = () => {
            pointerDownRef.current = false
        }
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
        return () => {
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', up)
        }
    }, [])
    // Layout effect: the anchor lands before paint — no flash of the top.
    useLayoutEffect(() => {
        const el = scrollRef.current
        if (!el || !stream.ready) return
        if (!restoredRef.current) {
            restoredRef.current = true
            el.scrollTop = el.scrollHeight
            return
        }
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
        if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
    }, [stream.ready, stream.messages.length, presence.typing])
    // The "jump to latest" pill: shown once the reader is meaningfully away
    // from the tail, with a count of messages that arrived below since they
    // left it. lastSeen tracks the newest offset that was ever on screen at
    // the bottom (updated by the scroll events the pins fire).
    const [awayFromBottom, setAwayFromBottom] = useState(false)
    const lastSeenOffsetRef = useRef(-1)
    const jumpToLatest = () => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }
    // Once the reader is with the new messages (on screen, at the tail) the
    // line has done its job: linger a beat, fade, drop. Keep-alive means no
    // remount ever resets it — without this it would sit in history forever.
    const hasNewLine = !!newSince && stream.messages.some((m) => m.postedAt > newSince && m.author.memberId !== org.memberId)
    useEffect(() => {
        if (!visible || !stream.ready || awayFromBottom || !hasNewLine || newFading) return
        const t = window.setTimeout(() => setNewFading(true), NEW_LINGER_MS)
        return () => window.clearTimeout(t)
    }, [visible, stream.ready, awayFromBottom, hasNewLine, newFading])
    useEffect(() => {
        if (!newFading) return
        const t = window.setTimeout(() => {
            setNewSince(null)
            setNewFading(false)
        }, NEW_FADE_MS)
        return () => window.clearTimeout(t)
    }, [newFading])
    // Coming back from hidden (keep-alive): display:none dropped the scroll
    // geometry, so put it back before paint — the remembered spot if the
    // reader had scrolled up, else the bottom (following).
    const wasVisibleRef = useRef(visible)
    useLayoutEffect(() => {
        const was = wasVisibleRef.current
        wasVisibleRef.current = visible
        const el = scrollRef.current
        if (!el || !visible || was || !restoredRef.current) return
        el.scrollTop = lastScrollTopRef.current ?? el.scrollHeight
    }, [visible])

    const threadRowFor = (message: spaces.Message): ThreadRowData | null => {
        const topic = stream.topicsByRoot.get(message.id) ?? null
        const replyCount = message.replyCount ?? 0
        const workingAgents = presence.working.get(message.id) ?? []
        if (replyCount === 0 && !topic && workingAgents.length === 0) return null
        const lastActivityAt = message.lastReplyAt ?? message.postedAt
        const mark = getTopicLastReadAt(org.id, space.id, message.id)
        // Archived topics never read as unread — consistent with the rail
        // badge and countSpaceUnread, which both skip archived ones.
        const hasNew = !topic?.archived && !!message.lastReplyAt && (!mark || message.lastReplyAt > mark)
        return {
            rootMessageId: message.id,
            archived: topic?.archived ?? false,
            replyCount,
            lastActivityAt,
            // Count isn't known without the thread's messages; 1 reads as "has new" on the row.
            unreadCount: hasNew && replyCount > 0 ? 1 : 0,
            workingAgents,
            title: topic ? resolveMentions(topic.title, memberNames) : null,
        }
    }

    // Optimistic send (the Slack pattern): the message renders the moment
    // Enter lands, dimmed as pending; the org's write confirms — or fails,
    // leaving a retry/discard row — in the background. The composer never
    // waits on the round trip.
    const post = async (body: string, agent?: AgentOptions) => {
        const pending = buildPendingMessage(space.id, org.memberId, body)
        ingestStreamMessage(org.id, space.id, pending)
        markTopicRead(org.id, space.id, STREAM_READ_KEY)
        void window.ipc
            .invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, body })
            .then((result) => {
                resolvePendingStreamMessage(org.id, space.id, pending.id, result.message)
                markTopicRead(org.id, space.id, STREAM_READ_KEY)
                analytics.spacesMessagePosted({ kind: 'general', mentionsRowboat: containsRowboatAddress(body) })
                // @rowboat on a fresh stream message: the agent works the thread
                // under it — its receipt lands as the first reply.
                maybeInvokeRowboat(org, space, { rootMessageId: result.message.id, label: threadLabelOf(body) }, result.message.id, body, agent)
            })
            .catch(() => {
                failPendingStreamMessage(org.id, space.id, pending.id)
            })
    }

    const retryFailed = (message: spaces.Message) => {
        removeStreamMessage(org.id, space.id, message.id)
        void post(message.body)
    }
    const discardFailed = (message: spaces.Message) => removeStreamMessage(org.id, space.id, message.id)

    // Reply creates NOTHING: the thread pane opens on the message itself —
    // a thread with zero replies is just a thread (annotation model).
    const replyInThread = (parent: spaces.Message) => onOpenThread(parent.id)

    const askRowboat = (message: spaces.Message) => {
        const name = memberNames.get(message.author.memberId) ?? message.author.memberId
        // Quote with names, not wire ids — the composer re-encodes on send.
        const quote = resolveMentions(message.body, memberNames).split('\n').map((l) => `> ${l}`).join('\n')
        setSeed({ text: `@rowboat \n\n${quote}\n— ${name}`, nonce: Date.now() })
    }

    // Toggle: add when the viewer isn't in the group yet, remove when they are.
    // Optimistic — the chip moves the instant it's clicked; the org's answer
    // replaces it right behind, and a failure puts the old state back.
    const toggleReaction = async (message: spaces.Message, emoji: string) => {
        const mine = (message.reactions ?? []).find((g) => g.emoji === emoji)?.memberIds.includes(org.memberId)
        const action = mine ? 'remove' : 'add'
        updateStreamMessage(org.id, space.id, {
            ...message,
            reactions: applyReaction(message.reactions, { emoji, memberId: org.memberId, action: action === 'add' ? 'added' : 'removed' }),
        })
        try {
            const { message: updated } = await window.ipc.invoke('spaces:reactToMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, emoji, action,
            })
            updateStreamMessage(org.id, space.id, updated)
            analytics.spacesReactionToggled({ action })
        } catch (err) {
            updateStreamMessage(org.id, space.id, message)
            toast(err instanceof Error ? err.message : 'Could not react', 'error')
        }
    }

    const copyLink = async (message: spaces.Message) => {
        try {
            await navigator.clipboard.writeText(`https://${org.address}/s/${space.id}/m/${message.id}`)
            toast('Link copied', 'success')
        } catch {
            toast('Could not copy the link', 'error')
        }
    }

    // Optimistic rewrite, same shape as reactions: the new body renders on
    // save; the org's answer (or a failure revert) reconciles right behind.
    const editMessage = async (message: spaces.Message, body: string) => {
        updateStreamMessage(org.id, space.id, { ...message, body, editedAt: new Date().toISOString() })
        try {
            const { message: updated } = await window.ipc.invoke('spaces:editMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, body,
            })
            updateStreamMessage(org.id, space.id, updated)
        } catch (err) {
            updateStreamMessage(org.id, space.id, message)
            toast(err instanceof Error ? err.message : 'Could not edit', 'error')
        }
    }

    const deleteMessage = async (message: spaces.Message) => {
        if (!window.confirm('Delete this message? This cannot be undone.')) return
        try {
            const { message: deleted } = await window.ipc.invoke('spaces:deleteMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id,
            })
            updateStreamMessage(org.id, space.id, deleted)
            analytics.spacesMessageDeleted()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete', 'error')
        }
    }

    // Long histories: render only the tail — every message is markdown through
    // Streamdown, so an uncapped list makes the first paint crawl. "Show
    // earlier" just lifts the cap; the messages are already in memory.
    const streamMessages = stream.messages
    const [renderCap, setRenderCap] = useState(FIRST_PAINT_CAP)
    useEffect(() => setRenderCap(FIRST_PAINT_CAP), [memoryKey])
    // The short tail is on screen — widen to the full window right after, as
    // a TRANSITION: React time-slices the ~70 extra markdown rows instead of
    // blocking input for one long commit. The rows prepend above the
    // viewport; the tail pin below keeps the bottom in view, so the reader
    // never sees the reflow.
    useEffect(() => {
        if (!stream.ready) return
        const raf = requestAnimationFrame(() => {
            startTransition(() => setRenderCap((c) => Math.max(c, RENDER_CAP)))
        })
        return () => cancelAnimationFrame(raf)
    }, [stream.ready, memoryKey])
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
        } else if (stream.hasMore && !stream.loadingOlder) {
            const oldest = stream.messages.find((m) => !m.pending && !m.failed)?.offset
            if (oldest === undefined) return
            pendingRestoreRef.current = { height: el.scrollHeight, top: el.scrollTop, oldest }
            // The fetched page must also render: lift the cap along with it.
            setRenderCap((c) => c + 200)
            void loadOlderStreamMessages(org.id, space.id)
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
        const oldestNow = stream.messages.find((m) => !m.pending && !m.failed)?.offset
        if (oldestNow !== undefined && oldestNow < pending.oldest) {
            el.scrollTop = el.scrollHeight - pending.height + pending.top
            lastScrollTopRef.current = el.scrollTop
            pendingRestoreRef.current = null
        } else if (!stream.loadingOlder) {
            // Settled without a prepend (failed, or raced empty).
            pendingRestoreRef.current = null
        }
    }, [stream.messages, stream.loadingOlder])

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
    if (hiddenCount > 0 || stream.hasMore) {
        rows.push(
            <div key="earlier" className="flex justify-center py-2">
                <button
                    type="button"
                    onClick={loadEarlier}
                    disabled={stream.loadingOlder}
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
                >
                    {stream.loadingOlder
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
            rows.push(<NewDivider key="new" fading={newFading} />)
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
                onEdit={(m, body) => void editMessage(m, body)}
                onRetryFailed={retryFailed}
                onDiscardFailed={discardFailed}
            />,
        )
        prev = message
    })

    const typingNames = (presence.typing.get('') ?? []).map((id) => memberNames.get(id) ?? id)

    return (
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="flex items-center gap-2.5 px-5 h-9 shrink-0">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Messages</span>
                <span className="text-xs text-muted-foreground truncate">What the team says, in order. Reply to one to start a thread.</span>
                <span className="flex-1" />
                {stream.error && <span className="text-xs text-destructive truncate" title={stream.error}>messages unavailable</span>}
            </div>
            <div className="relative flex-1 min-h-0 flex flex-col">
            <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto px-3 pb-1"
                onWheel={() => {
                    userScrollAtRef.current = performance.now()
                }}
                onTouchMove={() => {
                    userScrollAtRef.current = performance.now()
                }}
                onPointerDown={() => {
                    pointerDownRef.current = true
                }}
                onScroll={(e) => {
                    const el = e.currentTarget
                    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                    const userScroll = pointerDownRef.current || performance.now() - userScrollAtRef.current < 250
                    setAwayFromBottom(fromBottom > 200)
                    if (fromBottom < 8) {
                        // At the bottom = "follow the tail" — and everything
                        // settled so far counts as seen.
                        for (let i = stream.messages.length - 1; i >= 0; i--) {
                            const m = stream.messages[i]!
                            if (m.pending || m.failed) continue
                            lastSeenOffsetRef.current = Math.max(lastSeenOffsetRef.current, m.offset)
                            break
                        }
                        lastScrollTopRef.current = null
                    } else if (userScroll || lastScrollTopRef.current !== null) {
                        lastScrollTopRef.current = el.scrollTop
                    } else if (!pendingRestoreRef.current) {
                        // A scroll the reader didn't make, while following the
                        // tail — anchoring's compensation for a late layout.
                        // Re-pin the bottom; never let it unfollow.
                        el.scrollTop = el.scrollHeight
                    }
                    // No auto-backfill off the first short-tail frame: on a tall
                    // viewport its initial bottom pin can land under the 80px
                    // line and this would fire before the cap lifts to the full
                    // window — wait for that lift instead.
                    if (el.scrollTop < 80 && renderCap >= RENDER_CAP) loadEarlier()
                }}
            >
                {/* One measurable child — the tail pin observes its size. */}
                <div ref={contentRef}>
                {!stream.ready && (
                    <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading messages…</div>
                )}
                {stream.ready && rows.length === 0 && (
                    <div className="px-2 py-6 text-sm text-muted-foreground">Nothing here yet — say hello, or @rowboat to ask your agent.</div>
                )}
                {rows}
                <TypingIndicator names={typingNames} />
                <div ref={bottomRef} />
                </div>
            </div>
            {awayFromBottom && (() => {
                const unseen = streamMessages.filter(
                    (m) => m.offset > lastSeenOffsetRef.current && !m.pending && !m.failed && m.author.memberId !== org.memberId,
                ).length
                return (
                    <button
                        type="button"
                        onClick={jumpToLatest}
                        className="absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1 text-xs font-medium shadow-md hover:bg-accent"
                    >
                        {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : 'Latest'}
                        <ArrowDown className="size-3" />
                    </button>
                )
            })()}
            </div>
            <Composer
                placeholder={`Message ${space.name} — @rowboat to ask your agent`}
                busy={false}
                draftKey={memoryKey}
                onSend={post}
                onType={onType}
                seed={seed}
                members={members}
                entries={entries}
                selfMemberId={org.memberId}
                commands={[
                    {
                        name: 'invite',
                        hint: 'Copy an invite link to this space',
                        run: async () => {
                            try {
                                const result = await window.ipc.invoke('spaces:createInvite', { orgId: org.id, spaceId: space.id })
                                await navigator.clipboard.writeText(result.link)
                                toast('Invite link copied to clipboard', 'success')
                            } catch (err) {
                                toast(err instanceof Error ? err.message : 'Could not create an invite', 'error')
                            }
                        },
                    },
                    {
                        name: 'read',
                        hint: 'Mark everything in this space read',
                        run: () => {
                            markRead(org.id, space.id)
                            markTopicRead(org.id, space.id, STREAM_READ_KEY)
                            for (const m of stream.messages) {
                                if (!m.pending && !m.failed && (m.replyCount ?? 0) > 0) markTopicRead(org.id, space.id, m.id)
                            }
                            for (const root of stream.topicsByRoot.keys()) markTopicRead(org.id, space.id, root)
                            toast('Marked read', 'success')
                        },
                    },
                ]}
            />
        </section>
    )
}
