'use client';

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@heroui/react";
import { Panel } from "@/components/common/panel-common";
import { fetchConversation } from "@/app/actions/conversation_actions";
import { Conversation } from "@/src/entities/models/conversation";
import { Turn } from "@/src/entities/models/turn";
import { Message } from "@/app/lib/types/types";
import { z } from "zod";

function TurnReason({ reason }: { reason: z.infer<typeof Turn>['reason'] }) {
    const getReasonDisplay = () => {
        switch (reason.type) {
            case 'chat':
                return { label: 'CHAT', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
            case 'api':
                return { label: 'API', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
            case 'job':
                return { label: `JOB: ${reason.jobId}`, color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' };
            default:
                return { label: 'UNKNOWN', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' };
        }
    };

    const { label, color } = getReasonDisplay();

    return (
        <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-mono font-medium ${color}`}>
            {label}
        </span>
    );
}

function ToolCallDisplay({ toolCall }: { toolCall: any }) {
    return (
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    TOOL CALL: {toolCall.function.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-500">
                    ID: {toolCall.id}
                </span>
            </div>
            <div className="text-xs text-gray-700 dark:text-gray-300 font-mono">
                <div className="mb-1">
                    <span className="font-semibold">Arguments:</span>
                </div>
                <pre className="bg-gray-100 dark:bg-gray-900 p-2 rounded text-xs overflow-x-auto border border-gray-200 dark:border-gray-700">
                    {toolCall.function.arguments}
                </pre>
            </div>
        </div>
    );
}

function MessageDisplay({ message, index }: { message: z.infer<typeof Message>; index: number }) {
    const isUser = 'role' in message && message.role === 'user';
    const isAssistant = 'role' in message && message.role === 'assistant';
    const isSystem = 'role' in message && message.role === 'system';
    const isTool = 'role' in message && message.role === 'tool';
    
    // Check if assistant message is internal
    const isInternal = isAssistant && 'responseType' in message && message.responseType === 'internal';

    const getBubbleStyle = () => {
        if (isUser) {
            return 'ml-auto max-w-[80%] bg-blue-100 text-blue-900 border border-blue-200 rounded-2xl rounded-br-md';
        } else if (isAssistant) {
            if (isInternal) {
                return 'mr-auto max-w-[80%] bg-gray-50 text-gray-700 border border-dotted border-gray-300 rounded-2xl rounded-bl-md';
            } else {
                return 'mr-auto max-w-[80%] bg-green-100 text-green-900 border border-green-200 rounded-2xl rounded-bl-md';
            }
        } else if (isSystem) {
            return 'mx-auto max-w-[90%] bg-yellow-100 text-yellow-900 border border-yellow-200 rounded-2xl';
        } else if (isTool) {
            return 'mr-auto max-w-[80%] bg-purple-100 text-purple-900 border border-purple-200 rounded-2xl rounded-bl-md';
        }
        return 'mx-auto max-w-[80%] bg-gray-100 text-gray-900 border border-gray-200 rounded-2xl';
    };

    const getRoleLabel = () => {
        if ('role' in message) {
            switch (message.role) {
                case 'user':
                    return 'USER';
                case 'assistant':
                    const baseLabel = 'agentName' in message && message.agentName ? `ASSISTANT (${message.agentName})` : 'ASSISTANT';
                    return isInternal ? `${baseLabel} [INTERNAL]` : baseLabel;
                case 'system':
                    return 'SYSTEM';
                case 'tool':
                    return 'toolName' in message ? `TOOL (${message.toolName})` : 'TOOL';
                default:
                    return (message as any).role?.toUpperCase() || 'UNKNOWN';
            }
        }
        return 'UNKNOWN';
    };

    const getMessageContent = () => {
        if ('content' in message && message.content) {
            return message.content;
        }
        return '[No content]';
    };

    const getTimestamp = () => {
        if ('timestamp' in message && message.timestamp) {
            return new Date(message.timestamp).toLocaleTimeString();
        }
        return null;
    };

    const timestamp = getTimestamp();

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
            <div className={`${getBubbleStyle()} p-3 shadow-sm`}>
                {/* Message Header */}
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold opacity-90">
                        {getRoleLabel()}
                    </span>
                    <div className="flex items-center gap-2">
                        {timestamp && (
                            <span className="text-xs opacity-75">
                                {timestamp}
                            </span>
                        )}
                        <span className="text-xs opacity-75">
                            #{index + 1}
                        </span>
                    </div>
                </div>

                {/* Message Content */}
                <div className="text-sm">
                    {isTool ? (
                        <pre className="bg-gray-100 dark:bg-gray-900 p-2 rounded text-xs overflow-x-auto border border-gray-200 dark:border-gray-700 font-mono whitespace-pre-wrap">
                            {getMessageContent()}
                        </pre>
                    ) : (
                        <div className="whitespace-pre-wrap">
                            {getMessageContent()}
                        </div>
                    )}
                </div>

                {/* Tool Calls Display */}
                {isAssistant && 'toolCalls' in message && message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mt-3 space-y-2">
                        <div className="text-xs font-semibold opacity-90 border-t border-current/20 pt-2">
                            TOOL CALLS ({message.toolCalls.length})
                        </div>
                        {message.toolCalls.map((toolCall, toolIndex) => (
                            <ToolCallDisplay key={toolCall.id || toolIndex} toolCall={toolCall} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function TurnContainer({ turn, index }: { turn: z.infer<typeof Turn>; index: number }) {
    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {/* Turn Header */}
            <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-semibold text-gray-700 dark:text-gray-300">
                            TURN #{index + 1}
                        </span>
                        <TurnReason reason={turn.reason} />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                        {new Date(turn.createdAt).toLocaleTimeString()}
                    </div>
                </div>
            </div>

            {/* Turn Content */}
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {/* Input Messages */}
                {turn.input.messages && turn.input.messages.length > 0 && (
                    <div className="p-4 bg-gray-50 dark:bg-gray-900/50">
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide">
                            Input Messages ({turn.input.messages.length})
                        </div>
                        <div className="space-y-1">
                            {turn.input.messages.map((message, msgIndex) => (
                                <MessageDisplay key={`input-${msgIndex}`} message={message} index={msgIndex} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Output Messages */}
                {turn.output && turn.output.length > 0 && (
                    <div className="p-4">
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide">
                            Output Messages ({turn.output.length})
                        </div>
                        <div className="space-y-1">
                            {turn.output.map((message, msgIndex) => (
                                <MessageDisplay key={`output-${msgIndex}`} message={message} index={msgIndex} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Error Display */}
                {turn.error && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/10 border-l-4 border-red-500">
                        <div className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1 uppercase tracking-wide">
                            Error
                        </div>
                        <div className="text-sm text-red-700 dark:text-red-300 font-mono">
                            {turn.error}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function ConversationView({ projectId, conversationId }: { projectId: string; conversationId: string; }) {
    const [conversation, setConversation] = useState<z.infer<typeof Conversation> | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let ignore = false;
        (async () => {
            setLoading(true);
            const res = await fetchConversation({ conversationId });
            if (ignore) return;
            setConversation(res);
            setLoading(false);
        })();
        return () => { ignore = true; };
    }, [conversationId]);

    const title = useMemo(() => {
        if (!conversation) return 'Conversation';
        return `Conversation ${conversation.id}`;
    }, [conversation]);

    return (
        <Panel
            title={<div className="flex items-center gap-3"><div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div></div>}
            rightActions={<div className="flex items-center gap-3"></div>}
        >
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[1024px] mx-auto">
                    {loading && (
                        <div className="flex items-center gap-2">
                            <Spinner size="sm" />
                            <div>Loading...</div>
                        </div>
                    )}
                    {!loading && conversation && (
                        <div className="flex flex-col gap-6">
                            {/* Conversation Metadata */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Conversation ID:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">{conversation.id}</span>
                                    </div>
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Created:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                            {new Date(conversation.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    {conversation.updatedAt && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Updated:</span>
                                            <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                                {new Date(conversation.updatedAt).toLocaleString()}
                                            </span>
                                        </div>
                                    )}
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Live Workflow:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                            {conversation.isLiveWorkflow ? 'Yes' : 'No'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Turns */}
                            {conversation.turns && conversation.turns.length > 0 ? (
                                <div className="space-y-4">
                                    <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                                        Turns ({conversation.turns.length})
                                    </div>
                                    {conversation.turns.map((turn, index) => (
                                        <TurnContainer key={turn.id} turn={turn} index={index} />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                    <div className="text-sm font-mono">No turns in this conversation.</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}


