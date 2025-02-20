'use client';
import { Button, Spinner, Textarea } from "@nextui-org/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import z from "zod";
import { Workflow } from "../../../lib/types/workflow_types";
import { WorkflowTool } from "../../../lib/types/workflow_types";
import { WebpageCrawlResponse } from "../../../lib/types/tool_types";
import { GetInformationToolResult } from "../../../lib/types/tool_types";
import { executeClientTool, getInformationTool, scrapeWebpage, suggestToolResponse } from "../../../actions/actions";
import MarkdownContent from "../../../lib/components/markdown-content";
import Link from "next/link";
import { apiV1 } from "rowboat-shared";
import { EditableField } from "../../../lib/components/editable-field";
import { MessageSquareIcon, EllipsisIcon, CircleCheckIcon, ChevronsDownIcon, ChevronsRightIcon, ChevronRightIcon, ChevronDownIcon, ExternalLinkIcon, XIcon } from "lucide-react";

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
    handleResults,
    projectId,
    messages,
    sender,
    workflow,
}: {
    toolCalls: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'];
    results: Record<string, z.infer<typeof apiV1.ToolMessage>>;
    handleResults: (results: z.infer<typeof apiV1.ToolMessage>[]) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
}) {
    const resultsMap: Record<string, z.infer<typeof apiV1.ToolMessage>> = {};

    function handleToolCallResult(result: z.infer<typeof apiV1.ToolMessage>) {
        resultsMap[result.tool_call_id] = result;
        if (Object.keys(resultsMap).length === toolCalls.length) {
            const results = Object.values(resultsMap);
            handleResults(results);
        }
    }

    return <div className="flex flex-col gap-4">
        {toolCalls.map(toolCall => {
            return <ToolCall
                key={toolCall.id}
                toolCall={toolCall}
                result={results[toolCall.id]}
                handleResult={handleToolCallResult}
                projectId={projectId}
                messages={messages}
                sender={sender}
                workflow={workflow}
            />
        })}
    </div>;
}

