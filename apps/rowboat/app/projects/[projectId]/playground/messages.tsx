'use client';
import { Spinner } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import z from "zod";
import { Workflow } from "../../../lib/types/workflow_types";
import { WorkflowTool } from "../../../lib/types/workflow_types";
import MarkdownContent from "../../../lib/components/markdown-content";
import { apiV1 } from "rowboat-shared";
import { EditableField } from "../../../lib/components/editable-field";
import { MessageSquareIcon, EllipsisIcon, CircleCheckIcon, ChevronRightIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { TestProfile } from "@/app/lib/types/testing_types";

function UserMessage({ content }: { content: string }) {
    return <div className="self-end ml-[30%] flex flex-col">
        <div className="text-right text-gray-500 dark:text-gray-400 text-xs mr-3">
            User
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-lg rounded-br-none text-sm text-gray-900 dark:text-gray-100">
            <MarkdownContent content={content} />
        </div>
    </div>;
}

function InternalAssistantMessage({ content, sender, latency }: { content: string, sender: string | null | undefined, latency: number }) {
    const [expanded, setExpanded] = useState(false);

    return <div className="self-start mr-[30%]">
        {!expanded && <button className="flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 gap-1 group" onClick={() => setExpanded(true)}>
            <MessageSquareIcon size={16} />
            <EllipsisIcon size={16} />
            <span className="hidden group-hover:block text-xs">Show debug message</span>
        </button>}
        {expanded && <div className="flex flex-col">
            <div className="flex gap-2 justify-between items-center">
                <div className="text-gray-500 dark:text-gray-400 text-xs pl-3">
                    {sender ?? 'Assistant'}
                </div>
                <button className="flex items-center gap-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300" onClick={() => setExpanded(false)}>
                    <XIcon size={16} />
                </button>
            </div>
            <div className="border border-gray-300 dark:border-gray-700 border-dashed px-3 py-1 rounded-lg rounded-bl-none text-gray-900 dark:text-gray-100">
                <pre className="text-sm whitespace-pre-wrap">{content}</pre>
            </div>
        </div>}
    </div>;
}

function AssistantMessage({ content, sender, latency }: { content: string, sender: string | null | undefined, latency: number }) {
    return <div className="self-start mr-[30%] flex flex-col">
        <div className="flex gap-2 justify-between items-center">
            <div className="text-gray-500 dark:text-gray-400 text-xs pl-3">
                {sender ?? 'Assistant'}
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-xs pr-3">
                {Math.round(latency / 1000)}s
            </div>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-lg rounded-bl-none text-sm text-gray-900 dark:text-gray-100">
            <MarkdownContent content={content} />
        </div>
    </div>;
}

function AssistantMessageLoading() {
    return <div className="self-start mr-[30%] flex flex-col text-gray-500 dark:text-gray-400 items-start">
        <div className="text-gray-500 dark:text-gray-400 text-xs ml-3">
            Assistant
        </div>
        <Spinner size="sm" className="mt-2 ml-3" />
    </div>;
}

function UserMessageLoading() {
    return <div className="self-end ml-[30%] flex flex-col">
        <div className="text-right text-gray-500 dark:text-gray-400 text-sm mr-3">
            User
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg rounded-br-none animate-pulse w-20 text-gray-800 dark:text-gray-200">
            <Spinner size="sm" />
        </div>
    </div>;
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
}: {
    toolCalls: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'];
    results: Record<string, z.infer<typeof apiV1.ToolMessage>>;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
    testProfile: z.infer<typeof TestProfile> | null;
    systemMessage: string | undefined;
}) {
    const resultsMap: Record<string, z.infer<typeof apiV1.ToolMessage>> = {};

    return <div className="flex flex-col gap-4">
        {toolCalls.map(toolCall => {
            return <ToolCall
                key={toolCall.id}
                toolCall={toolCall}
                result={results[toolCall.id]}
                projectId={projectId}
                messages={messages}
                sender={sender}
                workflow={workflow}
                testProfile={testProfile}
                systemMessage={systemMessage}
            />
        })}
    </div>;
}

function ToolCall({
    toolCall,
    result,
    projectId,
    messages,
    sender,
    workflow,
    testProfile = null,
    systemMessage,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
    testProfile: z.infer<typeof TestProfile> | null;
    systemMessage: string | undefined;
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
            sender={sender}
        />;
    }
    return <ClientToolCall
        toolCall={toolCall}
        result={result}
        sender={sender}
    />;
}

function ToolCallHeader({
    toolCall,
    result,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
}) {
    return <div className="flex flex-col gap-1">
        <div className='shrink-0 flex gap-2 items-center'>
            {!result && <Spinner size="sm" />}
            {result && <CircleCheckIcon size={16} />}
            <div className='font-semibold text-sm'>
                Function Call: <code className='bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded font-mono'>{toolCall.function.name}</code>
            </div>
        </div>
    </div>;
}

