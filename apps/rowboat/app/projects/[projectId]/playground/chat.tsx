'use client';
import { getAssistantResponse, simulateUserResponse } from "../../../actions/actions";
import { useEffect, useState } from "react";
import { Messages } from "./messages";
import z from "zod";
import { PlaygroundChat } from "../../../lib/types/types";
import { convertToAgenticAPIChatMessages } from "../../../lib/types/agents_api_types";
import { convertWorkflowToAgenticAPI } from "../../../lib/types/agents_api_types";
import { AgenticAPIChatRequest } from "../../../lib/types/agents_api_types";
import { Workflow } from "../../../lib/types/workflow_types";
import { ComposeBox } from "./compose-box";
import { Button, Spinner, Tooltip } from "@heroui/react";
import { apiV1 } from "rowboat-shared";
import { CopyAsJsonButton } from "./copy-as-json-button";
import { TestProfile } from "@/app/lib/types/testing_types";
import { ProfileSelector } from "@/app/lib/components/selectors/profile-selector";
import { WithStringId } from "@/app/lib/types/types";
import { XCircleIcon, XIcon } from "lucide-react";

export function Chat({
    chat,
    projectId,
    workflow,
    messageSubscriber,
    testProfile=null,
    onTestProfileChange,
    systemMessage,
    onSystemMessageChange,
}: {
    chat: z.infer<typeof PlaygroundChat>;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
    testProfile?: z.infer<typeof TestProfile> | null;
    onTestProfileChange: (profile: WithStringId<z.infer<typeof TestProfile>> | null) => void;
    systemMessage: string;
    onSystemMessageChange: (message: string) => void;
}) {
    const [messages, setMessages] = useState<z.infer<typeof apiV1.ChatMessage>[]>(chat.messages);
    const [loadingAssistantResponse, setLoadingAssistantResponse] = useState<boolean>(false);
    const [loadingUserResponse, setLoadingUserResponse] = useState<boolean>(false);
    const [simulationComplete, setSimulationComplete] = useState<boolean>(chat.simulationComplete || false);
    const [agenticState, setAgenticState] = useState<unknown>(chat.agenticState || {
        last_agent_name: workflow.startAgent,
    });
    const [fetchResponseError, setFetchResponseError] = useState<string | null>(null);
    const [lastAgenticRequest, setLastAgenticRequest] = useState<unknown | null>(null);
    const [lastAgenticResponse, setLastAgenticResponse] = useState<unknown | null>(null);
    const [isProfileSelectorOpen, setIsProfileSelectorOpen] = useState(false);

    // collect published tool call results
    const toolCallResults: Record<string, z.infer<typeof apiV1.ToolMessage>> = {};
    messages
        .filter((message) => message.role == 'tool')
        .forEach((message) => {
            toolCallResults[message.tool_call_id] = message;
        });

    function handleUserMessage(prompt: string) {
        const updatedMessages: z.infer<typeof apiV1.ChatMessage>[] = [...messages, {
            role: 'user',
            content: prompt,
            version: 'v1',
            chatId: '',
            createdAt: new Date().toISOString(),
        }];
        setMessages(updatedMessages);
        setFetchResponseError(null);
    }

    function handleToolCallResults(results: z.infer<typeof apiV1.ToolMessage>[]) {
        setMessages([...messages, ...results.map((result) => ({
            ...result,
            version: 'v1' as const,
            chatId: '',
            createdAt: new Date().toISOString(),
        }))]);
    }

    // reset state when workflow changes
    useEffect(() => {
        setMessages([]);
        setAgenticState({
            last_agent_name: workflow.startAgent,
        });
    }, [workflow]);

    // publish messages to subscriber
    useEffect(() => {
        if (messageSubscriber) {
            messageSubscriber(messages);
        }
    }, [messages, messageSubscriber]);

    // get agent response
    useEffect(() => {
        let ignore = false;

        async function process() {
            setLoadingAssistantResponse(true);
            setFetchResponseError(null);
            const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow);
            const request: z.infer<typeof AgenticAPIChatRequest> = {
                messages: convertToAgenticAPIChatMessages([{
                    role: 'system',
                    content: systemMessage || '',
                    version: 'v1' as const,
                    chatId: '',
                    createdAt: new Date().toISOString(),
                }, ...messages]),
                state: agenticState,
                agents,
                tools,
                prompts,
                startAgent,
            };
            setLastAgenticRequest(null);
            setLastAgenticResponse(null);

            try {
                const response = await getAssistantResponse(projectId, request);
                if (ignore) {
                    return;
                }
                if (simulationComplete) {
                    return;
                }
                setLastAgenticRequest(response.rawRequest);
                setLastAgenticResponse(response.rawResponse);
                setMessages([...messages, ...response.messages.map((message) => ({
                    ...message,
                    version: 'v1' as const,
                    chatId: '',
                    createdAt: new Date().toISOString(),
                }))]);
                setAgenticState(response.state);
            } catch (err) {
                if (!ignore) {
                    setFetchResponseError(`Failed to get assistant response: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            } finally {
                if (!ignore) {
                    setLoadingAssistantResponse(false);
                }
            }
        }

        // if last message is not from role user
        // or tool, return
        if (messages.length > 0) {
            const last = messages[messages.length - 1];
            if (last.role !== 'user' && last.role !== 'tool') {
                return;
            }
        }

        // if there is an error, return
        if (fetchResponseError) {
            return;
        }

        process();

        return () => {
            ignore = true;
        };
    }, [chat.simulated, messages, projectId, agenticState, workflow, fetchResponseError, systemMessage, simulationComplete]);

    // simulate user turn
    useEffect(() => {
        let ignore = false;

        async function process() {
            if (chat.simulationScenario === undefined) {
                return;
            }

            // fetch next user prompt
            setLoadingUserResponse(true);
            try {

                const response = await simulateUserResponse(projectId, messages, chat.simulationScenario)
                if (ignore) {
                    return;
                }
                if (simulationComplete) {
                    return;
                }
                if (response.trim() === 'EXIT') {
                    setSimulationComplete(true);
                    return;
                }
                setMessages([...messages, {
                    role: 'user',
                    content: response,
                    version: 'v1' as const,
                    chatId: '',
                    createdAt: new Date().toISOString(),
                }]);
                setFetchResponseError(null);
            } catch (err) {
                setFetchResponseError(`Failed to simulate user response: ${err instanceof Error ? err.message : 'Unknown error'}`);
            } finally {
                setLoadingUserResponse(false);
            }
        }

        // proceed only if chat is simulated
        if (!chat.simulated) {
            return;
        }

        // dont proceed if simulation is complete
        if (chat.simulated && simulationComplete) {
            return;
        }

        // check if there are no messages yet OR
        // check if the last message is an assistant
        // message containing a text response. If so, 
        // call the simulate user turn api to fetch
        // user response
        let last = messages[messages.length - 1];
        if (last && last.role !== 'assistant') {
            return;
        }
        if (last && 'tool_calls' in last) {
            return;
        }

        process();

        return () => {
            ignore = true;
        };
    }, [chat.simulated, messages, projectId, simulationComplete, chat.simulationScenario]);

    // save chat on every assistant message
    // useEffect(() => {
    //     let ignore = false;

    //     function process() {
    //         savePlaygroundChat(projectId, {
    //             ...chat,
    //             messages,
    //             simulationComplete,
    //             agenticState,
    //         }, chatId)
    //             .then((insertedChatId) => {
    //                 if (!chatId) {
    //                     setChatId(insertedChatId);
    //                 }
    //             });
    //     }

    //     if (messages.length === 0) {
    //         return;
    //     }

    //     const lastMessage = messages[messages.length - 1];
    //     if (lastMessage && lastMessage.role !== 'assistant') {
    //         return;
    //     }
    //     process();
    // }, [chatId, chat, messages, projectId, simulationComplete, agenticState]);

    const handleCopyChat = () => {
        const jsonString = JSON.stringify({
            messages: [{
                role: 'system',
                content: systemMessage,
            }, ...messages],
            lastRequest: lastAgenticRequest,
            lastResponse: lastAgenticResponse,
        }, null, 2);
        navigator.clipboard.writeText(jsonString);
    }

    return <div className="relative h-full flex flex-col gap-8 pt-8 overflow-auto">
        <CopyAsJsonButton onCopy={handleCopyChat} />
        <div className="absolute top-0 left-0 flex items-center gap-1">
            <Tooltip content={"Change profile"} placement="right">
                <button
                    className="border border-gray-200 dark:border-gray-800 p-2 rounded-lg text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => setIsProfileSelectorOpen(true)}
                >
                    {`${testProfile?.name || 'Select test profile'}`}
                </button>
            </Tooltip>
            {testProfile && <Tooltip content={"Remove profile"} placement="right">
                <button className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300" onClick={() => onTestProfileChange(null)}>
                    <XIcon className="w-4 h-4" />
                </button>
            </Tooltip>}
        </div>
        <ProfileSelector
            projectId={projectId}
            isOpen={isProfileSelectorOpen}
            onOpenChange={setIsProfileSelectorOpen}
            onSelect={onTestProfileChange}
        />
        <Messages
            projectId={projectId}
            messages={messages}
            toolCallResults={toolCallResults}
            handleToolCallResults={handleToolCallResults}
            loadingAssistantResponse={loadingAssistantResponse}
            loadingUserResponse={loadingUserResponse}
            workflow={workflow}
            testProfile={testProfile}
            systemMessage={systemMessage}
            onSystemMessageChange={onSystemMessageChange}
        />
        <div className="shrink-0">
            {fetchResponseError && (
                <div className="max-w-[768px] mx-auto mb-4 p-2 bg-red-50 border border-red-200 rounded-lg flex gap-2 justify-between items-center">
                    <p className="text-red-600">{fetchResponseError}</p>
                    <Button
                        size="sm"
                        color="danger"
                        onPress={() => {
                            setFetchResponseError(null);
                        }}
                    >
                        Retry
                    </Button>
                </div>
            )}
            {!chat.simulated && <div className="max-w-[768px] mx-auto">
                <ComposeBox
                    handleUserMessage={handleUserMessage}
                    messages={messages}
                />
            </div>}
            {chat.simulated && !simulationComplete && <div className="p-2 bg-gray-50 border border-gray-200 flex items-center justify-center gap-2">
                <Spinner size="sm" />
                <div className="text-sm text-gray-500 animate-pulse">Simulating...</div>
                <Button
                    size="sm"
                    color="danger"
                    onPress={() => {
                        setSimulationComplete(true);
                    }}
                >
                    Stop
                </Button>
            </div>}
            {chat.simulated && simulationComplete && <p className="text-center text-sm">Simulation complete.</p>}
        </div>
    </div>;
}