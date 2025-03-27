'use client';
import { cn } from "@heroui/react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import React from "react";
import { WorkflowTemplate } from "@/app/lib/types/workflow_types";
import { z } from "zod";
import { tokens } from "@/app/styles/design-tokens";

interface TemplateCardProps {
    templateKey: string;
    template: z.infer<typeof WorkflowTemplate> | string;
    onSelect: (templateKey: string) => void;
    selected: boolean;
    type?: "template" | "prompt";
}

export function TemplateCard({
    templateKey,
    template,
    onSelect,
    selected,
    type = "template"
}: TemplateCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const name = typeof template === "string" ? templateKey : template.name;
    const description = typeof template === "string" ? template : template.description;

    const textRef = React.useRef<HTMLDivElement>(null);
    const [needsExpansion, setNeedsExpansion] = useState(false);

    React.useEffect(() => {
        if (textRef.current) {
            const needsButton = textRef.current.scrollHeight > textRef.current.clientHeight;
            setNeedsExpansion(needsButton);
        }
    }, [description]);

    return (
        <div
            onClick={() => onSelect(templateKey)}
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
                ],
                tokens.focus.default,
                tokens.focus.dark
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
                        {name}
                    </h3>
                    <p className={cn(
                        tokens.typography.sizes.sm,
                        tokens.colors.light.text.secondary,
                        tokens.colors.dark.text.secondary
                    )}>
                        {description}
                    </p>
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