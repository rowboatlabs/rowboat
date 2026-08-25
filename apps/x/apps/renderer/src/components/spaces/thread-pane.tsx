import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Anchor, Archive, ArchiveRestore, ArrowLeft, Bot, Loader2, MoreHorizontal, Pencil, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArtifactsSummary } from '@/components/spaces/artifacts'
import { MemberAvatar } from '@/components/spaces/atoms'
import { Composer, type AgentOptions } from '@/components/spaces/composer'
import { MemberName, MemberText } from '@/components/spaces/member-text'
import { SpaceMarkdown } from '@/components/spaces/space-markdown'
import { MessageRow, NewDivider, TypingIndicator } from '@/components/spaces/message-row'
import type { SpacePresence, ThreadInfo } from '@/hooks/use-space-chat'
import { rememberThread, usePresenceSender } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { artifactsForThread, buildThreadSeed, explicitTitle, isContinuation, stripThreadMarker } from '@/lib/spaces-conventions'
import { attributionLabel, formatFeedTime, shortId } from '@/lib/spaces-presentation'
import { getTopicLastReadAt, markTopicRead } from '@/lib/spaces-read-state'
import { maybeInvokeRowboat } from '@/lib/spaces-rowboat'
import { toast } from '@/lib/toast'
import * as analytics from '@/lib/analytics'
import { containsRowboatAddress } from '@/lib/spaces-mentions'

// A thread (or any topic): the parent on top, the artifacts it produced,
// the replies, a reply composer. In general it sits on the right; on the
// Topics tab it is the centre column and the artifacts expand into a rail.