function ToolCall({
    toolCall,
    result,
    handleResult,
    projectId,
    messages,
    sender,
    workflow,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    handleResult: (result: z.infer<typeof apiV1.ToolMessage>) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
}) {
    let matchingWorkflowTool: z.infer<typeof WorkflowTool> | undefined;
    for (const tool of workflow.tools) {
        if (tool.name === toolCall.function.name) {
            matchingWorkflowTool = tool;
            break;
        }
    }

    switch (toolCall.function.name) {
        case 'retrieve_url_info':
            return <RetrieveUrlInfoToolCall
                toolCall={toolCall}
                result={result}
                handleResult={handleResult}
                projectId={projectId}
                messages={messages}
                sender={sender}
            />;
        case 'getArticleInfo':
            return <GetInformationToolCall
                toolCall={toolCall}
                result={result}
                handleResult={handleResult}
                projectId={projectId}
                messages={messages}
                sender={sender}
                workflow={workflow}
            />;
        default:
            if (toolCall.function.name.startsWith('transfer_to_')) {
                return <TransferToAgentToolCall
                    toolCall={toolCall}
                    result={result}
                    handleResult={handleResult}
                    projectId={projectId}
                    messages={messages}
                    sender={sender}
                />;
            }
            if (matchingWorkflowTool && !matchingWorkflowTool.mockInPlayground) {
                return <ClientToolCall
                    toolCall={toolCall}
                    result={result}
                    handleResult={handleResult}
                    projectId={projectId}
                    messages={messages}
                    sender={sender}
                />;
            }
            return <MockToolCall
                toolCall={toolCall}
                result={result}
                handleResult={handleResult}
                projectId={projectId}
                messages={messages}
                sender={sender}
                autoSubmit={matchingWorkflowTool?.autoSubmitMockedResponse}
            />;
    }
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

function GetInformationToolCall({
    toolCall,
    result: availableResult,
    handleResult,
    projectId,
    messages,
    sender,
    workflow,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    handleResult: (result: z.infer<typeof apiV1.ToolMessage>) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    workflow: z.infer<typeof Workflow>;
}) {
    const [result, setResult] = useState<z.infer<typeof apiV1.ToolMessage> | undefined>(availableResult);
    const args = JSON.parse(toolCall.function.arguments) as { question: string };
    let typedResult: z.infer<typeof GetInformationToolResult> | undefined;
    if (result) {
        typedResult = JSON.parse(result.content) as z.infer<typeof GetInformationToolResult>;
    }

    useEffect(() => {
        if (result) {
            return;
        }
        let ignore = false;

        async function process() {
            const result: z.infer<typeof apiV1.ToolMessage> = {
                role: 'tool',
                tool_call_id: toolCall.id,
                tool_name: toolCall.function.name,
                content: '',
            };
            // find target agent
            const agent = workflow.agents.find(agent => agent.name == sender);
            if (!agent || !agent.ragDataSources) {
                result.content = JSON.stringify({
                    results: [],
                });
            } else {
                const matches = await getInformationTool(projectId, args.question, agent.ragDataSources, agent.ragReturnType, agent.ragK);
                if (ignore) {
                    return;
                }
                result.content = JSON.stringify(matches);
            }
            setResult(result);
            handleResult(result);
        }
        process();

        return () => {
            ignore = true;
        };
    }, [result, toolCall.id, toolCall.function.name, projectId, args.question, workflow.agents, sender, handleResult]);

    return <div className="flex flex-col gap-1">
        {sender && <div className='text-gray-500 text-sm ml-3'>{sender}</div>}
        <div className='border border-gray-300 p-2 rounded-lg rounded-bl-none flex flex-col gap-2 mr-[30%]'>
            <ToolCallHeader toolCall={toolCall} result={result} />

            <div className='mt-1'>
                {result ? 'Fetched' : 'Fetch'} information for question: <span className='font-mono font-semibold'>{args['question']}</span>
                {result && <div className='flex flex-col gap-2 mt-2 pt-2 border-t border-t-gray-200'>
                    {typedResult && typedResult.results.length === 0 && <div>No matches found.</div>}
                    {typedResult && typedResult.results.length > 0 && <ul className="list-disc ml-6">
                        {typedResult.results.map((result, index) => {
                            return <li key={'' + index} className="mb-2">
                                <ExpandableContent
                                    label={result.title || result.name}
                                    content={result.content}
                                    expanded={false}
                                />
                            </li>
                        })}
                    </ul>}
                </div>}
            </div>
        </div>
    </div>;
}

function RetrieveUrlInfoToolCall({
    toolCall,
    result: availableResult,
    handleResult,
    projectId,
    messages,
    sender,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    handleResult: (result: z.infer<typeof apiV1.ToolMessage>) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
}) {
    const [result, setResult] = useState<z.infer<typeof apiV1.ToolMessage> | undefined>(availableResult);
    const args = JSON.parse(toolCall.function.arguments) as { url: string };
    let typedResult: z.infer<typeof WebpageCrawlResponse> | undefined;
    if (result) {
        typedResult = JSON.parse(result.content) as z.infer<typeof WebpageCrawlResponse>;
    }

    useEffect(() => {
        if (result) {
            return;
        }
        let ignore = false;

        function process() {
            // parse args

            scrapeWebpage(args.url)
                .then(page => {
                    if (ignore) {
                        return;
                    }
                    const result: z.infer<typeof apiV1.ToolMessage> = {
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        tool_name: toolCall.function.name,
                        content: JSON.stringify(page),
                    };
                    setResult(result);
                    handleResult(result);
                });
        }
        process();

        return () => {
            ignore = true;
        };
    }, [result, toolCall.id, toolCall.function.name, projectId, args.url, handleResult]);

    return <div className="flex flex-col gap-1">
        {sender && <div className='text-gray-500 text-sm ml-3'>{sender}</div>}
        <div className='border border-gray-300 p-2 rounded-lg rounded-bl-none flex flex-col gap-2 mr-[30%]'>
            <ToolCallHeader toolCall={toolCall} result={result} />

            <div className='mt-1 flex flex-col gap-2'>
                <div className="flex gap-1">
                    URL: <a className="inline-flex items-center gap-1" target="_blank" href={args.url}>
                        <span className='underline'>
                            {args.url}
                        </span>
                        <ExternalLinkIcon size={16} />
                    </a>
                </div>
                {result && (
                    <ExpandableContent
                        label='Content'
                        content={typedResult}
                        expanded={false}
                    />
                )}
            </div>
        </div>
    </div>;
}

function TransferToAgentToolCall({
    toolCall,
    result: availableResult,
    handleResult,
    projectId,
    messages,
    sender,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    handleResult: (result: z.infer<typeof apiV1.ToolMessage>) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
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
    handleResult,
    projectId,
    messages,
    sender,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    handleResult: (result: z.infer<typeof apiV1.ToolMessage>) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
}) {
    const [result, setResult] = useState<z.infer<typeof apiV1.ToolMessage> | undefined>(availableResult);

    useEffect(() => {
        if (result) {
            return;
        }
        let ignore = false;

        async function process() {
            let response;
            try {
                response = await executeClientTool(
                    toolCall,
                    messages,
                    projectId,
                );
            } catch (e) {
                response = {
                    error: (e as Error).message,
                };
            }
            if (ignore) {
                return;
            }

            const result: z.infer<typeof apiV1.ToolMessage> = {
                role: 'tool',
                tool_call_id: toolCall.id,
                tool_name: toolCall.function.name,
                content: JSON.stringify(response),
            };
            setResult(result);
            handleResult(result);
        }
        process();

        return () => {
            ignore = true;
        };
    }, [result, toolCall, projectId, messages, handleResult]);

    return <div className="flex flex-col gap-1">
        {sender && <div className='text-gray-500 text-sm ml-3'>{sender}</div>}
        <div className='border border-gray-300 p-2 pt-2 rounded-lg rounded-bl-none flex flex-col gap-2 mr-[30%]'>
            <ToolCallHeader toolCall={toolCall} result={result} />

            <div className='flex flex-col gap-2'>
                <ExpandableContent label='Params' content={toolCall.function.arguments} expanded={Boolean(!result)} />
                {result && <ExpandableContent label='Result' content={result.content} expanded={true} />}
            </div>
        </div>
    </div>;
}

function MockToolCall({
    toolCall,
    result: availableResult,
    handleResult,
    projectId,
    messages,
    sender,
    autoSubmit = false,
}: {
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number];
    result: z.infer<typeof apiV1.ToolMessage> | undefined;
    handleResult: (result: z.infer<typeof apiV1.ToolMessage>) => void;
    projectId: string;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    sender: string | null | undefined;
    autoSubmit?: boolean;
}) {
    const [result, setResult] = useState<z.infer<typeof apiV1.ToolMessage> | undefined>(availableResult);
    const [response, setResponse] = useState('');
    const [generatingResponse, setGeneratingResponse] = useState(false);

    const handleSubmit = useCallback(() => {
        let parsed;
        try {
            parsed = JSON.parse(response);
        } catch (e) {
            alert('Invalid JSON');
            return;
        }
        const result: z.infer<typeof apiV1.ToolMessage> = {
            role: 'tool',
            tool_call_id: toolCall.id,
            tool_name: toolCall.function.name,
            content: JSON.stringify(parsed),
        };
        setResult(result);
        handleResult(result);
    }, [toolCall.id, toolCall.function.name, handleResult, response]);

    useEffect(() => {
        if (result) {
            return;
        }
        if (response) {
            return;
        }
        let ignore = false;

        async function process() {
            setGeneratingResponse(true);

            const response = await suggestToolResponse(toolCall.id, projectId, messages);
            if (ignore) {
                return;
            }
            setResponse(response);
            setGeneratingResponse(false);
        }
        process();

        return () => {
            ignore = true;
        };
    }, [result, response, toolCall.id, projectId, messages]);

    // auto submit if autoSubmitMockedResponse is true
    useEffect(() => {
        if (!autoSubmit) {
            return;
        }
        if (result) {
            return;
        }
        if (response) {
            handleSubmit();
        }
    }, [autoSubmit, response, handleSubmit, result]);

    return <div className="flex flex-col gap-1">
        {sender && <div className='text-gray-500 dark:text-gray-400 text-xs ml-3'>{sender}</div>}
        <div className='border border-gray-300 dark:border-gray-700 p-2 pt-2 rounded-lg rounded-bl-none flex flex-col gap-2 mr-[30%] bg-white dark:bg-gray-900'>
            <div className="flex items-center gap-2">
                <CircleCheckIcon size={16} className="text-gray-500 dark:text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                    Function Call: <code className='bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded font-mono'>{toolCall.function.name}</code>
                </span>
            </div>

            <div className='flex flex-col gap-2'>
                <ExpandableContent label='Params' content={toolCall.function.arguments} expanded={false} />
                {result && <ExpandableContent label='Result' content={result.content} expanded={false} />}
            </div>

            {!result && !autoSubmit && <div className='flex flex-col gap-2 mt-2'>
                <div>Response:</div>
                <Textarea
                    maxRows={10}
                    placeholder='{}'
                    variant="bordered"
                    value={response}
                    disabled={generatingResponse}
                    onValueChange={(value) => setResponse(value)}
                    className='font-mono'
                    size="sm"
                >
                </Textarea>
                <Button
                    onClick={handleSubmit}
                    disabled={generatingResponse}
                    isLoading={generatingResponse}
                    size="sm"
                >
                    Submit result
                </Button>
            </div>}
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
    locked
}: {
    content: string,
    onChange: (content: string) => void,
    locked: boolean
}) {
    return (
        <div className="border border-gray-300 dark:border-gray-700 p-2 rounded-lg flex flex-col gap-2 bg-white dark:bg-gray-900">
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">CONTEXT</div>
            <EditableField
                light
                value={content}
                onChange={onChange}
                multiline
                markdown
                locked={locked}
                placeholder={`Provide context about the user (e.g. user ID, user name) to the assistant at the start of chat, for testing purposes.`}
            />
        </div>
    );
}

