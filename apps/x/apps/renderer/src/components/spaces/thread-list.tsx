import { useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, Bot, ChevronDown, CircleCheck, Hash, Link as LinkIcon, MessageSquare, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil, Timer, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MemberAvatar } from '@/components/spaces/atoms'
import { ThreadStatusDot } from '@/components/spaces/session-status'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { sessionArchiveLabel } from '@/lib/spaces-conventions'
import { threadStatusLabel } from '@/lib/spaces-my-threads'
import { formatFeedTime } from '@/lib/spaces-presentation'
import type { SpaceBadge } from '@/lib/spaces-read-state'
import { cn } from '@/lib/utils'

// The thread list both Threads pages draw (2026-11-06, "coding session:
// threads" in Main): a space's tab (everyone's threads there) and the rail's
// page (yours in every space) differ only in which threads they are given, so
// rows, menus and filters are one component and cannot drift apart.

/** One row: a thread, named, a session, or plain. */
export interface ThreadItem {
    spaceId: string
    rootMessageId: string
    root?: spaces.Message
    topic?: Pick<spaces.Topic, 'id' | 'title' | 'archived'>
    /** Mentions already resolved. */
    title: string
    activityAt: string
    /** The starter first, then repliers in first-reply order. */
    people: string[]
    badge: SpaceBadge
    direct?: boolean
    /** The space's name, on lists that span spaces. */
    spaceName?: string
    /** Where it stands for you (harbor myThreads), when known. */
    status?: spaces.ThreadStatus
    /** An agent is working in it right now (live presence), when no status is known. */
    working?: boolean
}

export interface ThreadActions {
    onOpen: (item: ThreadItem) => void
    onPrefetch?: (item: ThreadItem) => void
    onCopyLink: (item: ThreadItem) => void
    /** Archive or end (true), unarchive or reopen (false): on the topic for a discussion, else on the root. */
    onArchive: (item: ThreadItem, archive: boolean) => void
    /** A discussion's or a session's new title. */
    onRename: (item: ThreadItem, title: string) => Promise<void> | void
    /** "Convert back to thread": the topic goes, the conversation stays. */
    onRemoveTopic: (item: ThreadItem) => void
}

const keyOf = (item: ThreadItem) => `${item.spaceId}/${item.rootMessageId}`

