'use client';
import { useEffect, useRef, useState, useCallback } from "react";
import { createPlaygroundChatRun } from "@/app/actions/run_actions";
import { Messages } from "./messages";
import z, { set } from "zod";
import { Message, ToolMessage } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { ComposeBoxPlayground } from "@/components/common/compose-box-playground";
import { Button } from "@heroui/react";
import { BillingUpgradeModal } from "@/components/common/billing-upgrade-modal";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { FeedbackModal } from "./feedback-modal";
import { FIX_WORKFLOW_PROMPT, FIX_WORKFLOW_PROMPT_WITH_FEEDBACK, EXPLAIN_WORKFLOW_PROMPT_ASSISTANT, EXPLAIN_WORKFLOW_PROMPT_TOOL, EXPLAIN_WORKFLOW_PROMPT_TRANSITION } from "../copilot-prompts";
import { Run } from "@/src/entities/models/run";

export function Chat({
    projectId,
    workflow,
    messageSubscriber,
    onCopyClick,
    showDebugMessages = true,
    showJsonMode = false,
    triggerCopilotChat,
}: {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    messageSubscriber?: (messages: z.infer<typeof Message>[]) => void;
    onCopyClick: (fn: () => string) => void;
    showDebugMessages?: boolean;
    showJsonMode?: boolean;
    triggerCopilotChat?: (message: string) => void;
}) {
    const [run, setRun] = useState<z.infer<typeof Run> | null>(null);
    const [messages, setMessages] = useState<z.infer<typeof Message>[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [billingError, setBillingError] = useState<string | null>(null);
    const [lastAgenticRequest, setLastAgenticRequest] = useState<unknown | null>(null);
    const [lastAgenticResponse, setLastAgenticResponse] = useState<unknown | null>(null);

    // Optimistic messages for real-time streaming UX:
    // - messages: source of truth, only updated when responses are complete
    // - optimisticMessages: what user sees, updated in real-time during streaming
    // This separation allows immediate visual feedback while maintaining data integrity
    // and clean error recovery (rollback to last known good state on failures)
    const [optimisticMessages, setOptimisticMessages] = useState<z.infer<typeof Message>[]>([]);
    const [isLastInteracted, setIsLastInteracted] = useState(false);
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [pendingFixMessage, setPendingFixMessage] = useState<string | null>(null);
    const [showSuccessMessage, setShowSuccessMessage] = useState(false);
    // Add state for explain (no modal needed, just direct trigger)
    const [showExplainSuccess, setShowExplainSuccess] = useState(false);
    const [pendingFixIndex, setPendingFixIndex] = useState<number | null>(null);

    // --- Scroll/auto-scroll/unread bubble logic ---
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [showUnreadBubble, setShowUnreadBubble] = useState(false);

    // collect published tool call results
    const toolCallResults: Record<string, z.infer<typeof ToolMessage>> = {};
    optimisticMessages
        .filter((message) => message.role == 'tool')
        .forEach((message) => {
            toolCallResults[message.toolCallId] = message;
        });


    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        const atBottom = scrollHeight - scrollTop - clientHeight < 20;
        setAutoScroll(atBottom);
        if (atBottom) setShowUnreadBubble(false);
    }, []);

    const getCopyContent = useCallback(() => {
        return JSON.stringify({
            messages,
            lastRequest: lastAgenticRequest,
            lastResponse: lastAgenticResponse,
        }, null, 2);
    }, [messages, lastAgenticRequest, lastAgenticResponse]);

    // Handle fix functionality
    const handleFix = useCallback((message: string, index: number) => {
        setPendingFixMessage(message);
        setPendingFixIndex(index);
        setShowFeedbackModal(true);
    }, []);

    const handleFeedbackSubmit = useCallback((feedback: string) => {
        if (!pendingFixMessage || pendingFixIndex === null) return;

        // Create the copilot prompt with index
        const prompt = feedback.trim()
            ? FIX_WORKFLOW_PROMPT_WITH_FEEDBACK
                .replace('{index}', String(pendingFixIndex))
                .replace('{chat_turn}', pendingFixMessage)
                .replace('{feedback}', feedback)
            : FIX_WORKFLOW_PROMPT
                .replace('{index}', String(pendingFixIndex))
                .replace('{chat_turn}', pendingFixMessage);

        // Use the triggerCopilotChat function if available, otherwise fall back to localStorage
        if (triggerCopilotChat) {
            triggerCopilotChat(prompt);
            // Show a subtle success indication
            setShowSuccessMessage(true);
            setTimeout(() => setShowSuccessMessage(false), 3000);
        } else {
            // Fallback for standalone playground
            localStorage.setItem(`project_prompt_${projectId}`, prompt);
            alert('Fix request submitted! Redirecting to workflow editor...');
            window.location.href = `/projects/${projectId}/workflow`;
        }
    }, [pendingFixMessage, pendingFixIndex, projectId, triggerCopilotChat]);

    // Handle explain functionality
    const handleExplain = useCallback((type: 'assistant' | 'tool' | 'transition', message: string, index: number) => {
        let prompt = '';
        if (type === 'assistant') {
            prompt = EXPLAIN_WORKFLOW_PROMPT_ASSISTANT.replace('{index}', String(index)).replace('{chat_turn}', message);
        } else if (type === 'tool') {
            prompt = EXPLAIN_WORKFLOW_PROMPT_TOOL.replace('{index}', String(index)).replace('{chat_turn}', message);
        } else if (type === 'transition') {
            prompt = EXPLAIN_WORKFLOW_PROMPT_TRANSITION.replace('{index}', String(index)).replace('{chat_turn}', message);
        }
        if (triggerCopilotChat) {
            triggerCopilotChat(prompt);
            setShowExplainSuccess(true);
            setTimeout(() => setShowExplainSuccess(false), 3000);
        } else {
            localStorage.setItem(`project_prompt_${projectId}`, prompt);
            alert('Explain request submitted! Redirecting to workflow editor...');
            window.location.href = `/projects/${projectId}/workflow`;
        }
    }, [projectId, triggerCopilotChat]);

    // Add a stop handler function
    const handleStop = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            setLoading(false);
        }
    }, []);

    function handleUserMessage(prompt: string) {
        const updatedMessages: z.infer<typeof Message>[] = [...messages, {
            role: 'user',
            content: prompt,
        }];
        setMessages(updatedMessages);
        setError(null);
        setIsLastInteracted(true);
    }

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        if (autoScroll) {
            container.scrollTop = container.scrollHeight;
            setShowUnreadBubble(false);
        } else {
            setShowUnreadBubble(true);
        }
    }, [optimisticMessages, loading, autoScroll]);

    // Expose copy function to parent
    useEffect(() => {
        onCopyClick(getCopyContent);
    }, [getCopyContent, onCopyClick]);

    // Keep optimistic messages in sync with committed messages
    // This ensures UI shows the latest confirmed state when messages are updated
    useEffect(() => {
        setOptimisticMessages(messages);
    }, [messages]);

    // reset state when workflow changes
    useEffect(() => {
        setMessages([]);
    }, [workflow]);

    // publish messages to subscriber
    useEffect(() => {
        if (messageSubscriber) {
            messageSubscriber(messages);
        }
    }, [messages, messageSubscriber]);

    // create a new run
    useEffect(() => {
        let ignore = false;

        async function process() {
            // if there is no run, create it
            try {
                const response = await createPlaygroundChatRun(
                    projectId,
                    workflow,
                    messages,
                );
                if (ignore) {
                    return;
                }
                if ('billingError' in response) {
                    setBillingError(response.billingError);
                    setError(response.billingError);
                    setLoading(false);
                    console.log('returning from createRun due to billing error');
                    return;
                }
                setRun(response);
            } catch (err) {
                if (!ignore) {
                    setError(`Failed to create run: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setLoading(false);
                }
            }
        }

        // if there's already a run, don't create another one
        if (run) {
            return;
        }

        // if there are no messages yet, return
        if (messages.length === 0) {
            return;
        }

        // if last message is not a user message, return
        const last = messages[messages.length - 1];
        if (last.role !== 'user') {
            return;
        }

        // if there is an error, return
        if (error) {
            return;
        }

        console.log(`executing createRun: fetchresponseerr: ${error}`);
        setLoading(true);
        setError(null);
        process();

        return () => {
            ignore = true;
        };
    }, [
        messages,
        projectId,
        workflow,
        error,
        run,
    ]);

    // stream from run until completion
    useEffect(() => {
        let ignore = false;
        let eventSource: EventSource | null = null;
        let msgs: z.infer<typeof Message>[] = [];

        async function process() {
            if (!run) {
                return;
            }

            eventSource = new EventSource(`/api/stream-response/${run.id}`);
            eventSourceRef.current = eventSource;

            eventSource.addEventListener("message", (event) => {
                console.log(`chat.tsx: got message: ${event.data}`);
                if (ignore) {
                    return;
                }

                try {
                    const data = JSON.parse(event.data);
                    const parsedMsg = Message.parse(data);
                    msgs.push(parsedMsg);
                    // Update optimistic messages immediately for real-time streaming UX
                    setOptimisticMessages(prev => [...prev, parsedMsg]);
                } catch (err) {
                    console.error('Failed to parse SSE message:', err);
                    setError(`Failed to parse SSE message: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    // Rollback to last known good state on parsing errors
                    setOptimisticMessages(messages);
                }
            });

            eventSource.addEventListener('done', (event) => {
                console.log(`chat.tsx: got done event: ${event.data}`);
                if (eventSource) {
                    eventSource.close();
                    eventSourceRef.current = null;
                }

                const parsed = JSON.parse(event.data);

                // Combine state and collected messages in the response
                setLastAgenticResponse({
                    ...parsed,
                    messages: msgs
                });

                // Commit all streamed messages atomically to the source of truth
                setMessages([...messages, ...msgs]);
                setLoading(false);
            });

            eventSource.addEventListener('stream_error', (event) => {
                console.log(`chat.tsx: got stream_error event: ${event.data}`);
                if (eventSource) {
                    eventSource.close();
                    eventSourceRef.current = null;
                }

                console.error('SSE Error:', event);
                if (!ignore) {
                    setLoading(false);
                    setError('Error: ' + JSON.parse(event.data).error);
                    // Rollback to last known good state on stream errors
                    setOptimisticMessages(messages);
                    // Clear the run on error
                    setRun(null);
                }
            });

            eventSource.onerror = (error) => {
                console.error('SSE Error:', error);
                if (!ignore) {
                    setLoading(false);
                    setError('Stream connection failed');
                    // Rollback to last known good state on connection errors
                    setOptimisticMessages(messages);
                    // Clear the run on error
                    setRun(null);
                }
            };
        }

        // Only stream if we have a run
        if (!run) {
            return;
        }

        console.log(`executing streamFromRun for run: ${run.id}`);
        process();

        return () => {
            ignore = true;
            if (eventSource) {
                eventSource.close();
                eventSourceRef.current = null;
            }
        };
    }, [
        run,
        messages,
    ]);

    return (
        <div className="w-11/12 max-w-6xl mx-auto h-full flex flex-col relative">
            <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 pt-4 pb-4">
            </div>

            {/* Main chat area: flex column, messages area is flex-1 min-h-0 overflow-auto, compose box at bottom */}
            <div className="flex flex-col flex-1 min-h-0 relative">
                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="flex-1 min-h-0 overflow-auto pr-4 playground-scrollbar"
                    style={{ scrollBehavior: 'smooth' }}
                >
                    <Messages
                        projectId={projectId}
                        messages={[
                            {
                                role: 'assistant',
                                content: 'Hi, how can I help you today?',
                                agentName: 'assistant',
                                responseType: 'external',
                            },
                            ...optimisticMessages,
                        ]}
                        toolCallResults={toolCallResults}
                        loadingAssistantResponse={loading}
                        workflow={workflow}
                        showDebugMessages={showDebugMessages}
                        showJsonMode={showJsonMode}
                        onFix={handleFix}
                        onExplain={handleExplain}
                    />
                </div>
                {showUnreadBubble && (
                    <button
                        className="absolute bottom-24 right-4 z-20 bg-blue-100 text-blue-700 rounded-full w-8 h-8 flex items-center justify-center hover:bg-blue-200 transition-colors animate-pulse shadow-lg"
                        style={{ pointerEvents: 'auto' }}
                        onClick={() => {
                            const container = scrollContainerRef.current;
                            if (container) {
                                container.scrollTop = container.scrollHeight;
                            }
                            setAutoScroll(true);
                            setShowUnreadBubble(false);
                        }}
                        aria-label="Scroll to latest message"
                    >
                        <ChevronDownIcon className="w-5 h-5" strokeWidth={2.2} />
                    </button>
                )}
                <div className="bg-white dark:bg-zinc-900 pt-4 pb-2">
                    {showSuccessMessage && (
                        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 
                                      rounded-lg flex gap-2 justify-between items-center">
                            <p className="text-green-600 dark:text-green-400 text-sm">Skipper will suggest fixes for you now.</p>
                            <Button
                                size="sm"
                                color="success"
                                onPress={() => setShowSuccessMessage(false)}
                            >
                                Dismiss
                            </Button>
                        </div>
                    )}
                    {showExplainSuccess && (
                        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 
                                      rounded-lg flex gap-2 justify-between items-center">
                            <p className="text-blue-600 dark:text-blue-400 text-sm">Skipper will explain this for you now.</p>
                            <Button
                                size="sm"
                                color="primary"
                                onPress={() => setShowExplainSuccess(false)}
                            >
                                Dismiss
                            </Button>
                        </div>
                    )}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 
                                      rounded-lg flex gap-2 justify-between items-center">
                            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                            <Button
                                size="sm"
                                color="danger"
                                onPress={() => {
                                    setError(null);
                                    setBillingError(null);
                                }}
                            >
                                Retry
                            </Button>
                        </div>
                    )}

                    <ComposeBoxPlayground
                        handleUserMessage={handleUserMessage}
                        messages={messages.filter(msg => msg.content !== undefined) as any}
                        loading={loading}
                        shouldAutoFocus={isLastInteracted}
                        onFocus={() => setIsLastInteracted(true)}
                        onCancel={handleStop}
                    />
                </div>
            </div>

            <BillingUpgradeModal
                isOpen={!!billingError}
                onClose={() => setBillingError(null)}
                errorMessage={billingError || ''}
            />
            <FeedbackModal
                isOpen={showFeedbackModal}
                onClose={() => setShowFeedbackModal(false)}
                onSubmit={handleFeedbackSubmit}
                title="Fix Assistant"
            />
        </div>
    );
}