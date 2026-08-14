import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
    Anchor, ArchiveRestore, Archive, ArrowLeft, Bot, Check, ChevronRight, Clock, FileText, History,
    Link as LinkIcon, Loader2, MessageSquare, MoreVertical, Pencil, Plus, RefreshCw, Send,
    Trash2, Users, X,
} from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RichMarkdownViewer } from '@/components/rich-markdown-viewer'
import { useSpaceLive, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'
import { formatRelativeTime } from '@/lib/relative-time'
import { containsRowboatAddress } from '@/lib/spaces-mentions'
import { toast } from '@/lib/toast'

// Spaces — functional-first surfaces per SPACES_DESIGN_BRIEF (private repo).
// This is the working skeleton the design pass restyles: real data, real
// draft→apply with merge/conflict handling, real live updates. Visual
// identity is deliberately plain house-style; no design opinions taken here.

type SpaceSelection = { orgId: string; spaceId: string } | null

type SpacePaneNav =
    | { pane: 'feed' }
    | { pane: 'files' }
    | { pane: 'topic'; topicId: string }
    | { pane: 'file'; path: string }

// ---------------------------------------------------------------------------
// @rowboat trigger (spec §8): a posted message that genuinely addresses
// @rowboat routes into the topic's session — from BOTH write paths, replying
// into a thread and starting a new topic with the mention as first message.
// ---------------------------------------------------------------------------

function maybeInvokeRowboat(
    org: OrgWithSpaces,
    space: spaces.Space,
    topic: spaces.Topic,
    messageId: string,
    body: string,
): void {
    if (!containsRowboatAddress(body)) return
    void window.ipc
        .invoke('spaces:invokeRowboat', {
            orgId: org.id,
            spaceId: space.id,
            topicId: topic.id,
            topicTitle: topic.title,
            spaceName: space.name,
            messageId,
            body,
        })
        .catch((err) => {
            toast(err instanceof Error ? err.message : 'Rowboat could not be invoked', 'error')
        })
}

// ---------------------------------------------------------------------------
// Attribution — the trust surface (brief principle 2): person first, acting
// mode as a suffix, never a separate bot identity.
// ---------------------------------------------------------------------------

function attributionLabel(a: spaces.ChangeSet['attribution'], members: Map<string, string>): string {
    const name = members.get(a.memberId) ?? a.memberId
    if (a.actingMode === 'direct') return name
    const agent = a.agentName ?? 'agent'
    return a.actingMode === 'scheduled' ? `${name} (via ${agent}, scheduled)` : `${name} (via ${agent})`
}

// ---------------------------------------------------------------------------
// Root view: org/space rail + the selected space
// ---------------------------------------------------------------------------

export function SpacesView({ onOpenSession }: { onOpenSession?: (sessionId: string) => void }) {
    const { orgs, loading, refresh } = useSpacesOrgs()
    const [selection, setSelection] = useState<SpaceSelection>(null)
    const [addOrgOpen, setAddOrgOpen] = useState(false)

    // Keep selection valid as orgs change.
    useEffect(() => {
        if (!selection) return
        const org = orgs.find((o) => o.id === selection.orgId)
        if (!org || !org.spaces.some((s) => s.id === selection.spaceId)) setSelection(null)
    }, [orgs, selection])

    const selectedOrg = selection ? (orgs.find((o) => o.id === selection.orgId) ?? null) : null
    const selectedSpace = selection && selectedOrg ? (selectedOrg.spaces.find((s) => s.id === selection.spaceId) ?? null) : null

    return (
        <div className="flex h-full min-h-0">
            <aside className="w-64 shrink-0 border-r border-border flex flex-col min-h-0">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <span className="text-sm font-semibold">Spaces</span>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" title="Refresh" onClick={() => void refresh()}>
                            <RefreshCw className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" title="Add an org" onClick={() => setAddOrgOpen(true)}>
                            <Plus className="size-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                    {loading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin" /> Loading…
                        </div>
                    ) : orgs.length === 0 ? (
                        <div className="px-3 py-6 text-sm text-muted-foreground">
                            <p className="mb-3">
                                Spaces are shared folders + a feed, living on your team&apos;s org. Your agent and your
                                teammates&apos; agents work in them with you.
                            </p>
                            <Button size="sm" onClick={() => setAddOrgOpen(true)}>
                                <Plus className="size-4 mr-1" /> Add an org
                            </Button>
                        </div>
                    ) : (
                        orgs.map((org) => (
                            <OrgSection
                                key={org.id}
                                org={org}
                                selection={selection}
                                onSelect={(spaceId) => setSelection({ orgId: org.id, spaceId })}
                                onChanged={() => void refresh()}
                            />
                        ))
                    )}
                </div>
            </aside>
            <main className="flex-1 min-w-0 min-h-0 flex flex-col">
                {selectedOrg && selectedSpace ? (
                    <SpacePane
                        key={`${selectedOrg.id}/${selectedSpace.id}`}
                        org={selectedOrg}
                        space={selectedSpace}
                        onOpenSession={onOpenSession}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        {orgs.length === 0 ? 'Add an org to get started.' : 'Pick a space.'}
                    </div>
                )}
            </main>
            <AddOrgDialog open={addOrgOpen} onOpenChange={setAddOrgOpen} onAdded={() => void refresh()} />
        </div>
    )
}

