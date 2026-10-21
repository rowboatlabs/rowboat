import { useSpaceAccess } from '@/lib/spaces-access'
import { invokeSpace } from '@/lib/spaces-invoke'
import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Bot, Link as LinkIcon, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil } from 'lucide-react'
import type { spaces } from '@x/shared'
import { messageUrl } from '@x/shared/dist/spaces.js'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { refreshSpaceFeed } from '@/hooks/use-spaces'
import { prefetchThread, type SpacePresence } from '@/hooks/use-space-chat'
import { threadBadge, useReadStateVersion } from '@/lib/spaces-read-state'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterTabs, SpacesEmpty, SpacesPage } from '@/components/spaces/page-shell'

export function SpaceDiscussionsView({ orgId, orgAddress, spaceId, direct, topics, loaded, memberNames, spaceNames, presence, onOpen }: {
    orgId: string
    orgAddress: string
    spaceId: string
    direct: boolean
    topics: spaces.TopicListing[]
    loaded: boolean
    memberNames: ReadonlyMap<string, string>
    spaceNames: ReadonlyMap<string, string>
    presence: SpacePresence
    onOpen: (rootMessageId: string) => void
}) {
    const { writable } = useSpaceAccess()
    useReadStateVersion()
    const [archived, setArchived] = useState(false)
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const rows = useMemo(() => topics.filter((topic) => !!topic.archived === archived)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id)), [topics, archived])
    const manage = async (id: string, action: spaces.SpacesManageTopicAction) => {
        setPending(id)
        try {
            await invokeSpace('spaces:manageTopic', { orgId, spaceId, topicId: id, action })
            setRenaming(null)
            await refreshSpaceFeed(orgId, spaceId)
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not update the discussion', 'error')
        } finally { setPending(null) }
    }
    const activeCount = topics.filter((topic) => !topic.archived).length
    const archivedCount = topics.length - activeCount
    return <SpacesPage label="All discussions" title="Discussions" count={activeCount}
        subtitle="Threads with a title, so the team can find them again."
        toolbar={<FilterTabs label="Show" value={archived ? 'archived' : 'active'} onChange={(value) => setArchived(value === 'archived')}
            options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived', count: archivedCount }]} />}>
        <ul className="flex flex-col gap-0.5">
            {rows.map((topic) => {
                const title = resolveMentions(topic.title, memberNames, spaceNames)
                const badge = threadBadge(orgId, spaceId, topic.rootMessageId, direct)
                const replies = topic.rootMessage?.replyCount ?? 0
                const working = (presence.working.get(topic.rootMessageId)?.length ?? 0) > 0
                const copyLink = () => void copySpacesLink(messageUrl(orgAddress, spaceId, topic.rootMessageId))
                return <li key={topic.id}><ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div className="group relative flex items-center rounded-xl transition-colors hover:bg-accent/60 has-[[data-state=open]]:bg-accent/60">
                            {renaming?.id === topic.id ? <form className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5" onSubmit={(event) => {
                                event.preventDefault()
                                if (renaming.title.trim()) void manage(topic.id, { action: 'retitle', title: renaming.title.trim() })
                            }}>
                                <Input autoFocus aria-label="Discussion title" className="h-9 min-w-0 flex-1 text-sm"
                                    value={renaming.title} onChange={(event) => setRenaming({ id: topic.id, title: event.target.value })}
                                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }} />
                                <Button type="submit" size="sm" disabled={pending === topic.id || !renaming.title.trim()}>Save</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                            </form> : <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 pr-12 text-left"
                                onMouseEnter={() => prefetchThread(orgId, spaceId, topic.rootMessageId)} onClick={() => onOpen(topic.rootMessageId)}>
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    <MessagesSquare className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className={cn('block truncate text-sm', badge.unread > 0 ? 'font-semibold text-foreground' : 'font-medium')}>{title}</span>{' '}
                                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span>{replies} {replies === 1 ? 'reply' : 'replies'} · {formatFeedTime(topic.lastActivityAt)}</span>
                                        {working && <span className="inline-flex items-center gap-1 text-[var(--stream-link)]"><Bot className="size-3.5" aria-hidden /> Rowboat is working</span>}
                                    </span>
                                </span>
                                <UnreadBadge badge={badge} direct={direct} />
                            </button>}
                            {renaming?.id !== topic.id && <DropdownMenu>
                                <DropdownMenuTrigger asChild><button type="button" aria-label={`Options for ${title}`} disabled={pending === topic.id}
                                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled={!writable} onSelect={() => setRenaming({ id: topic.id, title })}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>
                                    <DropdownMenuItem disabled={!writable} onSelect={() => void manage(topic.id, { action: archived ? 'unarchive' : 'archive' })}>
                                        {archived ? <ArchiveRestore className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{archived ? 'Unarchive' : 'Archive'}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem disabled={!writable} onSelect={() => void manage(topic.id, { action: 'remove' })}><MessageSquareOff className="mr-2 size-3.5" />Convert back to thread</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>}
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onOpen(topic.rootMessageId)}><MessagesSquare className="mr-2 size-3.5" />Open discussion</ContextMenuItem>
                        <ContextMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu></li>
            })}
        </ul>
        {rows.length === 0 && (!loaded
            ? <p className="px-3 py-12 text-sm text-muted-foreground">Loading discussions…</p>
            : archived
                ? <SpacesEmpty icon={<Archive />} title="No archived discussions">Archived discussions stay readable here.</SpacesEmpty>
                : <SpacesEmpty icon={<MessagesSquare />} title="No discussions yet">Give a thread a title from its ⋯ menu, or type /discussion in a reply, and it shows up here.</SpacesEmpty>)}
    </SpacesPage>
}
