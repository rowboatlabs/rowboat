import { useState } from 'react'
import { Streamdown } from 'streamdown'
import {
    type ConversationItem,
    type ToolCall,
    isChatMessage,
    isErrorMessage,
    isToolCall,
    getToolDisplayName,
    toToolState,
    normalizeToolOutput,
} from '@/lib/chat-conversation'
import { Tool, ToolHeader, ToolContent, ToolTabbedContent } from '@/components/ai-elements/tool'

/**
 * Compact rendering of a run's conversation log — used by the live-note panel's
 * "Last run" tab and the bg-task sidebar's "Runs history" drill-down. Keep this
 * the single source of truth so the two surfaces stay visually aligned.
 *
 * - User messages: right-aligned secondary bubble, plain text.
 * - Assistant messages: full-width markdown.
 * - Tool calls: collapsible `Tool` row with tabbed input/output.
 * - Errors: destructive-tinted banner.
 */
export function CompactConversation({ items }: { items: ConversationItem[] }) {
    return (
        <div className="flex flex-col gap-2.5">
            {items.map((item) => {
                if (isErrorMessage(item)) {
                    return (
                        <div key={item.id} className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {item.message}
                        </div>
                    )
                }
                if (isToolCall(item)) return <CompactToolRow key={item.id} tool={item} />
                if (isChatMessage(item)) {
                    const isUser = item.role === 'user'
                    return (
                        <div key={item.id} className={isUser ? 'flex justify-end' : ''}>
                            <div className={isUser
                                ? 'max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words'
                                : 'w-full text-xs text-foreground'}>
                                {isUser ? (
                                    item.content
                                ) : (
                                    <Streamdown className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px]">
                                        {item.content}
                                    </Streamdown>
                                )}
                            </div>
                        </div>
                    )
                }
                return null
            })}
        </div>
    )
}

function CompactToolRow({ tool }: { tool: ToolCall }) {
    const [open, setOpen] = useState(false)
    const title = getToolDisplayName(tool)
    const state = toToolState(tool.status)
    const errorText = tool.status === 'error' && typeof tool.result === 'string' ? tool.result : undefined
    return (
        <Tool open={open} onOpenChange={setOpen} className="mb-0 text-xs">
            <ToolHeader title={title} type={`tool-${tool.name}` as `tool-${string}`} state={state} />
            <ToolContent>
                <ToolTabbedContent
                    input={tool.input}
                    output={normalizeToolOutput(tool.result, tool.status) ?? undefined}
                    errorText={errorText}
                />
            </ToolContent>
        </Tool>
    )
}
