'use client';
import { cn } from "@heroui/react";
import { CheckIcon } from "lucide-react";
import { tokens } from "@/app/styles/design-tokens";
import { Textarea } from "@/components/ui/textarea";

interface CustomPromptCardProps {
    selected: boolean;
    onSelect: () => void;
    customPrompt: string;
    onCustomPromptChange: (value: string) => void;
}

export function CustomPromptCard({
    selected,
    onSelect,
    customPrompt,
    onCustomPromptChange
}: CustomPromptCardProps) {
    const DEFAULT_PROMPT = "Create a customer support assistant with one example agent";

    // When unselected, show default text. When selected, show editable customPrompt
    const displayText = selected ? customPrompt : DEFAULT_PROMPT;

    return (
        <div
            onClick={onSelect}
            className={cn(
                "w-full text-left cursor-pointer",
                "p-4",
                tokens.radius.lg,
                tokens.transitions.default,
                tokens.shadows.sm,
                "border",
                selected ? [
                    "border-indigo-600 dark:border-indigo-400",
                    "bg-indigo-50/50 dark:bg-indigo-500/10",
                ] : [
                    tokens.colors.light.border,
                    tokens.colors.dark.border,
                    tokens.colors.light.surface,
                    tokens.colors.dark.surface,
                    "hover:border-indigo-600/30 dark:hover:border-indigo-400/30",
                    "hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5",
                    "transform hover:scale-[1.01]",
                    tokens.shadows.hover,
                ]
            )}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                    <h3 className={cn(
                        tokens.typography.sizes.base,
                        tokens.typography.weights.medium,
                        tokens.colors.light.text.primary,
                        tokens.colors.dark.text.primary
                    )}>
                        Custom Prompt
                    </h3>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full"
                    >
                        {selected ? (
                            <Textarea
                                value={customPrompt}
                                onChange={(e) => onCustomPromptChange(e.target.value)}
                                className={cn(
                                    "w-full min-h-[100px]",
                                    "resize-none",
                                    tokens.radius.md,
                                    tokens.transitions.default,
                                    "bg-white dark:bg-[#1F1F23]"
                                )}
                                autoFocus
                            />
                        ) : (
                            <div 
                                onClick={onSelect}
                                className={cn(
                                    tokens.typography.sizes.sm,
                                    tokens.colors.light.text.secondary,
                                    tokens.colors.dark.text.secondary
                                )}
                            >
                                {displayText}
                            </div>
                        )}
                    </div>
                </div>
                <div className={cn(
                    "w-5 h-5 rounded-full border-2",
                    tokens.transitions.default,
                    selected ? [
                        "border-indigo-600 dark:border-indigo-400",
                        "bg-indigo-600 dark:bg-indigo-400",
                    ] : [
                        "border-gray-300 dark:border-gray-600",
                    ]
                )}>
                    {selected && (
                        <CheckIcon className="w-4 h-4 text-white" />
                    )}
                </div>
            </div>
        </div>
    );
} 