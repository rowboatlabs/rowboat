'use client';
import { Button, Textarea } from "@heroui/react";
import { ActionButton, StructuredPanel } from "../../../lib/components/structured-panel";
import { useEffect, useRef, useState, createContext, useContext, useCallback } from "react";
import { CopilotChatContext } from "../../../lib/types/copilot_types";
import { CopilotMessage } from "../../../lib/types/copilot_types";
import { CopilotAssistantMessage } from "../../../lib/types/copilot_types";
import { CopilotAssistantMessageActionPart } from "../../../lib/types/copilot_types";
import { CopilotUserMessage } from "../../../lib/types/copilot_types";
import { Workflow } from "../../../lib/types/workflow_types";
import { z } from "zod";
import { getCopilotResponse } from "@/app/actions/copilot_actions";
import { Action } from "./copilot_action_components";
import clsx from "clsx";
import { Action as WorkflowDispatch } from "./workflow_editor";
import MarkdownContent from "../../../lib/components/markdown-content";
import { CopyAsJsonButton } from "../playground/copy-as-json-button";
import { CornerDownLeftIcon, SendIcon } from "lucide-react";
import { useSearchParams } from 'next/navigation';


const CopilotContext = createContext<{
    workflow: z.infer<typeof Workflow> | null;
    handleApplyChange: (messageIndex: number, actionIndex: number, field?: string) => void;
    appliedChanges: Record<string, boolean>;
}>({ workflow: null, handleApplyChange: () => {}, appliedChanges: {} });

export function getAppliedChangeKey(messageIndex: number, actionIndex: number, field: string) {
    return `${messageIndex}-${actionIndex}-${field}`;
}

function AnimatedEllipsis() {
    const [dots, setDots] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => prev === 3 ? 0 : prev + 1);
        }, 500);

        return () => clearInterval(interval);
    }, []);

    return <span className="inline-block w-8">{'.'.repeat(dots)}</span>;
}

function ComposeBox({
    handleUserMessage,
    messages,
}: {
    handleUserMessage: (prompt: string) => void;
    messages: z.infer<typeof CopilotMessage>[];
}) {
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    function handleInput() {
        const prompt = input.trim();
        if (!prompt) {
            return;
        }
        setInput('');

        handleUserMessage(prompt);
    }

    function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleInput();
        }
    }

    // focus on the input field
    // only when there is at least one message
    useEffect(() => {
        if (messages.length > 0) {
            inputRef.current?.focus();
        }
    }, [messages]);

    return <Textarea
        required
        ref={inputRef}
        variant="bordered"
        placeholder="Enter message..."
        minRows={3}
        maxRows={15}
        value={input}
        onValueChange={setInput}
        onKeyDown={handleInputKeyDown}
        className="w-full"
        endContent={<Button
            size="sm"
            isIconOnly
            onPress={handleInput}
            className="bg-gray-100 dark:bg-gray-800"
        >
            <CornerDownLeftIcon size={16} />
        </Button>}
    />
}

function RawJsonResponse({
    message,
}: {
    message: z.infer<typeof CopilotAssistantMessage>;
}) {
    const [expanded, setExpanded] = useState(false);
    return <div className="flex flex-col gap-2">
        <button
            className="w-4 text-gray-300 hover:text-gray-600 dark:hover:text-gray-300"
            onClick={() => setExpanded(!expanded)}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-rectangle-ellipsis"><rect width="20" height="12" x="2" y="6" rx="2" /><path d="M12 12h.01" /><path d="M17 12h.01" /><path d="M7 12h.01" /></svg>
        </button>
        <pre className={clsx("text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm p-2 overflow-x-auto", {
            'hidden': !expanded,
        })}>
            {JSON.stringify(message.content, null, 2)}
        </pre>
    </div>;
}

function AssistantMessage({
    message,
    msgIndex,
    stale,
}: {
    message: z.infer<typeof CopilotAssistantMessage>;
    msgIndex: number;
    stale: boolean;
}) {
    const { workflow, handleApplyChange, appliedChanges } = useContext(CopilotContext);
    if (!workflow) {
        return <></>;
    }

    return <div className="flex flex-col gap-2 mb-8">
        <RawJsonResponse message={message} />
        <div className="flex flex-col gap-2">
            {message.content.response.map((part, index) => {
                if (part.type === "text") {
                    return <div key={index} className="text-sm">
                        <MarkdownContent content={part.content} />
                    </div>;
                } else if (part.type === "action") {
                    return <Action
                        key={index}
                        msgIndex={msgIndex}
                        actionIndex={index}
                        action={part.content}
                        workflow={workflow}
                        handleApplyChange={handleApplyChange}
                        appliedChanges={appliedChanges}
                        stale={stale}
                    />;
                }
            })}
        </div>
    </div>;
}

function UserMessage({
    message,
}: {
    message: z.infer<typeof CopilotUserMessage>;
}) {
    return <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm px-2 text-sm">
        <MarkdownContent content={message.content} />
    </div>
}

