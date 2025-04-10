'use client';
import { useState } from "react";
import { z } from "zod";
import { MCPServer, PlaygroundChat } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { Chat } from "./components/chat";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { apiV1 } from "rowboat-shared";
import { TestProfile } from "@/app/lib/types/testing_types";
import { WithStringId } from "@/app/lib/types/types";
import { ProfileSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/profile-selector";
import { CheckIcon, CopyIcon, PlusIcon, UserIcon } from "lucide-react";
import { USE_TESTING_FEATURE } from "@/app/lib/feature_flags";

const defaultSystemMessage = '';

export function App({
    hidden = false,
    projectId,
    workflow,
    messageSubscriber,
    mcpServerUrls,
    toolWebhookUrl,
}: {
    hidden?: boolean;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
    mcpServerUrls: Array<z.infer<typeof MCPServer>>;
    toolWebhookUrl: string;
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
    }

    const handleCopyJson = () => {
        const jsonString = JSON.stringify({
            messages: [{
                role: 'system',
                content: systemMessage,
            }, ...chat.messages],
        }, null, 2);
        navigator.clipboard.writeText(jsonString);
        setShowCopySuccess(true);
        setTimeout(() => {
            setShowCopySuccess(false);
        }, 2000);
    };

    if (hidden) {
        return <></>;
    }

    return (
        <>
            <Panel 
                title={
                    <div className="flex items-center gap-3">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            PLAYGROUND
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
                                hoverContent={testProfile?.name || 'Select test profile'}
                            >
                                <UserIcon className="w-4 h-4" />
                            </Button>
                        )}
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
                    />
                </div>
            </Panel>
        </>
    );
}
