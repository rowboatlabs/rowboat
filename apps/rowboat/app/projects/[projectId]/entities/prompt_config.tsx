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
const sectionHeaderStyles = "text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

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
                        startContent={<XIcon className="w-4 h-4" />}
                        aria-label="Close prompt config"
                        className="transition-colors"
                    >
                        Закрыть
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-6 p-4">
                {prompt.type === "base_prompt" && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className={sectionHeaderStyles}>
                                Название
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
                                    }}
                                    placeholder="Имя промта..."
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
                        Промт
                    </label>
                    <Textarea
                        value={prompt.prompt}
                        onChange={(e) => {
                            handleUpdate({
                                ...prompt,
                                prompt: e.target.value
                            });
                        }}
                        placeholder="Измените промт здесь..."
                        className={`${textareaStyles} min-h-[200px]`}
                        autoResize
                    />
                </div>
            </div>
        </Panel>
    );
} 