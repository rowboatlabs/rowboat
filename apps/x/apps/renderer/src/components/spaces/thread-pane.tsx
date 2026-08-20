import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { Anchor, Archive, ArchiveRestore, ArrowLeft, Bot, Loader2, MoreHorizontal, Pencil, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArtifactsSummary } from '@/components/spaces/artifacts'
import { MemberAvatar } from '@/components/spaces/atoms'
import { Composer, type AgentOptions } from '@/components/spaces/composer'
import { MessageRow, NewDivider, TypingIndicator } from '@/components/spaces/message-row'
import type { SpacePresence, ThreadInfo } from '@/hooks/use-space-chat'
import { usePresenceSender } from '@/hooks/use-space-chat'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { artifactsForThread, isContinuation, stripThreadMarker } from '@/lib/spaces-conventions'
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
    const marker = threadInfo?.marker ?? null
    const isThread = !!marker
    const replies = messages.slice(1)

    const post = async (body: string, agent?: AgentOptions) => {
        setPosting(true)
        try {
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId, body })
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

    const manage = async (action: spaces.SpacesManageTopicAction) => {
        try {
            const res = await window.ipc.invoke('spaces:manageTopic', { orgId: org.id, spaceId: space.id, topicId, action })
            setTopic(res.topic)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the topic', 'error')
        }
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
        rows.push(<MessageRow key={message.id} message={message} memberNames={memberNames} continuation={isContinuation(prev, message)} dense />)
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
                    {isThread ? 'from a message' : topic?.title ?? ''}{groups.length > 0 ? ` · ${groups.length} ${groups.length === 1 ? 'file' : 'files'} changed` : ''}
                </span>
                <span className="flex-1" />
                {topic?.archived && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">archived</span>}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onClick={() => {
                                const title = window.prompt('New title', topic?.title ?? '')
                                if (title?.trim()) void manage({ action: 'retitle', title: title.trim() })
                            }}
                        >
                            <Pencil className="size-3.5 mr-2" /> Retitle
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
                            const label = own ? 'Your Rowboat is working…' : `${memberNames.get(memberId) ?? memberId}’s Rowboat is working…`
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

            <Composer placeholder="Reply…" busy={posting} onSend={post} onType={onType} autoFocus members={members} selfMemberId={org.memberId} />

        </div>
    )
}

function ParentBody({ body }: { body: string }) {
    return <Streamdown>{body}</Streamdown>
}
