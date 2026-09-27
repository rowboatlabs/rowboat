import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, FileText, FolderOpen, Link as LinkIcon, MessageSquare, MessagesSquare } from 'lucide-react'
import { spaces } from '@x/shared'
import { copySpacesLink } from '@/lib/spaces-copy-link'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { UnreadBadge } from '@/components/spaces/unread-badge'
import { prefetchThread } from '@/hooks/use-space-chat'
import { streamBadge, threadBadge, useReadStateVersion, type SpaceBadge } from '@/lib/spaces-read-state'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import type { RailSelection } from '@/lib/spaces-selection'
import { cn } from '@/lib/utils'

const RECENT_LIMIT = 6
const OPEN_DELAY = 110
const CLOSE_DELAY = 240

/** The click destination and the hover preview deliberately have separate handlers. */
function ContentMenu({ label, icon, selected, badge, direct = false, onNavigate, children }: {
    label: string
    icon: ReactNode
    selected: boolean
    badge: SpaceBadge
    direct?: boolean
    onNavigate: () => void
    children: (close: () => void) => ReactNode
}) {
    const [open, setOpen] = useState(false)
    const trigger = useRef<HTMLButtonElement>(null)
    const content = useRef<HTMLDivElement>(null)
    const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const keyboardOpen = useRef(false)
    const cancelTimers = () => {
        clearTimeout(openTimer.current)
        clearTimeout(closeTimer.current)
    }
    useEffect(() => () => {
        clearTimeout(openTimer.current)
        clearTimeout(closeTimer.current)
    }, [])
    const close = () => { cancelTimers(); setOpen(false) }
    const scheduleClose = () => {
        cancelTimers()
        closeTimer.current = setTimeout(() => {
            if (!content.current?.contains(document.activeElement)) setOpen(false)
        }, CLOSE_DELAY)
    }
    return <Popover open={open} onOpenChange={(next) => { cancelTimers(); setOpen(next) }}>
        <PopoverAnchor asChild>
            <button ref={trigger} type="button" className={cn('spaces-content-tab', selected && 'is-selected')}
                aria-current={selected ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={open}
                onPointerEnter={(event) => {
                    if (event.pointerType !== 'mouse') return
                    cancelTimers()
                    keyboardOpen.current = false
                    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY)
                }}
                onPointerLeave={scheduleClose}
                onClick={() => { close(); onNavigate() }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        cancelTimers()
                        keyboardOpen.current = true
                        if (open) content.current?.querySelector<HTMLButtonElement>('button')?.focus()
                        else setOpen(true)
                    } else if (event.key === 'Escape') close()
                }}>
                {icon}<span>{label}</span>{' '}<UnreadBadge badge={badge} direct={direct} /><ChevronDown className="size-3 text-muted-foreground" />
            </button>
        </PopoverAnchor>
        <PopoverContent ref={content} align="start" sideOffset={4} aria-label={`Recent ${label.toLowerCase()}`}
            className="spaces-content-menu w-80 max-w-[calc(100vw-24px)] max-h-[min(440px,var(--radix-popover-content-available-height))] overflow-y-auto rounded-md border border-border p-1.5"
            onPointerEnter={() => clearTimeout(closeTimer.current)} onPointerLeave={scheduleClose}
            onOpenAutoFocus={(event) => {
                event.preventDefault()
                if (keyboardOpen.current) content.current?.querySelector<HTMLButtonElement>('button')?.focus()
            }}
            onCloseAutoFocus={(event) => { event.preventDefault() }}
            onEscapeKeyDown={() => { cancelTimers(); trigger.current?.focus() }}
            onFocusOutside={close}>
            {children(() => setOpen(false))}
        </PopoverContent>
    </Popover>
}

