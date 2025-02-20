'use client';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner } from "@nextui-org/react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { z } from "zod";
import { PlaygroundChat } from "../../../lib/types/types";
import { Workflow } from "../../../lib/types/workflow_types";
import { SimulationData } from "../../../lib/types/testing_types";
import { SimulationScenarioData } from "../../../lib/types/testing_types";
import { Chat } from "./chat";
import { useSearchParams, useRouter } from "next/navigation";
import { ActionButton, Pane } from "../workflow/pane";
import { apiV1 } from "rowboat-shared";
import { EllipsisVerticalIcon, MessageSquarePlusIcon, PlayIcon } from "lucide-react";
import { getScenario } from "../../../actions/simulation_actions";
import clsx from "clsx";

function SimulateLabel() {
    return <span>Simulate<sup className="pl-1">beta</sup></span>;
}

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
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialChatId = useMemo(() => searchParams.get('chatId'), [searchParams]);
    const [existingChatId, setExistingChatId] = useState<string | null>(initialChatId);
    const [loadingChat, setLoadingChat] = useState<boolean>(false);
    const [counter, setCounter] = useState<number>(0);
    const [chat, setChat] = useState<z.infer<typeof PlaygroundChat>>({
        projectId,
        createdAt: new Date().toISOString(),
        messages: [],
        simulated: false,
        systemMessage: defaultSystemMessage,
    });

    const beginSimulation = useCallback((data: z.infer<typeof SimulationData>) => {
        setExistingChatId(null);
        setLoadingChat(true);
        setCounter(counter + 1);
        setChat({
            projectId,
            createdAt: new Date().toISOString(),
            messages: [],
            simulated: true,
            simulationData: data,
            systemMessage: 'context' in data ? data.context : '',
        });
    }, [counter, projectId]);

    useEffect(() => {
        const scenarioId = localStorage.getItem('pendingScenarioId');
        if (scenarioId && projectId) {
            console.log('Scenario Effect triggered:', { scenarioId, projectId });
            getScenario(projectId, scenarioId).then((scenario) => {
                console.log('Scenario data received:', scenario);
                beginSimulation({
                    ...scenario,
                    systemMessage: scenario.context || '',
                } as z.infer<typeof SimulationScenarioData>);
                localStorage.removeItem('pendingScenarioId');
            }).catch(error => {
                console.error('Error fetching scenario:', error);
                localStorage.removeItem('pendingScenarioId');
            });
        }
    }, [projectId, beginSimulation]);

    if (hidden) {
        return <></>;
    }

    function handleSimulateButtonClick() {
        router.push(`/projects/${projectId}/simulation`);
    }

    function handleNewChatButtonClick() {
        setExistingChatId(null);
        setLoadingChat(true);
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
                <ActionButton
                    key="simulate"
                    icon={<PlayIcon size={16} />}
                    onClick={handleSimulateButtonClick}
                >
                    Simulate
                </ActionButton>,
            ]}
        >
            <div className="h-full overflow-auto">
                {loadingChat && <div className="flex justify-center items-center h-full">
                    <Spinner />
                </div>}
                {!loadingChat && <Chat
                    key={existingChatId || 'chat-' + counter}
                    chat={chat}
                    initialChatId={existingChatId || null}
                    projectId={projectId}
                    workflow={workflow}
                    messageSubscriber={messageSubscriber}
                />}
            </div>
        </Pane>
    );
}
