'use client';

import { z } from "zod";
import { Message } from "@/app/lib/types/types";
import Link from "next/link";

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

export function MessageDisplay({ message, index }: { message: z.infer<typeof Message>; index: number }) {
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
