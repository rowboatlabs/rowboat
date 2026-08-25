import { useState } from 'react'
import { Bot, ChevronRight, Link as LinkIcon, Loader2, MessageSquare, MoreHorizontal, SmilePlus, Trash2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub,
    ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MemberAvatar } from '@/components/spaces/atoms'
import { SpaceMarkdown } from '@/components/spaces/space-markdown'
import { formatFeedTime } from '@/lib/spaces-presentation'

// One message in a stream (general or a thread). Consecutive messages by the
// same author compact to a time gutter; hover reveals the action bar.

/** The quick palette (Slack's defaults plus the team's usual suspects). */
const REACTION_PALETTE = ['👍', '✅', '👀', '❤️', '🎉', '😂', '🚀', '🙏', '💯', '🔥', '😮', '👎']

function ReactionPicker({ onPick, onOpenChange, children }: {
    onPick: (emoji: string) => void
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(false)
    const setBoth = (next: boolean) => {
        setOpen(next)
        onOpenChange?.(next)
    }
    return (
        <Popover open={open} onOpenChange={setBoth}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-1.5">
                <div className="grid grid-cols-6 gap-0.5">
                    {REACTION_PALETTE.map((emoji) => (
                        <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                                setBoth(false)
                                onPick(emoji)
                            }}
                            className="inline-flex size-7 items-center justify-center rounded-md text-base hover:bg-accent"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}

function joinNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? ''
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** How many reactor avatars the hover card shows before collapsing to +N. */
const REACTOR_AVATAR_CAP = 8

function ReactionChips({ message, memberNames, selfMemberId, onReact, onPickerOpenChange }: {
    message: spaces.Message
    memberNames: Map<string, string>
    selfMemberId?: string
    onReact: (message: spaces.Message, emoji: string) => void
    onPickerOpenChange: (open: boolean) => void
}) {
    const groups = message.reactions ?? []
    if (groups.length === 0) return null
    return (
        <div className="mt-1 flex flex-wrap items-center gap-1">
            {groups.map((group) => {
                const mine = !!selfMemberId && group.memberIds.includes(selfMemberId)
                const nameOf = (id: string) => (id === selfMemberId ? 'You' : memberNames.get(id) ?? id)
                return (
                    <HoverCard key={group.emoji} openDelay={250} closeDelay={100}>
                        <HoverCardTrigger asChild>
                            <button
                                type="button"
                                onClick={() => onReact(message, group.emoji)}
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
                                    mine ? 'border-foreground/40 bg-accent' : 'border-border bg-background hover:border-foreground/30',
                                )}
                            >
                                <span className="text-[13px] leading-none">{group.emoji}</span>
                                <span className="text-[11px] font-medium leading-none tabular-nums text-muted-foreground">{group.memberIds.length}</span>
                            </button>
                        </HoverCardTrigger>
                        <HoverCardContent side="top" className="w-auto max-w-60 p-3">
                            <div className="flex flex-col items-center gap-1.5 text-center">
                                <span className="text-2xl leading-none">{group.emoji}</span>
                                <div className="flex flex-wrap items-center justify-center -space-x-1">
                                    {group.memberIds.slice(0, REACTOR_AVATAR_CAP).map((id) => (
                                        <MemberAvatar key={id} id={id} name={nameOf(id)} size="sm" className="ring-2 ring-popover" />
                                    ))}
                                    {group.memberIds.length > REACTOR_AVATAR_CAP && (
                                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-popover">
                                            +{group.memberIds.length - REACTOR_AVATAR_CAP}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs leading-snug text-muted-foreground">
                                    <span className="font-medium text-foreground">{joinNames(group.memberIds.map(nameOf))}</span> reacted with {group.emoji}
                                </p>
                            </div>
                        </HoverCardContent>
                    </HoverCard>
                )
            })}
            <ReactionPicker onPick={(emoji) => onReact(message, emoji)} onOpenChange={onPickerOpenChange}>
                <button
                    type="button"
                    title="Add reaction"
                    className="inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 text-muted-foreground opacity-0 hover:border-foreground/30 hover:text-foreground group-hover/msg:opacity-100 data-[state=open]:opacity-100"
                >
                    <SmilePlus className="size-3.5" />
                </button>
            </ReactionPicker>
        </div>
    )
}

const MESSAGE_PROSE = 'text-sm leading-relaxed [&_p]:my-0.5 [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_ul]:my-1 [&_ol]:my-1'

export interface ThreadRowData {
    topicId: string
    replyCount: number
    lastActivityAt: string
    unreadCount: number
    workingAgents: string[]
    /** The topic's explicit name (renamed by someone), mentions already resolved; null while auto-titled. */
    title?: string | null
}

export function MessageRow({
    message, memberNames, continuation, thread, onOpenThread, onReplyInThread, onAskRowboat, onCopyLink, onReact, onDelete, onRetryFailed, onDiscardFailed, dense, selfMemberId,
}: {
    message: spaces.Message & { pending?: boolean; failed?: boolean }
    memberNames: Map<string, string>
    /** Names the viewer's own agent "Your Rowboat" on thread rows. */
    selfMemberId?: string
    continuation: boolean
    /** Present when a topic was started from this message (general only). */
    thread?: ThreadRowData | null
    onOpenThread?: (topicId: string) => void
    onReplyInThread?: (message: spaces.Message) => void
    onAskRowboat?: (message: spaces.Message) => void
    onCopyLink?: (message: spaces.Message) => void
    /** Toggles the caller's reaction (add when absent, remove when present). */
    onReact?: (message: spaces.Message, emoji: string) => void
    /** Deletes the message — only offered on the viewer's own (the org enforces it too). */
    onDelete?: (message: spaces.Message) => void
    /** A failed optimistic send: try it again / drop the row. */
    onRetryFailed?: (message: spaces.Message) => void
    onDiscardFailed?: (message: spaces.Message) => void
    /** Thread panes use the smaller avatar. */
    dense?: boolean
}) {
    const name = memberNames.get(message.author.memberId) ?? message.author.memberId
    const viaAgent = message.author.actingMode !== 'direct'
    const avatarSize = dense ? 'md' : 'lg'
    const gutter = dense ? 'w-7' : 'w-8'
    // A tombstone renders only its note (and any thread row under it) — no
    // reactions, no hover actions; the deed is done.
    const deleted = !!message.deletedAt
    // Unconfirmed sends (pending or failed) have no server id yet — nothing
    // can act on them either.
    const unconfirmed = !!message.pending || !!message.failed
    const canDelete = !!onDelete && !deleted && !unconfirmed && selfMemberId === message.author.memberId
    const showActions = !deleted && !unconfirmed && !!(onReplyInThread || onAskRowboat || onCopyLink || onReact || canDelete)
    // While the emoji picker or the ⋯ menu is open the hover-revealed chrome
    // must stay put — unmounting it collapses the popper anchor and the menu
    // would jump to the viewport edge.
    const [pickerOpen, setPickerOpen] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)

    const row = (
        <div className={cn('group/msg relative flex items-start gap-2.5 rounded-lg px-2 hover:bg-accent/40', continuation ? 'py-0.5' : 'py-1.5')}>
            {continuation ? (
                <span className={cn('shrink-0 pt-1 text-right text-[10px] leading-5 text-muted-foreground/0 group-hover/msg:text-muted-foreground', gutter)}>
                    {formatFeedTime(message.postedAt).replace(/^Yesterday /, '')}
                </span>
            ) : (
                <MemberAvatar id={message.author.memberId} name={name} size={avatarSize} className="mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
                {!continuation && (
                    <div className="flex items-baseline gap-1.5 text-xs">
                        <span className="font-semibold text-foreground">{name}</span>
                        {viaAgent && (
                            <span className="text-muted-foreground">
                                via {message.author.agentName ?? 'agent'}{message.author.actingMode === 'scheduled' ? ', scheduled' : ''}
                            </span>
                        )}
                        <span className="text-muted-foreground">{formatFeedTime(message.postedAt)}</span>
                    </div>
                )}
                {deleted ? (
                    <div className="text-sm italic leading-relaxed text-muted-foreground">This message was deleted</div>
                ) : (
                    <div className={cn(MESSAGE_PROSE, message.pending && 'opacity-60')}>
                        <SpaceMarkdown body={message.body} />
                    </div>
                )}
                {message.failed && (
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-destructive">
                        <span>Failed to send</span>
                        {onRetryFailed && (
                            <button type="button" onClick={() => onRetryFailed(message)} className="font-medium underline hover:no-underline">
                                Retry
                            </button>
                        )}
                        {onDiscardFailed && (
                            <button type="button" onClick={() => onDiscardFailed(message)} className="underline hover:no-underline">
                                Discard
                            </button>
                        )}
                    </div>
                )}
                {!deleted && !unconfirmed && onReact && (
                    <ReactionChips
                        message={message}
                        memberNames={memberNames}
                        selfMemberId={selfMemberId}
                        onReact={onReact}
                        onPickerOpenChange={setPickerOpen}
                    />
                )}
                {thread && thread.replyCount > 0 && onOpenThread && (
                    <button
                        type="button"
                        onClick={() => onOpenThread(thread.topicId)}
                        className="mt-1.5 inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs hover:border-foreground/30"
                    >
                        <MessageSquare className="size-3 text-muted-foreground" />
                        {thread.title && <span className="max-w-48 truncate font-semibold">{thread.title}</span>}
                        <span className={cn(thread.unreadCount > 0 ? 'font-bold' : 'font-semibold', thread.title && 'font-normal text-muted-foreground')}>
                            {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
                        </span>
                        {thread.unreadCount > 0 && <span className="font-semibold text-orange-600">{thread.unreadCount} new</span>}
                        <span className="text-muted-foreground">{formatFeedTime(thread.lastActivityAt)}</span>
                        {thread.workingAgents.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Bot className="size-3" />
                                {thread.workingAgents.length === 1
                                    ? thread.workingAgents[0] === selfMemberId
                                        ? 'Your Rowboat is working…'
                                        : `${memberNames.get(thread.workingAgents[0]!) ?? thread.workingAgents[0]}’s Rowboat is working…`
                                    : `${thread.workingAgents.length} agents working…`}
                            </span>
                        )}
                        {thread.unreadCount > 0 ? <span className="size-1.5 rounded-full bg-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
                    </button>
                )}
                {thread && thread.replyCount === 0 && thread.workingAgents.length > 0 && onOpenThread && (
                    <button
                        type="button"
                        onClick={() => onOpenThread(thread.topicId)}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                    >
                        <Loader2 className="size-3 animate-spin" /> Rowboat is working on a reply…
                    </button>
                )}
            </div>
            {showActions && (
                <div className={cn('absolute right-2 top-1 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5 shadow-sm', pickerOpen || menuOpen ? 'flex' : 'hidden group-hover/msg:flex')}>
                    {onReact && (
                        <ReactionPicker onPick={(emoji) => onReact(message, emoji)} onOpenChange={setPickerOpen}>
                            <button
                                type="button"
                                title="Add reaction"
                                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <SmilePlus className="size-3.5" />
                            </button>
                        </ReactionPicker>
                    )}
                    {onReplyInThread && (
                        <button
                            type="button"
                            title={thread && thread.replyCount > 0 ? 'Open topic' : 'Reply — starts a topic'}
                            onClick={() => (thread && thread.replyCount > 0 && onOpenThread ? onOpenThread(thread.topicId) : onReplyInThread(message))}
                            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <MessageSquare className="size-3.5" />
                        </button>
                    )}
                    {onAskRowboat && (
                        <button
                            type="button"
                            title="Ask @rowboat about this"
                            onClick={() => onAskRowboat(message)}
                            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <Bot className="size-3.5" />
                        </button>
                    )}
                    {(onCopyLink || canDelete) && (
                        <DropdownMenu onOpenChange={setMenuOpen}>
                            <DropdownMenuTrigger asChild>
                                <button type="button" title="More" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                                    <MoreHorizontal className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {onCopyLink && (
                                    <DropdownMenuItem onClick={() => onCopyLink(message)}>
                                        <LinkIcon className="size-3.5 mr-2" /> Copy link
                                    </DropdownMenuItem>
                                )}
                                {canDelete && (
                                    <DropdownMenuItem variant="destructive" onClick={() => onDelete!(message)}>
                                        <Trash2 className="size-3.5 mr-2" /> Delete message
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            )}
        </div>
    )

    // Right-click mirrors the hover bar. Reactions live behind a submenu on
    // purpose — the menu opens at the cursor, and an inline emoji row right
    // under it kept catching accidental clicks. Tombstones and action-less
    // rows get the plain row.
    if (!showActions) return row
    const hasTopItems = !!(onReact || onReplyInThread || onAskRowboat || onCopyLink)
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {onReact && (
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <SmilePlus className="size-3.5 mr-2" /> Add reaction
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-auto p-1.5">
                            <div className="grid grid-cols-6 gap-0.5">
                                {REACTION_PALETTE.map((emoji) => (
                                    <ContextMenuItem
                                        key={emoji}
                                        onSelect={() => onReact(message, emoji)}
                                        className="size-7 justify-center p-0 text-base"
                                    >
                                        {emoji}
                                    </ContextMenuItem>
                                ))}
                            </div>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                )}
                {onReplyInThread && (
                    <ContextMenuItem
                        onSelect={() => (thread && thread.replyCount > 0 && onOpenThread ? onOpenThread(thread.topicId) : onReplyInThread(message))}
                    >
                        <MessageSquare className="size-3.5 mr-2" /> {thread && thread.replyCount > 0 ? 'Open topic' : 'Reply — starts a topic'}
                    </ContextMenuItem>
                )}
                {onAskRowboat && (
                    <ContextMenuItem onSelect={() => onAskRowboat(message)}>
                        <Bot className="size-3.5 mr-2" /> Ask @rowboat about this
                    </ContextMenuItem>
                )}
                {onCopyLink && (
                    <ContextMenuItem onSelect={() => onCopyLink(message)}>
                        <LinkIcon className="size-3.5 mr-2" /> Copy link
                    </ContextMenuItem>
                )}
                {canDelete && (
                    <>
                        {hasTopItems && <ContextMenuSeparator />}
                        <ContextMenuItem variant="destructive" onSelect={() => onDelete!(message)}>
                            <Trash2 className="size-3.5 mr-2" /> Delete message
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    )
}

export function DayDivider({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-2.5 px-2 py-1.5">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            <span className="h-px flex-1 bg-border" />
        </div>
    )
}

export function NewDivider() {
    return (
        <div className="flex items-center gap-2.5 px-2 py-1">
            <span className="h-px flex-1 bg-orange-500" />
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-orange-600">New</span>
        </div>
    )
}

export function TypingIndicator({ names }: { names: string[] }) {
    if (names.length === 0) return null
    const label = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `${names.length} people are typing…`
    return (
        <div className="flex items-center gap-1.5 px-2 pl-12 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
                <span className="size-1 rounded-full bg-muted-foreground/70 animate-pulse" />
                <span className="size-1 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:150ms]" />
                <span className="size-1 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:300ms]" />
            </span>
            {label}
        </div>
    )
}
