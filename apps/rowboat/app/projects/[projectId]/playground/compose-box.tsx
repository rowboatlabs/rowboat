'use client';

import { Button, Spinner, Textarea } from "@nextui-org/react";
import { CornerDownLeftIcon } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { apiV1 } from "rowboat-shared";
import { z } from "zod";

export function ComposeBox({
    minRows=3,
    disabled=false,
    loading=false,
    handleUserMessage,
    messages,
}: {
    minRows?: number;
    disabled?: boolean;
    loading?: boolean;
    handleUserMessage: (prompt: string) => void;
    messages: z.infer<typeof apiV1.ChatMessage>[];
}) {
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    function handleInput() {
        const prompt = input.trim();
        if (!prompt) {
            return;
        }
        setInput('');

        handleUserMessage(prompt);
    }

    function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleInput();
        }
    }
    // focus on the input field
    useEffect(() => {
        inputRef.current?.focus();
    }, [messages]);

    return <Textarea
        required
        ref={inputRef}
        variant="bordered"
        placeholder="Enter message..."
        minRows={minRows}
        maxRows={15}
        value={input}
        onValueChange={setInput}
        onKeyDown={handleInputKeyDown}
        disabled={disabled}
        className="w-full"
        endContent={<Button
            size="sm"
            isIconOnly
            disabled={disabled}
            onClick={handleInput}
            className="bg-default-100"
        >
            <CornerDownLeftIcon size={16} />
        </Button>}
    />;
}