function TransferToAgentToolCall({
    result: availableResult,
    sender,
}: {
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    sender: string | null | undefined;
}) {
    const typedResult = availableResult ? JSON.parse(availableResult.content) as { assistant: string } : undefined;
    if (!typedResult) {
        return <></>;
    }

    return <div className="flex gap-1 items-center text-gray-500 text-sm justify-center">
        <div>{sender}</div>
        <svg className="w-6 h-6" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 12H5m14 0-4 4m4-4-4-4" />
        </svg>
        <div>{typedResult.assistant}</div>
    </div>;
}

function ClientToolCall({
    toolCall,
    result: availableResult,
    sender,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    sender: string | null | undefined;
}) {
    return <div className="flex flex-col gap-1">
        {sender && <div className='text-gray-500 text-sm ml-3'>{sender}</div>}
        <div className='border border-gray-300 p-2 pt-2 rounded-lg rounded-bl-none flex flex-col gap-2 mr-[30%]'>
            <ToolCallHeader toolCall={toolCall} result={availableResult} />

            <div className='flex flex-col gap-2'>
                <ExpandableContent label='Params' content={toolCall.function.arguments} expanded={false} />
                {availableResult && <ExpandableContent label='Result' content={availableResult.content} expanded={false} />}
            </div>
        </div>
    </div>;
}

function ExpandableContent({
    label,
    content,
    expanded = false
}: {
    label: string,
    content: string | object | undefined,
    expanded?: boolean
}) {
    const [isExpanded, setIsExpanded] = useState(expanded);

    const formattedContent = useMemo(() => {
        if (typeof content === 'string') {
            try {
                const parsed = JSON.parse(content);
                return JSON.stringify(parsed, null, 2);
            } catch (e) {
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

    return <div className='flex flex-col gap-2'>
        <div className='flex gap-1 items-start cursor-pointer text-gray-500 dark:text-gray-400' onClick={toggleExpanded}>
            {!isExpanded && <ChevronRightIcon size={16} />}
            {isExpanded && <ChevronDownIcon size={16} />}
            <div className='text-left break-all text-xs'>{label}</div>
        </div>
        {isExpanded && <pre className='text-sm font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded break-all whitespace-pre-wrap overflow-x-auto text-gray-900 dark:text-gray-100'>
            {formattedContent}
        </pre>}
    </div>;
}

function SystemMessage({
    content,
    onChange,
    locked = false,
}: {
    content: string,
    onChange: (content: string) => void,
    locked?: boolean,
}) {
    return <div className="text-sm">
        <EditableField
            label="Context"
            value={content}
            onChange={onChange}
            locked={locked}
            multiline
            markdown
            placeholder={`Provide context about the user (e.g. user ID, user name) to the assistant at the start of chat, for testing purposes.`}
            showSaveButton={true}
            showDiscardButton={true}
        />
    </div>;
}

export function Messages({
    projectId,
    messages,
    toolCallResults,
    loadingAssistantResponse,
    loadingUserResponse,
    workflow,
    testProfile = null,
    systemMessage,
    onSystemMessageChange,
}: {
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    toolCallResults: Record<string, z.infer<typeof apiV1.ToolMessage>>;
    loadingAssistantResponse: boolean;
    loadingUserResponse: boolean;
    workflow: z.infer<typeof Workflow>;
    testProfile: z.infer<typeof TestProfile> | null;
    systemMessage: string | undefined;
    onSystemMessageChange: (message: string) => void;
}) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    let lastUserMessageTimestamp = 0;

    // scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages, loadingAssistantResponse, loadingUserResponse]);

    return <div className="grow pt-4 overflow-auto">
        <div className="max-w-[768px] mx-auto flex flex-col gap-8">
            <SystemMessage
                content={testProfile?.context || systemMessage || ''}
                onChange={onSystemMessageChange}
                locked={testProfile !== null}
            />
            {messages.map((message, index) => {
                if (message.role === 'assistant') {
                    if ('tool_calls' in message) {
                        return <ToolCalls
                            key={index}
                            toolCalls={message.tool_calls}
                            results={toolCallResults}
                            projectId={projectId}
                            messages={messages}
                            sender={message.agenticSender}
                            workflow={workflow}
                            testProfile={testProfile}
                            systemMessage={systemMessage}
                        />;
                    } else {
                        // the assistant message createdAt is an ISO string timestamp
                        const latency = new Date(message.createdAt).getTime() - lastUserMessageTimestamp;
                        if (message.agenticResponseType === 'internal') {
                            return (
                                <InternalAssistantMessage
                                    key={index}
                                    content={message.content}
                                    sender={message.agenticSender}
                                    latency={latency}
                                />
                            );
                        } else {
                            return (
                                <AssistantMessage
                                    key={index}
                                    content={message.content}
                                    sender={message.agenticSender}
                                    latency={latency}
                                />
                            );
                        }
                    }
                }
                if (message.role === 'user' && typeof message.content === 'string') {
                    lastUserMessageTimestamp = new Date(message.createdAt).getTime();
                    return <UserMessage key={index} content={message.content} />;
                }
                return <></>;
            })}
            {loadingAssistantResponse && <AssistantMessageLoading key="assistant-loading" />}
            {loadingUserResponse && <UserMessageLoading key="user-loading" />}
            <div ref={messagesEndRef} />
        </div>
    </div>;
}