export function SpaceContentTabs({ orgId, orgAddress, spaceId, direct, topics, entries, unreadAssetIds, selection,
    memberNames, spaceNames, onSelect, topicsLoaded, filesLoaded, filesError,
}: {
    orgId: string
    orgAddress: string
    spaceId: string
    direct: boolean
    topics: spaces.TopicListing[]
    entries: spaces.SpacesAssetEntry[]
    unreadAssetIds: ReadonlySet<string>
    selection: RailSelection
    memberNames: ReadonlyMap<string, string>
    spaceNames: ReadonlyMap<string, string>
    onSelect: (selection: RailSelection) => void
    topicsLoaded: boolean
    filesLoaded: boolean
    filesError: string | null
}) {
    useReadStateVersion()
    const recentTopics = useMemo(() => topics.filter((topic) => !topic.archived)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id)), [topics])
    const recentFiles = useMemo(() => entries.filter((entry) => !entry.state)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path)), [entries])
    const discussionBadge = recentTopics.reduce<SpaceBadge>((sum, topic) => {
        const badge = threadBadge(orgId, spaceId, topic.rootMessageId, direct)
        return { unread: sum.unread + badge.unread, forYou: sum.forYou + badge.forYou }
    }, { unread: 0, forYou: 0 })
    const filesBadge = { unread: recentFiles.filter((entry) => unreadAssetIds.has(entry.id)).length, forYou: 0 }
    const discussionSelected = selection.kind === 'discussions' || selection.kind === 'thread'
    const filesSelected = ['files', 'file', 'whiteboard', 'attachment'].includes(selection.kind)
    return <nav className="spaces-content-tabs" aria-label="Space content">
        <button type="button" className={cn('spaces-content-tab', !discussionSelected && !filesSelected && 'is-selected')}
            aria-current={!discussionSelected && !filesSelected ? 'page' : undefined} onClick={() => onSelect({ kind: 'general' })}>
            <MessageSquare className="size-3.5" /><span>Messages</span>{' '}<UnreadBadge badge={streamBadge(orgId, spaceId, direct)} direct={direct} />
        </button>
        <ContentMenu label="Discussions" icon={<MessagesSquare className="size-3.5" />} selected={discussionSelected}
            badge={discussionBadge} direct={direct} onNavigate={() => onSelect({ kind: 'discussions' })}>
            {(close) => <>
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Recently active</div>
                {recentTopics.slice(0, RECENT_LIMIT).map((topic) => <div key={topic.id} className="flex items-center gap-1">
                    <button type="button" className="spaces-content-menu-row min-w-0 flex-1"
                    title={resolveMentions(topic.title, memberNames, spaceNames)}
                    onMouseEnter={() => prefetchThread(orgId, spaceId, topic.rootMessageId)}
                    onClick={() => { close(); onSelect({ kind: 'thread', rootMessageId: topic.rootMessageId }) }}>
                    <MessagesSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate">{resolveMentions(topic.title, memberNames, spaceNames)}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{topic.rootMessage?.replyCount ?? 0} replies · {formatFeedTime(topic.lastActivityAt)}</span></span>
                    <UnreadBadge badge={threadBadge(orgId, spaceId, topic.rootMessageId, direct)} direct={direct} />
                    </button>
                    <button type="button" title="Copy discussion link" aria-label={`Copy link to ${resolveMentions(topic.title, memberNames, spaceNames)}`}
                        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => void copySpacesLink(spaces.messageUrl(orgAddress, spaceId, topic.rootMessageId))}>
                        <LinkIcon className="size-3.5" />
                    </button>
                </div>)}
                {recentTopics.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{topicsLoaded ? 'No active discussions yet.' : 'Loading discussions…'}</p>}
                <button type="button" className="spaces-content-menu-all" onClick={() => { close(); onSelect({ kind: 'discussions' }) }}>All discussions</button>
            </>}
        </ContentMenu>
        <ContentMenu label="Files" icon={<FolderOpen className="size-3.5" />} selected={filesSelected}
            badge={filesBadge} onNavigate={() => onSelect({ kind: 'files' })}>
            {(close) => <>
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Recently updated</div>
                {recentFiles.slice(0, RECENT_LIMIT).map((entry) => <button key={entry.id} type="button" className="spaces-content-menu-row"
                    onClick={() => { close(); onSelect({ kind: spaces.isWhiteboardPath(entry.path) ? 'whiteboard' : 'file', assetId: entry.id }) }}>
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate" title={entry.path}>{entry.path.split('/').pop()}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{entry.path.includes('/') ? `${entry.path.slice(0, entry.path.lastIndexOf('/'))} · ` : ''}{formatFeedTime(entry.updatedAt)}</span></span>
                    {unreadAssetIds.has(entry.id) && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-label="Unread changes" />}
                </button>)}
                {filesError && <p className="px-2 py-2 text-xs text-destructive">Could not refresh files.</p>}
                {recentFiles.length === 0 && !filesError && <p className="px-2 py-3 text-xs text-muted-foreground">{filesLoaded ? 'No files yet.' : 'Loading files…'}</p>}
                <button type="button" className="spaces-content-menu-all" onClick={() => { close(); onSelect({ kind: 'files' }) }}>All files</button>
            </>}
        </ContentMenu>
    </nav>
}
