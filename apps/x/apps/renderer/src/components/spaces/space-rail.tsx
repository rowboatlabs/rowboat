import { useMemo, useState } from 'react'
import { Bot, FileText, Folder, MessagesSquare, Pin, Plus, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { FileTree } from '@/components/spaces/files-tab'
import type { GeneralState, SpacePresence, ThreadIndex } from '@/hooks/use-space-chat'
import { useMemberNames } from '@/components/spaces/member-text'
import { isGeneralSeedMessage, stripThreadMarker, threadRefOf } from '@/lib/spaces-conventions'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { getTopicLastReadAt } from '@/lib/spaces-read-state'
import type { RailSelection } from '@/lib/spaces-selection'

// The space's edge rail: one collapsible strip that carries the list the
// current surface needs — topics in Talk, files in Read, both (tabbed) in
// Split. Collapsed it is a 28px edge; it pushes open to 280px on hover (never
// floats over content), peeks briefly to teach the gesture, and can be pinned
// per surface. The surfaces own everything else.

export type RailList = 'topics' | 'files'

export function SpaceRail({
    orgId, spaceId, selfMemberId, general, topics, threads, changeSets, entries, presence, unreadPaths, selection, onSelect, onCreateFile,
    list, tabbed, onPickList, open, pinned, hint, onHoverChange, onTogglePin,
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
    /** Which list the rail carries right now (follows the rendered surface). */
    list: RailList
    /** Split: one rail, a Topics/Files switcher instead of a title. */
    tabbed: boolean
    onPickList: (list: RailList) => void
    open: boolean
    pinned: boolean
    hint: string
    onHoverChange: (hovering: boolean) => void
    onTogglePin: () => void
}) {
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all')
    const [creatingFile, setCreatingFile] = useState(false)

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
            const ref = cs.topicId ?? threadRefOf(cs.reason)
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

    const memberNames = useMemberNames()
    const q = query.trim().toLowerCase()
    const topicRows = topics
        .filter((t) => t.id !== generalId)
        .filter((t) => (filter === 'archived' ? t.archived : !t.archived))
        .filter((t) => (filter === 'unread' ? isUnread(t) : true))
        .map((t) => {
            const info = threads.byTopic.get(t.id)
            const raw = info?.parentMessageId && info.firstMessage ? stripThreadMarker(info.firstMessage.body).split('\n')[0] ?? t.title : t.title
            // Titles resolve before the search filter so searching a person's
            // name finds the topics that mention them.
            return { topic: t, title: resolveMentions(raw, memberNames) }
        })
        .filter((x) => (q ? x.title.toLowerCase().includes(q) : true))
        .sort((a, b) => b.topic.lastActivityAt.localeCompare(a.topic.lastActivityAt))

    const selectedTopicId = selection.kind === 'topic' ? selection.topicId : null
    const selectedPath = selection.kind === 'file' ? selection.path : null

    const unreadTopics = topics.filter((t) => t.id !== generalId && !t.archived && isUnread(t)).length + (generalUnread > 0 ? 1 : 0)
    const badge = list === 'topics' ? unreadTopics : unreadPaths.size

    return (
        <aside
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            style={{ width: open ? 280 : 28, transition: 'width 200ms cubic-bezier(0.2,0,0,1)' }}
            className={cn(
                'relative z-10 shrink-0 min-h-0 overflow-hidden border-r border-border flex flex-col',
                open ? 'bg-muted/20' : 'bg-background',
            )}
        >
            {!open ? (
                // The closed edge: which list lives here, and how much of it is unread.
                <div className="flex flex-1 flex-col items-center gap-2.5 py-3.5">
                    {list === 'topics'
                        ? <MessagesSquare className="size-[15px] text-muted-foreground" />
                        : <Folder className="size-[15px] text-muted-foreground" />}
                    <div className="w-px flex-1 bg-border/70" />
                    {badge > 0 && (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9.5px] font-semibold text-background tabular-nums">
                            {badge}
                        </span>
                    )}
                </div>
            ) : (
                // Inner content is fixed at the open width so text doesn't reflow mid-slide.
                <div className="flex h-full w-[280px] flex-col">
                    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
                        {tabbed ? (
                            <div className="inline-flex items-center rounded-md bg-muted p-0.5 text-[10.5px] font-semibold uppercase tracking-wider">
                                {(['topics', 'files'] as const).map((l) => (
                                    <button
                                        key={l}
                                        type="button"
                                        onClick={() => onPickList(l)}
                                        className={cn('rounded px-2 py-0.5', list === l ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                                    >
                                        {l}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {list === 'topics' ? 'Topics' : 'Files'}
                            </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground/70">{hint}</span>
                        <button
                            type="button"
                            onClick={onTogglePin}
                            title={pinned ? 'Unpin — collapse when the mouse leaves' : 'Pin this rail open'}
                            className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-md border disabled:opacity-40',
                                pinned ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Pin className="size-3" />
                        </button>
                    </div>

                    {list === 'topics' ? (
                        <>
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
                                <span className="text-[11px] text-muted-foreground/70">{topicRows.length}</span>
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
                                    {topicRows.map(({ topic, title }) => {
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
                                    {topicRows.length === 0 && (
                                        <div className="px-2 py-2 text-xs text-muted-foreground">
                                            {q ? 'No topics match.' : filter === 'unread' ? 'Nothing unread.' : filter === 'archived' ? 'No archived topics.' : 'No topics yet — reply to a message to start one.'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex h-8 shrink-0 items-center gap-2 px-3 pr-2 pt-1">
                                <span className="text-[11px] text-muted-foreground/70">{entries.length} {entries.length === 1 ? 'file' : 'files'}</span>
                                <span className="flex-1" />
                                <button
                                    type="button"
                                    title="New file"
                                    onClick={() => setCreatingFile(true)}
                                    className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                    <Plus className="size-3.5" />
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
                        </>
                    )}
                </div>
            )}
        </aside>
    )
}
