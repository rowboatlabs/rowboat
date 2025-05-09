'use client';
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger, Spinner, Tooltip } from "@heroui/react";
import { useRef, useState, createContext, useContext, useCallback, forwardRef, useImperativeHandle, useEffect, Ref } from "react";
import { CopilotChatContext } from "../../../lib/types/copilot_types";
import { CopilotMessage } from "../../../lib/types/copilot_types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { DataSource } from "@/app/lib/types/datasource_types";
import { z } from "zod";
import { Action as WorkflowDispatch } from "../workflow/workflow_editor";
import { Panel } from "@/components/common/panel-common";
import { ComposeBoxCopilot } from "@/components/common/compose-box-copilot";
import { Messages } from "./components/messages";
import { CopyIcon, CheckIcon, PlusIcon, XIcon, InfoIcon } from "lucide-react";
import { useCopilot } from "./use-copilot";

const CopilotContext = createContext<{
    workflow: z.infer<typeof Workflow> | null;
    dispatch: (action: any) => void;
}>({ workflow: null, dispatch: () => { } });

export function getAppliedChangeKey(messageIndex: number, actionIndex: number, field: string) {
    return `${messageIndex}-${actionIndex}-${field}`;
}

interface AppProps {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: any) => void;
    chatContext?: any;
    onCopyJson?: (data: { messages: any[] }) => void;
    onMessagesChange?: (messages: z.infer<typeof CopilotMessage>[]) => void;
    isInitialState?: boolean;
    dataSources?: z.infer<typeof DataSource>[];
}

const App = forwardRef<{ handleCopyChat: () => void; handleUserMessage: (message: string) => void }, AppProps>(function App({
    projectId,
    workflow,
    dispatch,
    chatContext = undefined,
    onCopyJson,
    onMessagesChange,
    isInitialState = false,
    dataSources,
}, ref) {
    const [messages, setMessages] = useState<z.infer<typeof CopilotMessage>[]>([]);
    const [discardContext, setDiscardContext] = useState(false);
    const [isLastInteracted, setIsLastInteracted] = useState(isInitialState);
    const workflowRef = useRef(workflow);
    const startRef = useRef<any>(null);
    const cancelRef = useRef<any>(null);

    // Keep workflow ref up to date
    workflowRef.current = workflow;

    // Get the effective context based on user preference
    const effectiveContext = discardContext ? null : chatContext;

    const {
        streamingResponse,
        loading: loadingResponse,
        error: responseError,
        start,
        cancel
    } = useCopilot({
        projectId,
        workflow: workflowRef.current,
        context: effectiveContext,
        dataSources: dataSources
    });

    // Store latest start/cancel functions in refs
    startRef.current = start;
    cancelRef.current = cancel;

    // Notify parent of message changes
    useEffect(() => {
        onMessagesChange?.(messages);
    }, [messages, onMessagesChange]);

    // Check for initial prompt in local storage and send it
    useEffect(() => {
        const prompt = localStorage.getItem(`project_prompt_${projectId}`);
        if (prompt && messages.length === 0) {
            localStorage.removeItem(`project_prompt_${projectId}`);
            setMessages([{
                role: 'user',
                content: prompt
            }]);
        }
    }, [projectId, messages.length]);

    // Reset discardContext when chatContext changes
    useEffect(() => {
        setDiscardContext(false);
    }, [chatContext]);

    function handleUserMessage(prompt: string) {
        setMessages(currentMessages => [...currentMessages, {
            role: 'user',
            content: prompt
        }]);
        setIsLastInteracted(true);
    }

    // Effect for getting copilot response
    useEffect(() => {
        if (!messages.length || messages.at(-1)?.role !== 'user') return;

        const currentStart = startRef.current;
        const currentCancel = cancelRef.current;

        currentStart(messages, (finalResponse: string) => {
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: finalResponse
                }
            ]);
        });

        return () => currentCancel();
    }, [messages]); // Only depend on messages

    const handleCopyChat = useCallback(() => {
        if (onCopyJson) {
            onCopyJson({
                messages,
            });
        }
    }, [messages, onCopyJson]);

    useImperativeHandle(ref, () => ({
        handleCopyChat,
        handleUserMessage
    }), [handleCopyChat]);

    return (
        <CopilotContext.Provider value={{ workflow: workflowRef.current, dispatch }}>
            <div className="h-full flex flex-col">
                <div className="flex-1 overflow-auto">
                    <Messages
                        messages={messages}
                        streamingResponse={streamingResponse}
                        loadingResponse={loadingResponse}
                        workflow={workflowRef.current}
                        dispatch={dispatch}
                    />
                </div>
                <div className="shrink-0 px-1 pb-6">
                    {responseError && (
                        <div className="mb-4 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex gap-2 justify-between items-center text-sm">
                            <p className="text-red-600 dark:text-red-400">{responseError}</p>
                            <Button
                                size="sm"
                                color="danger"
                                onClick={() => {
                                    setMessages(prev => [...prev.slice(0, -1)]); // remove last assistant if needed
                                }}
                            >
                                Retry
                            </Button>
                        </div>
                    )}
                    {effectiveContext && <div className="flex items-start mb-2">
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 text-sm px-2 py-1 rounded-sm shadow-sm">
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
                                <XIcon size={16} />
                            </button>
                        </div>
                    </div>}
                    <ComposeBoxCopilot
                        handleUserMessage={handleUserMessage}
                        messages={messages}
                        loading={loadingResponse}
                        initialFocus={isInitialState}
                        shouldAutoFocus={isLastInteracted}
                        onFocus={() => setIsLastInteracted(true)}
                        onCancel={cancel}
                    />
                </div>
            </div>
        </CopilotContext.Provider>
    );
});

