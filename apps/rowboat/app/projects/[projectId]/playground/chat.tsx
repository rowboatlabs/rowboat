'use client';
import { getAssistantResponse, simulateUserResponse } from "@/app/actions";
import { useEffect, useState } from "react";
import { Messages } from "./messages";
import z from "zod";
import { AgenticAPIChatRequest, convertToAgenticAPIChatMessages, convertWorkflowToAgenticAPI, PlaygroundChat, Workflow } from "@/app/lib/types";
import { ComposeBox } from "./compose-box";
import { Button } from "@nextui-org/react";
import { apiV1 } from "rowboat-shared";
import { CheckIcon, CopyIcon } from "lucide-react";

export function Chat({
    chat,
    initialChatId = null,
    projectId,
    workflow,
    messageSubscriber,
}: {
    chat: z.infer<typeof PlaygroundChat>;
    initialChatId?: string | null;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
}) {
    const [chatId, setChatId] = useState<string | null>(initialChatId);
    const [messages, setMessages] = useState<z.infer<typeof apiV1.ChatMessage>[]>(chat.messages);
    const [loadingAssistantResponse, setLoadingAssistantResponse] = useState<boolean>(false);
    const [loadingUserResponse, setLoadingUserResponse] = useState<boolean>(false);
    const [simulationComplete, setSimulationComplete] = useState<boolean>(chat.simulationComplete || false);
    const [agenticState, setAgenticState] = useState<unknown>(chat.agenticState || {
        last_agent_name: workflow.startAgent,
    });
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [assistantResponseError, setAssistantResponseError] = useState<string | null>(null);
    const [lastAgenticRequest, setLastAgenticRequest] = useState<unknown | null>(null);
    const [lastAgenticResponse, setLastAgenticResponse] = useState<unknown | null>(null);
    const [systemMessage, setSystemMessage] = useState<string | undefined>(chat.systemMessage);

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
            chatId: chatId ?? '',
            createdAt: new Date().toISOString(),
        }];
        setMessages(updatedMessages);
    }

    function handleToolCallResults(results: z.infer<typeof apiV1.ToolMessage>[]) {
        setMessages([...messages, ...results.map((result) => ({
            ...result,
            version: 'v1' as const,
            chatId: chatId ?? '',
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
            setAssistantResponseError(null);
            const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow);
            const request: z.infer<typeof AgenticAPIChatRequest> = {
                messages: convertToAgenticAPIChatMessages([{
                    role: 'system',
                    content: systemMessage || '',
                    version: 'v1' as const,
                    chatId: chatId ?? '',
                    createdAt: new Date().toISOString(),
                }, ...messages]),
                state: agenticState,
                agents,
                tools,
                prompts,
                startAgent,
            };
            setLastAgenticRequest(request);
            setLastAgenticResponse(null);

            try {
                const response = await getAssistantResponse(projectId, request);
                if (ignore) {
                    return;
                }
                setLastAgenticResponse(response.rawAPIResponse);
                setMessages([...messages, ...response.messages.map((message) => ({
                    ...message,
                    version: 'v1' as const,
                    chatId: chatId ?? '',
                    createdAt: new Date().toISOString(),
                }))]);
                setAgenticState(response.state);
            } catch (err) {
                if (!ignore) {
                    setAssistantResponseError(`Failed to get assistant response: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            } finally {
                setLoadingAssistantResponse(false);
            }
        }

        // if no messages, return
        if (messages.length === 0) {
            return;
        }

        // if last message is not from role user
        // or tool, return
        const last = messages[messages.length - 1];
        if (assistantResponseError) {
            return;
        }
        if (last.role !== 'user' && last.role !== 'tool') {
            return;
        }

        process();

        return () => {
            ignore = true;
        };
    }, [chatId, chat.simulated, messages, projectId, agenticState, workflow, assistantResponseError, systemMessage]);

    // simulate user turn
    useEffect(() => {
        let ignore = false;

        function process() {
            if (chat.simulationData === undefined) {
                return;
            }

            // fetch next user prompt
            setLoadingUserResponse(true);
            simulateUserResponse(projectId, messages, chat.simulationData)
                .then(response => {
                    //console.log('User response:', response);
                    if (ignore) {
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
                        chatId: chatId ?? '',
                        createdAt: new Date().toISOString(),
                    }]);
                })
                .finally(() => {
                    setLoadingUserResponse(false);
                });
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
    }, [chatId, chat.simulated, messages, projectId, simulationComplete, chat.simulationData]);

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
        navigator.clipboard.writeText(jsonString)
            .then(() => {
                setShowCopySuccess(true);
                setTimeout(() => {
                    setShowCopySuccess(false);
                }, 1500);
            })
            .catch(err => {
                console.error('Failed to copy chat to clipboard:', err);
            });
    };

    function handleSystemMessageChange(message: string) {
        setSystemMessage(message);
    }

    return <div className="relative h-full flex flex-col gap-8 pt-8 overflow-auto">
        <Button
            size="sm"
            variant="bordered"
            isIconOnly
            onClick={handleCopyChat}
            className="absolute top-2 right-0"
        >
            {showCopySuccess ? (
                <CheckIcon size={16} />
            ) : (
                <CopyIcon size={16} />
            )}
        </Button>
        <Messages
            projectId={projectId}
            messages={messages}
            systemMessage={systemMessage}
            toolCallResults={toolCallResults}
            handleToolCallResults={handleToolCallResults}
            loadingAssistantResponse={loadingAssistantResponse}
            loadingUserResponse={loadingUserResponse}
            workflow={workflow}
            onSystemMessageChange={handleSystemMessageChange}
        />
        <div className="shrink-0">
            {assistantResponseError && (
                <div className="max-w-[768px] mx-auto mb-4 p-2 bg-red-50 border border-red-200 rounded-lg flex gap-2 justify-between items-center">
                    <p className="text-red-600">{assistantResponseError}</p>
                    <Button
                        size="sm"
                        color="danger"
                        onClick={() => {
                            setAssistantResponseError(null);
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
            {chat.simulated && simulationComplete && <p className="text-center">Simulation complete.</p>}
        </div>
    </div>;
}