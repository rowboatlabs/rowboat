import { useMemo, useState } from 'react'
import { Bot, ChevronDown, FileText, MessagesSquare, Plus, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { FileTree } from '@/components/spaces/files-tab'
import type { GeneralState, SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import { isGeneralSeedMessage, stripThreadMarker, threadRefOf } from '@/lib/spaces-conventions'
import { formatFeedTime } from '@/lib/spaces-presentation'
import { getTopicLastReadAt } from '@/lib/spaces-read-state'
import type { RailSelection } from '@/lib/spaces-selection'

// The space's own rail: Messages on top (the space's open stream), then every
// topic — a message that got replies — then the space's files. One selected
// thing at a time; the main area shows it.

export function SpaceRail({
    orgId, spaceId, selfMemberId, general, topics, threads, changeSets, entries, presence, unreadPaths, selection, onSelect, onCreateFile,
}: {
    orgId: string
    spaceId: string
    selfMemberId: string
    general: GeneralState
    topics: spaces.Topic[]
    threads: ThreadIndex
    changeSets: spaces.ChangeSet[]
    entries: spaces.SpacesAssetEntry[]
    presence: SpacePresence
    unreadPaths: ReadonlySet<string>
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onCreateFile: (path: string) => void
}) {
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all')
    const [creatingFile, setCreatingFile] = useState(false)
    const [filesOpen, setFilesOpen] = useState(true)

    const generalId = general.topic?.id ?? null

    const generalUnread = useMemo(() => {
        const g = general.topic
        if (!g || !general.ready) return 0
        const mark = getTopicLastReadAt(orgId, spaceId, g.id)
        return general.messages.filter((m, i) => !isGeneralSeedMessage(g, m, i) && (!mark || m.postedAt > mark) && m.author.memberId !== selfMemberId).length
    }, [general, orgId, spaceId, selfMemberId])

    const artifactFiles = useMemo(() => {
        const counts = new Map<string, Set<string>>()
        for (const cs of changeSets) {
            const ref = threadRefOf(cs.reason)
            if (!ref) continue
            const set = counts.get(ref) ?? new Set<string>()
            set.add(cs.assetPath)
            counts.set(ref, set)
        }
        return counts
    }, [changeSets])

    const isUnread = (t: spaces.Topic) => {
        const mark = getTopicLastReadAt(orgId, spaceId, t.id)
        if (mark && t.lastActivityAt <= mark) return false
        return t.messageCount > 1 || t.createdBy.memberId !== selfMemberId
    }

    const q = query.trim().toLowerCase()
    const list = topics
        .filter((t) => t.id !== generalId)
        .filter((t) => (filter === 'archived' ? t.archived : !t.archived))
        .filter((t) => (filter === 'unread' ? isUnread(t) : true))
        .map((t) => {
            const info = threads.byTopic.get(t.id)
            const title = info?.marker && info.firstMessage ? stripThreadMarker(info.firstMessage.body).split('\n')[0] ?? t.title : t.title
            return { topic: t, title }
        })
        .filter((x) => (q ? x.title.toLowerCase().includes(q) : true))
        .sort((a, b) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt))

    const selectedTopicId = selection.kind === 'topic' ? selection.topicId : null
    const selectedPath = selection.kind === 'file' ? selection.path : null

    return (
        <aside className="w-60 shrink-0 flex flex-col min-h-0 border-r border-border bg-muted/20">
            <div className="flex flex-col gap-0.5 px-2 pt-2">
                <button
                    type="button"
                    onClick={() => onSelect({ kind: 'general' })}
                    className={cn(
                        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px]',
                        selection.kind === 'general' ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                    )}
                >
                    <MessagesSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn('flex-1 truncate', generalUnread > 0 && selection.kind !== 'general' && 'font-semibold')}>Messages</span>
                    {generalUnread > 0 && selection.kind !== 'general' && (
                        <span className="text-[11px] font-semibold tabular-nums">{generalUnread}</span>
                    )}
                    {(presence.typing.get(generalId ?? '') ?? []).length > 0 && <span className="size-1.5 rounded-full bg-emerald-500" title="someone is typing" />}
                </button>
            </div>

            <div className="mt-3 flex items-center gap-2 px-3 pr-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Topics</span>
                <span className="text-[11px] text-muted-foreground/70">{list.length}</span>
                <span className="flex-1" />
                <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[10.5px]">
                    {(['all', 'unread', 'archived'] as const).map((f) => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setFilter(f)}
                            className={cn('rounded px-1.5 py-0.5 capitalize', filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>
            <label className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-within:border-foreground/30">
                <Search className="size-3" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search topics"
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
            </label>
            <div className="mt-1 flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                <div className="flex flex-col gap-0.5">
                    {list.map(({ topic, title }) => {
                        const active = topic.id === selectedTopicId
                        const unread = isUnread(topic)
                        const replies = Math.max(0, topic.messageCount - 1)
                        const files = artifactFiles.get(topic.id)
                        const working = (presence.working.get(topic.id) ?? []).length > 0
                        return (
                            <button
                                key={topic.id}
                                type="button"
                                onClick={() => onSelect({ kind: 'topic', topicId: topic.id })}
                                className={cn(
                                    'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                                    active ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                                    topic.archived && 'opacity-60',
                                )}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className={cn('flex-1 truncate text-[13px] leading-snug', unread ? 'font-semibold' : 'font-normal')}>{title}</span>
                                    {unread && !active && <span className="size-1.5 shrink-0 rounded-full bg-foreground" />}
                                </div>
                                <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                                    <span>{replies} {replies === 1 ? 'reply' : 'replies'}</span>
                                    <span>· {formatFeedTime(topic.lastActivityAt)}</span>
                                    {files && files.size > 0 && (
                                        <span className="inline-flex items-center gap-0.5" title={`Files changed here: ${[...files].join(', ')}`}><FileText className="size-2.5" />{files.size}</span>
                                    )}
                                    {working && <Bot className="size-2.5" aria-label="a Rowboat is working here" />}
                                    {topic.archived && <span>· archived</span>}
                                </div>
                            </button>
                        )
                    })}
                    {list.length === 0 && (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                            {q ? 'No topics match.' : filter === 'unread' ? 'Nothing unread.' : filter === 'archived' ? 'No archived topics.' : 'No topics yet — reply to a message to start one.'}
                        </div>
                    )}
                </div>
            </div>

            {/* Files: pinned below the topics, with its own scroll, collapsible. */}
            <div className={cn('flex shrink-0 flex-col border-t border-border', filesOpen && 'max-h-[38%]')}>
                <div className="flex h-8 shrink-0 items-center gap-2 px-3 pr-2">
                    <button
                        type="button"
                        onClick={() => setFilesOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                        <ChevronDown className={cn('size-3 transition-transform', !filesOpen && '-rotate-90')} />
                        Files
                        <span className="font-normal normal-case tracking-normal text-[11px] text-muted-foreground/70">{entries.length}</span>
                    </button>
                    <span className="flex-1" />
                    <button
                        type="button"
                        title="New file"
                        onClick={() => {
                            setFilesOpen(true)
                            setCreatingFile(true)
                        }}
                        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <Plus className="size-3.5" />
                    </button>
                </div>
                <div className={cn('min-h-0 overflow-y-auto px-2 pb-2', !filesOpen && 'hidden')}>
                    <FileTree
                        entries={entries}
                        selectedPath={selectedPath}
                        unreadPaths={unreadPaths}
                        onOpenFile={(path) => onSelect({ kind: 'file', path })}
                        creating={creatingFile}
                        onCreateFile={(path) => {
                            setCreatingFile(false)
                            onCreateFile(path)
                        }}
                        onCancelCreate={() => setCreatingFile(false)}
                    />
                </div>
            </div>
        </aside>
    )
}
