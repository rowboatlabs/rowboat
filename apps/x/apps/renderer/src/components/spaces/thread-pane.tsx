import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Anchor, Archive, ArchiveRestore, ArrowLeft, ArrowUp, Bot, Loader2, MessageSquareOff, MoreHorizontal, Pencil, ShieldAlert, Tag, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArtifactsSummary } from '@/components/spaces/artifacts'
import { MemberAvatar, MemberProfilePopover } from '@/components/spaces/atoms'
import { Composer, type AgentOptions } from '@/components/spaces/composer'
import { ForwardDialog } from '@/components/spaces/forward-dialog'
import { MemberName, MemberText } from '@/components/spaces/member-text'
import { SpaceMarkdown } from '@/components/spaces/space-markdown'
import { MessageRow, NewDivider, TypingIndicator } from '@/components/spaces/message-row'
import type { ChatMessage, SpacePresence } from '@/hooks/use-space-chat'
import { buildPendingMessage, ingestTopic, removeTopicByRoot, updateStreamMessage, usePresenceSender } from '@/hooks/use-space-chat'
import { useTopicAgentPermissionWait } from '@/hooks/use-topic-agent-permission'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { subscribeComposeInsert } from '@/lib/spaces-compose'
import { applyReaction, artifactsForThread, isContinuation, mergeMessages, threadLabelOf } from '@/lib/spaces-conventions'
import { consumeJump, scrollToMessage, subscribeJump } from '@/lib/spaces-jump'
import { PollDialogHost } from '@/components/spaces/poll-dialog'
import { applyPollVote, myPollVotes, postPoll } from '@/lib/spaces-poll'
import { attributionLabel, formatFeedTime, resolveMentions, shortId } from '@/lib/spaces-presentation'
import { formatScheduleTime, parseRemindArgs } from '@/lib/spaces-schedule'
import { getTopicLastReadAt, markTopicRead } from '@/lib/spaces-read-state'
import { toggleSaved, useSaved } from '@/lib/spaces-saved'
import { maybeInvokeRowboat } from '@/lib/spaces-rowboat'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// One flat thread (annotation model): the root on top, the artifacts it
// produced, the replies, a reply composer. A Discussion is the same pane with
// a topic annotation on it — a stated goal in the header and lifecycle
// actions in the menu. Replying never creates anything; giving the thread a
// goal is the one deliberate ceremony.

/** How long the New line lingers once the reader has caught up with it. */
const NEW_LINGER_MS = 5_000
/** Clear delay after the fade starts — must outlast the divider's duration-700. */
const NEW_FADE_MS = 800

