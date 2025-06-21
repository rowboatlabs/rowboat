'use client';
import { Spinner } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Workflow, WorkflowTool, WorkflowAgent, WorkflowPrompt } from "@/app/lib/types/workflow_types";
import MarkdownContent from "@/app/lib/components/markdown-content";
import { MessageSquareIcon, EllipsisIcon, XIcon } from "lucide-react";
import { CopilotMessage, CopilotAssistantMessage, CopilotAssistantMessageActionPart } from "@/app/lib/types/copilot_types";
import { Action, StreamingAction } from './actions';
import { useParsedBlocks } from "../use-parsed-blocks";
import { validateConfigChanges } from "@/app/lib/client_utils";

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
        const line = lines[i]!.trim();
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


function AssistantMessage({
    content,
    workflow,
    dispatch,
    messageIndex,
    loading
}: {
    content: z.infer<typeof CopilotAssistantMessage>['content'],
    workflow: z.infer<typeof Workflow>,
    dispatch: (action: any) => void,
    messageIndex: number,
    loading: boolean
}) {
    const blocks = useParsedBlocks(content);

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

    // split the content into parts 
    return (
        <div className="w-full">
            <div className="px-4 py-2.5 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                <div className="flex flex-col gap-4">
                    <div className="text-left flex flex-col gap-4">
                        {parsed.map((part, actionIndex) => {
                            if (part.type === 'text') {
                                return <MarkdownContent
                                    key={actionIndex}
                                    content={part.content}
                                />;
                            }
                            if (part.type === 'streaming_action') {
                                return <StreamingAction
                                    key={actionIndex}
                                    action={part.action}
                                    loading={loading}
                                />;
                            }
                            if (part.type === 'action') {
                                return <Action
                                    key={actionIndex}
                                    msgIndex={messageIndex}
                                    actionIndex={actionIndex}
                                    action={part.action}
                                    workflow={workflow}
                                    dispatch={dispatch}
                                    stale={false}
                                />;
                            }
                        })}
                    </div>
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
    dispatch
}: {
    messages: z.infer<typeof CopilotMessage>[];
    streamingResponse: string;
    loadingResponse: boolean;
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: any) => void;
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