export function ThreadPane({
    org, space, topicId, threadInfo, topic: topicFromList, changeSets, entries, presence, members, memberNames, refreshTick,
    anchorChange, showBack, onBack, onOpenFile, onOpenSession, artifactsRailOpen, onToggleArtifactsRail, onFolding,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    topicId: string
    threadInfo: ThreadInfo | undefined
    topic: spaces.Topic | undefined
    changeSets: spaces.ChangeSet[]
    entries: spaces.SpacesAssetEntry[]
    presence: SpacePresence
    members: spaces.Member[]
    memberNames: Map<string, string>
    refreshTick: number
    /** For standalone topics anchored to a change-set. */
    anchorChange: spaces.ChangeSet | null
    showBack: boolean
    onBack: () => void
    onOpenFile: (path: string) => void
    onOpenSession?: (sessionId: string) => void
    /** Whether the artifacts rail is showing; the summary line under the opener toggles it. */
    artifactsRailOpen: boolean
    onToggleArtifactsRail: () => void
    /** Lets a parent (the rail) share the fold-busy state. */
    onFolding?: (busy: boolean) => void
}) {
    const [topic, setTopic] = useState<spaces.Topic | null>(topicFromList ?? null)
    const [messages, setMessages] = useState<spaces.Message[]>([])
    const [loaded, setLoaded] = useState(false)
    const [posting, setPosting] = useState(false)
    const [folding, setFolding] = useState(false)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const { onType } = usePresenceSender(org.id, space.id, topicId)

    const [newSince] = useState<string | null>(() => getTopicLastReadAt(org.id, space.id, topicId))

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:listMessages', { orgId: org.id, spaceId: space.id, topicId })
            .then((res) => {
                if (cancelled) return
                setTopic(res.topic)
                setMessages(res.messages)
                setLoaded(true)
                markTopicRead(org.id, space.id, topicId)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, topicId, refreshTick])

    const workingAgents = presence.working.get(topicId) ?? []
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' })
    }, [messages.length, workingAgents.length])

    const groups = useMemo(() => artifactsForThread(changeSets, topicId), [changeSets, topicId])

    const parent = threadInfo?.firstMessage ?? messages[0] ?? null
    const isThread = !!threadInfo?.parentMessageId
    // Display metadata (who said the parent, when) still rides in the marker.
    const marker = threadInfo?.marker ?? null
    const replies = messages.slice(1)

    // Echo a just-posted reply into the pane — the live event that would
    // otherwise render it may be seconds away, or never come at all when the
    // socket went half-open (sleep). Dedupe keeps the eventual frame a no-op.
    const echo = (message: spaces.Message) => {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
    }

    const post = async (body: string, agent?: AgentOptions) => {
        setPosting(true)
        try {
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId, body })
            echo(result.message)
            markTopicRead(org.id, space.id, topicId)
            analytics.spacesMessagePosted({ kind: 'topic', mentionsRowboat: containsRowboatAddress(body) })
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body, agent)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post', 'error')
            throw err
        } finally {
            setPosting(false)
        }
    }

    // Fold = a visible ask to your own agent, posted in the thread, then invoked.
    const fold = async (path: string) => {
        setFolding(true)
        onFolding?.(true)
        try {
            const body = `@rowboat fold this topic’s decision into \`${path}\` — keep the file’s structure and put it under the right section. End your change reason with “· topic:${topicId}”.`
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId, body })
            echo(result.message)
            markTopicRead(org.id, space.id, topicId)
            analytics.spacesFoldRequested()
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not ask Rowboat', 'error')
        } finally {
            setFolding(false)
            onFolding?.(false)
        }
    }

    // Toggle: add when the viewer isn't in the group yet, remove when they are.
    const toggleReaction = async (message: spaces.Message, emoji: string) => {
        const mine = (message.reactions ?? []).find((g) => g.emoji === emoji)?.memberIds.includes(org.memberId)
        const action = mine ? 'remove' : 'add'
        try {
            const { message: updated } = await window.ipc.invoke('spaces:reactToMessage', {
                orgId: org.id, spaceId: space.id, messageId: message.id, emoji, action,
            })
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            analytics.spacesReactionToggled({ action })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not react', 'error')
        }
    }

    const manage = async (action: spaces.SpacesManageTopicAction) => {
        try {
            const res = await window.ipc.invoke('spaces:manageTopic', { orgId: org.id, spaceId: space.id, topicId, action })
            setTopic(res.topic)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the topic', 'error')
        }
    }

    // Inline title editing (window.prompt is a no-op in Electron — the old
    // Retitle item died silently). null = not editing.
    const [editingTitle, setEditingTitle] = useState<string | null>(null)
    const named = topic ? explicitTitle(topic, (threadInfo?.firstMessage ?? messages[0])?.body ?? null) : null
    const commitTitle = async () => {
        const title = editingTitle?.trim()
        setEditingTitle(null)
        if (!title || title === topic?.title) return
        await manage({ action: 'retitle', title })
    }

    const openTopicSession = async () => {
        try {
            const { sessionId } = await window.ipc.invoke('spaces:topicSession', { orgId: org.id, spaceId: space.id, topicId })
            if (sessionId && onOpenSession) onOpenSession(sessionId)
            else if (!sessionId) toast('No agent session for this topic yet', 'info')
        } catch {
            toast('Could not open the agent session', 'error')
        }
    }

    // Replies with compaction and the New line.
    const rows: ReactNode[] = []
    let prev: spaces.Message | undefined
    let newShown = false
    for (const message of replies) {
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
                selfMemberId={org.memberId}
                onReact={(m, emoji) => void toggleReaction(m, emoji)}
                dense
            />,
        )
        prev = message
    }

    const typingNames = (presence.typing.get(topicId) ?? []).map((id) => memberNames.get(id) ?? id)
    const parentAuthorId = marker?.parentAuthorId ?? parent?.author.memberId ?? null
    const parentName = parentAuthorId ? memberNames.get(parentAuthorId) ?? parentAuthorId : ''
    const parentAt = marker?.parentPostedAt ?? parent?.postedAt ?? null

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border pl-2 pr-2">
                {showBack && (
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={onBack} aria-label="Back to messages">
                        <ArrowLeft className="size-4" />
                    </Button>
                )}
                <span className="pl-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Topic</span>
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
                            placeholder="Topic name"
                            className="w-64 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-xs text-foreground outline-none"
                        />
                    ) : (
                        <>
                            {isThread ? (named ? <MemberText text={named} /> : 'from a message') : <MemberText text={topic?.title ?? ''} />}
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
                        <DropdownMenuItem onClick={() => setEditingTitle(named ?? topic?.title ?? '')}>
                            <Pencil className="size-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        {topic?.archived ? (
                            <DropdownMenuItem onClick={() => void manage({ action: 'unarchive' })}><ArchiveRestore className="size-3.5 mr-2" /> Unarchive</DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem onClick={() => void manage({ action: 'archive' })}><Archive className="size-3.5 mr-2" /> Archive</DropdownMenuItem>
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

            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
                {!loaded && !parent && <div className="px-2 py-2 text-sm text-muted-foreground">Loading…</div>}

                {/* Opener: the message this topic grew from, or the topic's first message / anchor change. */}
                {anchorChange && !isThread && (
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
                {parent && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                        {parentAuthorId && <MemberAvatar id={parentAuthorId} name={parentName} size="md" className="mt-0.5" />}
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5 text-xs">
                                <span className="font-semibold">{parentName}</span>
                                {!isThread && parent.author.actingMode !== 'direct' && (
                                    <span className="text-muted-foreground">via {parent.author.agentName ?? 'agent'}</span>
                                )}
                                {parentAt && <span className="text-muted-foreground">{formatFeedTime(parentAt)}{isThread ? ' · in Messages' : ''}</span>}
                            </div>
                            <div className="text-sm leading-relaxed [&_p]:my-0.5">
                                <ParentBody body={isThread ? stripThreadMarker(parent.body) : parent.body} />
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
                    <span className="text-[11px] font-medium text-muted-foreground">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                    <span className="h-px flex-1 bg-border" />
                </div>
                {rows}

                {/* Typing-indicator position: below the last message, where eyes rest. */}
                {workingAgents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pl-10 pt-1">
                        {workingAgents.map((memberId) => {
                            const own = memberId === org.memberId
                            const label = own ? 'Your Rowboat is working…' : <><MemberName id={memberId} />’s Rowboat is working…</>
                            return own ? (
                                <button key={memberId} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Open the agent session for this topic" onClick={() => void openTopicSession()}>
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

            <Composer placeholder="Reply…" busy={posting} onSend={post} onType={onType} autoFocus members={members} entries={entries} selfMemberId={org.memberId} />

        </div>
    )
}

function ParentBody({ body }: { body: string }) {
    return <SpaceMarkdown body={body} />
}

// ---------------------------------------------------------------------------
// Draft thread — Reply opened a pane, but nothing exists yet. The topic (seed
// message + the reply) is created only when the first reply is actually SENT;
// clicking Reply and walking away leaves no trace in anyone's space.
// ---------------------------------------------------------------------------

export function DraftThreadPane({ org, space, parent, members, memberNames, entries, onBack, onCreated }: {
    org: OrgWithSpaces
    space: spaces.Space
    /** The general message being replied to. */
    parent: spaces.Message
    members: spaces.Member[]
    memberNames: Map<string, string>
    entries: spaces.SpacesAssetEntry[]
    onBack: () => void
    /** The first reply landed — the pane should be swapped for the real topic. */
    onCreated: (topicId: string) => void
}) {
    const [posting, setPosting] = useState(false)
    // If the seed landed but the reply failed, a retry must reuse the topic —
    // never mint a second one on the same parent.
    const seededRef = useRef<{ topic: spaces.Topic; message: spaces.Message } | null>(null)

    const post = async (body: string, agent?: AgentOptions) => {
        setPosting(true)
        try {
            if (!seededRef.current) {
                seededRef.current = await window.ipc.invoke('spaces:postMessage', {
                    orgId: org.id, spaceId: space.id, body: buildThreadSeed(parent), anchorMessageId: parent.id,
                })
                rememberThread(org.id, space.id, seededRef.current.topic, seededRef.current.message)
                analytics.spacesTopicStarted()
            }
            const seeded = seededRef.current
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId: seeded.topic.id, body })
            markTopicRead(org.id, space.id, seeded.topic.id)
            analytics.spacesMessagePosted({ kind: 'topic', mentionsRowboat: containsRowboatAddress(body) })
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body, agent)
            onCreated(seeded.topic.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post', 'error')
            throw err
        } finally {
            setPosting(false)
        }
    }

    const authorName = memberNames.get(parent.author.memberId) ?? parent.author.memberId
    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border pl-2 pr-2">
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={onBack} aria-label="Back to messages">
                    <ArrowLeft className="size-4" />
                </Button>
                <span className="pl-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Topic</span>
                <span className="truncate text-xs text-muted-foreground">new — created when you send</span>
                <span className="flex-1" />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <MemberAvatar id={parent.author.memberId} name={authorName} size="md" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5 text-xs">
                            <span className="font-semibold">{authorName}</span>
                            <span className="text-muted-foreground">{formatFeedTime(parent.postedAt)} · in Messages</span>
                        </div>
                        <div className="text-sm leading-relaxed [&_p]:my-0.5">
                            <ParentBody body={parent.body} />
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-1 pb-1 pt-3">
                    <span className="text-[11px] font-medium text-muted-foreground">0 replies</span>
                    <span className="h-px flex-1 bg-border" />
                </div>
                <div className="px-2 py-2 text-xs text-muted-foreground">
                    Nothing here yet — sending a reply is what starts the topic for everyone.
                </div>
            </div>
            <Composer placeholder="Reply…" busy={posting} onSend={post} autoFocus members={members} entries={entries} selfMemberId={org.memberId} />
        </div>
    )
}