App.displayName = 'App';

export const Copilot = forwardRef<{ handleUserMessage: (message: string) => void }, {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    chatContext?: z.infer<typeof CopilotChatContext>;
    dispatch: (action: WorkflowDispatch) => void;
    isInitialState?: boolean;
    dataSources?: z.infer<typeof DataSource>[];
}>(({
    projectId,
    workflow,
    chatContext = undefined,
    dispatch,
    isInitialState = false,
    dataSources,
}, ref) => {
    const [copilotKey, setCopilotKey] = useState(0);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [messages, setMessages] = useState<z.infer<typeof CopilotMessage>[]>([]);
    const appRef = useRef<{ handleCopyChat: () => void; handleUserMessage: (message: string) => void }>(null);

    function handleNewChat() {
        setCopilotKey(prev => prev + 1);
        setMessages([]);
    }

    function handleCopyJson(data: { messages: any[] }) {
        const jsonString = JSON.stringify(data, null, 2);
        navigator.clipboard.writeText(jsonString);
        setShowCopySuccess(true);
        setTimeout(() => {
            setShowCopySuccess(false);
        }, 2000);
    }

    // Expose handleUserMessage through ref
    useImperativeHandle(ref, () => ({
        handleUserMessage: (message: string) => {
            const app = appRef.current as any;
            if (app?.handleUserMessage) {
                app.handleUserMessage(message);
            }
        }
    }), []);

    return (
        <Panel variant="copilot"
            tourTarget="copilot"
            showWelcome={messages.length === 0}
            title={
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            COPILOT
                        </div>
                        <Tooltip content="Ask copilot to help you build and modify your workflow">
                            <InfoIcon className="w-4 h-4 text-gray-400 cursor-help" />
                        </Tooltip>
                    </div>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleNewChat}
                        className="bg-blue-50 text-blue-700 hover:bg-blue-100"
                        showHoverContent={true}
                        hoverContent="New chat"
                    >
                        <PlusIcon className="w-4 h-4" />
                    </Button>
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => appRef.current?.handleCopyChat()}
                        showHoverContent={true}
                        hoverContent={showCopySuccess ? "Copied" : "Copy JSON"}
                    >
                        {showCopySuccess ? (
                            <CheckIcon className="w-4 h-4" />
                        ) : (
                            <CopyIcon className="w-4 h-4" />
                        )}
                    </Button>
                </div>
            }
        >
            <div className="h-full overflow-auto px-3 pt-4">
                <App
                    key={copilotKey}
                    ref={appRef}
                    projectId={projectId}
                    workflow={workflow}
                    dispatch={dispatch}
                    chatContext={chatContext}
                    onCopyJson={handleCopyJson}
                    onMessagesChange={setMessages}
                    isInitialState={isInitialState}
                    dataSources={dataSources}
                />
            </div>
        </Panel>
    );
});

Copilot.displayName = 'Copilot';

