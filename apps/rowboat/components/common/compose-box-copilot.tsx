'use client';

import { Button, Spinner, Tooltip } from "@heroui/react";
import { useRef, useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";

// Add a type to support both message formats
type FlexibleMessage = {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | any;
    version?: string;
    chatId?: string;
    createdAt?: string;
    // Add any other optional fields that might be needed
};

interface ComposeBoxCopilotProps {
    handleUserMessage: (message: string) => void;
    messages: any[];
    loading: boolean;
    initialFocus?: boolean;
    shouldAutoFocus?: boolean;
    onFocus?: () => void;
    onCancel?: () => void;
    statusBar?: any;
}

export function ComposeBoxCopilot({
    handleUserMessage,
    messages,
    loading,
    initialFocus = false,
    shouldAutoFocus = false,
    onFocus,
    onCancel,
    statusBar,
}: ComposeBoxCopilotProps) {
    const [input, setInput] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previousMessagesLength = useRef(messages.length);

    // Handle initial focus
    useEffect(() => {
        if (initialFocus && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [initialFocus]);

    // Handle auto-focus when new messages arrive
    useEffect(() => {
        if (shouldAutoFocus && messages.length > previousMessagesLength.current && textareaRef.current) {
            textareaRef.current.focus();
        }
        previousMessagesLength.current = messages.length;
    }, [messages.length, shouldAutoFocus]);

    function handleInput() {
        const prompt = input.trim();
        if (!prompt) {
            return;
        }
        setInput('');
        handleUserMessage(prompt);
    }

    function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleInput();
        }
    }

    const handleFocus = () => {
        setIsFocused(true);
        onFocus?.();
    };

    return (
        <div className="relative group z-10">
            {/* Status bar above the input */}
            {statusBar && <CopilotStatusBar {...statusBar} />}
            {/* Keyboard shortcut hint */}
            <div className="absolute -top-6 right-0 text-xs text-gray-500 dark:text-gray-400 opacity-0 
                          group-hover:opacity-100 transition-opacity">
                Press ⌘ + Enter to send
            </div>
            {/* Outer container without external padding; textarea grows to fill */}
            <div className="rounded-2xl border-[1.5px] border-gray-200 dark:border-[#2a2d31] relative 
                          bg-white dark:bg-[#1e2023] flex items-end gap-2">
                {/* Textarea */}
                <div className="flex-1 p-3">
                    <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        onFocus={handleFocus}
                        onBlur={() => setIsFocused(false)}
                        disabled={loading}
                        placeholder="Type a message..."
                        autoResize={true}
                        maxHeight={200}
                        className={`
                            min-h-6
                            border-0! shadow-none! ring-0!
                            bg-transparent
                            resize-none
                            [&::-webkit-scrollbar]:w-1
                            [&::-webkit-scrollbar-track]:bg-transparent
                            [&::-webkit-scrollbar-thumb]:bg-gray-300
                            [&::-webkit-scrollbar-thumb]:dark:bg-[#2a2d31]
                            [&::-webkit-scrollbar-thumb]:rounded-full
                            placeholder:text-gray-500 dark:placeholder:text-gray-400
                        `}
                    />
                </div>
                {/* Send button */}
                <Button
                    size="sm"
                    isIconOnly
                    disabled={!loading && !input.trim()}
                    onPress={loading ? onCancel : handleInput}
                    className={`
                        transition-all duration-200
                        ${loading 
                            ? 'bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/50 dark:hover:bg-red-800/60 dark:text-red-300'
                            : input.trim() 
                                ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:hover:bg-indigo-800/60 dark:text-indigo-300' 
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                        }
                        scale-100 hover:scale-105 active:scale-95
                        disabled:opacity-50 disabled:scale-95
                        hover:shadow-md dark:hover:shadow-indigo-950/10
                        mb-0.5
                    `}
                >
                    {loading ? (
                        <StopIcon size={16} />
                    ) : (
                        <SendIcon 
                            size={16} 
                            className={`transform transition-transform ${isFocused ? 'translate-x-0.5' : ''}`}
                        />
                    )}
                </Button>
            </div>
        </div>
    );
}

// Custom SendIcon component for better visual alignment
function SendIcon({ size, className }: { size: number, className?: string }) {
    return (
        <svg 
            width={size} 
            height={size} 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            className={className}
        >
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </svg>
    );
}

// Custom StopIcon component for better visual alignment
function StopIcon({ size, className }: { size: number, className?: string }) {
    return (
        <svg 
            width={size} 
            height={size} 
            viewBox="0 0 24 24" 
            fill="currentColor" 
            stroke="none"
            className={className}
        >
            <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
    );
}

function CopilotStatusBar({
    allCardsLoaded,
    allApplied,
    appliedCount,
    pendingCount,
    streamingLine,
    completedSummary,
    hasPanelWarning,
    handleApplyAll,
    context,
    onCloseContext
}: {
    allCardsLoaded?: boolean;
    allApplied?: boolean;
    appliedCount?: number;
    pendingCount?: number;
    streamingLine?: string;
    completedSummary?: string;
    hasPanelWarning?: boolean;
    handleApplyAll?: () => void;
    context?: any;
    onCloseContext?: () => void;
}) {
    // Context label rendering
    const renderContext = () => {
        if (!context) return null;
        let icon = null;
        if (context.type === 'chat') icon = <svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-300 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.96 8.96 0 01-4.39-1.11L2 17l1.11-2.61A8.96 8.96 0 012 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" /></svg>;
        if (context.type === 'agent') icon = <svg className="w-3.5 h-3.5 text-green-500 dark:text-green-300 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a6 6 0 016 6c0 2.21-1.343 4.09-3.25 5.25A4.992 4.992 0 0110 18a4.992 4.992 0 01-2.75-4.75C5.343 12.09 4 10.21 4 8a6 6 0 016-6z" /></svg>;
        if (context.type === 'tool') icon = <svg className="w-3.5 h-3.5 text-yellow-500 dark:text-yellow-300 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M13.293 2.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-8.5 8.5a1 1 0 01-.293.207l-4 2a1 1 0 01-1.316-1.316l2-4a1 1 0 01.207-.293l8.5-8.5z" /></svg>;
        if (context.type === 'prompt') icon = <svg className="w-3.5 h-3.5 text-purple-500 dark:text-purple-300 mr-1" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /></svg>;
        let label = '';
        if (context.type === 'chat') label = 'Chat';
        if (context.type === 'agent') label = `Agent: ${context.name}`;
        if (context.type === 'tool') label = `Tool: ${context.name}`;
        if (context.type === 'prompt') label = `Prompt: ${context.name}`;
        return (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-800/40 shadow-sm text-xs font-medium text-zinc-700 dark:text-zinc-200 max-w-[180px] truncate">
                {icon}
                <span className="truncate max-w-[110px]">{label}</span>
            </div>
        );
    };
    // Status/ticker rendering
    const renderStatus = () => {
        if (!allCardsLoaded && !streamingLine && !hasPanelWarning && !completedSummary) return null;
        return (
            <div className="flex flex-col min-w-0">
                {hasPanelWarning && (
                    <span className="text-xs text-yellow-600 dark:text-yellow-400 font-semibold flex items-center">
                        <span className="mr-1">⚠️</span> Some changes could not be applied
                    </span>
                )}
                {allCardsLoaded && completedSummary ? (
                    <span className="font-semibold text-xs text-gray-900 dark:text-gray-100 truncate">{completedSummary}</span>
                ) : streamingLine && (
                    <span className="font-semibold text-xs text-gray-900 dark:text-gray-100 truncate">{streamingLine}</span>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400">{appliedCount ?? 0} applied, {pendingCount ?? 0} pending</span>
            </div>
        );
    };
    // Apply All button
    const renderApplyAll = () => {
        // Show disabled button with tooltip while streaming
        if (!allCardsLoaded) {
            return (
                <Tooltip content="Apply all will be available when all changes are ready" placement="top">
                    <div className="inline-block">
                        <button
                            disabled
                            className="flex items-center gap-2 px-3 py-1 rounded-full font-medium text-xs transition-colors duration-200 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-200 dark:border-zinc-700 shadow-none"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2l4 -4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Apply all
                        </button>
                    </div>
                </Tooltip>
            );
        }
        // Show real button when ready
        return (
            <button
                onClick={handleApplyAll}
                disabled={allApplied}
                className={`flex items-center gap-2 px-3 py-1 rounded-full font-medium text-xs transition-colors duration-200
                    ${
                        allApplied
                            ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-200 dark:border-zinc-700 shadow-none'
                            : 'bg-blue-100 dark:bg-zinc-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-zinc-800 border border-blue-200 dark:border-zinc-800 shadow-sm'
                    }
                `}
            >
                {allApplied ? (
                    <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2l4 -4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        All applied!
                    </>
                ) : (
                    <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2l4 -4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Apply all
                    </>
                )}
            </button>
        );
    };
    return (
        <div className="w-auto max-w-[calc(100%-16px)] mx-auto flex items-center px-3 py-1 pt-2.5 pb-5 mt-2 -mb-3 rounded-xl bg-white/90 dark:bg-zinc-800/90 border border-zinc-300 dark:border-zinc-700 shadow-md dark:shadow-zinc-950/10 backdrop-blur-sm transition-all z-0 relative mx-2 overflow-visible">
            {/* Left: context + status/ticker, flex-1, truncate as needed */}
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-visible">
                {renderContext()}
                {renderStatus() && (
                    <div className="ml-2 min-w-0 overflow-visible">{renderStatus()}</div>
                )}
            </div>
            {/* Divider and rightmost Apply All button */}
            {renderApplyAll() && (
                <>
                    <div className="mx-2 h-5 border-l border-gray-200 dark:border-gray-700 flex-shrink-0" />
                    <div className="flex-shrink-0 flex items-center overflow-visible">{renderApplyAll()}</div>
                </>
            )}
            {/* Optional: subtle shadow at the bottom for extra depth */}
            <div className="absolute left-0 right-0 bottom-0 h-2 pointer-events-none rounded-b-xl shadow-[0_6px_12px_-6px_rgba(0,0,0,0.10)]" />
        </div>
    );
}
