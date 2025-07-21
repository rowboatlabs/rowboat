'use client';
import { useState, useCallback, useRef } from "react";
import { z } from "zod";
import { MCPServer, Message, PlaygroundChat } from "@/app/lib/types/types";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { Chat } from "./components/chat";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@heroui/react";
import { WithStringId } from "@/app/lib/types/types";
import { CheckIcon, CopyIcon, PlusIcon, UserIcon, InfoIcon, BugIcon, BugOffIcon, CodeIcon } from "lucide-react";
import { clsx } from "clsx";

const defaultSystemMessage = '';

export function App({
    hidden = false,
    projectId,
    workflow,
    messageSubscriber,
    mcpServerUrls,
    toolWebhookUrl,
    isInitialState = false,
    onPanelClick,
    projectTools,
    triggerCopilotChat,
    chatMessages: externalChatMessages,
    setChatMessages: externalSetChatMessages,
    systemMessage: externalSystemMessage,
    setSystemMessage: externalSetSystemMessage,
    onNewChat: externalOnNewChat,
    chatSessionCreatedAt,
    configPanel,
    isConfigPanelOpen = false,
}: {
    hidden?: boolean;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof Message>[]) => void;
    mcpServerUrls: Array<z.infer<typeof MCPServer>>;
    toolWebhookUrl: string;
    isInitialState?: boolean;
    onPanelClick?: () => void;
    projectTools: z.infer<typeof WorkflowTool>[];
    triggerCopilotChat?: (message: string) => void;
    chatMessages?: z.infer<typeof Message>[];
    setChatMessages?: (msgs: z.infer<typeof Message>[]) => void;
    systemMessage?: string;
    setSystemMessage?: (msg: string) => void;
    onNewChat?: () => void;
    chatSessionCreatedAt?: string;
    configPanel?: React.ReactNode;
    isConfigPanelOpen?: boolean;
}) {
    // If external state is provided, use it; otherwise, use internal state
    const [internalCounter, setInternalCounter] = useState<number>(0);
    const [internalSystemMessage, setInternalSystemMessage] = useState<string>(defaultSystemMessage);
    const [internalShowDebugMessages, setInternalShowDebugMessages] = useState<boolean>(true);
    const [internalChat, setInternalChat] = useState<z.infer<typeof PlaygroundChat>>({
        projectId,
        createdAt: new Date().toISOString(),
        messages: [],
        simulated: false,
        systemMessage: defaultSystemMessage,
    });
    const [isProfileSelectorOpen, setIsProfileSelectorOpen] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const getCopyContentRef = useRef<(() => string) | null>(null);

    // Use external or internal state
    const chatMessages = externalChatMessages !== undefined ? externalChatMessages : internalChat.messages;
    const setChatMessages = externalSetChatMessages !== undefined ? externalSetChatMessages : (msgs: z.infer<typeof Message>[]) => setInternalChat((c) => ({ ...c, messages: msgs }));
    const systemMessage = externalSystemMessage !== undefined ? externalSystemMessage : internalSystemMessage;
    const setSystemMessage = externalSetSystemMessage !== undefined ? externalSetSystemMessage : setInternalSystemMessage;
    const counter = externalChatMessages !== undefined ? chatMessages.length : internalCounter;
    const showDebugMessages = internalShowDebugMessages;
    const setShowDebugMessages = setInternalShowDebugMessages;
    const createdAt = chatSessionCreatedAt || internalChat.createdAt;

    function handleSystemMessageChange(message: string) {
        setSystemMessage(message);
        if (!externalSetChatMessages) setInternalCounter(internalCounter + 1);
    }

    function handleNewChatButtonClick() {
        if (externalOnNewChat) {
            externalOnNewChat();
        } else {
            setInternalCounter(internalCounter + 1);
            setInternalChat({
                projectId,
                createdAt: new Date().toISOString(),
                messages: [],
                simulated: false,
                systemMessage: defaultSystemMessage,
            });
            setInternalSystemMessage(defaultSystemMessage);
        }
    }

    const handleCopyJson = useCallback(() => {
        if (getCopyContentRef.current) {
            try {
                const data = getCopyContentRef.current();
                navigator.clipboard.writeText(data);
                setShowCopySuccess(true);
                setTimeout(() => {
                    setShowCopySuccess(false);
                }, 2000);
            } catch (error) {
                console.error('Error copying:', error);
            }
        }
    }, []);

    return (
        <>
            <Panel 
                variant="playground"
                tourTarget="playground"
                title={
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                                Playground
                            </div>
                            <Tooltip content="Test your workflow and chat with your agents in real-time">
                                <InfoIcon className="w-4 h-4 text-gray-400 cursor-help" />
                            </Tooltip>
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleNewChatButtonClick}
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100"
                            showHoverContent={true}
                            hoverContent="New chat"
                        >
                            <PlusIcon className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setShowDebugMessages(!showDebugMessages)}
                            className={showDebugMessages ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}
                            showHoverContent={true}
                            hoverContent={showDebugMessages ? "Hide debug messages" : "Show debug messages"}
                        >
                            {showDebugMessages ? (
                                <BugIcon className="w-4 h-4" />
                            ) : (
                                <BugOffIcon className="w-4 h-4" />
                            )}
                        </Button>
                    </div>
                }
                rightActions={
                    <div className="flex items-center gap-3">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCopyJson}
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
                onClick={onPanelClick}
                className="relative"
            >
                <div className="h-full w-full">
                    {/* Chat area */}
                    <div
                        aria-hidden={isConfigPanelOpen}
                        style={isConfigPanelOpen ? { pointerEvents: 'none', filter: 'blur(0px)', opacity: 0.5 } : undefined}
                        className="h-full w-full"
                    >
                        <div className="h-full overflow-auto px-4 py-4">
                            <Chat
                                key={createdAt}
                                chat={{
                                    projectId,
                                    createdAt,
                                    messages: chatMessages,
                                    simulated: false,
                                    systemMessage: systemMessage,
                                }}
                                projectId={projectId}
                                workflow={workflow}
                                messageSubscriber={messageSubscriber}
                                systemMessage={systemMessage}
                                onSystemMessageChange={handleSystemMessageChange}
                                mcpServerUrls={mcpServerUrls}
                                toolWebhookUrl={toolWebhookUrl}
                                onCopyClick={(fn) => { getCopyContentRef.current = fn; }}
                                showDebugMessages={showDebugMessages}
                                projectTools={projectTools}
                                triggerCopilotChat={triggerCopilotChat}
                            />
                        </div>
                    </div>
                </div>
                {/* Overlay config panel - covers the entire panel, including header */}
                {isConfigPanelOpen && (
                    <div className="absolute inset-0 z-30 bg-white dark:bg-zinc-900 overflow-auto">
                        {configPanel}
                    </div>
                )}
            </Panel>
        </>
    );
}
