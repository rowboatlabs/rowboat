'use client';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner } from "@nextui-org/react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { z } from "zod";
import { PlaygroundChat } from "../../../lib/types/types";
import { Workflow } from "../../../lib/types/workflow_types";
import { Chat } from "./chat";
import { useSearchParams, useRouter } from "next/navigation";
import { ActionButton, Pane } from "../workflow/pane";
import { apiV1 } from "rowboat-shared";
import { EllipsisVerticalIcon, MessageSquarePlusIcon, PlayIcon } from "lucide-react";
import { getScenario } from "../../../actions/testing_actions";
import clsx from "clsx";
import { TestProfile, TestScenario } from "@/app/lib/types/testing_types";
import { WithStringId } from "@/app/lib/types/types";
function SimulateLabel() {
    return <span>Simulate<sup className="pl-1">beta</sup></span>;
}

const defaultSystemMessage = '';

export function App({
    hidden = false,
    projectId,
    workflow,
    messageSubscriber,
    initialTestProfile,
}: {
    hidden?: boolean;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
    initialTestProfile: z.infer<typeof TestProfile>;
}) {
    const [counter, setCounter] = useState<number>(0);
    const [testProfile, setTestProfile] = useState<z.infer<typeof TestProfile>>(initialTestProfile);
    const [chat, setChat] = useState<z.infer<typeof PlaygroundChat>>({
        projectId,
        createdAt: new Date().toISOString(),
        messages: [],
        simulated: false,
        systemMessage: defaultSystemMessage,
    });

    function handleTestProfileChange(profile: WithStringId<z.infer<typeof TestProfile>>) {
        setTestProfile(profile);
        setCounter(counter + 1);
    }

    // const beginSimulation = useCallback((scenario: string) => {
    //     setExistingChatId(null);
    //     setLoadingChat(true);
    //     setCounter(counter + 1);
    //     setChat({
    //         projectId,
    //         createdAt: new Date().toISOString(),
    //         messages: [],
    //         simulated: true,
    //         simulationScenario: scenario,
    //         systemMessage: '',
    //     });
    // }, [counter, projectId]);

    // useEffect(() => {
    //     const scenarioId = localStorage.getItem('pendingScenarioId');
    //     if (scenarioId && projectId) {
    //         console.log('Scenario Effect triggered:', { scenarioId, projectId });
    //         getScenario(projectId, scenarioId).then((scenario) => {
    //             console.log('Scenario data received:', scenario);
    //             beginSimulation(scenario.description);
    //             localStorage.removeItem('pendingScenarioId');
    //         }).catch(error => {
    //             console.error('Error fetching scenario:', error);
    //             localStorage.removeItem('pendingScenarioId');
    //         });
    //     }
    // }, [projectId, beginSimulation]);

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
                />
            </div>
        </Pane>
    );
}