export function ThreadList({ items, nameOf, actions, writable, pendingKey, selectedRootMessageId, inline = false }: {
    items: ThreadItem[]
    nameOf: (memberId: string) => string
    actions: ThreadActions
    writable: boolean
    /** A row whose action is in flight: its menu is disabled. */
    pendingKey?: string | null
    selectedRootMessageId?: string | null
    /** Inline spaces call the side pane a conversation. */
    inline?: boolean
}) {
    const [renaming, setRenaming] = useState<{ key: string; title: string } | null>(null)
    return <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
            const { root, topic, title } = item
            const key = keyOf(item)
            const session = !topic && root?.session
            const archived = topic ? topic.archived : !!root?.archived
            const author = root ? nameOf(root.author.memberId) : null
            const replies = root?.replyCount ?? 0
            const Icon = topic ? MessagesSquare : session ? Timer : MessageSquare
            const selected = selectedRootMessageId === item.rootMessageId
            const editing = renaming?.key === key
            const commit = async () => {
                const next = renaming?.title.trim()
                if (!next) return
                await actions.onRename(item, next)
                setRenaming(null)
            }
            return <li key={key}><ContextMenu>
                <ContextMenuTrigger asChild>
                    <div className={cn('group relative flex items-center rounded-xl transition-colors hover:bg-accent/60 has-[[data-state=open]]:bg-accent/60', selected && 'bg-accent/60')}>
                        {editing ? <form className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5" onSubmit={(event) => {
                            event.preventDefault()
                            void commit()
                        }}>
                            <Input autoFocus aria-label={session ? 'Session title' : 'Discussion title'} className="h-9 min-w-0 flex-1 text-sm"
                                value={renaming.title} onChange={(event) => setRenaming({ key, title: event.target.value })}
                                onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }} />
                            <Button type="submit" size="sm" disabled={pendingKey === key || !renaming.title.trim()}>Save</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                        </form> : <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 pr-12 text-left"
                            aria-current={selected ? 'true' : undefined}
                            onMouseEnter={() => actions.onPrefetch?.(item)} onClick={() => actions.onOpen(item)}>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <Icon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className={cn('block truncate text-sm', item.badge.unread > 0 ? 'font-semibold text-foreground' : 'font-medium')}>{title}</span>{' '}
                                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="truncate">{item.spaceName ? `${item.spaceName} · ` : ''}{author ? `${author} · ` : ''}{replies} {replies === 1 ? 'reply' : 'replies'} · {formatFeedTime(item.activityAt)}</span>
                                    {item.status && item.status !== 'idle' && !archived
                                        ? <span className="inline-flex shrink-0 items-center gap-1">· <ThreadStatusDot status={item.status} /> {threadStatusLabel(item.status)}</span>
                                        : item.working && <span className="inline-flex shrink-0 items-center gap-1 text-[var(--stream-link)]"><Bot className="size-3.5" aria-hidden /> Rowboat is working</span>}
                                </span>
                            </span>
                            {item.people.length > 0 && <ParticipantStack ids={item.people} nameOf={nameOf} />}
                            <UnreadBadge badge={item.badge} direct={item.direct} />
                        </button>}
                        {!editing && <DropdownMenu>
                            <DropdownMenuTrigger asChild><button type="button" aria-label={`Options for ${title}`} disabled={pendingKey === key}
                                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => actions.onCopyLink(item)}><LinkIcon className="mr-2 size-3.5" />Copy link</DropdownMenuItem>
                                {!topic && root && <>
                                    <DropdownMenuSeparator />
                                    {session && <DropdownMenuItem disabled={!writable} onSelect={() => setRenaming({ key, title })}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>}
                                    <DropdownMenuItem disabled={!writable} onSelect={() => actions.onArchive(item, !archived)}>
                                        {archived ? <ArchiveRestore className="mr-2 size-3.5" /> : session ? <CircleCheck className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{sessionArchiveLabel(root)}
                                    </DropdownMenuItem>
                                </>}
                                {topic && <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled={!writable} onSelect={() => setRenaming({ key, title })}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>
                                    <DropdownMenuItem disabled={!writable} onSelect={() => actions.onArchive(item, !topic.archived)}>
                                        {topic.archived ? <ArchiveRestore className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{topic.archived ? 'Unarchive' : 'Archive'}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled={!writable} onSelect={() => actions.onRemoveTopic(item)}><MessageSquareOff className="mr-2 size-3.5" />Convert back to thread</DropdownMenuItem>
                                </>}
                            </DropdownMenuContent>
                        </DropdownMenu>}
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={() => actions.onOpen(item)}><Icon className="mr-2 size-3.5" />{inline ? 'Open conversation' : 'Open thread'}</ContextMenuItem>
                    <ContextMenuItem onSelect={() => actions.onCopyLink(item)}><LinkIcon className="mr-2 size-3.5" />Copy link</ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu></li>
        })}
    </ul>
}

/**
 * A thread's participants as overlapping circles (2026-10-25, "managing
 * sessions" in Main: asked for circular, so people are round here too, unlike
 * the stream's square tiles). Names ride the title; the row's label stays the title.
 */
export function ParticipantStack({ ids, nameOf, max = 4 }: { ids: string[]; nameOf: (memberId: string) => string; max?: number }) {
    const shown = ids.slice(0, max)
    return <span aria-hidden title={ids.map(nameOf).join(', ')} className="flex shrink-0 items-center -space-x-1.5">
        {shown.map((id) => <MemberAvatar key={id} id={id} name={nameOf(id)} size="md" className="rounded-full ring-2 ring-background" />)}
        {ids.length > max && <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
            +{ids.length - max}
        </span>}
    </span>
}

