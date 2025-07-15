'use client';
import { Spinner } from "@heroui/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { z } from "zod";
import { Workflow} from "@/app/lib/types/workflow_types";
import MarkdownContent from "@/app/lib/components/markdown-content";
import { MessageSquareIcon, EllipsisIcon, XIcon, CheckCheckIcon, ChevronDown, ChevronUp } from "lucide-react";
import { CopilotMessage, CopilotAssistantMessage, CopilotAssistantMessageActionPart } from "@/app/lib/types/copilot_types";
import { Action, StreamingAction } from './actions';
import { useParsedBlocks } from "../use-parsed-blocks";
import { validateConfigChanges } from "@/app/lib/client_utils";
import { PreviewModalProvider } from '../../workflow/preview-modal';

const CopilotResponsePart = z.union([
    z.object({
        type: z.literal('text'),
        content: z.string(),
    }),
    z.object({
        type: z.literal('streaming_action'),
        action: CopilotAssistantMessageActionPart.shape.content.partial(),
    }),
    z.object({
        type: z.literal('action'),
        action: CopilotAssistantMessageActionPart.shape.content,
    }),
]);

function enrich(response: string): z.infer<typeof CopilotResponsePart> {
    // If it's not a code block, return as text
    if (!response.trim().startsWith('//')) {
        return {
            type: 'text',
            content: response
        };
    }

    // Parse the metadata from comments
    const lines = response.trim().split('\n');
    const metadata: Record<string, string> = {};
    let jsonStartIndex = 0;

    // Parse metadata from comment lines
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('//')) {
            jsonStartIndex = i;
            break;
        }
        const [key, value] = line.substring(2).trim().split(':').map(s => s.trim());
        if (key && value) {
            metadata[key] = value;
        }
    }

    // Try to parse the JSON part
    try {
        const jsonContent = lines.slice(jsonStartIndex).join('\n');
        const jsonData = JSON.parse(jsonContent);

        // If we have all required metadata, validate the config changes
        if (metadata.action && metadata.config_type && metadata.name) {
            const result = validateConfigChanges(
                metadata.config_type,
                jsonData.config_changes || {},
                metadata.name
            );

            if ('error' in result) {
                return {
                    type: 'action',
                    action: {
                        action: metadata.action as 'create_new' | 'edit',
                        config_type: metadata.config_type as 'tool' | 'agent' | 'prompt',
                        name: metadata.name,
                        change_description: jsonData.change_description || '',
                        config_changes: {},
                        error: result.error
                    }
                };
            }

            return {
                type: 'action',
                action: {
                    action: metadata.action as 'create_new' | 'edit',
                    config_type: metadata.config_type as 'tool' | 'agent' | 'prompt',
                    name: metadata.name,
                    change_description: jsonData.change_description || '',
                    config_changes: result.changes
                }
            };
        }
    } catch (e) {
        // JSON parsing failed - this is likely a streaming block
    }

    // Return as streaming action with whatever metadata we have
    return {
        type: 'streaming_action',
        action: {
            action: (metadata.action as 'create_new' | 'edit') || undefined,
            config_type: (metadata.config_type as 'tool' | 'agent' | 'prompt') || undefined,
            name: metadata.name
        }
    };
}

function UserMessage({ content }: { content: string }) {
    return (
        <div className="w-full">
            <div className="bg-blue-50 dark:bg-[#1e2023] px-4 py-2.5 
                rounded-lg text-sm leading-relaxed
                text-gray-700 dark:text-gray-200 
                border border-blue-100 dark:border-[#2a2d31]
                shadow-sm animate-[slideUpAndFade_150ms_ease-out]">
                <div className="text-left">
                    <MarkdownContent content={content} />
                </div>
            </div>
        </div>
    );
}

function InternalAssistantMessage({ content }: { content: string }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="w-full">
            {!expanded ? (
                <button className="flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 gap-1 group"
                    onClick={() => setExpanded(true)}>
                    <MessageSquareIcon size={16} />
                    <EllipsisIcon size={16} />
                    <span className="text-xs">Show debug message</span>
                </button>
            ) : (
                <div className="w-full">
                    <div className="border border-gray-200 dark:border-gray-700 border-dashed 
                        px-4 py-2.5 rounded-lg text-sm
                        text-gray-700 dark:text-gray-200 shadow-sm">
                        <div className="flex justify-end mb-2">
                            <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                onClick={() => setExpanded(false)}>
                                <XIcon size={16} />
                            </button>
                        </div>
                        <pre className="whitespace-pre-wrap">{content}</pre>
                    </div>
                </div>
            )}
        </div>
    );
}

