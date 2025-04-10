'use client';
import { Button } from "@/components/ui/button";
import { useRef, useState, createContext, useContext, useCallback, forwardRef, useImperativeHandle, useEffect, Ref } from "react";
import { CopilotChatContext } from "../../../lib/types/copilot_types";
import { CopilotMessage } from "../../../lib/types/copilot_types";
import { CopilotAssistantMessageActionPart } from "../../../lib/types/copilot_types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { z } from "zod";
import { getCopilotResponse } from "@/app/actions/copilot_actions";
import { Action as WorkflowDispatch } from "../workflow/workflow_editor";
import { Panel } from "@/components/common/panel-common";
import { ComposeBoxCopilot } from "@/components/common/compose-box-copilot";
import { Messages } from "./components/messages";
import { CopyIcon, CheckIcon, PlusIcon, XIcon } from "lucide-react";

const CopilotContext = createContext<{
    workflow: z.infer<typeof Workflow> | null;
    handleApplyChange: (messageIndex: number, actionIndex: number, field?: string) => void;
    appliedChanges: Record<string, boolean>;
}>({ workflow: null, handleApplyChange: () => { }, appliedChanges: {} });

export function getAppliedChangeKey(messageIndex: number, actionIndex: number, field: string) {
    return `${messageIndex}-${actionIndex}-${field}`;
}

interface AppProps {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: any) => void;
    chatContext?: any;
    onCopyJson?: (data: { messages: any[], lastRequest: any, lastResponse: any }) => void;
}

const App = forwardRef<{ handleCopyChat: () => void }, AppProps>(function App({
    projectId,
    workflow,
    dispatch,
    chatContext = undefined,
    onCopyJson,
}, ref) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [messages, setMessages] = useState<z.infer<typeof CopilotMessage>[]>([]);
    const [loadingResponse, setLoadingResponse] = useState(false);
    const [responseError, setResponseError] = useState<string | null>(null);
    const [appliedChanges, setAppliedChanges] = useState<Record<string, boolean>>({});
    const [discardContext, setDiscardContext] = useState(false);
    const [lastRequest, setLastRequest] = useState<unknown | null>(null);
    const [lastResponse, setLastResponse] = useState<unknown | null>(null);

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

    // Get the effective context based on user preference
    const effectiveContext = discardContext ? null : chatContext;

    function handleUserMessage(prompt: string) {
        setMessages(currentMessages => [...currentMessages, {
            role: 'user',
            content: prompt
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

    // Effect for handling copilot responses
    useEffect(() => {
        let ignore = false;

        async function process() {
            if (!messages.length) return;
            
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role !== 'user') return;
            
            setLoadingResponse(true);

            try {
                const response = await getCopilotResponse(
                    projectId,
                    messages,
                    workflow,
                    effectiveContext || null,
                );
                
                if (ignore) return;
                
                setLastRequest(response.rawRequest);
                setLastResponse(response.rawResponse);
                setMessages(currentMessages => [...currentMessages, response.message]);
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

        process();

        return () => {
            ignore = true;
        };
    }, [messages, projectId, workflow, effectiveContext]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loadingResponse]);

    const handleCopyChat = useCallback(() => {
        if (onCopyJson) {
            onCopyJson({
                messages,
                lastRequest,
                lastResponse,
            });
        }
    }, [messages, lastRequest, lastResponse, onCopyJson]);

    useImperativeHandle(ref, () => ({
        handleCopyChat
    }), [handleCopyChat]);

    return (
        <CopilotContext.Provider value={{ workflow, handleApplyChange, appliedChanges }}>
            <div className="h-full flex flex-col">
                <div className="flex-1 overflow-auto">
                    <Messages
                        messages={messages}
                        loadingResponse={loadingResponse}
                        workflow={workflow}
                        handleApplyChange={handleApplyChange}
                        appliedChanges={appliedChanges}
                    />
                </div>
                <div className="shrink-0 px-1 pb-6">
                    {responseError && (
                        <div className="mb-4 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex gap-2 justify-between items-center text-sm">
                            <p className="text-red-600 dark:text-red-400">{responseError}</p>
                            <Button
                                size="sm"
                                color="danger"
                                onClick={() => setResponseError(null)}
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
                        disabled={loadingResponse}
                    />
                </div>
            </div>
        </CopilotContext.Provider>
    );
});

export function Copilot({
    projectId,
    workflow,
    chatContext = undefined,
    dispatch,
}: {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    chatContext?: z.infer<typeof CopilotChatContext>;
    dispatch: (action: WorkflowDispatch) => void;
}) {
    const [copilotKey, setCopilotKey] = useState(0);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const appRef = useRef<{ handleCopyChat: () => void }>(null);

    function handleNewChat() {
        setCopilotKey(prev => prev + 1);
    }

    function handleCopyJson(data: { messages: any[], lastRequest: any, lastResponse: any }) {
        const jsonString = JSON.stringify(data, null, 2);
        navigator.clipboard.writeText(jsonString);
        setShowCopySuccess(true);
        setTimeout(() => {
            setShowCopySuccess(false);
        }, 2000);
    }

    return (
        <Panel variant="copilot"
            title={
                <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        COPILOT
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
                />
            </div>
        </Panel>
    );
}

