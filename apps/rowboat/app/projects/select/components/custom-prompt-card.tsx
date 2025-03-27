'use client';
import { cn } from "@heroui/react";
import { Textarea } from "@/components/ui/textarea";
import { CheckIcon } from "lucide-react";
import { tokens } from "@/app/styles/tokens";

interface CustomPromptCardProps {
    onSelect: () => void;
    selected: boolean;
    onPromptChange: (prompt: string) => void;
    customPrompt: string;
}

export function CustomPromptCard({
    onSelect,
    selected,
    onPromptChange,
    customPrompt
}: CustomPromptCardProps) {
    return <button
        className={cn(
            "card",
            "relative flex flex-col gap-2 w-full",
            tokens.colors.surface.light,
            tokens.colors.surface.dark,
            tokens.colors.border.light,
            tokens.colors.border.dark,
            tokens.colors.border.hover.light,
            tokens.colors.border.hover.dark,
            selected && "border-gray-800 dark:border-gray-300 shadow-md"
        )}
        type="button"
        onClick={onSelect}
    >
        {selected && <div className="absolute top-2 right-2 bg-gray-200 dark:bg-gray-800 flex items-center justify-center rounded p-1">
            <CheckIcon size={16} />
        </div>}
        <div className="text-lg dark:text-gray-100 text-left">Custom Prompt</div>
        {selected ? (
            <Textarea
                placeholder="Enter your custom prompt here..."
                value={customPrompt}
                onChange={(e) => {
                    e.stopPropagation();
                    onPromptChange(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-h-[100px] text-sm w-full"
            />
        ) : (
            <div 
                className={cn(
                    "min-h-[60px] w-full p-2 text-sm text-gray-500 dark:text-gray-400 text-left",
                    "border border-gray-200 dark:border-gray-700",
                    "bg-gray-50 dark:bg-gray-800"
                )}
            >
                &ldquo;Create an assistant for a food delivery app that can take new orders, cancel existing orders and answer questions about refund policies&rdquo;
            </div>
        )}
    </button>
} 