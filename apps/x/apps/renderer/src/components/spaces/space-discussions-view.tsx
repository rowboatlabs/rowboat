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
    useReadStateVersion()
    const [archived, setArchived] = useState(false)
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const rows = useMemo(() => topics.filter((topic) => !!topic.archived === archived)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id)), [topics, archived])
    const manage = async (id: string, action: spaces.SpacesManageTopicAction) => {
        setPending(id)
        try {
            await window.ipc.invoke('spaces:manageTopic', { orgId, spaceId, topicId: id, action })
            setRenaming(null)
            await refreshSpaceFeed(orgId, spaceId)
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not update the discussion', 'error')
        } finally { setPending(null) }
    }
    return <section aria-label="All discussions" className="flex min-h-0 flex-1 flex-col">
        <div className="spaces-pane-header flex shrink-0 items-center gap-3 border-b border-border">
            <h2 className="flex-1 text-[13px] font-semibold">All discussions</h2>
            <button type="button" aria-pressed={!archived} className="spaces-collection-filter" onClick={() => setArchived(false)}>Active</button>
            <button type="button" aria-pressed={archived} className="spaces-collection-filter" onClick={() => setArchived(true)}>Archived</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {rows.map((topic) => {
                const title = resolveMentions(topic.title, memberNames, spaceNames)
                const badge = threadBadge(orgId, spaceId, topic.rootMessageId, direct)
                const copyLink = () => void copySpacesLink(messageUrl(orgAddress, spaceId, topic.rootMessageId))
                return <ContextMenu key={topic.id}>
                    <ContextMenuTrigger asChild>
                        <div className="group flex items-center gap-2 border-b border-border/60 py-1">
                            {renaming?.id === topic.id ? <form className="flex min-w-0 flex-1 gap-2 py-2" onSubmit={(event) => {
                                event.preventDefault()
                                if (renaming.title.trim()) void manage(topic.id, { action: 'retitle', title: renaming.title.trim() })
                            }}>
                                <input autoFocus aria-label="Discussion title" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                                    value={renaming.title} onChange={(event) => setRenaming({ id: topic.id, title: event.target.value })}
                                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }} />
                                <button type="submit" className="spaces-collection-filter" disabled={pending === topic.id || !renaming.title.trim()}>Save</button>
                                <button type="button" className="spaces-collection-filter" onClick={() => setRenaming(null)}>Cancel</button>
                            </form> : <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded py-3 text-left hover:bg-accent/50"
                                onMouseEnter={() => prefetchThread(orgId, spaceId, topic.rootMessageId)} onClick={() => onOpen(topic.rootMessageId)}>
                                <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1"><span className={`block truncate text-[13px] ${badge.unread > 0 ? 'font-semibold' : ''}`}>{title}</span>{' '}
                                    <span className="mt-1 block text-xs text-muted-foreground">{topic.rootMessage?.replyCount ?? 0} replies · {formatFeedTime(topic.lastActivityAt)}</span></span>
                                {(presence.working.get(topic.rootMessageId)?.length ?? 0) > 0 && <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-label="A Rowboat is working here" />}
                                <UnreadBadge badge={badge} direct={direct} />
                            </button>}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild><button type="button" aria-label={`Options for ${title}`} disabled={pending === topic.id}
                                    className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => setRenaming({ id: topic.id, title })}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void manage(topic.id, { action: archived ? 'unarchive' : 'archive' })}>
                                        {archived ? <ArchiveRestore className="mr-2 size-3.5" /> : <Archive className="mr-2 size-3.5" />}{archived ? 'Unarchive' : 'Archive'}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => void manage(topic.id, { action: 'remove' })}><MessageSquareOff className="mr-2 size-3.5" />Convert back to thread</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onOpen(topic.rootMessageId)}><MessagesSquare className="mr-2 size-3.5" />Open discussion</ContextMenuItem>
                        <ContextMenuItem onSelect={copyLink}><LinkIcon className="mr-2 size-3.5" />Copy link</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            })}
            {rows.length === 0 && <p className="py-8 text-sm text-muted-foreground">{!loaded ? 'Loading discussions…' : archived ? 'No archived discussions.' : 'No active discussions. Turn a message thread into a discussion to give a topic its own place.'}</p>}
        </div>
    </section>
}