/**
 * Narrow to threads any of the chosen people are in (2026-11-03: several can
 * be picked, and the menu stays open while picking).
 */
export function ParticipantFilter({ chosen, options, nameOf, onChange }: {
    chosen: string[]
    options: string[]
    nameOf: (memberId: string) => string
    onChange: (ids: string[]) => void
}) {
    const names = new Intl.ListFormat('en', { type: 'disjunction' }).format(chosen.map(nameOf))
    return <PickFilter chosen={chosen} options={options} onChange={onChange}
        label={chosen.length ? `Participants: ${names}` : 'Filter by participant'}
        summary={chosen.length === 0 ? 'Everyone' : chosen.length === 1 ? nameOf(chosen[0]!) : `${chosen.length} people`}
        everyone="Everyone" everyoneIcon={<Users className="size-3.5" />}
        face={(id) => <MemberAvatar id={id} name={nameOf(id)} size="sm" className="rounded-full" />}
        chosenFaces={<span className="flex items-center -space-x-1">{chosen.slice(0, 3).map((id) => <MemberAvatar key={id} id={id} name={nameOf(id)} size="sm" className="rounded-full ring-2 ring-background" />)}</span>}
        nameOf={nameOf} />
}

/** Narrow to threads in any of the chosen spaces: the cross-space page's extra filter. */
export function SpaceFilter({ chosen, options, nameOf, onChange }: {
    chosen: string[]
    options: string[]
    nameOf: (spaceId: string) => string
    onChange: (ids: string[]) => void
}) {
    const names = new Intl.ListFormat('en', { type: 'disjunction' }).format(chosen.map(nameOf))
    return <PickFilter chosen={chosen} options={options} onChange={onChange}
        label={chosen.length ? `Spaces: ${names}` : 'Filter by space'}
        summary={chosen.length === 0 ? 'All spaces' : chosen.length === 1 ? nameOf(chosen[0]!) : `${chosen.length} spaces`}
        everyone="All spaces" everyoneIcon={<Hash className="size-3.5" />}
        face={() => <Hash className="size-3.5 text-muted-foreground" />}
        chosenFaces={<Hash className="size-3.5" />}
        nameOf={nameOf} />
}

function PickFilter({ chosen, options, onChange, label, summary, everyone, everyoneIcon, face, chosenFaces, nameOf }: {
    chosen: string[]
    options: string[]
    onChange: (ids: string[]) => void
    label: string
    summary: string
    everyone: string
    everyoneIcon: ReactNode
    face: (id: string) => ReactNode
    chosenFaces: ReactNode
    nameOf: (id: string) => string
}) {
    // The menu offers what is on screen, plus a sticky choice the list no longer reaches, so it can be cleared.
    const all = [...new Set([...options, ...chosen])].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id])
    return <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" aria-label={label}
                className={cn('h-8 gap-1.5 px-2.5 text-[13px]', chosen.length ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                {chosen.length ? chosenFaces : everyoneIcon}
                {summary}
                <ChevronDown className="size-3.5 opacity-60" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            <DropdownMenuCheckboxItem checked={chosen.length === 0} onCheckedChange={() => onChange([])}>
                {everyoneIcon}{everyone}
            </DropdownMenuCheckboxItem>
            {all.length > 0 && <DropdownMenuSeparator />}
            {/* The menu stays open so several can be picked in one go. */}
            {all.map((id) => <DropdownMenuCheckboxItem key={id} checked={chosen.includes(id)}
                onCheckedChange={() => toggle(id)} onSelect={(event) => event.preventDefault()}>
                {face(id)}{nameOf(id)}
            </DropdownMenuCheckboxItem>)}
        </DropdownMenuContent>
    </DropdownMenu>
}

/** A thread's participants: the root's author, then everyone who replied, in first-reply order. */
export function participantsOf(root: spaces.Message | undefined, replyAuthors: (root: spaces.Message) => readonly string[] = (r) => r.replyAuthors): string[] {
    if (!root) return []
    return [...new Set([root.author.memberId, ...replyAuthors(root)])]
}
