"use client";
import { WorkflowPrompt } from "../../../lib/types/workflow_types";
import { Divider, Input, Textarea } from "@nextui-org/react";
import { z } from "zod";
import { ActionButton, StructuredPanel } from "../../../lib/components/structured-panel";
import { EditableField } from "../../../lib/components/editable-field";
import { XIcon } from "@heroicons/react/24/outline";

export function PromptConfig({
    prompt,
    usedPromptNames,
    handleUpdate,
    handleClose,
}: {
    prompt: z.infer<typeof WorkflowPrompt>,
    usedPromptNames: Set<string>,
    handleUpdate: (prompt: z.infer<typeof WorkflowPrompt>) => void,
    handleClose: () => void,
}) {
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
                />
            </div>
        </div>
    </StructuredPanel>;
} 