function OrgSection({
    org, selection, onSelect, onChanged,
}: {
    org: OrgWithSpaces
    selection: SpaceSelection
    onSelect: (spaceId: string) => void
    onChanged: () => void
}) {
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')

    const createSpace = async () => {
        const name = newName.trim()
        if (!name) return
        try {
            const { space } = await window.ipc.invoke('spaces:createSpace', { orgId: org.id, name })
            setCreating(false)
            setNewName('')
            onChanged()
            onSelect(space.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create the space', 'error')
        }
    }

    return (
        <div className="mb-2">
            <div className="px-3 py-1 flex items-center justify-between group">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate" title={org.address}>
                    {org.name}
                </span>
                <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 max-w-28 truncate" title={`${org.address} · you are ${org.memberId}`}>
                        {org.memberId}
                    </Badge>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-5 opacity-0 group-hover:opacity-100">
                                <MoreVertical className="size-3" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setCreating(true)}>
                                <Plus className="size-3.5 mr-2" /> New space
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                    void window.ipc.invoke('spaces:removeOrg', { orgId: org.id }).then(onChanged)
                                }}
                            >
                                <Trash2 className="size-3.5 mr-2" /> Remove org
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {org.error ? (
                <div className="px-3 py-1 text-xs text-muted-foreground">Unreachable — {org.error}</div>
            ) : (
                <div>
                    {org.spaces.map((space) => {
                        const active = selection?.orgId === org.id && selection.spaceId === space.id
                        return (
                            <button
                                key={space.id}
                                onClick={() => onSelect(space.id)}
                                className={`w-full text-left px-3 py-1.5 text-sm truncate hover:bg-accent/50 ${active ? 'bg-accent font-medium' : ''}`}
                            >
                                {space.name}
                            </button>
                        )
                    })}
                    {org.spaces.length === 0 && !creating && (
                        <button className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50" onClick={() => setCreating(true)}>
                            + Create the first space
                        </button>
                    )}
                </div>
            )}
            {creating && (
                <div className="px-3 py-1.5 flex items-center gap-1">
                    <Input
                        autoFocus
                        value={newName}
                        placeholder="Space name"
                        className="h-7 text-sm"
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void createSpace()
                            if (e.key === 'Escape') setCreating(false)
                        }}
                    />
                    <Button size="icon" className="size-7" onClick={() => void createSpace()}>
                        <Check className="size-3.5" />
                    </Button>
                </div>
            )}
        </div>
    )
}

