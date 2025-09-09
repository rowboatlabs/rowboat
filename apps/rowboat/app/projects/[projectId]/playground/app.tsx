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

    return (
        <>
            <Panel 
                className={`${hidden ? 'hidden' : 'block'}`}
                variant="playground"
                tourTarget="playground"
                title={
                    <div className="flex items-center text-zinc-800 dark:text-zinc-200 font-semibold">Chat</div>
                }
                subtitle="Chat with your assistant"
                rightActions={
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
                }
                onClick={onPanelClick}
            >
                <div className="h-full overflow-auto px-4 py-4">
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
                </div>
            </Panel>
        </>
    );
}
