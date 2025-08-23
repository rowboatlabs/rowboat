'use client';
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger, Spinner, Tooltip } from "@heroui/react";
import { useRef, useState, createContext, useContext, useCallback, forwardRef, useImperativeHandle, useEffect, Ref } from "react";
import { CopilotChatContext } from "../../../../src/entities/models/copilot";
import { CopilotMessage } from "../../../../src/entities/models/copilot";
import { Workflow } from "@/app/lib/types/workflow_types";
import { DataSource } from "@/src/entities/models/data-source";
import { z } from "zod";
import { Action as WorkflowDispatch } from "@/app/projects/[projectId]/workflow/workflow_editor";
import { Panel } from "@/components/common/panel-common";
import { ComposeBoxCopilot } from "@/components/common/compose-box-copilot";
import { Messages } from "./components/messages";
import { CopyIcon, CheckIcon, PlusIcon, XIcon, InfoIcon, Sparkles } from "lucide-react";
import { useCopilot } from "./use-copilot";
import { BillingUpgradeModal } from "@/components/common/billing-upgrade-modal";
import { SHOW_COPILOT_MARQUEE } from "@/app/lib/feature_flags";
import Image from "next/image";
import mascot from "@/public/mascot.png";

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
    const [statusBar, setStatusBar] = useState<any>(null);

    // Always use effectiveContext for the user's current selection
    const effectiveContext = discardContext ? null : chatContext;

    // Context locking state
    const [lockedContext, setLockedContext] = useState<any>(effectiveContext);
    const [pendingContext, setPendingContext] = useState<any>(effectiveContext);
    const [isStreaming, setIsStreaming] = useState(false);

    // Keep workflow ref up to date
    workflowRef.current = workflow;

    // Copilot streaming state
    const {
        streamingResponse,
        loading: loadingResponse,
        toolCalling,
        toolQuery,
        error: responseError,
        clearError: clearResponseError,
        billingError,
        clearBillingError,
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

    // Memoized handleUserMessage for useImperativeHandle and hooks
    const handleUserMessage = useCallback((prompt: string) => {
        // Before starting streaming, lock the context to the current pendingContext
        setLockedContext(pendingContext);
        setMessages(currentMessages => [...currentMessages, {
            role: 'user',
            content: prompt
        }]);
        setIsLastInteracted(true);
    }, [setMessages, setIsLastInteracted, pendingContext, setLockedContext]);

    // Effect for getting copilot response
    useEffect(() => {
        if (!messages.length || messages.at(-1)?.role !== 'user') return;

        if (responseError) {
            return;
        }

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
    }, [messages, responseError]);

    // --- CONTEXT LOCKING LOGIC ---
    // Always update pendingContext to the latest effectiveContext
    useEffect(() => {
        setPendingContext(effectiveContext);
    }, [effectiveContext]);

    // Lock/unlock context based on streaming state
    useEffect(() => {
        if (loadingResponse) {
            // Streaming started: lock context to the value at the start
            setIsStreaming(true);
            setLockedContext((prev: any) => prev ?? pendingContext); // lock to previous if already set, else to pending
        } else {
            // Streaming ended: update lockedContext to the last pendingContext
            setIsStreaming(false);
            setLockedContext(pendingContext);
        }
    }, [loadingResponse, pendingContext]);

    // After streaming ends, update lockedContext live as effectiveContext changes
    useEffect(() => {
        if (!isStreaming) {
            setLockedContext(effectiveContext);
        }
        // If streaming, do not update lockedContext
    }, [effectiveContext, isStreaming]);
    // --- END CONTEXT LOCKING LOGIC ---

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
    }), [handleCopyChat, handleUserMessage]);

    // Memoized status bar change handler to prevent infinite update loop
    const handleStatusBarChange = useCallback((status: any) => {
        setStatusBar((prev: any) => {
            // Shallow compare previous and next status
            const next = { ...status, context: lockedContext };
            const keys = Object.keys(next);
            if (
                prev &&
                keys.every(key => prev[key] === next[key])
            ) {
                return prev;
            }
            return next;
        });
    }, [lockedContext]);

    return (
        <CopilotContext.Provider value={{ workflow: workflowRef.current, dispatch }}>
            <div className="h-full flex flex-col">
                <div className="flex-1 overflow-auto">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-4 pointer-events-none">
                            {/* Replace Sparkles icon with mascot image */}
                            <Image src={mascot} alt="Rowboat Mascot" width={160} height={160} className="object-contain mb-3 animate-float" />
                            
                            {/* Welcome/Intro Section */}
                            <div className="text-center max-w-md px-6 mb-3">
                                <h3 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2 text-center">
                                    👋 Hi there!
                                </h3>
                                <p className="text-base text-zinc-600 dark:text-zinc-400 mb-4 text-center">
                                    I&apos;m your copilot for building agents and adding tools to them.
                                </p>
                                <p className="text-base text-zinc-600 dark:text-zinc-400 mb-3 text-center">
                                    Here&apos;s what you can do in Rowboat:
                                </p>
                                <div className="space-y-2 max-w-2xl mx-auto text-left">
                                    <div className="flex items-start gap-3">
                                        <span className="text-lg">⚡</span>
                                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Build AI agents instantly with natural language.</span>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <span className="text-lg">🔌</span>
                                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Connect tools with one-click integrations.</span>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <span className="text-lg">📂</span>
                                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Power with knowledge by adding documents for RAG.</span>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <span className="text-lg">🔄</span>
                                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Automate workflows by setting up triggers and actions.</span>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <span className="text-lg">🚀</span>
                                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Deploy anywhere via API or SDK.</span>
                                    </div>
                                </div>
                            </div>
                            
                            {SHOW_COPILOT_MARQUEE && (
                                <div className="relative mt-2 max-w-full px-8">
                                    <div className="font-mono text-sm whitespace-nowrap text-blue-400/60 dark:text-blue-500/40 font-small inline-flex">
                                        <div className="overflow-hidden w-0 animate-typing">What can I help you build?</div>
                                        <div className="border-r-2 border-blue-400 dark:border-blue-500 animate-cursor">&nbsp;</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <Messages
                        messages={messages}
                        streamingResponse={streamingResponse}
                        loadingResponse={loadingResponse}
                        workflow={workflowRef.current}
                        dispatch={dispatch}
                        onStatusBarChange={handleStatusBarChange}
                    />
                </div>
                {toolCalling && (
                    <div className="shrink-0 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm dark:shadow-gray-950/20 rounded-2xl mx-1 mb-2">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <Spinner size="sm" className="ml-2" />
                            <span>
                                Searching for tools{toolQuery ? ` to ${toolQuery}` : '...'}
                            </span>
                        </div>
                    </div>
                )}
                <div className="shrink-0 px-1">
                    {responseError && (
                        <div className="mb-4 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex gap-2 justify-between items-center text-sm">
                            <p className="text-red-600 dark:text-red-400">{responseError}</p>
                            <Button
                                size="sm"
                                color="danger"
                                onClick={() => {
                                    // remove the last assistant message, if any
                                    setMessages(prev => {
                                        const lastMessage = prev[prev.length - 1];
                                        if (lastMessage?.role === 'assistant') {
                                            return prev.slice(0, -1);
                                        }
                                        return prev;
                                    });
                                    clearResponseError();
                                }}
                            >
                                Retry
                            </Button>
                        </div>
                    )}
                    <ComposeBoxCopilot
                        handleUserMessage={handleUserMessage}
                        messages={messages}
                        loading={loadingResponse}
                        initialFocus={isInitialState}
                        shouldAutoFocus={isLastInteracted}
                        onFocus={() => setIsLastInteracted(true)}
                        onCancel={cancel}
                        statusBar={statusBar || { context: lockedContext }}
                    />
                </div>
            </div>
            <BillingUpgradeModal
                isOpen={!!billingError}
                onClose={clearBillingError}
                errorMessage={billingError || ''}
            />
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
    const [billingError, setBillingError] = useState<string | null>(null);
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
        <>
            <Panel 
                variant="copilot"
                tourTarget="copilot"
                icon={<Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
                title="Skipper"
                subtitle="Build your assistant"
                rightActions={
                    <div className="flex items-center gap-2">
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
        </>
    );
});

Copilot.displayName = 'Copilot';

