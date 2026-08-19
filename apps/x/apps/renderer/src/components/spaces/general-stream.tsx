import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Composer } from '@/components/spaces/composer'
import { DayDivider, MessageRow, NewDivider, TypingIndicator, type ThreadRowData } from '@/components/spaces/message-row'
import type { GeneralState, SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import { rememberThread, usePresenceSender } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { buildThreadSeed, dayKey, formatDayLabel, isContinuation, isGeneralSeedMessage } from '@/lib/spaces-conventions'
import { getTopicLastReadAt, markTopicRead } from '@/lib/spaces-read-state'
import { maybeInvokeRowboat } from '@/lib/spaces-rowboat'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// Messages — the space's open stream. What people say, in order; a message
// that gets replies becomes a topic (shown as a row under it here).

/** Scroll position per space, so coming back (a topic, a file, the top ‹ ›) lands where you were. */
const scrollMemory = new Map<string, number>()

export function GeneralStream({
    org, space, general, threads, topics, presence, memberNames, onOpenThread,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    general: GeneralState
    threads: ThreadIndex
    topics: spaces.Topic[]
    presence: SpacePresence
    memberNames: Map<string, string>
    onOpenThread: (topicId: string) => void
}) {
    const [posting, setPosting] = useState(false)
    const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const generalId = general.topic?.id ?? null
    const { onType } = usePresenceSender(org.id, space.id, generalId ?? undefined)

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
    }, [general.ready, general.messages.length, presence.typing, memoryKey])
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
        return {
            topicId,
            replyCount: Math.max(0, topic.messageCount - 1),
            lastActivityAt: topic.lastActivityAt,
            // Count isn't known without the thread's messages; 1 reads as "has new" on the row.
            unreadCount: hasNew && topic.messageCount > 1 ? 1 : 0,
            workingAgents: presence.working.get(topicId) ?? [],
        }
    }

    const post = async (body: string) => {
        if (!generalId) return
        setPosting(true)
        try {
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId: generalId, body })
            markTopicRead(org.id, space.id, generalId)
            analytics.spacesMessagePosted({ kind: 'general', mentionsRowboat: containsRowboatAddress(body) })
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post', 'error')
            throw err
        } finally {
            setPosting(false)
        }
    }

    const replyInThread = async (parent: spaces.Message) => {
        try {
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, body: buildThreadSeed(parent) })
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
        const quote = message.body.split('\n').map((l) => `> ${l}`).join('\n')
        setSeed({ text: `@rowboat \n\n${quote}\n— ${name}`, nonce: Date.now() })
    }

    const copyLink = async (message: spaces.Message) => {
        try {
            await navigator.clipboard.writeText(`https://${org.address}/s/${space.id}/t/${message.topicId}#${message.id}`)
            toast('Link copied', 'success')
        } catch {
            toast('Could not copy the link', 'error')
        }
    }

    // Render: day dividers, compaction, the New line, thread rows.
    const rows: ReactNode[] = []
    let prev: spaces.Message | undefined
    let prevDay = ''
    let newShown = false
    general.messages.forEach((message, index) => {
        if (general.topic && isGeneralSeedMessage(general.topic, message, index)) return
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
                thread={threadRowFor(message)}
                selfMemberId={org.memberId}
                onOpenThread={onOpenThread}
                onReplyInThread={(m) => void replyInThread(m)}
                onAskRowboat={askRowboat}
                onCopyLink={(m) => void copyLink(m)}
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
                <TypingIndicator names={typingNames} />
                <div ref={bottomRef} />
            </div>
            <Composer
                placeholder={`Message ${space.name} — @rowboat to ask your agent`}
                busy={posting || !generalId}
                onSend={post}
                onType={onType}
                seed={seed}
            />
        </section>
    )
}
