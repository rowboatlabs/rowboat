'use client';
import { Spinner } from "@heroui/react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { z } from "zod";
import { Workflow} from "@/app/lib/types/workflow_types";
import MarkdownContent from "@/app/lib/components/markdown-content";
import { MessageSquareIcon, EllipsisIcon, XIcon, CheckCheckIcon, ChevronDown, ChevronUp } from "lucide-react";
import { CopilotMessage, CopilotAssistantMessage, CopilotAssistantMessageActionPart, TriggerSchemaForCopilot } from "@/src/entities/models/copilot";
import { Action, StreamingAction } from './actions';
import { TriggerSetupModal } from './TriggerSetupModal';
import { useCopilotTriggerActions } from './use-trigger-actions';
import { useParsedBlocks } from "../use-parsed-blocks";
import { validateConfigChanges } from "@/app/lib/client_utils";
import { PreviewModalProvider } from '../../workflow/preview-modal';

type CopilotTriggerType = z.infer<typeof TriggerSchemaForCopilot>;

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
                        action: metadata.action as 'create_new' | 'edit' | 'delete',
                        config_type: metadata.config_type as 'tool' | 'agent' | 'prompt' | 'pipeline' | 'start_agent' | 'one_time_trigger' | 'recurring_trigger' | 'external_trigger',
                        name: metadata.name,
                        change_description: jsonData.change_description || '',
                        config_changes: {},
                        error: result.error
                    }
                };
            }

            const actionPayload = {
                action: metadata.action as 'create_new' | 'edit' | 'delete',
                config_type: metadata.config_type as 'tool' | 'agent' | 'prompt' | 'pipeline' | 'start_agent' | 'one_time_trigger' | 'recurring_trigger' | 'external_trigger',
                name: metadata.name,
                change_description: jsonData.change_description || '',
                config_changes: result.changes
            };

            if (actionPayload.config_type === 'external_trigger' && actionPayload.action === 'edit') {
                return {
                    type: 'action',
                    action: {
                        ...actionPayload,
                        error: "Editing external triggers isn't supported. Delete the trigger and create a new one with the updated settings—I can take care of that for you if you'd like."
                    }
                };
            }

            return {
                type: 'action',
                action: actionPayload
            };
        }
    } catch (e) {
        // JSON parsing failed - this is likely a streaming block
    }

    // Return as streaming action with whatever metadata we have
    return {
        type: 'streaming_action',
        action: {
            action: (metadata.action as 'create_new' | 'edit' | 'delete') || undefined,
            config_type: (metadata.config_type as 'tool' | 'agent' | 'prompt' | 'pipeline' | 'start_agent' | 'one_time_trigger' | 'recurring_trigger' | 'external_trigger') || undefined,
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
    onStatusBarChange,
    projectId,
    triggers,
    onTriggersUpdated,
}: {
    content: z.infer<typeof CopilotAssistantMessage>['content'],
    workflow: z.infer<typeof Workflow>,
    dispatch: (action: any) => void,
    messageIndex: number,
    loading: boolean,
    onStatusBarChange?: (status: any) => void;
    projectId: string;
    triggers?: CopilotTriggerType[];
    onTriggersUpdated?: () => Promise<void> | void;
}) {
    const blocks = useParsedBlocks(content);
    const [appliedActions, setAppliedActions] = useState<Set<number>>(new Set());

    // parse actions from parts
    const parsed = useMemo(() => {
        const result: z.infer<typeof CopilotResponsePart>[] = [];
        for (const block of blocks) {
            if (block.type === 'text') {
                result.push({
                    type: 'text',
                    content: block.content,
                });
            } else {
                result.push(enrich(block.content));
            }
        }
        return result;
    }, [blocks]);

    const hasUpcomingReplacement = useCallback((candidate: z.infer<typeof CopilotAssistantMessageActionPart>['content'], currentIndex: number = -1) => {
        return parsed.some((part, idx) =>
            idx > currentIndex &&
            part.type === 'action' &&
            part.action.config_type === candidate.config_type &&
            part.action.name === candidate.name &&
            part.action.action === 'create_new'
        );
    }, [parsed]);

    const {
        triggerSetupModal,
        requestTriggerSetup,
        closeTriggerSetup,
        handleTriggerCreatedViaModal,
        handleTriggerAction,
    } = useCopilotTriggerActions({
        projectId,
        triggers,
        onTriggersUpdated,
        hasUpcomingReplacement,
    });

    const handleTriggerSetupCreated = useCallback(async () => {
        if (!triggerSetupModal) {
            return;
        }
        const index = triggerSetupModal.actionIndex;
        setAppliedActions(prev => {
            const next = new Set(prev);
            next.add(index);
            return next;
        });
        await handleTriggerCreatedViaModal();
    }, [handleTriggerCreatedViaModal, triggerSetupModal]);

    const handleTriggerSetupClosed = useCallback(() => {
        closeTriggerSetup();
    }, [closeTriggerSetup]);

    // Count action cards for tracking
    const actionParts = parsed.filter(part => part.type === 'action' || part.type === 'streaming_action');
    const totalActions = parsed.filter(part => part.type === 'action').length;
    const appliedCount = Array.from(appliedActions).length;
    const pendingCount = Math.max(0, totalActions - appliedCount);
    const allApplied = pendingCount === 0 && totalActions > 0;

    // Memoized applyAction for useCallback dependencies
    const applyAction = useCallback((action: any): boolean => {
        if (action.action === 'create_new') {
            switch (action.config_type) {
                case 'agent': {
                    if (workflow.agents.some((agent: any) => agent.name === action.name)) {
                        return false;
                    }
                    dispatch({
                        type: 'add_agent',
                        agent: {
                            name: action.name,
                            ...action.config_changes
                        },
                        fromCopilot: true
                    });
                    return true;
                }
                case 'tool': {
                    if (workflow.tools.some((tool: any) => tool.name === action.name)) {
                        return false;
                    }
                    dispatch({
                        type: 'add_tool',
                        tool: {
                            name: action.name,
                            ...action.config_changes
                        },
                        fromCopilot: true
                    });
                    return true;
                }
                case 'prompt':
                    dispatch({
                        type: 'add_prompt',
                        prompt: {
                            name: action.name,
                            ...action.config_changes
                        },
                        fromCopilot: true
                    });
                    return true;
                case 'pipeline':
                    dispatch({
                        type: 'add_pipeline',
                        pipeline: {
                            name: action.name,
                            ...action.config_changes
                        },
                        fromCopilot: true
                    });
                    return true;
            }
        } else if (action.action === 'edit') {
            switch (action.config_type) {
                case 'agent':
                    dispatch({
                        type: 'update_agent_no_select',
                        name: action.name,
                        agent: action.config_changes
                    });
                    return true;
                case 'tool':
                    dispatch({
                        type: 'update_tool_no_select',
                        name: action.name,
                        tool: action.config_changes
                    });
                    return true;
                case 'prompt':
                    dispatch({
                        type: 'update_prompt',
                        name: action.name,
                        prompt: action.config_changes
                    });
                    return true;
                case 'pipeline':
                    dispatch({
                        type: 'update_pipeline',
                        name: action.name,
                        pipeline: action.config_changes
                    });
                    return true;
                case 'start_agent':
                    dispatch({
                        type: 'set_main_agent',
                        name: action.name,
                    });
                    return true;
            }
        } else if (action.action === 'delete') {
            switch (action.config_type) {
                case 'agent':
                    dispatch({
                        type: 'delete_agent',
                        name: action.name
                    });
                    return true;
                case 'tool':
                    dispatch({
                        type: 'delete_tool',
                        name: action.name
                    });
                    return true;
                case 'prompt':
                    dispatch({
                        type: 'delete_prompt',
                        name: action.name
                    });
                    return true;
                case 'pipeline':
                    dispatch({
                        type: 'delete_pipeline',
                        name: action.name
                    });
                    return true;
            }
        }

        console.warn('Unhandled action from Copilot applyAction', action);
        return false;
    }, [dispatch, workflow.agents, workflow.tools]);

    // Memoized handleApplyAll for useEffect dependencies
    const handleApplyAll = useCallback(async () => {
        const unapplied = parsed.reduce<Array<{ action: z.infer<typeof CopilotAssistantMessageActionPart>['content']; actionIndex: number }>>((acc, part, idx) => {
            if (part.type === 'action' && !appliedActions.has(idx)) {
                acc.push({ action: part.action, actionIndex: idx });
            }
            return acc;
        }, []);

        const newlyApplied: number[] = [];

        for (const { action, actionIndex } of unapplied) {
            try {
                const isTrigger = action.config_type === 'one_time_trigger' || action.config_type === 'recurring_trigger' || action.config_type === 'external_trigger';
                const success = isTrigger
                    ? await handleTriggerAction(action, { actionIndex, messageIndex })
                    : applyAction(action);

                if (success) {
                    newlyApplied.push(actionIndex);
                }
            } catch (error) {
                console.error('Failed to apply Copilot action', action, error);
            }
        }

        if (newlyApplied.length > 0) {
            setAppliedActions(prev => {
                const next = new Set(prev);
                newlyApplied.forEach(index => next.add(index));
                return next;
            });
        }
    }, [parsed, appliedActions, applyAction, handleTriggerAction, messageIndex]);

    // Manual single apply (from card)
    const handleSingleApply = useCallback(async (action: z.infer<typeof CopilotAssistantMessageActionPart>['content'], actionIndex: number) => {
        if (appliedActions.has(actionIndex)) {
            return;
        }

        try {
            const isTrigger = action.config_type === 'one_time_trigger' || action.config_type === 'recurring_trigger' || action.config_type === 'external_trigger';
            const success = isTrigger
                ? await handleTriggerAction(action, { actionIndex, messageIndex })
                : applyAction(action);

            if (success) {
                setAppliedActions(prev => new Set([...prev, actionIndex]));
            }
        } catch (error) {
            console.error('Failed to apply Copilot action', action, error);
        }
    }, [appliedActions, applyAction, handleTriggerAction, messageIndex]);

    useEffect(() => {
        if (loading) {
            setAppliedActions(new Set());
        }
    }, [loading]);

    // Find streaming/ongoing card and extract name
    const streamingPart = parsed.find(part => part.type === 'streaming_action');
    let streamingLine = '';
    if (streamingPart && streamingPart.type === 'streaming_action' && streamingPart.action && streamingPart.action.name) {
        streamingLine = `Generating ${streamingPart.action.name}...`;
    }

    // Only show Apply All button if all cards are loaded (no streaming_action cards) and streaming is finished
    const allCardsLoaded = !loading && actionParts.length > 0 && actionParts.every(part => part.type === 'action');
    // When all cards are loaded, show summary of agents created/updated
    let completedSummary = '';
    if (allCardsLoaded && totalActions > 0) {
        // Count how many are create vs edit
        const createCount = parsed.filter(part => part.type === 'action' && part.action.action === 'create_new').length;
        const editCount = parsed.filter(part => part.type === 'action' && part.action.action === 'edit').length;
        const parts = [];
        if (createCount > 0) parts.push(`${createCount} item${createCount > 1 ? 's' : ''} created`);
        if (editCount > 0) parts.push(`${editCount} item${editCount > 1 ? 's' : ''} updated`);
        completedSummary = parts.join(', ');
    }

    // Detect if any card has an error or is cancelled
    const hasPanelWarning = parsed.some(
        part =>
            part.type === 'action' &&
            part.action &&
            (part.action.error || ('cancelled' in part.action && part.action.cancelled))
    );

    // Utility to filter out divider/empty markdown blocks
    function isNonDividerMarkdown(content: string) {
        const trimmed = content.trim();
        return (
            trimmed !== '' &&
            !/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)
        );
    }

    // At the end of the render, call onStatusBarChange with the current status bar props
    // Only call onStatusBarChange if the serializable status actually changes
    const lastStatusRef = useRef<any>(null);
    useEffect(() => {
        if (onStatusBarChange) {
            const status = {
                allCardsLoaded,
                allApplied,
                appliedCount,
                pendingCount,
                streamingLine,
                completedSummary,
                hasPanelWarning,
                // Exclude handleApplyAll from comparison
            };
            if (!lastStatusRef.current || JSON.stringify(lastStatusRef.current) !== JSON.stringify(status)) {
                lastStatusRef.current = status;
                onStatusBarChange({
                    ...status,
                    handleApplyAll, // pass the function, but don't compare it
                });
            }
        }
        // Only depend on the serializable values, not the function
    }, [allCardsLoaded, allApplied, appliedCount, pendingCount, streamingLine, completedSummary, hasPanelWarning, onStatusBarChange, handleApplyAll]);

    // Render all cards inline, not in a panel
    return (
        <>
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
                                    onApplied={() => { void handleSingleApply(part.action, idx); }}
                                    externallyApplied={appliedActions.has(idx)}
                                    defaultExpanded={true}
                                    onRequestTriggerSetup={({ action, actionIndex }) =>
                                        requestTriggerSetup({ action, actionIndex, messageIndex })
                                    }
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
        <TriggerSetupModal
            isOpen={Boolean(triggerSetupModal)}
            onClose={handleTriggerSetupClosed}
            projectId={projectId}
            initialToolkitSlug={triggerSetupModal?.initialToolkitSlug ?? null}
            initialTriggerTypeSlug={triggerSetupModal?.initialTriggerTypeSlug ?? null}
            initialTriggerConfig={triggerSetupModal?.initialConfig}
            onCreated={handleTriggerSetupCreated}
        />
        </>
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
    projectId,
    messages,
    streamingResponse,
    loadingResponse,
    workflow,
    dispatch,
    onStatusBarChange,
    toolCalling,
    toolQuery,
    triggers,
    onTriggersUpdated,
}: {
    projectId: string;
    messages: z.infer<typeof CopilotMessage>[];
    streamingResponse: string;
    loadingResponse: boolean;
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: any) => void;
    onStatusBarChange?: (status: any) => void;
    toolCalling?: boolean;
    toolQuery?: string | null;
    triggers?: z.infer<typeof TriggerSchemaForCopilot>[];
    onTriggersUpdated?: () => Promise<void> | void;
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
                    projectId={projectId}
                    triggers={triggers}
                    onTriggersUpdated={onTriggersUpdated}
                    onStatusBarChange={status => {
                        // Only update for the last assistant message
                        if (messageIndex === displayMessages.length - 1) {
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
        <div className={displayMessages.length === 0 ? "" : "h-full"}>
            <div className="flex flex-col mb-4">
                {displayMessages.map((message, index) => (
                    <div key={index} className="mb-4">
                        {renderMessage(message, index)}
                    </div>
                ))}
                {!streamingResponse && (toolCalling ? (
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2 px-4">
                        <span className="animate-pulse [animation-duration:2s]">Searching for tools{toolQuery ? ` to ${toolQuery}` : ''}...</span>
                    </div>
                ) : loadingResponse ? (
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2 px-4">
                        <span className="animate-pulse [animation-duration:2s]">Thinking...</span>
                    </div>
                ) : null)}
            </div>
            <div ref={messagesEndRef} />
        </div>
    );
}
