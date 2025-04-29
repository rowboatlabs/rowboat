'use client';
import { useState, useCallback, useRef } from "react";
import { z } from "zod";
import { MCPServer, PlaygroundChat } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { Chat } from "./components/chat";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@heroui/react";
import { apiV1 } from "rowboat-shared";
import { TestProfile } from "@/app/lib/types/testing_types";
import { WithStringId } from "@/app/lib/types/types";
import { ProfileSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/profile-selector";
import { CheckIcon, CopyIcon, PlusIcon, UserIcon, InfoIcon } from "lucide-react";
import { USE_TESTING_FEATURE } from "@/app/lib/feature_flags";
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
}: {
    hidden?: boolean;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
    mcpServerUrls: Array<z.infer<typeof MCPServer>>;
    toolWebhookUrl: string;
    isInitialState?: boolean;
    onPanelClick?: () => void;
}) {
    const [counter, setCounter] = useState<number>(0);
    const [testProfile, setTestProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);
    const [systemMessage, setSystemMessage] = useState<string>(defaultSystemMessage);
    const [chat, setChat] = useState<z.infer<typeof PlaygroundChat>>({
        projectId,
        createdAt: new Date().toISOString(),
        messages: [],
        simulated: false,
        systemMessage: defaultSystemMessage,
    });
    const [isProfileSelectorOpen, setIsProfileSelectorOpen] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const getCopyContentRef = useRef<(() => string) | null>(null);

    function handleSystemMessageChange(message: string) {
        setSystemMessage(message);
        setCounter(counter + 1);
    }

    function handleTestProfileChange(profile: WithStringId<z.infer<typeof TestProfile>> | null) {
        setTestProfile(profile);
        setCounter(counter + 1);
    }

    function handleNewChatButtonClick() {
        setCounter(counter + 1);
        setChat({
            projectId,
            createdAt: new Date().toISOString(),
            messages: [],
            simulated: false,
            systemMessage: defaultSystemMessage,
        });
        setSystemMessage(defaultSystemMessage);
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

    if (hidden) {
        return <></>;
    }

    return (
        <>
            <Panel 
                variant="playground"
                tourTarget="playground"
                title={
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                ПЕСОЧНИЦА
                            </div>
                            <Tooltip content="Проверьте агента в деле — общайтесь с ним прямо здесь!">
                                <InfoIcon className="w-4 h-4 text-gray-400 cursor-help" />
                            </Tooltip>
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleNewChatButtonClick}
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100"
                            showHoverContent={true}
                            hoverContent="Новый диалог"
                        >
                            <PlusIcon className="w-4 h-4" />
                        </Button>
                    </div>
                }
                rightActions={
                    <div className="flex items-center gap-3">
                        {USE_TESTING_FEATURE && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setIsProfileSelectorOpen(true)}
                                showHoverContent={true}
                                hoverContent={testProfile?.name || 'Выбери профиль'}
                            >
                                <UserIcon className="w-4 h-4" />
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCopyJson}
                            showHoverContent={true}
                            hoverContent={showCopySuccess ? "Готово!" : "Скопировать JSON"}
                        >
                            {showCopySuccess ? (
                                <CheckIcon className="w-4 h-4" />
                            ) : (
                                <CopyIcon className="w-4 h-4" />
                            )}
                        </Button>
                    </div>
                }
                className={clsx(
                    isInitialState && "opacity-50 transition-opacity duration-300"
                )}
                onClick={onPanelClick}
            >
                <ProfileSelector
                    projectId={projectId}
                    isOpen={isProfileSelectorOpen}
                    onOpenChange={setIsProfileSelectorOpen}
                    onSelect={handleTestProfileChange}
                    selectedProfileId={testProfile?._id}
                />
                <div className="h-full overflow-auto px-4 py-4">
                    <Chat
                        key={`chat-${counter}`}
                        chat={chat}
                        projectId={projectId}
                        workflow={workflow}
                        testProfile={testProfile}
                        messageSubscriber={messageSubscriber}
                        onTestProfileChange={handleTestProfileChange}
                        systemMessage={systemMessage}
                        onSystemMessageChange={handleSystemMessageChange}
                        mcpServerUrls={mcpServerUrls}
                        toolWebhookUrl={toolWebhookUrl}
                        onCopyClick={(fn) => { getCopyContentRef.current = fn; }}
                    />
                </div>
            </Panel>
        </>
    );
}
