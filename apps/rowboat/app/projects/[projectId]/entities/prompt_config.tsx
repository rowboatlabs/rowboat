"use client";
import { WorkflowAgent, WorkflowPrompt, WorkflowTool } from "../../../lib/types/workflow_types";
import { z } from "zod";
import { XIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import clsx from "clsx";

// Common section header styles (matching tool_config)
const sectionHeaderStyles = "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

// Enhanced textarea styles with improved states
const textareaStyles = "rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500";

export function PromptConfig({
    prompt,
    agents,
    tools,
    prompts,
    usedPromptNames,
    handleUpdate,
    handleClose,
}: {
    prompt: z.infer<typeof WorkflowPrompt>,
    agents: z.infer<typeof WorkflowAgent>[],
    tools: z.infer<typeof WorkflowTool>[],
    prompts: z.infer<typeof WorkflowPrompt>[],
    usedPromptNames: Set<string>,
    handleUpdate: (prompt: z.infer<typeof WorkflowPrompt>) => void,
    handleClose: () => void,
}) {
    const [nameError, setNameError] = useState<string | null>(null);
    const [showSavedBanner, setShowSavedBanner] = useState(false);

    // Function to show saved banner
    const showSavedMessage = () => {
        setShowSavedBanner(true);
        setTimeout(() => setShowSavedBanner(false), 2000);
    };

    const atMentions = [
        ...agents.map(a => ({ id: `agent:${a.name}`, value: `agent:${a.name}` })),
        ...prompts.filter(p => p.name !== prompt.name).map(p => ({ id: `prompt:${p.name}`, value: `prompt:${p.name}` })),
        ...tools.map(tool => ({ id: `tool:${tool.name}`, value: `tool:${tool.name}` }))
    ];

    // Move validation function inside component to access props
    const validatePromptName = (value: string) => {
        if (value.length === 0) {
            return "Name cannot be empty";
        }
        if (value !== prompt.name && usedPromptNames.has(value)) {
            return "This name is already taken";
        }
        return null;
    };

    return (
        <Panel 
            title={
                <div className="flex items-center justify-between w-full">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {prompt.name}
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleClose}
                        showHoverContent={true}
                        hoverContent="Close"
                    >
                        <XIcon className="w-4 h-4" />
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-6 p-4">
                {/* Saved Banner */}
                {showSavedBanner && (
                    <div className="absolute top-4 right-4 z-10 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 duration-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-medium">Changes saved ✓</span>
                    </div>
                )}
                {prompt.type === "base_prompt" && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className={sectionHeaderStyles}>
                                Name
                            </label>
                            <div className={clsx(
                                "border rounded-lg focus-within:ring-2",
                                nameError 
                                    ? "border-red-500 focus-within:ring-red-500/20" 
                                    : "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                            )}>
                                <Textarea
                                    value={prompt.name}
                                    useValidation={true}
                                    updateOnBlur={true}
                                    validate={(value) => {
                                        const error = validatePromptName(value);
                                        setNameError(error);
                                        return { valid: !error, errorMessage: error || undefined };
                                    }}
                                    onValidatedChange={(value) => {
                                        handleUpdate({
                                            ...prompt,
                                            name: value
                                        });
                                        showSavedMessage();
                                    }}
                                    placeholder="Enter prompt name..."
                                    className="w-full text-sm bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                                    autoResize
                                />
                            </div>
                            {nameError && (
                                <p className="text-sm text-red-500">{nameError}</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <label className={sectionHeaderStyles}>
                        Prompt
                    </label>
                    <Textarea
                        value={prompt.prompt}
                        onChange={(e) => {
                            handleUpdate({
                                ...prompt,
                                prompt: e.target.value
                            });
                            showSavedMessage();
                        }}
                        placeholder="Edit prompt here..."
                        className={`${textareaStyles} min-h-[200px]`}
                        autoResize
                    />
                </div>
            </div>
        </Panel>
    );
} 