"use client";
import { WorkflowAgent, WorkflowPrompt, WorkflowTool } from "../../../lib/types/workflow_types";
import { Divider } from "@nextui-org/react";
import { z } from "zod";
import { ActionButton, StructuredPanel } from "../../../lib/components/structured-panel";
import { EditableField } from "../../../lib/components/editable-field";
import { XIcon } from "@heroicons/react/24/outline";

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
    const atMentions = [];
    for (const a of agents) {
        const id = `agent:${a.name}`;
        atMentions.push({
            id,
            value: id,
        });
    }
    for (const p of prompts) {
        if (p.name === prompt.name) {
            continue;
        }
        const id = `prompt:${p.name}`;
        atMentions.push({
            id,
            value: id,
        });
    }
    for (const tool of tools) {
        const id = `tool:${tool.name}`;
        atMentions.push({
            id,
            value: id,
        });
    }

    return <StructuredPanel title={prompt.name} actions={[
        <ActionButton
            key="close"
            onClick={handleClose}
            icon={<XIcon className="w-4 h-4" />}
        >
            Close
        </ActionButton>
    ]}>
        <div className="flex flex-col gap-4">
            {prompt.type === "base_prompt" && (
                <>
                    <EditableField
                        label="Name"
                        value={prompt.name}
                        onChange={(value) => {
                            handleUpdate({
                                ...prompt,
                                name: value
                            });
                        }}
                        placeholder="Enter prompt name"
                        validate={(value) => {
                            if (value.length === 0) {
                                return { valid: false, errorMessage: "Name cannot be empty" };
                            }
                            if (usedPromptNames.has(value)) {
                                return { valid: false, errorMessage: "This name is already taken" };
                            }
                            return { valid: true };
                        }}
                    />
                    <Divider />
                </>
            )}

            <div className="w-full flex flex-col">
                <EditableField
                    value={prompt.prompt}
                    onChange={(value) => {
                        handleUpdate({
                            ...prompt,
                            prompt: value
                        });
                    }}
                    placeholder="Edit prompt here..."
                    markdown
                    label="Prompt"
                    multiline
                    mentions
                    mentionsAtValues={atMentions}
                />
            </div>
        </div>
    </StructuredPanel>;
} 