export function Messages({
    projectId,
    systemMessage,
    messages,
    toolCallResults,
    handleToolCallResults,
    loadingAssistantResponse,
    loadingUserResponse,
    workflow,
    onSystemMessageChange,
}: {
    projectId: string;
    systemMessage: string | undefined;
    messages: z.infer<typeof apiV1.ChatMessage>[];
    toolCallResults: Record<string, z.infer<typeof apiV1.ToolMessage>>;
    handleToolCallResults: (results: z.infer<typeof apiV1.ToolMessage>[]) => void;
    loadingAssistantResponse: boolean;
    loadingUserResponse: boolean;
    workflow: z.infer<typeof Workflow>;
    onSystemMessageChange: (message: string) => void;
}) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    let lastUserMessageTimestamp = 0;

    const systemMessageLocked = messages.length > 0;

    // scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages, loadingAssistantResponse, loadingUserResponse]);

    return <div className="grow pt-4 overflow-auto">
        <div className="max-w-[768px] mx-auto flex flex-col gap-8">
            <SystemMessage
                content={systemMessage || ''}
                onChange={onSystemMessageChange}
                locked={systemMessageLocked}
            />
            {messages.map((message, index) => {
                if (message.role === 'assistant') {
                    if ('tool_calls' in message) {
                        return <ToolCalls
                            key={index}
                            toolCalls={message.tool_calls}
                            results={toolCallResults}
                            handleResults={handleToolCallResults}
                            projectId={projectId}
                            messages={messages}
                            sender={message.agenticSender}
                            workflow={workflow}
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