'use client';
import { Spinner } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import z from "zod";
import { Workflow } from "@/app/lib/types/workflow_types";
import { WorkflowTool } from "@/app/lib/types/workflow_types";
import MarkdownContent from "@/app/lib/components/markdown-content";
import { apiV1 } from "rowboat-shared";
import { MessageSquareIcon, EllipsisIcon, CircleCheckIcon, ChevronRightIcon, ChevronDownIcon, ChevronUpIcon, XIcon, PlusIcon, CodeIcon, CheckCircleIcon, FileTextIcon } from "lucide-react";
import { TestProfile } from "@/app/lib/types/testing_types";
import { ProfileContextBox } from "./profile-context-box";

function UserMessage({ content }: { content: string }) {
    return (
        <div className="self-end flex flex-col items-end gap-1 mt-5 mb-8">
            <div className="text-gray-500 dark:text-gray-400 text-xs">
                User
            </div>
            <div className="max-w-[85%] inline-block">
                <div className="bg-blue-100 dark:bg-blue-900/40 px-4 py-2.5 
                    rounded-2xl rounded-br-lg text-sm leading-relaxed
                    text-gray-800 dark:text-blue-100 
                    border-none shadow-sm animate-slideUpAndFade">
                    <div className="text-left">
                        <MarkdownContent content={content} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function InternalAssistantMessage({ content, sender, latency, delta }: { content: string, sender: string | null | undefined, latency: number, delta: number }) {
    const [expanded, setExpanded] = useState(false);

    // Show plus icon and duration
    const deltaDisplay = (
        <span className="inline-flex items-center text-gray-400 dark:text-gray-500">
            +{Math.round(delta / 1000)}s
        </span>
    );

    // Get first line preview
    const firstLine = content.split('\n')[0].trim();
    const preview = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;

    return (
        <div className="self-start flex flex-col gap-1 my-5">
            <div className="text-gray-500 dark:text-gray-400 text-xs pl-1">
                {sender ?? 'Assistant'}
            </div>
            <div className={expanded ? 'max-w-[85%] inline-block' : 'inline-block'}>
                <div className={expanded
                  ? 'bg-gray-50 dark:bg-zinc-800 px-4 py-2.5 rounded-2xl rounded-bl-lg text-sm leading-relaxed text-gray-700 dark:text-gray-200 border-none shadow-sm animate-slideUpAndFade flex flex-col items-stretch'
                  : 'bg-gray-50 dark:bg-zinc-800 px-4 py-2.5 rounded-2xl rounded-bl-lg text-sm leading-relaxed text-gray-700 dark:text-gray-200 border-none shadow-sm animate-slideUpAndFade w-fit'}>
                    {!expanded ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-gray-700 dark:text-gray-200">
                                {preview}
                            </div>
                            <div className="flex justify-between items-center gap-6">
                                <button className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:underline self-start" onClick={() => setExpanded(true)}>
                                    <ChevronDownIcon size={16} />
                                    Show internal message
                                </button>
                                <div className="text-right text-xs">
                                    {deltaDisplay}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="text-left mb-2">
                                <MarkdownContent content={content} />
                            </div>
                            <div className="flex justify-between items-center gap-6 mt-2">
                                <button className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:underline self-start" onClick={() => setExpanded(false)}>
                                    <ChevronUpIcon size={16} />
                                    Hide internal message
                                </button>
                                <div className="text-right text-xs">
                                    {deltaDisplay}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function AssistantMessage({ content, sender, latency }: { content: string, sender: string | null | undefined, latency: number }) {
    return (
        <div className="self-start flex flex-col gap-1 my-5">
            <div className="text-gray-500 dark:text-gray-400 text-xs pl-1">
                {sender ?? 'Assistant'}
            </div>
            <div className="max-w-[85%] inline-block">
                <div className="bg-purple-50 dark:bg-purple-900/30 px-4 py-2.5 
                    rounded-2xl rounded-bl-lg text-sm leading-relaxed
                    text-gray-800 dark:text-purple-100 
                    border-none shadow-sm animate-slideUpAndFade">
                    <div className="flex flex-col gap-1">
                        <div className="text-left">
                            <MarkdownContent content={content} />
                        </div>
                        {latency > 0 && <div className="text-right text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {Math.round(latency / 1000)}s
                        </div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AssistantMessageLoading() {
    return (
        <div className="self-start flex flex-col gap-1 my-5">
            <div className="max-w-[85%] inline-block">
                <div className="bg-purple-50 dark:bg-purple-900/30 px-4 py-2.5 
                    rounded-2xl rounded-bl-lg
                    border-none shadow-sm animate-slideUpAndFade min-h-[2.5rem] flex items-center">
                    <Spinner size="sm" className="ml-2" />
                </div>
            </div>
        </div>
    );
}

function ToolCalls({
    toolCalls,
    results,
    projectId,
    messages,
    sender,
    workflow,
    testProfile = null,
    systemMessage,
    delta
}: {
    toolCalls: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'];
    results: Record<string, z.infer<typeof apiV1.ToolMessage>>;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
    testProfile: z.infer<typeof TestProfile> | null;
    systemMessage: string | undefined;
    delta: number;
}) {
    return <div className="flex flex-col gap-4">
        {toolCalls.map(toolCall => {
            return <ToolCall
                key={toolCall.id}
                toolCall={toolCall}
                result={results[toolCall.id]}
                sender={sender}
                workflow={workflow}
                delta={delta}
            />
        })}
    </div>;
}

function ToolCall({
    toolCall,
    result,
    sender,
    workflow,
    delta
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
    delta: number;
}) {
    let matchingWorkflowTool: z.infer<typeof WorkflowTool> | undefined;
    for (const tool of workflow.tools) {
        if (tool.name === toolCall.function.name) {
            matchingWorkflowTool = tool;
            break;
        }
    }

    if (toolCall.function.name.startsWith('transfer_to_')) {
        return <TransferToAgentToolCall
            result={result}
            sender={sender ?? ''}
            delta={delta}
        />;
    }
    return <ClientToolCall
        toolCall={toolCall}
        result={result}
        sender={sender ?? ''}
        workflow={workflow}
        delta={delta}
    />;
}

function TransferToAgentToolCall({
    result: availableResult,
    sender,
    delta
}: {
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    sender: string | null | undefined;
    delta: number;
}) {
    const typedResult = availableResult ? JSON.parse(availableResult.content) as { assistant: string } : undefined;
    if (!typedResult) {
        return <></>;
    }
    const deltaDisplay = (
        <span className="inline-flex items-center text-gray-400 dark:text-gray-500">
            +{Math.round(delta / 1000)}s
        </span>
    );
    return (
        <div className="flex justify-center mb-2">
            <div className="flex items-center gap-2 px-4 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 shadow-sm text-xs">
                <span className="text-gray-700 dark:text-gray-200">{sender}</span>
                <ChevronRightIcon size={14} className="text-gray-400 dark:text-gray-300" />
                <span className="text-gray-700 dark:text-gray-200">{typedResult.assistant}</span>
                <span className="ml-2">{deltaDisplay}</span>
            </div>
        </div>
    );
}

function ClientToolCall({
    toolCall,
    result: availableResult,
    sender,
    workflow,
    delta
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
    delta: number;
}) {
    return (
        <div className="self-start flex flex-col gap-1 mb-4">
            {sender && (
                <div className="text-gray-500 dark:text-gray-400 text-xs pl-1">
                    {sender}
                </div>
            )}
            <div className="min-w-[85%] inline-block">
                <div className="border border-gray-200 dark:border-gray-700 p-3
                    rounded-2xl rounded-bl-lg flex flex-col gap-2
                    bg-gray-50 dark:bg-gray-800 shadow-sm dark:shadow-gray-950/20">
                    <div className="flex flex-col gap-1">
                        <div className="shrink-0 flex gap-2 items-center">
                            {!availableResult && <Spinner size="sm" />}
                            {availableResult && <CheckCircleIcon size={16} className="text-green-500" />}
                            <div className="flex items-center font-semibold text-sm gap-2">
                                <span>Function Call:</span>
                                <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 dark:bg-purple-900/30 dark:text-purple-100 font-bold text-sm align-middle">
                                    {toolCall.function.name}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <ExpandableContent label="Params" content={toolCall.function.arguments} expanded={false} icon={<CodeIcon size={14} />} />
                        {availableResult && <ExpandableContent label="Result" content={availableResult.content} expanded={false} icon={<FileTextIcon size={14} className="text-blue-500" />} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ExpandableContent({
    label,
    content,
    expanded = false,
    icon
}: {
    label: string,
    content: string | object | undefined,
    expanded?: boolean,
    icon?: React.ReactNode
}) {
    const [isExpanded, setIsExpanded] = useState(expanded);

    const formattedContent = useMemo(() => {
        if (typeof content === 'string') {
            try {
                const parsed = JSON.parse(content);
                return JSON.stringify(parsed, null, 2);
            } catch (e) {
                // If it's not JSON, return the string as-is
                return content;
            }
        }
        if (typeof content === 'object') {
            return JSON.stringify(content, null, 2);
        }
        return 'undefined';
    }, [content]);

    function toggleExpanded() {
        setIsExpanded(!isExpanded);
    }

    const isMarkdown = label === 'Result' && typeof content === 'string' && !content.startsWith('{');

    return <div className='flex flex-col gap-2'>
        <div className='flex gap-1 items-start cursor-pointer text-gray-500 dark:text-gray-400' onClick={toggleExpanded}>
            {!isExpanded && <ChevronRightIcon size={16} />}
            {isExpanded && <ChevronDownIcon size={16} />}
            {icon && <span className="mr-1">{icon}</span>}
            <div className='text-left break-all text-xs'>{label}</div>
        </div>
        {isExpanded && (
            isMarkdown ? (
                <div className='text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100'>
                    <MarkdownContent content={content as string} />
                </div>
            ) : (
                <pre
                  className="text-xs leading-snug bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg px-2 py-1 overflow-x-auto font-mono shadow-sm border border-zinc-100 dark:border-zinc-700"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Mono', 'Menlo', 'Consolas', 'Liberation Mono', monospace" }}
                >
                    {formattedContent}
                </pre>
            )
        )}
    </div>;
}

export function Messages({
    projectId,
    messages,
    toolCallResults,
    loadingAssistantResponse,
    workflow,
    testProfile = null,
    systemMessage,
    onSystemMessageChange,
    showSystemMessage,
    showDebugMessages = true,
}: {
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    toolCallResults: Record<string, z.infer<typeof apiV1.ToolMessage>>;
    loadingAssistantResponse: boolean;
    workflow: z.infer<typeof Workflow>;
    testProfile: z.infer<typeof TestProfile> | null;
    systemMessage: string | undefined;
    onSystemMessageChange: (message: string) => void;
    showSystemMessage: boolean;
    showDebugMessages?: boolean;
}) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    let lastUserMessageTimestamp = 0;
    let userMessageSeen = false;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loadingAssistantResponse]);

    const renderMessage = (message: z.infer<typeof apiV1.ChatMessage>, index: number) => {
        const isConsecutive = index > 0 && messages[index - 1].role === message.role;

        if (message.role === 'assistant') {
            let latency = new Date(message.createdAt).getTime() - lastUserMessageTimestamp;
            if (!userMessageSeen) {
                latency = 0;
            }

            // First check for tool calls
            if ('tool_calls' in message && message.tool_calls) {
                // Skip tool calls if debug mode is off
                if (!showDebugMessages) {
                    return null;
                }
                return (
                    <ToolCalls
                        toolCalls={message.tool_calls}
                        results={toolCallResults}
                        projectId={projectId}
                        messages={messages}
                        sender={message.agenticSender ?? ''}
                        workflow={workflow}
                        testProfile={testProfile}
                        systemMessage={systemMessage}
                        delta={latency}
                    />
                );
            }

            // Then check for internal messages
            if (message.agenticResponseType === 'internal') {
                // Skip internal messages if debug mode is off
                if (!showDebugMessages) {
                    return null;
                }
                return (
                    <InternalAssistantMessage
                        content={message.content ?? ''}
                        sender={message.agenticSender ?? ''}
                        latency={latency}
                        delta={latency}
                    />
                );
            }

            // Finally, regular assistant messages
            return (
                <AssistantMessage
                    content={message.content ?? ''}
                    sender={message.agenticSender ?? ''}
                    latency={latency}
                />
            );
        }

        if (message.role === 'user' && typeof message.content === 'string') {
            lastUserMessageTimestamp = new Date(message.createdAt).getTime();
            userMessageSeen = true;
            return <UserMessage content={message.content} />;
        }

        return null;
    };

    const isAgentTransition = (message: z.infer<typeof apiV1.ChatMessage>) => {
        return message.role === 'assistant' && 'tool_calls' in message && Array.isArray(message.tool_calls) && message.tool_calls.some(tc => tc.function.name.startsWith('transfer_to_'));
    };

    const isAssistantMessage = (message: z.infer<typeof apiV1.ChatMessage>) => {
        return message.role === 'assistant' && (!('tool_calls' in message) || !Array.isArray(message.tool_calls) || !message.tool_calls.some(tc => tc.function.name.startsWith('transfer_to_')));
    };

    if (showSystemMessage) {
        return (
            <ProfileContextBox
                content={testProfile?.context || systemMessage || ''}
                onChange={onSystemMessageChange}
                locked={testProfile !== null}
            />
        );
    }

    return (
        <div className="max-w-[768px] mx-auto">
            <div className="flex flex-col">
                {messages.map((message, index) => {
                    const renderedMessage = renderMessage(message, index);
                    if (renderedMessage) {
                        return (
                            <div key={index}>
                                {renderedMessage}
                            </div>
                        );
                    }
                    return null;
                })}
                {loadingAssistantResponse && <AssistantMessageLoading />}
            </div>
            <div ref={messagesEndRef} />
        </div>
    );
}