export function ThreadPane({
    org, space, rootMessageId, rootFromStream, topicFromStream, changeSets, entries, presence, members, memberNames, refreshTick,
    showBack, onBack, onOpenFile, onOpenSession, artifactsRailOpen, onToggleArtifactsRail, onFolding, visible = true,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    /** The thread's identity — permanent, whether or not a topic annotates it. */
    rootMessageId: string
    /** The root as the stream already holds it — paints the parent card before the fetch lands. */
    rootFromStream: spaces.Message | undefined
    topicFromStream: spaces.Topic | undefined
    changeSets: spaces.ChangeSet[]
    entries: spaces.SpacesAssetEntry[]
    presence: SpacePresence
    members: spaces.Member[]
    memberNames: Map<string, string>
    refreshTick: number
    showBack: boolean
    onBack: () => void
    onOpenFile: (path: string) => void
    onOpenSession?: (sessionId: string) => void
    /** Whether the artifacts rail is showing; the summary line under the opener toggles it. */
    artifactsRailOpen: boolean
    onToggleArtifactsRail: () => void
    /** Lets a parent (the rail) share the fold-busy state. */
    onFolding?: (busy: boolean) => void
    /** False while kept mounted but off screen (read mode, hidden Spaces view) — no presence, no read marks. */
    visible?: boolean
}) {
    const [root, setRoot] = useState<spaces.Message | null>(rootFromStream ?? null)
    const [topic, setTopic] = useState<spaces.Topic | null>(topicFromStream ?? null)
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [loaded, setLoaded] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [loadingOlder, setLoadingOlder] = useState(false)
    // The deepest (oldest) offset any fetch has reached — a refetch of the
    // newest page must not reset hasMore after the reader paged further back.
    const oldestLoadedRef = useRef<number | null>(null)
    const [folding, setFolding] = useState(false)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    /** Composer prefill (quote-reply, mention-from-profile); a new nonce re-applies it. */
    const [seed, setSeed] = useState<{ text: string; nonce: number; append?: boolean } | null>(null)
    const { onType } = usePresenceSender(org.id, space.id, rootMessageId, visible)

    // The profile popover's "Mention" lands in whichever composer is visible.
    useEffect(() => {
        if (!visible) return
        return subscribeComposeInsert((insert) => setSeed({ text: insert.text, nonce: Date.now(), append: true }))
    }, [visible])
    // A ref, not an effect dep: visibility flips must not refetch the thread.
    const visibleRef = useRef(visible)
    visibleRef.current = visible

    // Esc goes back to Messages. Not from a field (typing must keep its Esc
    // semantics — and a drafted reply must not vanish), and not when an
    // overlay already claimed the key (Radix prevents default on those).
    useEffect(() => {
        if (!visible) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return
            const t = e.target as HTMLElement | null
            if (t?.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
            onBack()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [visible, onBack])

    const [newSince, setNewSince] = useState<string | null>(() => getTopicLastReadAt(org.id, space.id, rootMessageId))
    const [newFading, setNewFading] = useState(false)
    // Each return to the thread re-arms the line at the catch-up point: the
    // read mark as it stood while hidden. Declared BEFORE the visible
    // mark-read effect below — same flip, and the snapshot must win the race.
    const newArmedVisibleRef = useRef(visible)
    useEffect(() => {
        const was = newArmedVisibleRef.current
        newArmedVisibleRef.current = visible
        if (!visible || was) return
        setNewFading(false)
        setNewSince(getTopicLastReadAt(org.id, space.id, rootMessageId))
    }, [visible, org.id, space.id, rootMessageId])

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:listThread', { orgId: org.id, spaceId: space.id, rootMessageId })
            .then((res) => {
                if (cancelled) return
                setRoot(res.root)
                setTopic(res.topic)
                // A refetch merges (older loaded pages stay put) and must not
                // eat optimistic sends: pending/failed rows the response
                // doesn't already contain are carried over.
                setMessages((prev) => [
                    ...mergeMessages(prev.filter((m) => !m.pending && !m.failed && m.threadRoot === res.root.id), res.messages),
                    ...prev.filter(
                        (m) => (m.pending || m.failed) && !res.messages.some((r) => r.author.memberId === m.author.memberId && r.body === m.body),
                    ),
                ])
                const windowOldest = res.messages[0]?.offset ?? null
                if (oldestLoadedRef.current === null || windowOldest === null || windowOldest <= oldestLoadedRef.current) {
                    oldestLoadedRef.current = windowOldest ?? oldestLoadedRef.current
                    setHasMore(res.hasMore)
                }
                setLoaded(true)
                // Keep the stream's copy of the chip data current too.
                updateStreamMessage(org.id, space.id, res.root)
                if (res.topic) ingestTopic(org.id, space.id, res.topic)
                if (visibleRef.current) markTopicRead(org.id, space.id, rootMessageId)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, rootMessageId, refreshTick])
    // Refetches that landed while hidden left the thread unread on purpose —
    // becoming visible again is the moment the reader actually sees them.
    useEffect(() => {
        if (visible && loaded) markTopicRead(org.id, space.id, rootMessageId)
    }, [visible, loaded, org.id, space.id, rootMessageId])

    const loadOlderReplies = async () => {
        const oldest = messages.find((m) => !m.pending && !m.failed)
        if (!oldest || loadingOlder) return
        setLoadingOlder(true)
        try {
            const res = await window.ipc.invoke('spaces:listThread', {
                orgId: org.id, spaceId: space.id, rootMessageId, beforeOffset: oldest.offset,
            })
            setMessages((prev) => mergeMessages(prev, res.messages))
            oldestLoadedRef.current = res.messages[0]?.offset ?? oldestLoadedRef.current
            setHasMore(res.hasMore)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not load earlier replies', 'error')
        } finally {
            setLoadingOlder(false)
        }
    }

    const workingAgents = presence.working.get(rootMessageId) ?? []
    // Your own agent, blocked mid-turn on a tool permission: surface it here
    // instead of letting it idle behind a "working…" spinner (or silence).
    const permissionWait = useTopicAgentPermissionWait(org.id, space.id, rootMessageId, visible)
    // While blocked, the amber pill replaces the own-agent spinner.
    const spinningAgents = permissionWait.length > 0 ? workingAgents.filter((id) => id !== org.memberId) : workingAgents

    // Jump-to-message (search, pinned, saved): a pending jump wins over the
    // bottom pin for the commit it lands in — the pin effect checks the ref,
    // which clears a tick later (after that commit's effects ran).
    const pendingJumpRef = useRef<string | null>(null)
    const [jumpNonce, setJumpNonce] = useState(0)
    useEffect(() => {
        if (!visible) return
        const attempt = () => {
            const mid = consumeJump(rootMessageId)
            if (!mid) return
            pendingJumpRef.current = mid
            setJumpNonce((n) => n + 1)
        }
        attempt()
        return subscribeJump(attempt)
    }, [visible, rootMessageId])
    useLayoutEffect(() => {
        const mid = pendingJumpRef.current
        if (!mid) return
        const el = scrollRef.current
        if (!el) return
        if (scrollToMessage(el, mid) || loaded) {
            // Landed — or the window is loaded and the row just isn't in it.
            setTimeout(() => {
                pendingJumpRef.current = null
            }, 0)
        }
    }, [jumpNonce, loaded, messages.length])

    useEffect(() => {
        if (pendingJumpRef.current) return
        bottomRef.current?.scrollIntoView({ block: 'end' })
    }, [messages.length, workingAgents.length, permissionWait.length])

    const groups = useMemo(() => artifactsForThread(changeSets, rootMessageId), [changeSets, rootMessageId])

    const replies = messages

    // Once the reader has caught up (this pane pins to the bottom, so visible
    // = with the new messages) the line lingers a beat, fades, drops.
    const hasNewLine = !!newSince && replies.some((m) => !m.deletedAt && m.postedAt > newSince && m.author.memberId !== org.memberId)
    // Jump-to-unread: the pane opens at the bottom; when the New line sits
    // above the fold a pill scrolls to it. Dismissed by use; re-arms with the
    // divider (adjust-on-change).
    const newCount = newSince
        ? replies.filter((m) => !m.deletedAt && m.postedAt > newSince && m.author.memberId !== org.memberId).length
        : 0
    const [newJumped, setNewJumped] = useState(false)
    const [lastNewSince, setLastNewSince] = useState(newSince)
    if (newSince !== lastNewSince) {
        setLastNewSince(newSince)
        setNewJumped(false)
    }
    const jumpToNew = () => {
        setNewJumped(true)
        scrollRef.current?.querySelector<HTMLElement>('[data-new-divider]')?.scrollIntoView({ block: 'center' })
    }
    useEffect(() => {
        if (!visible || !loaded || !hasNewLine || newFading) return
        const t = window.setTimeout(() => setNewFading(true), NEW_LINGER_MS)
        return () => window.clearTimeout(t)
    }, [visible, loaded, hasNewLine, newFading])
    useEffect(() => {
        if (!newFading) return
        const t = window.setTimeout(() => {
            setNewSince(null)
            setNewFading(false)
        }, NEW_FADE_MS)
        return () => window.clearTimeout(t)
    }, [newFading])

    // Echo a just-posted reply into the pane — the live event that would
    // otherwise render it may be seconds away, or never come at all when the
    // socket went half-open (sleep). Dedupe keeps the eventual frame a no-op.
    const echo = (message: spaces.Message) => {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
    }

    /** What @rowboat and sessions call this conversation. */
    const threadLabel = topic?.title ?? threadLabelOf(root?.body ?? '')

    // Optimistic send, same shape as the stream's: render now (dimmed as
    // pending), confirm — or fail into a retry/discard row — in the
    // background. The composer never waits on the round trip.
    const post = async (body: string, agent?: AgentOptions) => {
        const pending = buildPendingMessage(space.id, org.memberId, body, rootMessageId)
        setMessages((prev) => [...prev, pending])
        markTopicRead(org.id, space.id, rootMessageId)
        void window.ipc
            .invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, threadRoot: rootMessageId, body })
            .then((result) => {
                setMessages((prev) => {
                    const rest = prev.filter((m) => m.id !== pending.id)
                    return rest.some((m) => m.id === result.message.id) ? rest : [...rest, result.message].sort((a, b) => a.offset - b.offset)
                })
                markTopicRead(org.id, space.id, rootMessageId)
                analytics.spacesMessagePosted({ kind: 'topic', mentionsRowboat: containsRowboatAddress(body) })
                maybeInvokeRowboat(org, space, { rootMessageId, label: threadLabel }, result.message.id, body, agent)
            })
            .catch(() => {
                setMessages((prev) => prev.map((m) => (m.id === pending.id ? { ...m, pending: false, failed: true } : m)))
            })
    }

    const retryFailed = (message: spaces.Message) => {
        setMessages((prev) => prev.filter((m) => m.id !== message.id))
        void post(message.body)
    }
    const discardFailed = (message: spaces.Message) => setMessages((prev) => prev.filter((m) => m.id !== message.id))

    // Fold = a visible ask to your own agent, posted in the thread, then invoked.
    const fold = async (path: string) => {
        setFolding(true)
        onFolding?.(true)
        try {
            const body = `@rowboat fold this thread’s decision into \`${path}\` — keep the file’s structure and put it under the right section. End your change reason with “· thread:${rootMessageId}”.`
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, threadRoot: rootMessageId, body })
            echo(result.message)
            markTopicRead(org.id, space.id, rootMessageId)
            analytics.spacesFoldRequested()
            maybeInvokeRowboat(org, space, { rootMessageId, label: threadLabel }, result.message.id, body)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not ask Rowboat', 'error')
        } finally {
            setFolding(false)
            onFolding?.(false)
        }
    }

    // Toggle: add when the viewer isn't in the group yet, remove when they are.
    // Optimistic like the stream's — the chip moves on click, the org reconciles.
    const toggleReaction = async (message: spaces.Message, emoji: string) => {
        const mine = (message.reactions ?? []).find((g) => g.emoji === emoji)?.memberIds.includes(org.memberId)
        const action = mine ? 'remove' : 'add'
        const fold_ = (m: spaces.Message) => ({ ...m, reactions: applyReaction(m.reactions, { emoji, memberId: org.memberId, action: action === 'add' ? 'added' : 'removed' }) })
        if (message.id === root?.id) setRoot(fold_(root))
        else setMessages((prev) => prev.map((m) => (m.id === message.id ? fold_(m) : m)))
        try {
            const { message: updated } = await window.ipc.invoke('spaces:reactToMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, emoji, action,
            })
            if (updated.id === root?.id) setRoot(updated)
            else setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            analytics.spacesReactionToggled({ action })
        } catch (err) {
            if (message.id === root?.id) setRoot(message)
            else setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)))
            toast(err instanceof Error ? err.message : 'Could not react', 'error')
        }
    }

    // Quote-reply, mirroring the stream's: the quoted copy seeds the reply
    // composer — plain markdown on the wire; image embeds drop, names not ids.
    const quoteReply = (message: spaces.Message) => {
        const name = memberNames.get(message.author.memberId) ?? message.author.memberId
        const text = resolveMentions(message.body, memberNames).replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()
        if (!text) return
        const quote = text.split('\n').map((l) => `> ${l}`).join('\n')
        setSeed({ text: `${quote}\n> — ${name}\n\n`, nonce: Date.now() })
    }

    // Saved-for-later: personal, local; the row menu needs the membership.
    const savedList = useSaved(org.id, space.id)
    const savedIds = useMemo(() => new Set(savedList.map((s) => s.messageId)), [savedList])
    const toggleSave = (message: spaces.Message) => {
        const nowSaved = toggleSaved(org.id, space.id, message)
        toast(nowSaved ? 'Saved for later' : 'Removed from saved', 'success')
    }

    /** The message being forwarded — non-null renders the destination dialog. */
    const [forwarding, setForwarding] = useState<spaces.Message | null>(null)

    /** Opens the poll dialog (state lives in PollDialogHost — see its doc). */
    const openPollRef = useRef<(() => void) | null>(null)
    const createPoll = async (input: spaces.SpacesNewPollInput) => {
        try {
            const { message: posted } = await postPoll({ orgId: org.id, spaceId: space.id, rootMessageId, input })
            echo(posted)
            markTopicRead(org.id, space.id, rootMessageId)
            analytics.spacesMessagePosted({ kind: 'topic', mentionsRowboat: false })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post the poll', 'error')
            throw err
        }
    }

    /** Replace one message in place (the folded result of a poll call). */
    const reconcile = (updated: spaces.Message) =>
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))

    // Poll votes, mirroring general's: optimistic fold, confirm, revert on failure.
    const votePoll = async (message: spaces.Message, answerIds: number[]) => {
        if (!message.poll || answerIds.length === 0) return
        let optimistic = message.poll
        for (const answerId of answerIds) {
            optimistic = applyPollVote(optimistic, { answerId, memberId: org.memberId, action: 'added' })
        }
        reconcile({ ...message, poll: optimistic })
        try {
            let updated: spaces.Message | undefined
            for (const answerId of answerIds) {
                const res = await window.ipc.invoke('spaces:votePoll', {
                    orgId: org.id, spaceId: space.id, messageId: message.id, answerId, action: 'add',
                })
                updated = res.message
            }
            if (updated) reconcile(updated)
        } catch (err) {
            reconcile(message)
            toast(err instanceof Error ? err.message : 'Could not vote', 'error')
        }
    }

    const removePollVote = async (message: spaces.Message) => {
        if (!message.poll) return
        const mine = myPollVotes(message.poll, org.memberId)
        if (mine.length === 0) return
        let optimistic = message.poll
        for (const answerId of mine) {
            optimistic = applyPollVote(optimistic, { answerId, memberId: org.memberId, action: 'removed' })
        }
        reconcile({ ...message, poll: optimistic })
        try {
            let updated: spaces.Message | undefined
            for (const answerId of mine) {
                const res = await window.ipc.invoke('spaces:votePoll', {
                    orgId: org.id, spaceId: space.id, messageId: message.id, answerId, action: 'remove',
                })
                updated = res.message
            }
            if (updated) reconcile(updated)
        } catch (err) {
            reconcile(message)
            toast(err instanceof Error ? err.message : 'Could not remove the vote', 'error')
        }
    }

    const endPoll = async (message: spaces.Message) => {
        if (!window.confirm('End this poll now? Voting stops immediately.')) return
        try {
            const { message: updated } = await window.ipc.invoke('spaces:endPoll', {
                orgId: org.id, spaceId: space.id, messageId: message.id,
            })
            reconcile(updated)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not end the poll', 'error')
        }
    }

    // Optimistic rewrite, mirroring the stream's.
    const editMessage = async (message: spaces.Message, body: string) => {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, body, editedAt: new Date().toISOString() } : m)))
        try {
            const { message: updated } = await window.ipc.invoke('spaces:editMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, body,
            })
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
        } catch (err) {
            setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)))
            toast(err instanceof Error ? err.message : 'Could not edit', 'error')
        }
    }

    const deleteMessage = async (message: spaces.Message) => {
        if (!window.confirm('Delete this message? This cannot be undone.')) return
        try {
            const { message: deleted } = await window.ipc.invoke('spaces:deleteMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id,
            })
            setMessages((prev) => prev.map((m) => (m.id === deleted.id ? deleted : m)))
            analytics.spacesMessageDeleted()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete', 'error')
        }
    }

    // Topic lifecycle — every action is a one-row op on the annotation; the
    // messages are untouchable by construction.
    const manage = async (action: spaces.SpacesManageTopicAction) => {
        if (!topic) return
        try {
            const res = await window.ipc.invoke('spaces:manageTopic', { orgId: org.id, spaceId: space.id, topicId: topic.id, action })
            if (action.action === 'remove') {
                setTopic(null)
                removeTopicByRoot(org.id, space.id, rootMessageId)
            } else {
                setTopic(res.topic)
                ingestTopic(org.id, space.id, res.topic)
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the discussion', 'error')
        }
    }

    /** The deliberate ceremony: a stated goal annotates this thread. */
    const createTopic = async (title: string) => {
        const trimmed = title.trim()
        if (!trimmed) return
        try {
            const res = await window.ipc.invoke('spaces:createTopic', { orgId: org.id, spaceId: space.id, rootMessageId, title: trimmed })
            setTopic(res.topic)
            ingestTopic(org.id, space.id, res.topic)
            analytics.spacesTopicStarted()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the discussion', 'error')
        }
    }

    // Inline title editing (window.prompt is a no-op in Electron). null = not
    // editing; the same field serves rename AND first-time goal setting.
    const [editingTitle, setEditingTitle] = useState<string | null>(null)
    const commitTitle = async () => {
        const title = editingTitle?.trim()
        setEditingTitle(null)
        if (!title || title === topic?.title) return
        if (topic) await manage({ action: 'retitle', title })
        else await createTopic(title)
    }

    const openTopicSession = async () => {
        try {
            const { sessionId } = await window.ipc.invoke('spaces:topicSession', { orgId: org.id, spaceId: space.id, threadRootId: rootMessageId })
            if (sessionId && onOpenSession) onOpenSession(sessionId)
            else if (!sessionId) toast('No agent session for this thread yet', 'info')
        } catch {
            toast('Could not open the agent session', 'error')
        }
    }

    // Replies with compaction and the New line. Deleted replies disappear
    // (nothing anchors to a reply, so no tombstone row is needed here).
    const visibleReplies = replies.filter((m) => !m.deletedAt)
    const rows: ReactNode[] = []
    let prev: spaces.Message | undefined
    let newShown = false
    for (const message of visibleReplies) {
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
                selfMemberId={org.memberId}
                onReact={(m, emoji) => void toggleReaction(m, emoji)}
                onDelete={(m) => void deleteMessage(m)}
                onEdit={(m, body) => void editMessage(m, body)}
                onQuoteReply={quoteReply}
                onForward={setForwarding}
                onToggleSave={toggleSave}
                saved={savedIds.has(message.id)}
                onRetryFailed={retryFailed}
                onDiscardFailed={discardFailed}
                onVotePoll={(m, answerIds) => void votePoll(m, answerIds)}
                onRemovePollVote={(m) => void removePollVote(m)}
                onEndPoll={(m) => void endPoll(m)}
                dense
            />,
        )
        prev = message
    }

    const typingNames = (presence.typing.get(rootMessageId) ?? []).map((id) => memberNames.get(id) ?? id)
    const parentName = root ? memberNames.get(root.author.memberId) ?? root.author.memberId : ''
    // Reply-to-activity-row provenance: the change-set this root answers.
    const anchorChange = root?.anchorChangeSetId ? changeSets.find((c) => c.id === root.anchorChangeSetId) ?? null : null
    const replyCountLabel = Math.max(visibleReplies.length, root?.replyCount ?? 0)

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border pl-2 pr-2">
                {showBack && (
                    <>
                        <Button variant="ghost" size="xs" className="gap-1 bg-primary/10 px-2 font-semibold text-primary hover:bg-primary/15 hover:text-primary" onClick={onBack} title="Back to Messages (Esc)" aria-label="Back to messages">
                            <ArrowLeft className="size-3.5" /> Messages
                        </Button>
                        <span className="h-4 w-px shrink-0 bg-border" />
                    </>
                )}
                <span className="pl-1 text-[13px] text-muted-foreground">{topic ? 'Discussion' : 'Thread'}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {editingTitle !== null ? (
                        <input
                            autoFocus
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void commitTitle()
                                if (e.key === 'Escape') setEditingTitle(null)
                            }}
                            onBlur={() => setEditingTitle(null)}
                            placeholder={topic ? 'Discussion goal' : 'What needs to get resolved?'}
                            className="w-64 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-xs text-foreground outline-none"
                        />
                    ) : (
                        <>
                            {topic ? <MemberText text={topic.title} /> : 'from a message'}
                            {groups.length > 0 ? ` · ${groups.length} ${groups.length === 1 ? 'file' : 'files'} changed` : ''}
                        </>
                    )}
                </span>
                <span className="flex-1" />
                {topic?.archived && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">archived</span>}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {topic ? (
                            <>
                                <DropdownMenuItem onClick={() => setEditingTitle(topic.title)}>
                                    <Pencil className="size-3.5 mr-2" /> Rename
                                </DropdownMenuItem>
                                {topic.archived ? (
                                    <DropdownMenuItem onClick={() => void manage({ action: 'unarchive' })}><ArchiveRestore className="size-3.5 mr-2" /> Unarchive</DropdownMenuItem>
                                ) : (
                                    <DropdownMenuItem onClick={() => void manage({ action: 'archive' })}><Archive className="size-3.5 mr-2" /> Archive</DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => void manage({ action: 'remove' })}>
                                    <MessageSquareOff className="size-3.5 mr-2" /> Convert back to thread
                                </DropdownMenuItem>
                            </>
                        ) : (
                            <DropdownMenuItem onClick={() => setEditingTitle('')}>
                                <Tag className="size-3.5 mr-2" /> Make this a discussion…
                            </DropdownMenuItem>
                        )}
                        {!showBack && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={onBack}><X className="size-3.5 mr-2" /> Close</DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
                {!showBack && (
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={onBack} aria-label="Close thread">
                        <X className="size-4" />
                    </Button>
                )}
            </div>

            <div className="relative flex-1 min-h-0 flex flex-col">
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
                {!loaded && !root && <div className="px-2 py-2 text-sm text-muted-foreground">Loading…</div>}

                {/* Reply-to-activity-row provenance: the change this root answers. */}
                {anchorChange && (
                    <button
                        type="button"
                        onClick={() => onOpenFile(anchorChange.assetPath)}
                        className="mb-2 flex w-full items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left hover:border-foreground/20"
                    >
                        <Anchor className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1 text-xs">
                            <div className="text-[12.5px]">
                                <span className="font-semibold">{attributionLabel(anchorChange.attribution, memberNames)}</span>
                                <span className="text-muted-foreground"> · 1 change · </span><code className="text-[11.5px]">{anchorChange.assetPath}</code>
                                <span className="text-muted-foreground"> · {formatFeedTime(anchorChange.committedAt)} · v{anchorChange.resultVersion}</span>
                            </div>
                            {anchorChange.reason && <div className="mt-0.5 text-muted-foreground">“{anchorChange.reason}”</div>}
                            <div className="mt-1 text-[11px] text-muted-foreground">anchored to {shortId(anchorChange.id)} · open file</div>
                        </div>
                    </button>
                )}
                {root && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <MemberProfilePopover id={root.author.memberId}>
                            <button type="button" aria-label={`${parentName}’s profile`} className="mt-0.5 shrink-0 cursor-pointer rounded-full">
                                <MemberAvatar id={root.author.memberId} name={parentName} size="md" />
                            </button>
                        </MemberProfilePopover>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5 text-xs">
                                <MemberProfilePopover id={root.author.memberId}>
                                    <button type="button" className="cursor-pointer font-semibold hover:underline">{parentName}</button>
                                </MemberProfilePopover>
                                {root.author.actingMode !== 'direct' && (
                                    <span className="text-muted-foreground">via {root.author.agentName ?? 'agent'}</span>
                                )}
                                <span className="text-muted-foreground">{formatFeedTime(root.postedAt)} · in Messages</span>
                            </div>
                            <div className="text-sm leading-relaxed [&_p]:my-0.5">
                                {root.deletedAt ? (
                                    <span className="italic text-muted-foreground">This message was deleted</span>
                                ) : (
                                    <SpaceMarkdown body={root.body} />
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <ArtifactsSummary
                    groups={groups}
                    working={workingAgents.length > 0}
                    railOpen={artifactsRailOpen}
                    onToggleRail={onToggleArtifactsRail}
                    entries={entries}
                    onFold={(path) => void fold(path)}
                    folding={folding}
                />

                <div className="flex items-center gap-2 px-1 pb-1 pt-3">
                    <span className="text-[11px] font-medium text-muted-foreground">
                        {replyCountLabel} {replyCountLabel === 1 ? 'reply' : 'replies'}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                    {hasMore && (
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                            disabled={loadingOlder}
                            onClick={() => void loadOlderReplies()}
                        >
                            {loadingOlder ? <Loader2 className="size-3 animate-spin" /> : null} show earlier replies
                        </button>
                    )}
                </div>
                {rows}

                {/* Your agent is stopped, not working — it wants an answer. */}
                {permissionWait.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pl-10 pt-1">
                        <button
                            type="button"
                            onClick={() => void openTopicSession()}
                            title="Open the agent session to review the request"
                            className="flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                        >
                            <ShieldAlert className="size-3" />
                            Your Rowboat needs permission — {permissionWait[0]}
                            {permissionWait.length > 1 ? ` +${permissionWait.length - 1} more` : ''} · Review
                        </button>
                    </div>
                )}
                {/* Typing-indicator position: below the last message, where eyes rest. */}
                {spinningAgents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pl-10 pt-1">
                        {spinningAgents.map((memberId) => {
                            const own = memberId === org.memberId
                            const label = own ? 'Your Rowboat is working…' : <><MemberName id={memberId} />’s Rowboat is working…</>
                            return own ? (
                                <button key={memberId} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Open the agent session for this thread" onClick={() => void openTopicSession()}>
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
            {hasNewLine && newCount > 0 && !newJumped && (
                <button
                    type="button"
                    onClick={jumpToNew}
                    className="absolute top-2 left-1/2 z-20 inline-flex -translate-x-1/2 animate-in fade-in slide-in-from-top-2 items-center gap-1.5 rounded-full border border-orange-500/40 bg-background/95 px-3 py-1 text-xs font-medium text-orange-600 shadow-md hover:bg-accent"
                >
                    <ArrowUp className="size-3" />
                    {newCount} new — jump to unread
                </button>
            )}
            </div>

            {forwarding && (
                <ForwardDialog org={org} space={space} message={forwarding} memberNames={memberNames} onClose={() => setForwarding(null)} />
            )}
            <PollDialogHost openRef={openPollRef} onSubmit={createPoll} />
            <Composer
                placeholder="Reply…"
                busy={false}
                onSend={post}
                onSchedule={async (body, at) => {
                    await window.ipc.invoke('spaces:schedule', {
                        orgId: org.id, spaceId: space.id, threadRootId: rootMessageId, body, at: at.toISOString(), kind: 'message',
                    })
                    toast(`Scheduled — sends ${formatScheduleTime(at)}`, 'success')
                }}
                onCreatePoll={() => openPollRef.current?.()}
                onType={onType}
                seed={seed}
                autoFocus
                members={members}
                entries={entries}
                selfMemberId={org.memberId}
                draftKey={`${org.id}/${space.id}/${rootMessageId}`}
                commands={[
                    {
                        name: 'fold',
                        args: '<file>',
                        hint: 'Ask your Rowboat to fold this thread into a file',
                        run: (args) => void fold(args),
                    },
                    topic
                        ? {
                              name: 'rename',
                              args: '<goal>',
                              hint: 'Rename this discussion',
                              run: (args) => void manage({ action: 'retitle', title: args }),
                          }
                        : {
                              name: 'discussion',
                              args: '<goal>',
                              hint: 'Make this thread a discussion with a stated goal',
                              run: (args) => void createTopic(args),
                          },
                    {
                        name: 'poll',
                        hint: 'Create a poll — pick answers, votes tally live',
                        run: () => openPollRef.current?.(),
                    },
                    ...(topic
                        ? [
                              topic.archived
                                  ? { name: 'unarchive', hint: 'Unarchive this discussion', run: () => void manage({ action: 'unarchive' }) }
                                  : { name: 'archive', hint: 'Archive this discussion — it leaves the rail until a new reply revives it', run: () => void manage({ action: 'archive' }) },
                          ]
                        : []),
                    {
                        name: 'remind',
                        args: '<when> <text>',
                        hint: 'Set a reminder — 20m, 2h, 9:30, tomorrow',
                        run: async (args) => {
                            const parsed = parseRemindArgs(args)
                            if (typeof parsed === 'string') {
                                toast(parsed, 'info')
                                return
                            }
                            try {
                                await window.ipc.invoke('spaces:schedule', {
                                    orgId: org.id, spaceId: space.id, threadRootId: rootMessageId, body: parsed.text, at: parsed.at.toISOString(), kind: 'reminder',
                                })
                                toast(`Reminder set for ${formatScheduleTime(parsed.at)}`, 'success')
                            } catch (err) {
                                toast(err instanceof Error ? err.message : 'Could not set the reminder', 'error')
                            }
                        },
                    },
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
                ]}
            />

        </div>
    )
}
