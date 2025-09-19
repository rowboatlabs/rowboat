import { useState, useRef, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button, Spinner } from "@heroui/react";

interface ComposeBoxPlaygroundProps {
    handleUserMessage: (message: string) => void;
    messages: any[];
    loading: boolean;
    disabled?: boolean;
    shouldAutoFocus?: boolean;
    onFocus?: () => void;
    onCancel?: () => void; // Add this prop
}

export function ComposeBoxPlayground({
    handleUserMessage,
    messages,
    loading,
    disabled = false,
    shouldAutoFocus = false,
    onFocus,
    onCancel,
}: ComposeBoxPlaygroundProps) {
    const [input, setInput] = useState('');
    const [uploading, setUploading] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previousMessagesLength = useRef(messages.length);

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

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleInput();
        }
    };

    const handleFocus = () => {
        setIsFocused(true);
        onFocus?.();
    };

    async function handleImagePicked(file: File) {
        if (!file) return;
        try {
            setUploading(true);
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('/api/uploaded-images', {
                method: 'POST',
                body: form,
            });
            if (!res.ok) {
                throw new Error(`Upload failed: ${res.status}`);
            }
            const data = await res.json();
            const url: string | undefined = data?.url;
            if (!url) throw new Error('No URL returned');
            handleUserMessage(`The user uploaded an image. URL: ${url}`);
        } catch (e) {
            console.error('Image upload failed', e);
            alert('Image upload failed. Please try again.');
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="relative group">
            {/* Keyboard shortcut hint */}
            <div className="absolute -top-6 right-0 text-xs text-gray-500 dark:text-gray-400 opacity-0 
                          group-hover:opacity-100 transition-opacity">
                Press ⌘ + Enter to send
            </div>

            {/* Outer container with padding */}
            <div className="rounded-2xl border-[1.5px] border-gray-200 dark:border-[#2a2d31] p-3 relative 
                          bg-white dark:bg-[#1e2023] flex items-end gap-2">
                {/* Upload button */}
                <label className={`
                          flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer
                          ${uploading ? 'bg-gray-100 dark:bg-gray-800 text-gray-400' : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'}
                          transition-colors
                        `}>
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={disabled || loading || uploading}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleImagePicked(f);
                            e.currentTarget.value = '';
                        }}
                    />
                    {uploading ? <Spinner size="sm" /> : <ImageIcon size={16} />}
                </label>
                {/* Textarea */}
                <div className="flex-1">
                    <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        onFocus={handleFocus}
                        onBlur={() => setIsFocused(false)}
                        disabled={disabled || loading}
                        placeholder="Type a message..."
                        autoResize={true}
                        maxHeight={120}
                        className={`
                            min-h-0!
                            border-0! shadow-none! ring-0!
                            bg-transparent
                            resize-none
                            overflow-y-auto
                            [&::-webkit-scrollbar]:w-1
                            [&::-webkit-scrollbar-track]:bg-transparent
                            [&::-webkit-scrollbar-thumb]:bg-gray-300
                            [&::-webkit-scrollbar-thumb]:dark:bg-[#2a2d31]
                            [&::-webkit-scrollbar-thumb]:rounded-full
                            placeholder:text-gray-500 dark:placeholder:text-gray-400
                        `}
                    />
                </div>

                {/* Send/Stop button */}
                <Button
                    size="sm"
                    isIconOnly
                    disabled={disabled || uploading || (loading ? false : !input.trim())}
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

// Add StopIcon component (copy from ComposeBoxCopilot)
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

function ImageIcon({ size, className }: { size: number, className?: string }) {
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
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
        </svg>
    );
}
