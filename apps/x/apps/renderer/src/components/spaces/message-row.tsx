import { memo, useState } from 'react'
import { Bot, ChevronRight, Copy, Link as LinkIcon, Loader2, MessageSquare, MoreHorizontal, Pencil, SmilePlus, Trash2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { MemberAvatar } from '@/components/spaces/atoms'
import { MessageLinkPreview } from '@/components/spaces/link-preview-card'
import { SpaceMarkdown } from '@/components/spaces/space-markdown'
import { formatFeedTime, formatFullTimestamp, resolveMentions } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

// One message in a stream (general or a thread). Consecutive messages by the
// same author compact to a time gutter; hover reveals the action bar.

/** The quick palette (the common defaults plus the team's usual suspects). */
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
                            className="inline-flex size-7 items-center justify-center rounded-md text-base transition-transform duration-100 hover:bg-accent hover:scale-125 active:scale-95"
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
                            {/* The chip zooms in when the group appears; the emoji
                                re-pops (keyed remount) every time the count moves. */}
                            <button
                                type="button"
                                onClick={() => onReact(message, group.emoji)}
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition-all duration-150 animate-in fade-in-0 zoom-in-50 active:scale-90',
                                    mine ? 'border-[var(--stream-link)] bg-[var(--stream-mention-wash)]' : 'border-border bg-background hover:border-foreground/30',
                                )}
                            >
                                <span key={group.memberIds.length} className="text-[13px] leading-none animate-in zoom-in-50 duration-300">{group.emoji}</span>
                                <span className={cn('text-[11px] font-medium leading-none tabular-nums', mine ? 'text-[var(--stream-link)]' : 'text-muted-foreground')}>{group.memberIds.length}</span>
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

const MESSAGE_PROSE = 'text-[15px] leading-[22px] [&_p]:my-0.5 [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_ul]:my-1 [&_ol]:my-1'

export interface ThreadRowData {
    /** The thread's identity: its root message id (the row's own message). */
    rootMessageId: string
    /** The topic annotation's archived flag (false when the thread is plain). */
    archived: boolean
    replyCount: number
    lastActivityAt: string
    unreadCount: number
    workingAgents: string[]
    /** The topic annotation's stated goal, mentions already resolved; null = a plain thread. */
    title?: string | null
}

