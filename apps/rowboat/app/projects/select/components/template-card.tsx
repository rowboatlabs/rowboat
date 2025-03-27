'use client';
import { cn } from "@heroui/react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import React from "react";
import { WorkflowTemplate } from "@/app/lib/types/workflow_types";
import { z } from "zod";
import { tokens } from "@/app/styles/tokens";

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
    const description = typeof template === "string" 
        ? `"${template}"`
        : template.description;

    const textRef = React.useRef<HTMLDivElement>(null);
    const [needsExpansion, setNeedsExpansion] = useState(false);

    React.useEffect(() => {
        if (textRef.current) {
            const needsButton = textRef.current.scrollHeight > textRef.current.clientHeight;
            setNeedsExpansion(needsButton);
        }
    }, [description]);

    return <div
        className={cn(
            "card",
            "relative flex flex-col cursor-pointer",
            "border border-gray-300 dark:border-gray-700",
            "hover:border-gray-500 dark:hover:border-gray-500",
            "bg-white dark:bg-gray-900",
            selected && "border-gray-800 dark:border-gray-300 shadow-md",
            isExpanded ? "h-auto" : "h-[160px]"
        )}
        onClick={() => onSelect(templateKey)}
    >
        {selected && <div className="absolute top-2 right-2 bg-gray-200 dark:bg-gray-800 flex items-center justify-center rounded p-1">
            <CheckIcon size={16} />
        </div>}
        
        <div className="flex flex-col h-full">
            <div className="text-base font-medium dark:text-gray-100 text-left mb-2">{name}</div>
            <div className="relative flex-1">
                <div 
                    ref={textRef}
                    className={cn(
                        "text-sm text-gray-500 dark:text-gray-400 text-left pr-6",
                        !isExpanded && "line-clamp-3"
                    )}
                >
                    {description}
                </div>
                {needsExpansion && (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }
                        }}
                        className={cn(
                            "absolute right-0 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer",
                            isExpanded ? "relative mt-1" : "bottom-0"
                        )}
                        aria-label={isExpanded ? "Show less" : "Show more"}
                    >
                        {isExpanded ? (
                            <ChevronUpIcon size={16} />
                        ) : (
                            <ChevronDownIcon size={16} />
                        )}
                    </div>
                )}
            </div>
        </div>
    </div>
} 