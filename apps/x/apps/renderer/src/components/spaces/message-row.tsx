import { Streamdown } from 'streamdown'
import { Bot, ChevronRight, Link as LinkIcon, Loader2, MessageSquare, MoreHorizontal } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MemberAvatar } from '@/components/spaces/atoms'
import { formatFeedTime } from '@/lib/spaces-presentation'

// One message in a stream (general or a thread). Consecutive messages by the
// same author compact to a time gutter; hover reveals the action bar.

const MESSAGE_PROSE = 'text-sm leading-relaxed [&_p]:my-0.5 [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_ul]:my-1 [&_ol]:my-1'

export interface ThreadRowData {
    topicId: string
    replyCount: number
    lastActivityAt: string
    unreadCount: number
    workingAgents: string[]
}

export function MessageRow({
    message, memberNames, continuation, thread, onOpenThread, onReplyInThread, onAskRowboat, onCopyLink, dense, selfMemberId,
}: {
    message: spaces.Message
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
    /** Thread panes use the smaller avatar. */
    dense?: boolean
}) {
    const name = memberNames.get(message.author.memberId) ?? message.author.memberId
    const viaAgent = message.author.actingMode !== 'direct'
    const avatarSize = dense ? 'md' : 'lg'
    const gutter = dense ? 'w-7' : 'w-8'
    const showActions = !!(onReplyInThread || onAskRowboat || onCopyLink)

    return (
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
                <div className={MESSAGE_PROSE}>
                    <Streamdown>{message.body}</Streamdown>
                </div>
                {thread && thread.replyCount > 0 && onOpenThread && (
                    <button
                        type="button"
                        onClick={() => onOpenThread(thread.topicId)}
                        className="mt-1.5 inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs hover:border-foreground/30"
                    >
                        <MessageSquare className="size-3 text-muted-foreground" />
                        <span className={cn(thread.unreadCount > 0 ? 'font-bold' : 'font-semibold')}>
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
                <div className="absolute right-2 top-1 hidden items-center gap-0.5 rounded-lg border border-border bg-background p-0.5 shadow-sm group-hover/msg:flex">
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
                    {onCopyLink && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button type="button" title="More" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                                    <MoreHorizontal className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onCopyLink(message)}>
                                    <LinkIcon className="size-3.5 mr-2" /> Copy link
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            )}
        </div>
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
