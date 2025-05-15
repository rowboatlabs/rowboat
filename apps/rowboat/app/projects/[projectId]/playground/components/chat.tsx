'use client';
import { useEffect, useRef, useState, useCallback } from "react";
import { getAssistantResponseStreamId } from "@/app/actions/actions";
import { Messages } from "./messages";
import z from "zod";
import { MCPServer, PlaygroundChat } from "@/app/lib/types/types";
import { AgenticAPIChatMessage, convertFromAgenticAPIChatMessages, convertToAgenticAPIChatMessages } from "@/app/lib/types/agents_api_types";
import { convertWorkflowToAgenticAPI } from "@/app/lib/types/agents_api_types";
import { AgenticAPIChatRequest } from "@/app/lib/types/agents_api_types";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { ComposeBoxPlayground } from "@/components/common/compose-box-playground";
import { Button } from "@heroui/react";
import { apiV1 } from "rowboat-shared";
import { TestProfile } from "@/app/lib/types/testing_types";
import { WithStringId } from "@/app/lib/types/types";
import { ProfileContextBox } from "./profile-context-box";
import { USE_TESTING_FEATURE } from "@/app/lib/feature_flags";

export function Chat({
    chat,
    projectId,
    workflow,
    messageSubscriber,
    testProfile = null,
    onTestProfileChange,
    systemMessage,
    onSystemMessageChange,
    mcpServerUrls,
    toolWebhookUrl,
    onCopyClick,
    showDebugMessages = true,
    projectTools,
}: {
    chat: z.infer<typeof PlaygroundChat>;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof apiV1.ChatMessage>[]) => void;
    testProfile?: z.infer<typeof TestProfile> | null;
    onTestProfileChange: (profile: WithStringId<z.infer<typeof TestProfile>> | null) => void;
    systemMessage: string;
    onSystemMessageChange: (message: string) => void;
    mcpServerUrls: Array<z.infer<typeof MCPServer>>;
    toolWebhookUrl: string;
    onCopyClick: (fn: () => string) => void;
    showDebugMessages?: boolean;
    projectTools: z.infer<typeof WorkflowTool>[];
}) {
    const [messages, setMessages] = useState<z.infer<typeof apiV1.ChatMessage>[]>(chat.messages);
    const [loadingAssistantResponse, setLoadingAssistantResponse] = useState<boolean>(false);
    const [agenticState, setAgenticState] = useState<unknown>(chat.agenticState || {
        last_agent_name: workflow.startAgent,
    });
    const [fetchResponseError, setFetchResponseError] = useState<string | null>(null);
    const [lastAgenticRequest, setLastAgenticRequest] = useState<unknown | null>(null);
    const [lastAgenticResponse, setLastAgenticResponse] = useState<unknown | null>(null);
    const [optimisticMessages, setOptimisticMessages] = useState<z.infer<typeof apiV1.ChatMessage>[]>(chat.messages);
    const [isLastInteracted, setIsLastInteracted] = useState(false);

    const getCopyContent = useCallback(() => {
        return JSON.stringify({
            messages: [{
                role: 'system',
                content: systemMessage,
            }, ...messages],
            lastRequest: lastAgenticRequest,
            lastResponse: lastAgenticResponse,
        }, null, 2);
    }, [messages, systemMessage, lastAgenticRequest, lastAgenticResponse]);

    // Expose copy function to parent
    useEffect(() => {
        onCopyClick(getCopyContent);
    }, [getCopyContent, onCopyClick]);

    // reset optimistic messages when messages change
    useEffect(() => {
        setOptimisticMessages(messages);
    }, [messages]);

    // collect published tool call results
    const toolCallResults: Record<string, z.infer<typeof apiV1.ToolMessage>> = {};
    optimisticMessages
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
        setIsLastInteracted(true);
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

    // get assistant response
    useEffect(() => {
        let ignore = false;
        let eventSource: EventSource | null = null;
        let msgs: z.infer<typeof apiV1.ChatMessage>[] = [];

        async function process() {
            setLoadingAssistantResponse(true);
            setFetchResponseError(null);
            
            // Reset request/response state before making new request
            setLastAgenticRequest(null);
            setLastAgenticResponse(null);
            
            const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow, projectTools);
            const request: z.infer<typeof AgenticAPIChatRequest> = {
                projectId,
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
                mcpServers: mcpServerUrls.map(server => ({
                    name: server.name,
                    serverUrl: server.serverUrl || '',
                    isReady: server.isReady
                })),
                toolWebhookUrl: toolWebhookUrl,
                testProfile: testProfile ?? undefined,
            };
            
            // Store the full request object
            setLastAgenticRequest(request);

            let streamId: string | null = null;
            try {
                const response = await getAssistantResponseStreamId(request);
                if (ignore) {
                    return;
                }
                streamId = response.streamId;
            } catch (err) {
                if (!ignore) {
                    setFetchResponseError(`Failed to get assistant response: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setLoadingAssistantResponse(false);
                }
            }

            if (ignore || !streamId) {
                return;
            }

            eventSource = new EventSource(`/api/stream-response/${streamId}`);

            eventSource.addEventListener("message", (event) => {
                if (ignore) {
                    return;
                }

                try {
                    const data = JSON.parse(event.data);
                    const msg = AgenticAPIChatMessage.parse(data);
                    const parsedMsg = convertFromAgenticAPIChatMessages([msg])[0];
                    msgs.push(parsedMsg);
                    setOptimisticMessages(prev => [...prev, parsedMsg]);
                } catch (err) {
                    console.error('Failed to parse SSE message:', err);
                    setFetchResponseError(`Failed to parse SSE message: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setOptimisticMessages(messages);
                }
            });

            eventSource.addEventListener('done', (event) => {
                if (eventSource) {
                    eventSource.close();
                }

                const parsed = JSON.parse(event.data);
                setAgenticState(parsed.state);
                
                // Combine state and collected messages in the response
                setLastAgenticResponse({
                    ...parsed,
                    messages: msgs
                });
                
                setMessages([...messages, ...msgs]);
                setLoadingAssistantResponse(false);
            });

            eventSource.addEventListener('stream_error', (event) => {
                if (eventSource) {
                    eventSource.close();
                }

                console.error('SSE Error:', event);
                if (!ignore) {
                    setLoadingAssistantResponse(false);
                    setFetchResponseError('Error: ' + JSON.parse(event.data).error);
                    setOptimisticMessages(messages);
                }
            });

            eventSource.onerror = (error) => {
                console.error('SSE Error:', error);
                if (!ignore) {
                    setLoadingAssistantResponse(false);
                    setFetchResponseError('Stream connection failed');
                    setOptimisticMessages(messages);
                }
            };
        }

        // if last message is not a user message, return
        if (messages.length > 0) {
            const last = messages[messages.length - 1];
            if (last.role !== 'user') {
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
            if (eventSource) {
                eventSource.close();
            }
        };
    }, [
        messages,
        projectId,
        agenticState,
        workflow,
        systemMessage,
        mcpServerUrls,
        toolWebhookUrl,
        testProfile,
        fetchResponseError,
        projectTools,
    ]);

    return <div className="relative max-w-3xl mx-auto h-full flex flex-col">
        <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 pt-4 pb-4">
            {USE_TESTING_FEATURE && (
                <ProfileContextBox
                    content={testProfile?.context || systemMessage || ''}
                    onChange={onSystemMessageChange}
                    locked={testProfile !== null}
                />
            )}
        </div>
        
        <div className="flex-1 overflow-auto pr-1 
            [&::-webkit-scrollbar]{width:4px}
            [&::-webkit-scrollbar-track]{background:transparent}
            [&::-webkit-scrollbar-thumb]{background-color:rgb(156 163 175)}
            dark:[&::-webkit-scrollbar-thumb]{background-color:#2a2d31}">
            <div className="pr-4">
                <Messages
                    projectId={projectId}
                    messages={optimisticMessages}
                    toolCallResults={toolCallResults}
                    loadingAssistantResponse={loadingAssistantResponse}
                    workflow={workflow}
                    testProfile={testProfile}
                    systemMessage={systemMessage}
                    onSystemMessageChange={onSystemMessageChange}
                    showSystemMessage={false}
                    showDebugMessages={showDebugMessages}
                />
            </div>
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-zinc-900 pt-4 pb-2">
            {fetchResponseError && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 
                              rounded-lg flex gap-2 justify-between items-center">
                    <p className="text-red-600 dark:text-red-400 text-sm">{fetchResponseError}</p>
                    <Button
                        size="sm"
                        color="danger"
                        onPress={() => setFetchResponseError(null)}
                    >
                        Retry
                    </Button>
                </div>
            )}
            
            <ComposeBoxPlayground
                handleUserMessage={handleUserMessage}
                messages={messages.filter(msg => msg.content !== undefined) as any}
                loading={loadingAssistantResponse}
                shouldAutoFocus={isLastInteracted}
                onFocus={() => setIsLastInteracted(true)}
            />
        </div>
    </div>;
}