function MessageRowImpl({
    message, memberNames, continuation, thread, onOpenThread, onReplyInThread, onAskRowboat, onCopyLink, onReact, onDelete, onEdit, onRetryFailed, onDiscardFailed, dense, selfMemberId,
}: {
    message: spaces.Message & { pending?: boolean; failed?: boolean }
    memberNames: Map<string, string>
    /** Names the viewer's own agent "Your Rowboat" on thread rows. */
    selfMemberId?: string
    continuation: boolean
    /** Present when a thread hangs under this message (stream only). */
    thread?: ThreadRowData | null
    onOpenThread?: (rootMessageId: string) => void
    onReplyInThread?: (message: spaces.Message) => void
    onAskRowboat?: (message: spaces.Message) => void
    onCopyLink?: (message: spaces.Message) => void
    /** Toggles the caller's reaction (add when absent, remove when present). */
    onReact?: (message: spaces.Message, emoji: string) => void
    /** Deletes the message — only offered on the viewer's own (the org enforces it too). */
    onDelete?: (message: spaces.Message) => void
    /** Rewrites the body — only offered on the viewer's own text messages. */
    onEdit?: (message: spaces.Message, body: string) => void
    /** A failed optimistic send: try it again / drop the row. */
    onRetryFailed?: (message: spaces.Message) => void
    onDiscardFailed?: (message: spaces.Message) => void
    /** Thread panes use the smaller avatar. */
    dense?: boolean
}) {
    const name = memberNames.get(message.author.memberId) ?? message.author.memberId
    const viaAgent = message.author.actingMode !== 'direct'
    const avatarSize = dense ? 'md' : 'xl'
    const gutter = dense ? 'w-7' : 'w-9'
    // A tombstone renders only its note (and any thread row under it) — no
    // reactions, no hover actions; the deed is done.
    const deleted = !!message.deletedAt
    // Unconfirmed sends (pending or failed) have no server id yet — nothing
    // can act on them either.
    const unconfirmed = !!message.pending || !!message.failed
    const canDelete = !!onDelete && !deleted && !unconfirmed && selfMemberId === message.author.memberId
    const canEdit = !!onEdit && !deleted && !unconfirmed && selfMemberId === message.author.memberId
    // The inline editor: null = not editing; a string = the draft body.
    const [editDraft, setEditDraft] = useState<string | null>(null)
    const commitEdit = () => {
        const text = (editDraft ?? '').trim()
        setEditDraft(null)
        if (text && text !== message.body) onEdit!(message, text)
    }
    const showActions = !deleted && !unconfirmed && !!(onReplyInThread || onAskRowboat || onCopyLink || onReact || canDelete)
    // While the emoji picker or the ⋯ menu is open the hover-revealed chrome
    // must stay put — unmounting it collapses the popper anchor and the menu
    // would jump to the viewport edge.
    const [pickerOpen, setPickerOpen] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)

    // What "Copy message" copies: mentions resolved to names, image embeds
    // dropped — their app:// addresses mean nothing outside the app. Empty
    // (image-only message, tombstone) hides the item.
    const messageText = deleted || unconfirmed ? '' : resolveMentions(message.body, memberNames).replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()
    // The selection as it stood when the context menu opened (opening keeps it).
    const [selectionText, setSelectionText] = useState('')
    const copyToClipboard = (text: string) => {
        void navigator.clipboard.writeText(text).then(
            () => toast('Copied', 'success'),
            () => toast('Could not copy', 'error'),
        )
    }

    const row = (
        <div className={cn('group/msg relative flex items-start gap-3 px-3 hover:bg-accent', continuation ? 'py-0.5' : 'py-1.5')}>
            {continuation ? (
                <span title={formatFullTimestamp(message.postedAt)} className={cn('shrink-0 pt-1 text-right text-[11px] leading-[22px] tabular-nums text-muted-foreground/0 group-hover/msg:text-muted-foreground', gutter)}>
                    {formatFeedTime(message.postedAt).replace(/^Yesterday /, '')}
                </span>
            ) : (
                <MemberAvatar id={message.author.memberId} name={name} size={avatarSize} className="mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
                {!continuation && (
                    <div className="flex items-baseline gap-2 text-xs">
                        <span className="text-[15px] font-extrabold leading-[22px] text-foreground">{name}</span>
                        {viaAgent && (
                            <span className="text-muted-foreground">
                                via {message.author.agentName ?? 'agent'}{message.author.actingMode === 'scheduled' ? ', scheduled' : ''}
                            </span>
                        )}
                        <span title={formatFullTimestamp(message.postedAt)} className="text-muted-foreground">{formatFeedTime(message.postedAt)}</span>
                    </div>
                )}
                {editDraft !== null ? (
                    <div className="mt-1">
                        <Textarea
                            autoFocus
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    commitEdit()
                                } else if (e.key === 'Escape') {
                                    setEditDraft(null)
                                }
                            }}
                            className="min-h-16 text-sm"
                        />
                        <div className="mt-1 flex items-center gap-2 text-xs">
                            <button type="button" onClick={commitEdit} className="rounded-md bg-foreground px-2 py-0.5 font-medium text-background hover:opacity-90">Save</button>
                            <button type="button" onClick={() => setEditDraft(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                            <span className="text-muted-foreground/70">Enter to save · Esc to cancel</span>
                        </div>
                    </div>
                ) : deleted ? (
                    <div className="text-sm italic leading-relaxed text-muted-foreground">This message was deleted</div>
                ) : (
                    <div className={cn(MESSAGE_PROSE, message.pending && 'opacity-60')}>
                        <SpaceMarkdown body={message.body} />
                        {message.editedAt && (
                            <span title={formatFullTimestamp(message.editedAt)} className="text-[10.5px] text-muted-foreground/70">(edited)</span>
                        )}
                        <MessageLinkPreview body={message.body} />
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
                    // A full-width row, not a snug chip: opening the thread is
                    // the most common follow-up and deserves a target the size
                    // of the message itself.
                    <button
                        type="button"
                        onClick={() => onOpenThread(thread.rootMessageId)}
                        className={cn(
                            'group/thread mt-1.5 flex w-full max-w-2xl items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left text-xs transition-colors hover:border-border hover:bg-[var(--rowboat-raised)]',
                            thread.archived && 'opacity-60',
                        )}
                    >
                        <MessageSquare className="size-3 text-muted-foreground" />
                        {thread.title && <span className="max-w-48 truncate font-semibold">{thread.title}</span>}
                        <span className={cn('font-bold text-[var(--stream-link)]', thread.title && 'font-normal text-muted-foreground')}>
                            {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
                        </span>
                        {thread.unreadCount > 0 && <span className="font-semibold text-[var(--rowboat-attention)]">{thread.unreadCount} new</span>}
                        <span title={formatFullTimestamp(thread.lastActivityAt)} className="text-muted-foreground">{formatFeedTime(thread.lastActivityAt)}</span>
                        {thread.archived && <span className="text-muted-foreground">archived</span>}
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
                        <span className="flex-1" />
                        {thread.unreadCount > 0 ? (
                            <span className="size-1.5 rounded-full bg-foreground" />
                        ) : (
                            <ChevronRight className="size-3 text-muted-foreground transition-transform group-hover/thread:translate-x-0.5" />
                        )}
                    </button>
                )}
                {thread && thread.replyCount === 0 && thread.workingAgents.length > 0 && onOpenThread && (
                    <button
                        type="button"
                        onClick={() => onOpenThread(thread.rootMessageId)}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                    >
                        <Loader2 className="size-3 animate-spin" /> Rowboat is working on a reply…
                    </button>
                )}
            </div>
            {showActions && (
                <div className={cn('absolute -top-3.5 right-3 items-center gap-0.5 rounded-lg border border-border bg-[var(--rowboat-raised)] p-0.5 shadow-[var(--rowboat-shadow-soft)]', pickerOpen || menuOpen ? 'flex' : 'hidden group-hover/msg:flex')}>
                    {onReact && (
                        <ReactionPicker onPick={(emoji) => onReact(message, emoji)} onOpenChange={setPickerOpen}>
                            <button
                                type="button"
                                title="Add reaction"
                                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <SmilePlus className="size-3.5" />
                            </button>
                        </ReactionPicker>
                    )}
                    {onReplyInThread && (
                        // Labelled, not icon-only: replying is THE core action
                        // and a bare glyph made people hunt for it.
                        <button
                            type="button"
                            title={thread && thread.replyCount > 0 ? 'Open thread' : 'Reply in thread'}
                            onClick={() => (thread && thread.replyCount > 0 && onOpenThread ? onOpenThread(thread.rootMessageId) : onReplyInThread(message))}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <MessageSquare className="size-3.5" />
                            {thread && thread.replyCount > 0 ? 'Open' : 'Reply'}
                        </button>
                    )}
                    {onAskRowboat && (
                        <button
                            type="button"
                            title="Ask @rowboat about this"
                            onClick={() => onAskRowboat(message)}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <Bot className="size-3.5" />
                        </button>
                    )}
                    {(onCopyLink || canDelete || canEdit) && (
                        <DropdownMenu onOpenChange={setMenuOpen}>
                            <DropdownMenuTrigger asChild>
                                <button type="button" title="More" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                                    <MoreHorizontal className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {canEdit && (
                                    <DropdownMenuItem onClick={() => setEditDraft(message.body)}>
                                        <Pencil className="size-3.5 mr-2" /> Edit message
                                    </DropdownMenuItem>
                                )}
                                {messageText && (
                                    <DropdownMenuItem onClick={() => copyToClipboard(messageText)}>
                                        <Copy className="size-3.5 mr-2" /> Copy message
                                    </DropdownMenuItem>
                                )}
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
    const hasTopItems = !!(onReact || onReplyInThread || onAskRowboat || onCopyLink || messageText)
    return (
        <ContextMenu onOpenChange={(open) => { if (open) setSelectionText(window.getSelection()?.toString().trim() ?? '') }}>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {selectionText && (
                    <ContextMenuItem onSelect={() => copyToClipboard(selectionText)}>
                        <Copy className="size-3.5 mr-2" /> Copy
                    </ContextMenuItem>
                )}
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
                        onSelect={() => (thread && thread.replyCount > 0 && onOpenThread ? onOpenThread(thread.rootMessageId) : onReplyInThread(message))}
                    >
                        <MessageSquare className="size-3.5 mr-2" /> {thread && thread.replyCount > 0 ? 'Open thread' : 'Reply in thread'}
                    </ContextMenuItem>
                )}
                {onAskRowboat && (
                    <ContextMenuItem onSelect={() => onAskRowboat(message)}>
                        <Bot className="size-3.5 mr-2" /> Ask @rowboat about this
                    </ContextMenuItem>
                )}
                {canEdit && (
                    <ContextMenuItem onSelect={() => setEditDraft(message.body)}>
                        <Pencil className="size-3.5 mr-2" /> Edit message
                    </ContextMenuItem>
                )}
                {messageText && (
                    <ContextMenuItem onSelect={() => copyToClipboard(messageText)}>
                        <Copy className="size-3.5 mr-2" /> Copy message
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

type MessageRowProps = Parameters<typeof MessageRowImpl>[0]

function threadRowEqual(a: ThreadRowData | null | undefined, b: ThreadRowData | null | undefined): boolean {
    if (!a || !b) return !a === !b
    return (
        a.rootMessageId === b.rootMessageId &&
        a.archived === b.archived &&
        a.replyCount === b.replyCount &&
        a.lastActivityAt === b.lastActivityAt &&
        a.unreadCount === b.unreadCount &&
        a.title === b.title &&
        a.workingAgents.length === b.workingAgents.length &&
        a.workingAgents.every((id, i) => id === b.workingAgents[i])
    )
}

/**
 * Memoized by DATA, deliberately ignoring the handler props: the stream
 * recreates its closures every render (presence frames, visibility flips),
 * and comparing them would make the memo worthless. Safe because everything
 * a handler reads is either per-pane-stable (org, space) or flows through a
 * compared prop — a thread index change reaches the row as a new `thread`
 * object, which re-renders it with fresh closures.
 */
export const MessageRow = memo(MessageRowImpl, (prev: MessageRowProps, next: MessageRowProps) =>
    prev.message === next.message &&
    prev.continuation === next.continuation &&
    prev.selfMemberId === next.selfMemberId &&
    prev.dense === next.dense &&
    prev.memberNames === next.memberNames &&
    threadRowEqual(prev.thread, next.thread),
)

export function DayDivider({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-2.5 px-2 py-1.5">
            <span className="h-px flex-1 bg-border" />
            <span className="rounded-full border border-border bg-background px-3 py-0.5 text-xs font-bold">{label}</span>
            <span className="h-px flex-1 bg-border" />
        </div>
    )
}

/** The line has been seen: fade over 700ms; the pane drops it after. */
export function NewDivider({ fading = false }: { fading?: boolean }) {
    return (
        <div className={cn('flex items-center gap-2.5 px-2 py-1 transition-opacity duration-700', fading && 'opacity-0')}>
            <span className="h-px flex-1 bg-[var(--rowboat-attention)]" />
            <span className="text-[11px] font-medium text-[var(--rowboat-attention)]">New</span>
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
