'use client';

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@heroui/react";
import { Panel } from "@/components/common/panel-common";
import { fetchConversation } from "@/app/actions/conversation_actions";
import { Conversation } from "@/src/entities/models/conversation";
import { Turn } from "@/src/entities/models/turn";
import { z } from "zod";
import Link from "next/link";
import { MessageDisplay } from "../../../../lib/components/message-display";

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

function TurnReasonWithLink({ reason, projectId }: { reason: z.infer<typeof Turn>['reason']; projectId: string }) {
    const getReasonDisplay = () => {
        switch (reason.type) {
            case 'chat':
                return { label: 'CHAT', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
            case 'api':
                return { label: 'API', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
            case 'job':
                return { 
                    label: `JOB: ${reason.jobId}`, 
                    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
                    isJob: true,
                    jobId: reason.jobId
                };
            default:
                return { label: 'UNKNOWN', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' };
        }
    };

    const { label, color, isJob, jobId } = getReasonDisplay();

    if (isJob && jobId) {
        return (
            <Link
                href={`/projects/${projectId}/jobs/${jobId}`}
                className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-mono font-medium ${color} hover:opacity-80 transition-opacity`}
            >
                {label}
            </Link>
        );
    }

    return (
        <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-mono font-medium ${color}`}>
            {label}
        </span>
    );
}

function TurnContainer({ turn, index, projectId }: { turn: z.infer<typeof Turn>; index: number; projectId: string }) {
    return (
        <div id={`turn-${turn.id}`} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {/* Turn Header */}
            <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-semibold text-gray-700 dark:text-gray-300">
                            TURN #{index + 1}
                        </span>
                        <TurnReasonWithLink reason={turn.reason} projectId={projectId} />
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

                            {/* Workflow */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">
                                    Workflow
                                </div>
                                <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto border border-gray-200 dark:border-gray-700 font-mono max-h-[400px]">
                                    {JSON.stringify(conversation.workflow, null, 2)}
                                </pre>
                            </div>

                            {/* Turns */}
                            {conversation.turns && conversation.turns.length > 0 ? (
                                <div className="space-y-4">
                                    <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                                        Turns ({conversation.turns.length})
                                    </div>
                                    {conversation.turns.map((turn, index) => (
                                        <TurnContainer key={turn.id} turn={turn} index={index} projectId={projectId} />
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



