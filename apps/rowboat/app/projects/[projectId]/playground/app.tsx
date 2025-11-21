'use client';
import { useState, useCallback, useRef } from "react";
import { z } from "zod";
import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { Chat } from "./components/chat";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@heroui/react";
import { CheckIcon, CopyIcon, PlusIcon, InfoIcon, BugIcon, BugOffIcon, MessageCircle } from "lucide-react";

export function App({
    hidden = false,
    projectId,
    workflow,
    messageSubscriber,
    onPanelClick,
    triggerCopilotChat,
    isLiveWorkflow,
    activePanel,
    onTogglePanel,
    onMessageSent,
}: {
    hidden?: boolean;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof Message>[]) => void;
    onPanelClick?: () => void;
    triggerCopilotChat?: (message: string) => void;
    isLiveWorkflow: boolean;
    activePanel?: 'playground' | 'copilot';
    onTogglePanel?: () => void;
    onMessageSent?: () => void;
}) {
    const [counter, setCounter] = useState<number>(0);
    const [showDebugMessages, setShowDebugMessages] = useState<boolean>(true);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const getCopyContentRef = useRef<(() => string) | null>(null);

    function handleNewChatButtonClick() {
        setCounter(counter + 1);
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

    const hasAgents = (workflow?.agents?.length || 0) > 0;

    return (
        <>
            <Panel 
                className={`${hidden ? 'hidden' : 'block'}`}
                variant="playground"
                tourTarget="playground"
                title={
                    <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-semibold">
                        <MessageCircle className="w-4 h-4" />
                        Chat
                    </div>
                }
                subtitle={hasAgents ? "Chat with your assistant" : "Create an agent to start chatting"}
                rightActions={hasAgents ? (
                    <div className="flex items-center gap-2">
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
                ) : (
                    // Preserve header height when there are zero agents
                    <div className="h-8" />
                )}
                onClick={onPanelClick}
            >
                <div className="h-full overflow-auto px-4 py-4">
                    {hasAgents ? (
                        <Chat
                            key={`chat-${counter}`}
                            projectId={projectId}
                            workflow={workflow}
                            messageSubscriber={messageSubscriber}
                            onCopyClick={(fn) => { getCopyContentRef.current = fn; }}
                            showDebugMessages={showDebugMessages}
                            triggerCopilotChat={triggerCopilotChat}
                            isLiveWorkflow={isLiveWorkflow}
                            onMessageSent={onMessageSent}
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center">
                            <div className="text-center max-w-md">
                                <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                    <MessageCircle className="w-6 h-6" />
                                </div>
                                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Create an agent to start chatting</div>
                                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Skipper can build agents for you!</div>
                                <div className="mt-4 flex items-center justify-center gap-3">
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        className="!bg-blue-700 hover:!bg-blue-800 !text-white dark:!bg-blue-600 dark:hover:!bg-blue-700 !border !border-blue-700 dark:!border-blue-600"
                                        onClick={() => triggerCopilotChat?.("Help me create my first agent.")}
                                    >
                                        Ask Skipper
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Panel>
        </>
    );
}
