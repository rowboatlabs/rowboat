'use client';
import { useState } from "react";
import { z } from "zod";
import { PlaygroundChat } from "../../../lib/types/types";
import { Workflow } from "../../../lib/types/workflow_types";
import { Chat } from "./chat";
import { ActionButton, Pane } from "../workflow/pane";
import { apiV1 } from "rowboat-shared";
import { MessageSquarePlusIcon } from "lucide-react";
import { TestProfile } from "@/app/lib/types/testing_types";
import { WithStringId } from "@/app/lib/types/types";

const defaultSystemMessage = '';

export function App({
    hidden = false,
    projectId,
    workflow,
    messageSubscriber,
}: {
    hidden?: boolean;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
}) {
    const [counter, setCounter] = useState<number>(0);
    const [testProfile, setTestProfile] = useState<z.infer<typeof TestProfile> | null>(null);
    const [systemMessage, setSystemMessage] = useState<string>(defaultSystemMessage);
    const [chat, setChat] = useState<z.infer<typeof PlaygroundChat>>({
        projectId,
        createdAt: new Date().toISOString(),
        messages: [],
        simulated: false,
        systemMessage: defaultSystemMessage,
    });

    function handleSystemMessageChange(message: string) {
        setSystemMessage(message);
        setCounter(counter + 1);
    }

    function handleTestProfileChange(profile: WithStringId<z.infer<typeof TestProfile>> | null) {
        setTestProfile(profile);
        setCounter(counter + 1);
    }

    if (hidden) {
        return <></>;
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

    return (
        <Pane 
            title="PLAYGROUND" 
            tooltip="Test your agents and see their responses in this interactive chat interface"
            actions={[
                <ActionButton
                    key="new-chat"
                    icon={<MessageSquarePlusIcon size={16} />}
                    onClick={handleNewChatButtonClick}
                >
                    New chat
                </ActionButton>,
            ]}
        >
            <div className="h-full overflow-auto">
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
                />
            </div>
        </Pane>
    );
}