function AddOrgDialog({ open, onOpenChange, onAdded }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onAdded: () => void
}) {
    const [baseUrl, setBaseUrl] = useState('http://localhost:4272')
    const [memberId, setMemberId] = useState('')
    const [busy, setBusy] = useState(false)

    const add = async () => {
        if (!baseUrl.trim() || !memberId.trim()) return
        setBusy(true)
        try {
            const { org } = await window.ipc.invoke('spaces:addOrg', { baseUrl: baseUrl.trim(), memberId: memberId.trim() })
            toast(`Signed into ${org.name} as ${org.memberId}`, 'success')
            onOpenChange(false)
            onAdded()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not reach the org', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Add an org</DialogTitle>
                    <DialogDescription>
                        Dev sign-in against a stub Harbor (run <code>pnpm dev</code> in <code>apps/harbor/packages/server</code>).
                        The real org sign-in is an OAuth journey and replaces this form.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Org address</label>
                        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:4272" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Member id</label>
                        <Input
                            value={memberId}
                            onChange={(e) => setMemberId(e.target.value)}
                            placeholder="e.g. ramnique"
                            onKeyDown={(e) => e.key === 'Enter' && void add()}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={() => void add()} disabled={busy || !baseUrl.trim() || !memberId.trim()}>
                            {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Sign in
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// One space: header + feed/files/topic/file panes, kept live by the org socket
// ---------------------------------------------------------------------------

/** `${memberId}|${topicId}` → last-seen ms. Presence is a lease: senders renew ~10s, we prune at 30s. */
type AgentPresenceMap = Map<string, number>

const PRESENCE_TTL_MS = 30_000

function SpacePane({ org, space, onOpenSession }: {
    org: OrgWithSpaces
    space: spaces.Space
    onOpenSession?: (sessionId: string) => void
}) {
    const [nav, setNav] = useState<SpacePaneNav>({ pane: 'feed' })
    const [members, setMembers] = useState<spaces.Member[]>([])
    const [topics, setTopics] = useState<spaces.Topic[]>([])
    const [activity, setActivity] = useState<spaces.ChangeSet[]>([])
    const [refreshTick, setRefreshTick] = useState(0)
    const [agentPresence, setAgentPresence] = useState<AgentPresenceMap>(new Map())

    const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members])

    const refreshFeed = useCallback(async () => {
        try {
            const [membersRes, topicsRes, historyRes] = await Promise.all([
                window.ipc.invoke('spaces:listMembers', { orgId: org.id, spaceId: space.id }),
                window.ipc.invoke('spaces:listTopics', { orgId: org.id, spaceId: space.id }),
                window.ipc.invoke('spaces:assetHistory', { orgId: org.id, spaceId: space.id, limit: 30 }),
            ])
            setMembers(membersRes.members)
            setTopics(topicsRes.topics)
            setActivity(historyRes.changeSets)
        } catch {
            // org unreachable; panes show their own error states
        }
    }, [org.id, space.id])

    useEffect(() => {
        void refreshFeed()
    }, [refreshFeed, refreshTick])

    useSpaceLive(org.id, space.id, (frame) => {
        if (frame.kind === 'presence') {
            if (!frame.topicId) return
            const key = `${frame.memberId}|${frame.topicId}`
            setAgentPresence((prev) => {
                const next = new Map(prev)
                if (frame.state === 'agent_working') next.set(key, Date.now())
                else next.delete(key)
                return next
            })
            return
        }
        if (frame.kind !== 'event') return
        // Coarse-grained on purpose: any durable event refreshes the feed
        // strand; open panes react via refreshTick.
        setRefreshTick((t) => t + 1)
    })

    // Presence chips die on their own when the lease stops renewing (a crashed
    // machine means a wrong chip for ≤30s, never a stuck one).
    useEffect(() => {
        const timer = setInterval(() => {
            setAgentPresence((prev) => {
                const cutoff = Date.now() - PRESENCE_TTL_MS
                if (![...prev.values()].some((at) => at < cutoff)) return prev
                return new Map([...prev].filter(([, at]) => at >= cutoff))
            })
        }, 10_000)
        return () => clearInterval(timer)
    }, [])

    const invite = async () => {
        try {
            const result = await window.ipc.invoke('spaces:createInvite', { orgId: org.id, spaceId: space.id })
            await navigator.clipboard.writeText(result.link)
            toast('Invite link copied to clipboard', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create an invite', 'error')
        }
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
                {nav.pane !== 'feed' && (
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setNav({ pane: 'feed' })}>
                        <ArrowLeft className="size-4" />
                    </Button>
                )}
                <h1 className="text-sm font-semibold truncate">{space.name}</h1>
                <Badge variant="outline" className="text-[10px]">{org.name}</Badge>
                <div className="flex-1" />
                <div className="flex items-center gap-1 text-xs text-muted-foreground" title={members.map((m) => m.displayName).join(', ')}>
                    <Users className="size-3.5" /> {members.length}
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setNav({ pane: 'files' })}>
                    <FileText className="size-3.5 mr-1" /> Files
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void invite()}>
                    <LinkIcon className="size-3.5 mr-1" /> Invite
                </Button>
            </header>
            <div className="flex-1 min-h-0">
                {nav.pane === 'feed' && (
                    <FeedPane
                        org={org}
                        space={space}
                        topics={topics}
                        activity={activity}
                        memberNames={memberNames}
                        refreshTick={refreshTick}
                        onOpenTopic={(topicId) => setNav({ pane: 'topic', topicId })}
                        onOpenFile={(path) => setNav({ pane: 'file', path })}
                        onPosted={() => setRefreshTick((t) => t + 1)}
                    />
                )}
                {nav.pane === 'files' && (
                    <FilesPane org={org} space={space} refreshTick={refreshTick} onOpenFile={(path) => setNav({ pane: 'file', path })} />
                )}
                {nav.pane === 'topic' && (
                    <TopicPane
                        org={org}
                        space={space}
                        topicId={nav.topicId}
                        memberNames={memberNames}
                        refreshTick={refreshTick}
                        workingAgents={[...agentPresence.keys()]
                            .filter((key) => key.endsWith(`|${nav.topicId}`))
                            .map((key) => key.slice(0, key.lastIndexOf('|')))}
                        onOpenSession={onOpenSession}
                    />
                )}
                {nav.pane === 'file' && (
                    <FilePane org={org} space={space} path={nav.path} memberNames={memberNames} refreshTick={refreshTick} />
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Feed: README beside the topic list + collapsed activity strand
// ---------------------------------------------------------------------------

function FeedPane({
    org, space, topics, activity, memberNames, refreshTick, onOpenTopic, onOpenFile, onPosted,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    topics: spaces.Topic[]
    activity: spaces.ChangeSet[]
    memberNames: Map<string, string>
    refreshTick: number
    onOpenTopic: (topicId: string) => void
    onOpenFile: (path: string) => void
    onPosted: () => void
}) {
    const [readme, setReadme] = useState<spaces.ReadAssetResult | null>(null)
    const [readmeMissing, setReadmeMissing] = useState(false)
    const [draft, setDraft] = useState('')
    const [posting, setPosting] = useState(false)
    const [showActivity, setShowActivity] = useState(false)

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:readAsset', { orgId: org.id, spaceId: space.id, path: 'README.md' })
            .then((res) => {
                if (!cancelled) {
                    setReadme(res)
                    setReadmeMissing(false)
                }
            })
            .catch(() => {
                if (!cancelled) setReadmeMissing(true)
            })
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, refreshTick])

    const startTopic = async () => {
        const body = draft.trim()
        if (!body) return
        setPosting(true)
        try {
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, body })
            setDraft('')
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body)
            onPosted()
            onOpenTopic(result.topic.id)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post', 'error')
        } finally {
            setPosting(false)
        }
    }

    return (
        <div className="flex h-full min-h-0">
            <section className="flex-1 min-w-0 overflow-y-auto border-r border-border p-4">
                {readme ? (
                    <div className="max-w-2xl">
                        <RichMarkdownViewer content={readme.content} />
                        <button
                            className="mt-2 text-xs text-muted-foreground hover:underline flex items-center gap-1"
                            onClick={() => onOpenFile('README.md')}
                        >
                            <Pencil className="size-3" /> README.md · v{readme.version}
                        </button>
                    </div>
                ) : readmeMissing ? (
                    <div className="text-sm text-muted-foreground">
                        <p className="mb-2">No README yet — it&apos;s the front door of this space.</p>
                        <Button size="sm" variant="outline" onClick={() => onOpenFile('README.md')}>
                            <Plus className="size-3.5 mr-1" /> Write it
                        </Button>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">Loading…</div>
                )}
            </section>
            <section className="w-[26rem] shrink-0 flex flex-col min-h-0">
                <div className="p-3 border-b border-border">
                    <Textarea
                        value={draft}
                        placeholder="Start a topic — your first message becomes its title"
                        className="min-h-16 text-sm"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void startTopic()
                        }}
                    />
                    <div className="flex justify-end mt-2">
                        <Button size="sm" className="h-7 text-xs" disabled={posting || !draft.trim()} onClick={() => void startTopic()}>
                            {posting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />} Post
                        </Button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {topics.length === 0 && (
                        <div className="px-3 py-4 text-sm text-muted-foreground">No topics yet.</div>
                    )}
                    {topics.map((topic) => (
                        <button
                            key={topic.id}
                            className="w-full text-left px-3 py-2 border-b border-border/50 hover:bg-accent/40"
                            onClick={() => onOpenTopic(topic.id)}
                        >
                            <div className="flex items-center gap-2">
                                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="text-sm truncate flex-1">{topic.title}</span>
                                {topic.anchorChangeSetId && <Anchor className="size-3 shrink-0 text-muted-foreground" />}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 pl-5.5 flex items-center gap-2">
                                <span>{attributionLabel(topic.createdBy, memberNames)}</span>
                                <span>· {topic.messageCount} {topic.messageCount === 1 ? 'message' : 'messages'}</span>
                                <span>· {formatRelativeTime(topic.lastActivityAt)}</span>
                            </div>
                        </button>
                    ))}
                    <div className="px-3 py-2">
                        <button
                            className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                            onClick={() => setShowActivity((v) => !v)}
                        >
                            <ChevronRight className={`size-3 transition-transform ${showActivity ? 'rotate-90' : ''}`} />
                            Activity · {activity.length} recent {activity.length === 1 ? 'change' : 'changes'}
                        </button>
                        {showActivity && (
                            <div className="mt-1 space-y-1">
                                {activity.map((cs) => (
                                    <button
                                        key={cs.id}
                                        className="w-full text-left text-xs text-muted-foreground hover:bg-accent/40 rounded px-2 py-1"
                                        onClick={() => onOpenFile(cs.assetPath)}
                                        title={cs.reason ?? undefined}
                                    >
                                        <span className="font-medium">{attributionLabel(cs.attribution, memberNames)}</span>
                                        {' · '}
                                        <code>{cs.assetPath}</code> → v{cs.resultVersion}
                                        {cs.reason && <span className="italic"> — {cs.reason}</span>}
                                        <span> · {formatRelativeTime(cs.committedAt)}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Topic thread
// ---------------------------------------------------------------------------

function TopicPane({
    org, space, topicId, memberNames, refreshTick, workingAgents, onOpenSession,
}: {
    org: OrgWithSpaces
    space: spaces.Space
    topicId: string
    memberNames: Map<string, string>
    refreshTick: number
    /** memberIds whose agents hold a live agent_working lease on this topic. */
    workingAgents: string[]
    onOpenSession?: (sessionId: string) => void
}) {
    const [topic, setTopic] = useState<spaces.Topic | null>(null)
    const [messages, setMessages] = useState<spaces.Message[]>([])
    const [draft, setDraft] = useState('')
    const [posting, setPosting] = useState(false)
    const bottomRef = useRef<HTMLDivElement | null>(null)

    const openTopicSession = async () => {
        try {
            const { sessionId } = await window.ipc.invoke('spaces:topicSession', {
                orgId: org.id,
                spaceId: space.id,
                topicId,
            })
            if (sessionId && onOpenSession) onOpenSession(sessionId)
            else if (!sessionId) toast('No agent session for this topic yet', 'info')
        } catch {
            toast('Could not open the agent session', 'error')
        }
    }

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:listMessages', { orgId: org.id, spaceId: space.id, topicId })
            .then((res) => {
                if (cancelled) return
                setTopic(res.topic)
                setMessages(res.messages)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, topicId, refreshTick])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' })
    }, [messages.length, workingAgents.length])

    const reply = async () => {
        const body = draft.trim()
        if (!body) return
        setPosting(true)
        try {
            const result = await window.ipc.invoke('spaces:postMessage', { orgId: org.id, spaceId: space.id, topicId, body })
            setDraft('')
            maybeInvokeRowboat(org, space, result.topic, result.message.id, body)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not post', 'error')
        } finally {
            setPosting(false)
        }
    }

    const manage = async (action: spaces.SpacesManageTopicAction) => {
        try {
            const topicRes = await window.ipc.invoke('spaces:manageTopic', { orgId: org.id, spaceId: space.id, topicId, action })
            setTopic(topicRes.topic)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not update the topic', 'error')
        }
    }

    if (!topic) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                <h2 className="text-sm font-medium truncate flex-1">{topic.title}</h2>
                {topic.archived && <Badge variant="outline" className="text-[10px]">archived</Badge>}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onClick={() => {
                                const title = window.prompt('New title', topic.title)
                                if (title?.trim()) void manage({ action: 'retitle', title: title.trim() })
                            }}
                        >
                            <Pencil className="size-3.5 mr-2" /> Retitle
                        </DropdownMenuItem>
                        {topic.archived ? (
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
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.map((message) => (
                    <div key={message.id}>
                        <div className="text-xs text-muted-foreground mb-0.5">
                            <span className={message.author.actingMode === 'direct' ? 'font-medium text-foreground' : ''}>
                                {attributionLabel(message.author, memberNames)}
                            </span>
                            {' · '}
                            {formatRelativeTime(message.postedAt)}
                        </div>
                        <div className="text-sm">
                            <Streamdown>{message.body}</Streamdown>
                        </div>
                    </div>
                ))}
                {/* Typing-indicator position: below the last message, where eyes rest. */}
                {workingAgents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        {workingAgents.map((memberId) => {
                            const own = memberId === org.memberId
                            const label = own
                                ? 'Your Rowboat is working…'
                                : `${memberNames.get(memberId) ?? memberId}'s Rowboat is working…`
                            return own ? (
                                <button
                                    key={memberId}
                                    className="flex items-center gap-1.5 text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                    title="Open the agent session for this topic"
                                    onClick={() => void openTopicSession()}
                                >
                                    <Loader2 className="size-3 animate-spin" />
                                    {label}
                                </button>
                            ) : (
                                <span
                                    key={memberId}
                                    className="flex items-center gap-1.5 text-xs rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground"
                                >
                                    <Bot className="size-3" />
                                    {label}
                                </span>
                            )
                        })}
                    </div>
                )}
                <div ref={bottomRef} />
            </div>
            <div className="p-3 border-t border-border">
                <Textarea
                    value={draft}
                    placeholder="Reply…"
                    className="min-h-16 text-sm"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void reply()
                    }}
                />
                <div className="flex justify-end mt-2">
                    <Button size="sm" className="h-7 text-xs" disabled={posting || !draft.trim()} onClick={() => void reply()}>
                        {posting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Send className="size-3.5 mr-1" />} Reply
                    </Button>
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Files list
// ---------------------------------------------------------------------------

function FilesPane({ org, space, refreshTick, onOpenFile }: {
    org: OrgWithSpaces
    space: spaces.Space
    refreshTick: number
    onOpenFile: (path: string) => void
}) {
    const [entries, setEntries] = useState<Array<{ path: string; version: number; updatedAt: string }>>([])
    const [newPath, setNewPath] = useState('')
    const [creating, setCreating] = useState(false)

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:listAssets', { orgId: org.id, spaceId: space.id })
            .then((res) => {
                if (!cancelled) setEntries(res.entries)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, refreshTick])

    return (
        <div className="p-4 max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
                {creating ? (
                    <>
                        <Input
                            autoFocus
                            value={newPath}
                            placeholder="path/to/file.md"
                            className="h-7 text-sm max-w-64"
                            onChange={(e) => setNewPath(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newPath.trim()) onOpenFile(newPath.trim())
                                if (e.key === 'Escape') setCreating(false)
                            }}
                        />
                        <Button size="icon" className="size-7" disabled={!newPath.trim()} onClick={() => onOpenFile(newPath.trim())}>
                            <Check className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => setCreating(false)}>
                            <X className="size-3.5" />
                        </Button>
                    </>
                ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreating(true)}>
                        <Plus className="size-3.5 mr-1" /> New file
                    </Button>
                )}
            </div>
            {entries.length === 0 ? (
                <div className="text-sm text-muted-foreground">No files yet.</div>
            ) : (
                <div className="divide-y divide-border/50 border border-border rounded-md">
                    {entries.map((entry) => (
                        <button
                            key={entry.path}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40 text-left"
                            onClick={() => onOpenFile(entry.path)}
                        >
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                            <code className="flex-1 truncate">{entry.path}</code>
                            <span className="text-xs text-muted-foreground">v{entry.version} · {formatRelativeTime(entry.updatedAt)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// File view + draft→apply — the novel interaction (brief screen 4).
// A draft is explicit; applying is deliberate; a stale base that merges shows
// a notice; a conflict blocks nothing and loses nothing.
// ---------------------------------------------------------------------------

interface DraftState {
    baseVersion: number
    text: string
    reason: string
    conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }> | null
}

function FilePane({ org, space, path, memberNames, refreshTick }: {
    org: OrgWithSpaces
    space: spaces.Space
    path: string
    memberNames: Map<string, string>
    refreshTick: number
}) {
    const [asset, setAsset] = useState<spaces.ReadAssetResult | null>(null)
    const [missing, setMissing] = useState(false)
    const [draft, setDraft] = useState<DraftState | null>(null)
    const [applying, setApplying] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [diffView, setDiffView] = useState<{ title: string; unified: string } | null>(null)

    const load = useCallback(async () => {
        try {
            const res = await window.ipc.invoke('spaces:readAsset', { orgId: org.id, spaceId: space.id, path })
            setAsset(res)
            setMissing(false)
        } catch {
            setAsset(null)
            setMissing(true)
        }
    }, [org.id, space.id, path])

    useEffect(() => {
        void load()
    }, [load, refreshTick])

    const beginEdit = () => {
        setDraft({
            baseVersion: asset?.version ?? 0,
            text: asset?.content ?? '',
            reason: '',
            conflict: null,
        })
    }

    const apply = async () => {
        if (!draft) return
        setApplying(true)
        try {
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: {
                    assetPath: path,
                    baseVersion: draft.baseVersion,
                    newContent: draft.text,
                    ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
                },
            })
            if (result.outcome === 'applied') {
                toast(`Applied — now v${result.version}`, 'success')
                setDraft(null)
                await load()
            } else if (result.outcome === 'merged') {
                // The base moved while drafting but the merge was clean: what
                // now exists is mergedContent, not the draft (contract rule).
                toast(`Applied with concurrent changes folded in — now v${result.version}`, 'success')
                setDraft(null)
                await load()
            } else {
                setDraft({ ...draft, conflict: result })
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not apply', 'error')
        } finally {
            setApplying(false)
        }
    }

    const showDiff = async (from: number, to: number) => {
        try {
            const res = await window.ipc.invoke('spaces:diff', { orgId: org.id, spaceId: space.id, path, from, to })
            setDiffView({ title: `${path} · v${from} → v${to}`, unified: res.unified })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not load the diff', 'error')
        }
    }

    // One-tap micro change-set: checkbox ticks in view mode apply directly.
    const toggleCheckbox = async (lineIndex: number) => {
        if (!asset) return
        const lines = asset.content.split('\n')
        const line = lines[lineIndex]
        if (line === undefined) return
        if (/\[ \]/.test(line)) lines[lineIndex] = line.replace('[ ]', '[x]')
        else if (/\[[xX]\]/.test(line)) lines[lineIndex] = line.replace(/\[[xX]\]/, '[ ]')
        else return
        try {
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: { assetPath: path, baseVersion: asset.version, newContent: lines.join('\n') },
            })
            if (result.outcome === 'conflict') toast('Someone changed this line at the same time — refresh and retry', 'error')
            else await load()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not apply', 'error')
        }
    }

    if (missing && !draft) {
        return (
            <div className="p-6 text-sm text-muted-foreground">
                <p className="mb-3"><code>{path}</code> doesn&apos;t exist yet.</p>
                <Button size="sm" onClick={beginEdit}><Plus className="size-3.5 mr-1" /> Create it</Button>
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0">
            <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border text-xs text-muted-foreground">
                    <code className="truncate">{path}</code>
                    {asset && <span>v{asset.version}</span>}
                    <div className="flex-1" />
                    {!draft && asset && (
                        <>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={beginEdit}>
                                <Pencil className="size-3 mr-1" /> Edit
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setHistoryOpen((v) => !v)}>
                                <History className="size-3 mr-1" /> History
                            </Button>
                        </>
                    )}
                    {draft && (
                        <>
                            <Input
                                value={draft.reason}
                                placeholder="Why? (optional — shows in history forever)"
                                className="h-6 text-xs w-72"
                                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                            />
                            <Button size="sm" className="h-6 text-xs" disabled={applying} onClick={() => void apply()}>
                                {applying ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Check className="size-3 mr-1" />}
                                Apply{draft.conflict ? ` against v${draft.conflict.currentVersion}` : ''}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDraft(null)}>
                                <X className="size-3 mr-1" /> Discard
                            </Button>
                        </>
                    )}
                </div>
                {draft?.conflict && (
                    <ConflictNotice
                        conflict={draft.conflict}
                        memberNames={memberNames}
                        onUseCurrent={() => {
                            setDraft({
                                baseVersion: draft.conflict!.currentVersion,
                                text: draft.conflict!.currentContent,
                                reason: draft.reason,
                                conflict: null,
                            })
                        }}
                        onRebase={() => setDraft({ ...draft, baseVersion: draft.conflict!.currentVersion })}
                    />
                )}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {draft ? (
                        <Textarea
                            value={draft.text}
                            spellCheck={false}
                            className="w-full h-full min-h-full rounded-none border-0 font-mono text-sm resize-none focus-visible:ring-0"
                            onChange={(e) => setDraft({ ...draft, text: e.target.value, conflict: null })}
                        />
                    ) : asset ? (
                        <InteractiveMarkdown content={asset.content} onToggleCheckbox={(i) => void toggleCheckbox(i)} />
                    ) : (
                        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                    )}
                </div>
            </div>
            {historyOpen && asset && !draft && (
                <HistoryPanel
                    org={org}
                    space={space}
                    path={path}
                    memberNames={memberNames}
                    refreshTick={refreshTick}
                    onClose={() => setHistoryOpen(false)}
                    onShowDiff={(from, to) => void showDiff(from, to)}
                />
            )}
            <Dialog open={diffView !== null} onOpenChange={(open) => !open && setDiffView(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{diffView?.title}</DialogTitle>
                    </DialogHeader>
                    <pre className="max-h-[60vh] overflow-auto text-xs bg-muted/50 rounded p-3 whitespace-pre-wrap">
                        {diffView?.unified}
                    </pre>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function ConflictNotice({ conflict, memberNames, onUseCurrent, onRebase }: {
    conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }>
    memberNames: Map<string, string>
    onUseCurrent: () => void
    onRebase: () => void
}) {
    const lastWriter = conflict.recentHistory[0]
    return (
        <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs space-y-1">
            <div className="font-medium">
                Nothing was saved — {lastWriter ? attributionLabel(lastWriter.attribution, memberNames) : 'someone'} changed
                {' '}the same {conflict.regions.length === 1 ? 'region' : `${conflict.regions.length} regions`} while you were drafting (now v{conflict.currentVersion}).
            </div>
            {conflict.regions.map((region, i) => (
                <div key={i} className="pl-2 border-l-2 border-border">
                    <span className="text-muted-foreground">
                        lines {region.baseStart > region.baseEnd ? `at ${region.baseEnd}+` : `${region.baseStart}–${region.baseEnd}`}:
                    </span>
                    <span className="text-muted-foreground"> theirs </span>
                    <code>{region.current.join(' ⏎ ') || '(deleted)'}</code>
                    <span className="text-muted-foreground"> · yours </span>
                    <code>{region.proposed.join(' ⏎ ') || '(deleted)'}</code>
                </div>
            ))}
            <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onRebase}>
                    Keep my draft, I&apos;ve folded theirs in
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onUseCurrent}>
                    Start over from v{conflict.currentVersion}
                </Button>
            </div>
        </div>
    )
}

function HistoryPanel({ org, space, path, memberNames, refreshTick, onClose, onShowDiff }: {
    org: OrgWithSpaces
    space: spaces.Space
    path: string
    memberNames: Map<string, string>
    refreshTick: number
    onClose: () => void
    onShowDiff: (from: number, to: number) => void
}) {
    const [changeSets, setChangeSets] = useState<spaces.ChangeSet[]>([])

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:assetHistory', { orgId: org.id, spaceId: space.id, path, limit: 100 })
            .then((res) => {
                if (!cancelled) setChangeSets(res.changeSets)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, path, refreshTick])

    return (
        <aside className="w-80 shrink-0 border-l border-border flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium flex items-center gap-1"><History className="size-3.5" /> History</span>
                <Button variant="ghost" size="icon" className="size-6" onClick={onClose}><X className="size-3.5" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {changeSets.map((cs) => (
                    <button
                        key={cs.id}
                        className="w-full text-left px-3 py-2 border-b border-border/50 hover:bg-accent/40"
                        onClick={() => onShowDiff(cs.baseVersion, cs.resultVersion)}
                    >
                        <div className="text-xs font-medium">{attributionLabel(cs.attribution, memberNames)}</div>
                        {cs.reason && <div className="text-xs italic text-muted-foreground mt-0.5">{cs.reason}</div>}
                        <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="size-2.5" /> {formatRelativeTime(cs.committedAt)} · v{cs.resultVersion}
                        </div>
                    </button>
                ))}
            </div>
        </aside>
    )
}

// ---------------------------------------------------------------------------
// Markdown view with one-tap checkboxes. RichMarkdownViewer renders read-only;
// checkbox lines get an interactive overlay row instead (v0: line-accurate,
// plain — the design pass owns making this pretty).
// ---------------------------------------------------------------------------

function InteractiveMarkdown({ content, onToggleCheckbox }: {
    content: string
    onToggleCheckbox: (lineIndex: number) => void
}) {
    const lines = content.split('\n')
    const hasCheckboxes = lines.some((l) => /- \[[ xX]\]/.test(l))
    if (!hasCheckboxes) {
        return (
            <div className="p-4 max-w-2xl">
                <RichMarkdownViewer content={content} />
            </div>
        )
    }
    return (
        <div className="p-4 max-w-2xl space-y-0.5">
            {lines.map((line, i) => {
                const checkbox = line.match(/^(\s*)- \[([ xX])\] (.*)$/)
                if (checkbox) {
                    const checked = checkbox[2] !== ' '
                    return (
                        <div key={i} className="flex items-start gap-2 text-sm" style={{ paddingLeft: `${(checkbox[1]?.length ?? 0) * 8}px` }}>
                            <input
                                type="checkbox"
                                checked={checked}
                                className="mt-1 cursor-pointer"
                                onChange={() => onToggleCheckbox(i)}
                            />
                            <span className={checked ? 'line-through text-muted-foreground' : ''}>{checkbox[3]}</span>
                        </div>
                    )
                }
                return line.trim() === '' ? (
                    <div key={i} className="h-2" />
                ) : (
                    <div key={i} className="text-sm [&_p]:my-0">
                        <Streamdown>{line}</Streamdown>
                    </div>
                )
            })}
        </div>
    )
}