function App({
    projectId,
    workflow,
    dispatch,
    chatContext=undefined,
    messages,
    setMessages,
    loadingResponse,
    setLoadingResponse,
    loadingMessage,
    setLoadingMessage,
    responseError,
    setResponseError,
}: {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: WorkflowDispatch) => void;
    chatContext?: z.infer<typeof CopilotChatContext>;
    messages: z.infer<typeof CopilotMessage>[];
    setMessages: (messages: z.infer<typeof CopilotMessage>[]) => void;
    loadingResponse: boolean;
    setLoadingResponse: (loading: boolean) => void;
    loadingMessage: string;
    setLoadingMessage: (message: string) => void;
    responseError: string | null;
    setResponseError: (error: string | null) => void;
}) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [appliedChanges, setAppliedChanges] = useState<Record<string, boolean>>({});
    const [discardContext, setDiscardContext] = useState(false);
    const [lastRequest, setLastRequest] = useState<unknown | null>(null);
    const [lastResponse, setLastResponse] = useState<unknown | null>(null);

    // First useEffect for loading messages
    useEffect(() => {
        setLoadingMessage("Thinking");
        if (!loadingResponse) return;

        const loadingMessages = [
            "Thinking",
            "Planning",
            "Generating",
        ];
        let messageIndex = 0;

        const interval = setInterval(() => {
            if (messageIndex < loadingMessages.length - 1) {
                messageIndex++;
                setLoadingMessage(loadingMessages[messageIndex]);
            }
        }, 4000);

        return () => clearInterval(interval);
    }, [loadingResponse, setLoadingMessage]);

    // Reset discardContext when chatContext changes
    useEffect(() => {
        setDiscardContext(false);
    }, [chatContext]);

    // Get the effective context based on user preference
    const effectiveContext = discardContext ? null : chatContext;

    function handleUserMessage(prompt: string) {
        setMessages([...messages, {
            role: 'user',
            content: prompt,
        }]);
        setResponseError(null);
    }

    const handleApplyChange = useCallback((
        messageIndex: number,
        actionIndex: number,
        field?: string
    ) => {
        // validate
        console.log('apply change', messageIndex, actionIndex, field);
        const msg = messages[messageIndex];
        if (!msg) {
            console.log('no message');
            return;
        }
        if (msg.role !== 'assistant') {
            console.log('not assistant');
            return;
        }
        const action = msg.content.response[actionIndex].content as z.infer<typeof CopilotAssistantMessageActionPart>['content'];
        if (!action) {
            console.log('no action');
            return;
        }
        console.log('reached here');

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
            const appliedKeys = Object.keys(action.config_changes).reduce((acc, key) => {
                acc[getAppliedChangeKey(messageIndex, actionIndex, key)] = true;
                return acc;
            }, {} as Record<string, boolean>);
            setAppliedChanges({
                ...appliedChanges,
                ...appliedKeys,
            });
        } else if (action.action === 'edit') {
            const changes = field
                ? { [field]: action.config_changes[field] }
                : action.config_changes;

            switch (action.config_type) {
                case 'agent':
                    dispatch({
                        type: 'update_agent',
                        name: action.name,
                        agent: changes
                    });
                    break;
                case 'tool':
                    dispatch({
                        type: 'update_tool',
                        name: action.name,
                        tool: changes
                    });
                    break;
                case 'prompt':
                    dispatch({
                        type: 'update_prompt',
                        name: action.name,
                        prompt: changes
                    });
                    break;
            }
            const appliedKeys = Object.keys(changes).reduce((acc, key) => {
                acc[getAppliedChangeKey(messageIndex, actionIndex, key)] = true;
                return acc;
            }, {} as Record<string, boolean>);
            setAppliedChanges({
                ...appliedChanges,
                ...appliedKeys,
            });
        }
    }, [dispatch, appliedChanges, messages]);

    // Second useEffect for copilot response
    useEffect(() => {
        let ignore = false;

        async function process() {
            setLoadingResponse(true);
            setResponseError(null);

            try {
                setLastRequest(null);
                setLastResponse(null);

                const response = await getCopilotResponse(
                    projectId,
                    messages,
                    workflow,
                    effectiveContext || null,
                );
                if (ignore) {
                    return;
                }
                setLastRequest(response.rawRequest);
                setLastResponse(response.rawResponse);
                setMessages([...messages, response.message]);
            } catch (err) {
                if (!ignore) {
                    setResponseError(`Failed to get copilot response: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            } finally {
                if (!ignore) {
                    setLoadingResponse(false);
                }
            }
        }

        // if no messages, return
        if (messages.length === 0) {
            return;
        }

        // if last message is not from role user
        // or tool, return
        const last = messages[messages.length - 1];
        if (responseError) {
            return;
        }
        if (last.role !== 'user') {
            return;
        }

        process();

        return () => {
            ignore = true;
        };
    }, [
        messages,
        projectId,
        responseError,
        workflow,
        effectiveContext,
        setLoadingResponse,
        setMessages,
        setResponseError
    ]);

    function handleCopyChat() {
        const jsonString = JSON.stringify({
            messages: messages,
            lastRequest: lastRequest,
            lastResponse: lastResponse,
        }, null, 2);
        navigator.clipboard.writeText(jsonString);
    }

    // scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages, loadingResponse]);

    return <div className="h-full flex flex-col relative">
        <CopilotContext.Provider value={{ workflow, handleApplyChange, appliedChanges }}>
            <CopyAsJsonButton onCopy={handleCopyChat} />
            <div className="grow flex flex-col gap-2 overflow-auto px-1 mt-6">
                {messages.map((m, index) => {
                    // Calculate if this assistant message is stale
                    const isStale = m.role === 'assistant' && messages.slice(index + 1).some(
                        laterMsg => laterMsg.role === 'assistant' &&
                            'response' in laterMsg.content &&
                            laterMsg.content.response.filter(part => part.type === 'action').length > 0
                    );

                    return <>
                        {m.role === 'user' && (
                            <UserMessage
                                key={index}
                                message={m}
                            />
                        )}
                        {m.role === 'assistant' && (
                            <AssistantMessage
                                key={index}
                                message={m}
                                msgIndex={index}
                                stale={isStale}
                            />
                        )}
                    </>;
                })}
                {loadingResponse && <div className="px-2 py-1 flex items-center animate-pulse text-gray-600 dark:text-gray-400 text-xs">
                    <div>
                        {loadingMessage}
                    </div>
                    <AnimatedEllipsis />
                </div>}
                <div ref={messagesEndRef} />
            </div>
            <div className="shrink-0">
                {responseError && (
                    <div className="max-w-[768px] mx-auto mb-4 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex gap-2 justify-between items-center text-sm">
                        <p className="text-red-600 dark:text-red-400">{responseError}</p>
                        <Button
                            size="sm"
                            color="danger"
                            onPress={() => {
                                setResponseError(null);
                            }}
                        >
                            Retry
                        </Button>
                    </div>
                )}
                {effectiveContext && <div className="flex items-start">
                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 text-sm px-2 py-1 rounded-sm shadow-sm mb-2">
                        <div>
                            {effectiveContext.type === 'chat' && "Chat"}
                            {effectiveContext.type === 'agent' && `Agent: ${effectiveContext.name}`}
                            {effectiveContext.type === 'tool' && `Tool: ${effectiveContext.name}`}
                            {effectiveContext.type === 'prompt' && `Prompt: ${effectiveContext.name}`}
                        </div>
                        <button 
                            className="text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300" 
                            onClick={() => setDiscardContext(true)}
                        >
                            <svg className="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>}
                <ComposeBox
                    handleUserMessage={handleUserMessage}
                    messages={messages}
                />
            </div>
        </CopilotContext.Provider>
    </div>;
}

export function Copilot({
    projectId,
    workflow,
    chatContext=undefined,
    dispatch,
    onNewChat,
    messages,
    setMessages,
    loadingResponse,
    setLoadingResponse,
    loadingMessage,
    setLoadingMessage,
    responseError,
    setResponseError,
}: {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    chatContext?: z.infer<typeof CopilotChatContext>;
    dispatch: (action: WorkflowDispatch) => void;
    onNewChat: () => void;
    messages: z.infer<typeof CopilotMessage>[];
    setMessages: (messages: z.infer<typeof CopilotMessage>[]) => void;
    loadingResponse: boolean;
    setLoadingResponse: (loading: boolean) => void;
    loadingMessage: string;
    setLoadingMessage: (message: string) => void;
    responseError: string | null;
    setResponseError: (error: string | null) => void;
}) {
    const searchParams = useSearchParams();
    
    // Check for initial prompt in URL and send it
    useEffect(() => {
        const prompt = searchParams.get('prompt');
        if (prompt && messages.length === 0) {
            setMessages([{
                role: 'user',
                content: prompt
            }]);
            
            // Clean up the URL
            const url = new URL(window.location.href);
            url.searchParams.delete('prompt');
            window.history.replaceState({}, '', url);
        }
    }, [searchParams, messages.length, setMessages]);

    return (
        <StructuredPanel 
            fancy 
            title="COPILOT" 
            tooltip="Get AI assistance for creating and improving your multi-agent system"
            actions={[
                <ActionButton
                    key="ask"
                    primary
                    icon={
                        <svg className="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14m-7 7V5" />
                        </svg>
                    }
                    onClick={onNewChat}
                >
                    New
                </ActionButton>
            ]}
        >
            <App
                projectId={projectId}
                workflow={workflow}
                dispatch={dispatch}
                chatContext={chatContext}
                messages={messages}
                setMessages={setMessages}
                loadingResponse={loadingResponse}
                setLoadingResponse={setLoadingResponse}
                loadingMessage={loadingMessage}
                setLoadingMessage={setLoadingMessage}
                responseError={responseError}
                setResponseError={setResponseError}
            />
        </StructuredPanel>
    );
}
