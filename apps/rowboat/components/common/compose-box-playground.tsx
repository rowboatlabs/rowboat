import { useState, useRef, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button, Spinner } from "@heroui/react";

interface ComposeBoxPlaygroundProps {
    handleUserMessage: (message: string, imageDebug?: { url: string; description?: string | null }) => void;
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
    const [pendingImage, setPendingImage] = useState<{ url?: string; previewSrc?: string; mimeType?: string; description?: string | null } | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previousMessagesLength = useRef(messages.length);
    const uploadAbortRef = useRef<AbortController | null>(null);

    // Handle auto-focus when new messages arrive
    useEffect(() => {
        if (shouldAutoFocus && messages.length > previousMessagesLength.current && textareaRef.current) {
            textareaRef.current.focus();
        }
        previousMessagesLength.current = messages.length;
    }, [messages.length, shouldAutoFocus]);

    function handleInput() {
        // Mirror send-button disable rules to block Enter submits
        if (disabled || loading || uploading) return;
        if (pendingImage?.url && pendingImage.description === undefined) return;
        const text = input.trim();
        if (!text && !pendingImage) {
            return;
        }
        // Only include the user's typed text; omit image URL/markdown from user message
        const parts: string[] = [];
        if (text) parts.push(text);
        const prompt = parts.join('\n\n');
        // Build optional debug payload to render as internal-only message in debug view
        const imageDebug = pendingImage?.url
            ? { url: pendingImage.url, description: pendingImage.description ?? null }
            : undefined;
        setInput('');
        if (pendingImage?.previewSrc) {
            try { URL.revokeObjectURL(pendingImage.previewSrc); } catch {}
        }
        setPendingImage(null);
        handleUserMessage(prompt, imageDebug);
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
            // Show immediate local preview
            const previewSrc = URL.createObjectURL(file);
            setPendingImage({ previewSrc });
            setUploading(true);
            // Cancel any in-flight request
            if (uploadAbortRef.current) {
                try { uploadAbortRef.current.abort(); } catch {}
                uploadAbortRef.current = null;
            }
            const controller = new AbortController();
            uploadAbortRef.current = controller;
            let usedFallback = false;
            try {
                // 1) Request a presigned S3 upload URL via server action
                const { getUploadUrlForImage } = await import('@/app/actions/uploaded-images.actions');
                const urlData = await getUploadUrlForImage(file.type);
                const uploadUrl: string | undefined = urlData?.uploadUrl;
                const imageId: string | undefined = urlData?.id; // includes extension
                const imageUrl: string | undefined = urlData?.url; // points to /api/uploaded-images/<idWithExt>
                if (!uploadUrl || !imageId || !imageUrl) throw new Error('Invalid upload URL response');

                // 2) Upload the file directly to S3
                const putRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': file.type },
                    body: file,
                    signal: controller.signal,
                });
                if (!putRes.ok) throw new Error(`Failed to upload image: ${putRes.status}`);

                // 3) Update local state with URL (description pending)
                if (uploadAbortRef.current === controller) {
                    setPendingImage({ url: imageUrl, previewSrc, mimeType: file.type, description: undefined });
                }

                // 4) Ask server to generate description from S3 image
                try {
                    const { describeUploadedImage } = await import('@/app/actions/uploaded-images.actions');
                    const descData = await describeUploadedImage(imageId);
                    const description: string | null = descData?.description ?? null;
                    if (uploadAbortRef.current === controller) {
                        setPendingImage({ url: imageUrl, previewSrc, mimeType: file.type, description });
                    }
                } catch {
                    // If description fails, still allow sending
                    if (uploadAbortRef.current === controller) {
                        setPendingImage({ url: imageUrl, previewSrc, mimeType: file.type, description: null });
                    }
                }
            } catch (err: any) {
                // On local, S3 may be unconfigured. Fallback to legacy temp upload endpoint.
                if (err?.name === 'AbortError') throw err;
                usedFallback = true;
                const form = new FormData();
                form.append('file', file);
                const res = await fetch('/api/uploaded-images', {
                    method: 'POST',
                    body: form,
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
                const data = await res.json();
                const url: string | undefined = data?.url;
                if (!url) throw new Error('No URL returned');
                if (uploadAbortRef.current === controller) {
                    setPendingImage({ url, previewSrc, mimeType: data?.mimeType || file.type, description: data?.description ?? null });
                }
            }
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                // Swallow aborts
                console.log('Image upload/description aborted');
            } else {
                console.error('Image upload failed', e);
                alert('Image upload failed. Please try again.');
            }
        } finally {
            if (uploadAbortRef.current === null) {
                // Dismissed earlier; ensure uploading is false
                setUploading(false);
            } else {
                // If this is still the active controller, clear uploading and ref
                setUploading(false);
                uploadAbortRef.current = null;
            }
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
                {/* Textarea */}
                <div className="flex-1">
                    {pendingImage && (
                        <div className="mb-2 inline-block relative">
                            <img
                                src={pendingImage.previewSrc || pendingImage.url}
                                alt="Uploaded image preview"
                                className="w-16 h-16 object-cover rounded border border-gray-200 dark:border-gray-700"
                            />
                            <button
                                type="button"
                                aria-label="Remove image"
                                className="absolute -top-1 -right-1 p-1 rounded-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-700 shadow hover:bg-gray-50 dark:hover:bg-zinc-800"
                                onClick={() => {
                                    if (pendingImage?.previewSrc) {
                                        try { URL.revokeObjectURL(pendingImage.previewSrc); } catch {}
                                    }
                                    if (uploadAbortRef.current) {
                                        try { uploadAbortRef.current.abort(); } catch {}
                                        uploadAbortRef.current = null;
                                    }
                                    setUploading(false);
                                    setPendingImage(null);
                                }}
                            >
                                <XIcon size={12} />
                            </button>
                        </div>
                    )}
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

                {/* Image upload button (moved to the right) */}
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
                {/* Send/Stop button */}
                <Button
                    size="sm"
                    isIconOnly
                    disabled={
                        disabled
                        || uploading
                        // If an image is selected but description isn't ready yet, keep disabled
                        || (pendingImage?.url && pendingImage.description === undefined)
                        // When not loading a response, require either text or a ready image
                        || (loading ? false : (!input.trim() && !pendingImage))
                    }
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

function XIcon({ size, className }: { size: number, className?: string }) {
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}