type ActionPanelBlock = {
  part: {
    type: 'action';
    action: any;
  } | {
    type: 'streaming_action';
    action: any;
  };
  actionIndex: number;
};

/**
 * AssistantMessage component that renders copilot responses with action cards.
 * 
 * Features:
 * - Renders text content with markdown support
 * - Displays individual action cards for workflow changes
 * - Shows "Apply All" button when there are action cards
 * - Supports streaming responses with real-time apply all functionality
 * - Action cards are in a collapsible panel with a ticker summary in collapsed state
 */
function AssistantMessage({
    content,
    workflow,
    dispatch,
    messageIndex,
    loading,
    onStatusBarChange
}: {
    content: z.infer<typeof CopilotAssistantMessage>['content'],
    workflow: z.infer<typeof Workflow>,
    dispatch: (action: any) => void,
    messageIndex: number,
    loading: boolean,
    onStatusBarChange?: (status: any) => void
}) {
    const blocks = useParsedBlocks(content);
    const [appliedActions, setAppliedActions] = useState<Set<number>>(new Set());
    // Remove autoApplyEnabled and useEffect for auto-apply

    // parse actions from parts
    let parsed: z.infer<typeof CopilotResponsePart>[] = [];
    for (const block of blocks) {
        if (block.type === 'text') {
            parsed.push({
                type: 'text',
                content: block.content,
            });
        } else {
            parsed.push(enrich(block.content));
        }
    }

    // Only render text outside the panel
    const textBlocks = parsed.filter(part => part.type === 'text');
    // All cards (action and streaming_action) go inside the panel
    const cardBlocks: ActionPanelBlock[] = parsed
  .map((part, actionIndex) => ({ part, actionIndex }))
  .filter(({ part }) => part.type === 'action' || part.type === 'streaming_action') as ActionPanelBlock[];
    const hasCards = cardBlocks.length > 0;
    const totalActions = cardBlocks.filter(({ part }) => part.type === 'action').length;
    const appliedCount = Array.from(appliedActions).length;
    const pendingCount = Math.max(0, totalActions - appliedCount);
    const allApplied = pendingCount === 0 && totalActions > 0;

    // Memoized applyAction for useCallback dependencies
    const applyAction = useCallback((action: any, actionIndex: number) => {
        // Only apply, do not update appliedActions here
        if (action.action === 'create_new') {
            switch (action.config_type) {
                case 'agent':
                    dispatch({
                        type: 'add_agent',
                        agent: {
                            name: action.name,
                            ...action.config_changes
                        }
                    });
                    break;
                case 'tool':
                    dispatch({
                        type: 'add_tool',
                        tool: {
                            name: action.name,
                            ...action.config_changes
                        }
                    });
                    break;
                case 'prompt':
                    dispatch({
                        type: 'add_prompt',
                        prompt: {
                            name: action.name,
                            ...action.config_changes
                        }
                    });
                    break;
            }
        } else if (action.action === 'edit') {
            switch (action.config_type) {
                case 'agent':
                    dispatch({
                        type: 'update_agent',
                        name: action.name,
                        agent: action.config_changes
                    });
                    break;
                case 'tool':
                    dispatch({
                        type: 'update_tool',
                        name: action.name,
                        tool: action.config_changes
                    });
                    break;
                case 'prompt':
                    dispatch({
                        type: 'update_prompt',
                        name: action.name,
                        prompt: action.config_changes
                    });
                    break;
            }
        }
    }, [dispatch]);

    // Memoized handleApplyAll for useEffect dependencies
    const handleApplyAll = useCallback(() => {
        // Find all unapplied action indices
        const unapplied = cardBlocks
            .filter(({ part, actionIndex }) => part.type === 'action' && !appliedActions.has(actionIndex))
            .map(({ part, actionIndex }) => ({ action: part.action, actionIndex }));

        // Synchronously apply all unapplied actions
        unapplied.forEach(({ action, actionIndex }) => {
            applyAction(action, actionIndex);
        });

        // After all are applied, update the state in one go
        setAppliedActions(prev => {
            const next = new Set(prev);
            unapplied.forEach(({ actionIndex }) => next.add(actionIndex));
            return next;
        });
    }, [cardBlocks, appliedActions, setAppliedActions, applyAction]);

    // Manual single apply (from card)
    const handleSingleApply = (action: any, actionIndex: number) => {
        if (!appliedActions.has(actionIndex)) {
            applyAction(action, actionIndex);
            setAppliedActions(prev => new Set([...prev, actionIndex]));
        }
    };

    useEffect(() => {
        if (loading) {
            // setAutoApplyEnabled(false); // Removed
            setAppliedActions(new Set());
            // setPanelOpen(false); // Removed
        }
    }, [loading]);

    // Removed useEffect for auto-apply

    // Find streaming/ongoing card and extract name
    const streamingBlock = cardBlocks.find(({ part }) => part.type === 'streaming_action');
    let streamingLine = '';
    if (streamingBlock && streamingBlock.part.type === 'streaming_action' && streamingBlock.part.action && streamingBlock.part.action.name) {
        streamingLine = `Generating ${streamingBlock.part.action.name}...`;
    }

    // Find the first card index
    const firstCardIdx = parsed.findIndex(part => part.type === 'action' || part.type === 'streaming_action');
    // Group blocks into: beforePanel, cardBlocks, afterPanel
    const beforePanel = firstCardIdx === -1 ? parsed : parsed.slice(0, firstCardIdx);
    const panelBlocks = firstCardIdx === -1 ? [] : parsed.slice(firstCardIdx).filter(part => part.type === 'action' || part.type === 'streaming_action');
    // Find where the card blocks end (first non-card after first card)
    let afterPanelStart = firstCardIdx;
    if (firstCardIdx !== -1) {
        for (let i = firstCardIdx; i < parsed.length; i++) {
            if (parsed[i].type !== 'action' && parsed[i].type !== 'streaming_action') {
                afterPanelStart = i;
                break;
            }
        }
    }
    const afterPanel = (firstCardIdx !== -1 && afterPanelStart > firstCardIdx) ? parsed.slice(afterPanelStart) : [];

    // Only show Apply All button if all cards are loaded (no streaming_action cards) and streaming is finished
    const allCardsLoaded = !loading && panelBlocks.length > 0 && panelBlocks.every(part => part.type === 'action');
    // When all cards are loaded, show summary of agents created/updated
    let completedSummary = '';
    if (allCardsLoaded && totalActions > 0) {
        // Count how many are create vs edit
        const createCount = cardBlocks.filter(({ part }) => part.type === 'action' && part.action.action === 'create_new').length;
        const editCount = cardBlocks.filter(({ part }) => part.type === 'action' && part.action.action === 'edit').length;
        const parts = [];
        if (createCount > 0) parts.push(`${createCount} agent${createCount > 1 ? 's' : ''} created`);
        if (editCount > 0) parts.push(`${editCount} agent${editCount > 1 ? 's' : ''} updated`);
        completedSummary = parts.join(', ');
    }

    // Detect if any card has an error or is cancelled
    const hasPanelWarning = cardBlocks.some(
        ({ part }) =>
            part.type === 'action' &&
            part.action &&
            (part.action.error || ('cancelled' in part.action && part.action.cancelled))
    );

    // Ticker summary for collapsed state (two lines)
    const ticker = (
        <div className="flex flex-col">
            {allCardsLoaded && completedSummary ? (
                <span className="font-medium text-xs sm:text-sm">{completedSummary}</span>
            ) : streamingLine && (
                <span className="font-medium text-xs sm:text-sm">{streamingLine}</span>
            )}
            <span className="font-medium text-xs sm:text-sm">{appliedCount} applied, {pendingCount} pending</span>
        </div>
    );

    const applyAllButton = (
        <button
            onClick={handleApplyAll}
            disabled={allApplied} // Changed to allApplied
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm transition-colors duration-200
                ${
                    allApplied
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-200 dark:border-zinc-700 shadow-none'
                        : 'bg-blue-100 dark:bg-zinc-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-zinc-800 border border-blue-200 dark:border-zinc-800 shadow-sm'
                }
            `}
        >
            {allApplied ? (
                <>
                    <CheckCheckIcon size={16} />
                    All applied!
                </>
            ) : (
                <>
                    <CheckCheckIcon size={16} />
                    Apply all
                </>
            )}
        </button>
    );

    // Utility to filter out divider/empty markdown blocks
    function isNonDividerMarkdown(content: string) {
        const trimmed = content.trim();
        return (
            trimmed !== '' &&
            !/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)
        );
    }

    // Restore panelOpen state if missing
    const [panelOpen, setPanelOpen] = useState(false); // collapsed by default

    // At the end of the render, call onStatusBarChange with the current status bar props
    useEffect(() => {
        if (onStatusBarChange) {
            onStatusBarChange({
                allCardsLoaded,
                allApplied,
                appliedCount,
                pendingCount,
                streamingLine,
                completedSummary,
                hasPanelWarning,
                handleApplyAll,
            });
        }
    }, [allCardsLoaded, allApplied, appliedCount, pendingCount, streamingLine, completedSummary, hasPanelWarning, handleApplyAll, onStatusBarChange]);

    // Render all cards inline, not in a panel
    return (
        <div className="w-full">
            <div className="px-4 py-2.5 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                <div className="flex flex-col gap-2">
                  <PreviewModalProvider>
                    {/* Render markdown and cards inline in order */}
                    {parsed.map((part, idx) => {
                        if (part.type === 'text' && isNonDividerMarkdown(part.content)) {
                            return <MarkdownContent key={`text-${idx}`} content={part.content} />;
                        }
                        if (part.type === 'action') {
                            return (
                                <Action
                                    key={`action-${idx}`}
                                    msgIndex={messageIndex}
                                    actionIndex={idx}
                                    action={part.action}
                                    workflow={workflow}
                                    dispatch={dispatch}
                                    stale={false}
                                    onApplied={() => handleSingleApply(part.action, idx)}
                                    externallyApplied={appliedActions.has(idx)}
                                    defaultExpanded={true}
                                />
                            );
                        }
                        if (part.type === 'streaming_action') {
                            return (
                                <StreamingAction
                                    key={`streaming-${idx}`}
                                    action={part.action}
                                    loading={loading}
                                />
                            );
                        }
                        return null;
                    })}
                  </PreviewModalProvider>
                </div>
            </div>
        </div>
    );
}

function AssistantMessageLoading({ currentStatus }: { currentStatus: 'thinking' | 'planning' | 'generating' }) {
    const statusText = {
        thinking: "Thinking...",
        planning: "Planning...",
        generating: "Generating..."
    };

    return (
        <div className="w-full">
            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2.5 
                rounded-lg
                border border-gray-200 dark:border-gray-700
                shadow-sm dark:shadow-gray-950/20 animate-pulse min-h-[2.5rem] flex items-center gap-2">
                <Spinner size="sm" className="ml-2" />
                <span className="text-sm text-gray-600 dark:text-gray-400">{statusText[currentStatus]}</span>
            </div>
        </div>
    );
}

export function Messages({
    messages,
    streamingResponse,
    loadingResponse,
    workflow,
    dispatch,
    onStatusBarChange
}: {
    messages: z.infer<typeof CopilotMessage>[];
    streamingResponse: string;
    loadingResponse: boolean;
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: any) => void;
    onStatusBarChange?: (status: any) => void;
}) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [displayMessages, setDisplayMessages] = useState(messages);

    useEffect(() => {
        if (loadingResponse) {
            setDisplayMessages([...messages, {
                role: 'assistant',
                content: streamingResponse
            }]);
        } else {
            setDisplayMessages(messages);
        }
    }, [messages, loadingResponse, streamingResponse]);

    useEffect(() => {
        // Small delay to ensure content is rendered
        const timeoutId = setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "end",
                inline: "nearest"
            });
        }, 100);

        return () => clearTimeout(timeoutId);
    }, [messages, loadingResponse]);

    // Track the latest status bar info
    const latestStatusBar = useRef<any>(null);

    const renderMessage = (message: z.infer<typeof CopilotMessage>, messageIndex: number) => {
        if (message.role === 'assistant') {
            return (
                <AssistantMessage
                    key={messageIndex}
                    content={message.content}
                    workflow={workflow}
                    dispatch={dispatch}
                    messageIndex={messageIndex}
                    loading={loadingResponse}
                    onStatusBarChange={status => {
                        // Only update for the last assistant message
                        if (messageIndex === displayMessages.length - 1) {
                            latestStatusBar.current = status;
                            onStatusBarChange?.(status);
                        }
                    }}
                />
            );
        }

        if (message.role === 'user' && typeof message.content === 'string') {
            return <UserMessage key={messageIndex} content={message.content} />;
        }

        return null;
    };

    return (
        <div className="h-full">
            <div className="flex flex-col mb-4">
                {displayMessages.map((message, index) => (
                    <div key={index} className="mb-4">
                        {renderMessage(message, index)}
                    </div>
                ))}
                {loadingResponse && (
                    <div className="text-xs text-gray-500">
                        <Spinner size="sm" className="ml-2" />
                    </div>
                )}
            </div>
            <div ref={messagesEndRef} />
        </div>
    );
}