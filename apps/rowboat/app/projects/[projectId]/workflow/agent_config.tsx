"use client";
import { WithStringId } from "../../../lib/types/types";
import { AgenticAPITool } from "../../../lib/types/agents_api_types";
import { WorkflowPrompt, WorkflowAgent, Workflow } from "../../../lib/types/workflow_types";
import { DataSource } from "../../../lib/types/datasource_types";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input, Radio, RadioGroup} from "@nextui-org/react";
import { z } from "zod";
import { DataSourceIcon } from "../../../lib/components/datasource-icon";
import { ActionButton, StructuredPanel } from "../../../lib/components/structured-panel";
import { FormSection } from "../../../lib/components/form-section";
import { EditableField } from "../../../lib/components/editable-field";
import { Label } from "../../../lib/components/label";
import { PlusIcon, SparklesIcon } from "lucide-react";
import { List } from "./config_list";
import { useState, useEffect, useRef } from "react";
import { usePreviewModal } from "./preview-modal";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@nextui-org/react";
import { Textarea } from "@nextui-org/react";
import { PreviewModalProvider } from "./preview-modal";
import { CopilotMessage } from "@/app/lib/types/copilot_types";
import { getCopilotAgentInstructions } from "@/app/actions/copilot_actions";
import { PlusIcon, ChevronRight, ChevronDown } from "lucide-react";
import { List } from "./config_list";
import { Dropdown as CustomDropdown } from "../../../lib/components/dropdown";
import { useState } from "react";

export function AgentConfig({
    projectId,
    workflow,
    agent,
    usedAgentNames,
    agents,
    tools,
    prompts,
    dataSources,
    handleUpdate,
    handleClose,
}: {
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    agent: z.infer<typeof WorkflowAgent>,
    usedAgentNames: Set<string>,
    agents: z.infer<typeof WorkflowAgent>[],
    tools: z.infer<typeof AgenticAPITool>[],
    prompts: z.infer<typeof WorkflowPrompt>[],
    dataSources: WithStringId<z.infer<typeof DataSource>>[],
    handleUpdate: (agent: z.infer<typeof WorkflowAgent>) => void,
    handleClose: () => void,
}) {
    const [isAdvancedConfigOpen, setIsAdvancedConfigOpen] = useState(false);

    const atMentions = [];
    for (const a of agents) {
        if (a.disabled || a.name === agent.name) {
            continue;
        }
        const id = `agent:${a.name}`;
        atMentions.push({
            id,
            value: id,
        });
    }
    for (const prompt of prompts) {
        const id = `prompt:${prompt.name}`;
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

    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const { showPreview } = usePreviewModal();

    return <StructuredPanel title={agent.name} actions={[
        <ActionButton
            key="close"
            onClick={handleClose}
            icon={<svg className="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M6 18 17.94 6M18 18 6.06 6" />
            </svg>}
        >
            Close
        </ActionButton>
    ]}>
        <div className="flex flex-col gap-4">
            {!agent.locked && (
                <FormSection label="Name" showDivider>
                    <EditableField
                        key="name"
                        value={agent.name}
                        onChange={(value) => {
                            handleUpdate({
                                ...agent,
                                name: value
                            });
                        }}
                        placeholder="Enter agent name"
                        validate={(value) => {
                            if (value.length === 0) {
                                return { valid: false, errorMessage: "Name cannot be empty" };
                            }
                            if (usedAgentNames.has(value)) {
                                return { valid: false, errorMessage: "This name is already taken" };
                            }
                            if (!/^[a-zA-Z0-9_-\s]+$/.test(value)) {
                                return { valid: false, errorMessage: "Name must contain only letters, numbers, underscores, hyphens, and spaces" };
                            }
                            return { valid: true };
                        }}
                    />
                </FormSection>
            )}

            <FormSection label="Description" showDivider>
                <EditableField
                    key="description"
                    value={agent.description || ""}
                    onChange={(value) => {
                        handleUpdate({
                            ...agent,
                            description: value
                        });
                    }}
                    placeholder="Enter a description for this agent"
                />
            </FormSection>

            {/* To be refactored */}
            <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                    <Label label="Instructions" />
                    <Button
                        variant="light"
                        size="sm"
                        startContent={<SparklesIcon size={16} />}
                        onPress={() => setShowGenerateModal(true)}
                    >
                        Generate
                    </Button>
                </div>
                <div className="w-full flex flex-col">
                    <EditableField
                        key="instructions"
                        value={agent.instructions}
                        onChange={(value) => {
                            handleUpdate({
                                ...agent,
                                instructions: value
                            });
                        }}
                        markdown
                        multiline
                        mentions
                        mentionsAtValues={atMentions}
                    />
                </div>
            </div>

            {/* Refactored */}
            <FormSection label="Instructions" showDivider>
                <EditableField
                    key="instructions"
                    value={agent.instructions}
                    onChange={(value) => {
                        handleUpdate({
                            ...agent,
                            instructions: value
                        });
                    }}
                    markdown
                    multiline
                    mentions
                    mentionsAtValues={atMentions}
                />
            </FormSection>

            <FormSection label="Examples" showDivider>
                <EditableField
                    key="examples"
                    value={agent.examples || ""}
                    onChange={(value) => {
                        handleUpdate({
                            ...agent,
                            examples: value
                        });
                    }}
                    placeholder="Enter examples for this agent"
                    markdown
                    multiline
                    mentions
                    mentionsAtValues={atMentions}
                />
            </FormSection>

            <FormSection label="RAG (beta)" showDivider>
                <div className="flex flex-col gap-3">
                    <Dropdown>
                        <DropdownTrigger>
                            <Button
                                variant="light"
                                size="sm"
                                startContent={<PlusIcon size={16} />}
                                className="w-fit text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                                Add data source
                            </Button>
                        </DropdownTrigger>
                        <DropdownMenu onAction={(key) => handleUpdate({
                            ...agent,
                            ragDataSources: [...(agent.ragDataSources || []), key as string]
                        })}>
                            {dataSources.filter((ds) => !(agent.ragDataSources || []).includes(ds._id)).map((ds) => (
                                <DropdownItem
                                    key={ds._id}
                                    startContent={<DataSourceIcon type={ds.data.type} />}
                                    className="text-foreground dark:text-gray-300"
                                >
                                    {ds.name}
                                </DropdownItem>
                            ))}
                        </DropdownMenu>
                    </Dropdown>

                    <div className="flex flex-col gap-2">
                        {(agent.ragDataSources || []).map((source) => {
                            const ds = dataSources.find((ds) => ds._id === source);
                            return (
                                <div 
                                    key={source}
                                    className="group flex items-center justify-between p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="p-1 rounded-md bg-white dark:bg-gray-700">
                                            <DataSourceIcon type={ds?.data.type} />
                                        </div>
                                        <span className="text-sm text-gray-700 dark:text-gray-300">
                                            {ds?.name || "Unknown"}
                                        </span>
                                    </div>
                                    <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-500"
                                        onClick={() => {
                                            const newSources = agent.ragDataSources?.filter((s) => s !== source);
                                            handleUpdate({
                                                ...agent,
                                                ragDataSources: newSources
                                            });
                                        }}
                                    >
                                        <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </Button>
                                </div>
                            );
                        })}
                    </div>

                    {agent.ragDataSources !== undefined && agent.ragDataSources.length > 0 && (
                        <>
                            <button
                                onClick={() => setIsAdvancedConfigOpen(!isAdvancedConfigOpen)}
                                className="flex items-center gap-2 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase hover:text-gray-500 dark:hover:text-gray-400"
                            >
                                {isAdvancedConfigOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                Advanced RAG configuration
                            </button>
                            
                            {isAdvancedConfigOpen && (
                                <div className="ml-4 flex flex-col gap-4">
                                    <Label label="Return type" />
                                    <RadioGroup
                                        size="sm"
                                        orientation="horizontal"
                                        value={agent.ragReturnType}
                                        onValueChange={(value) => handleUpdate({
                                            ...agent,
                                            ragReturnType: value as z.infer<typeof WorkflowAgent>['ragReturnType']
                                        })}
                                        classNames={{
                                            label: "text-foreground dark:text-gray-300"
                                        }}
                                    >
                                        <Radio value="chunks">Chunks</Radio>
                                        <Radio value="content">Content</Radio>
                                    </RadioGroup>
                                    <Label label="No. of matches" />
                                    <Input
                                        variant="bordered"
                                        size="sm"
                                        className="w-20 text-foreground dark:text-gray-300"
                                        value={agent.ragK.toString()}
                                        onValueChange={(value) => handleUpdate({
                                            ...agent,
                                            ragK: parseInt(value)
                                        })}
                                        type="number"
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </FormSection>

            <FormSection label="Model" showDivider>
                <CustomDropdown
                    value={agent.model}
                    options={WorkflowAgent.shape.model.options.map((model) => ({
                        key: model.value,
                        label: model.value
                    }))}
                    onChange={(value) => handleUpdate({
                        ...agent,
                        model: value as z.infer<typeof WorkflowAgent>['model']
                    })}
                    className="w-40"
                />
            </FormSection>

            <FormSection label="Conversation control after turn">
                <CustomDropdown
                    value={agent.controlType}
                    options={[
                        { key: "retain", label: "Retain control" },
                        { key: "relinquish_to_parent", label: "Relinquish to parent" },
                        { key: "relinquish_to_start", label: "Relinquish to 'start' agent" }
                    ]}
                    onChange={(value) => handleUpdate({
                        ...agent,
                        controlType: value as z.infer<typeof WorkflowAgent>['controlType']
                    })}
                />
            </FormSection>

            <Divider />

            <PreviewModalProvider>
                <GenerateInstructionsModal 
                    projectId={projectId}
                    workflow={workflow}
                    agent={agent}
                    isOpen={showGenerateModal}
                    onClose={() => setShowGenerateModal(false)}
                    currentInstructions={agent.instructions}
                    onApply={(newInstructions) => {
                        handleUpdate({
                            ...agent,
                            instructions: newInstructions
                        });
                    }}
                />
            </PreviewModalProvider>
        </div>
    </StructuredPanel>;
}

function GenerateInstructionsModal({
    projectId,
    workflow,
    agent,
    isOpen,
    onClose,
    currentInstructions,
    onApply
}: {
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    agent: z.infer<typeof WorkflowAgent>,
    isOpen: boolean,
    onClose: () => void,
    currentInstructions: string,
    onApply: (newInstructions: string) => void
}) {
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { showPreview } = usePreviewModal();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen) {
            setPrompt("");
            setIsLoading(false);
            setError(null);
            textareaRef.current?.focus();
        }
    }, [isOpen]);

    const handleGenerate = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const msgs: z.infer<typeof CopilotMessage>[] = [
                {
                    role: 'user',
                    content: prompt,
                },
            ];
            const newInstructions = await getCopilotAgentInstructions(projectId, msgs, workflow, agent.name);
            
            onClose();
            
            showPreview(
                currentInstructions,
                newInstructions,
                true, // markdown enabled
                "Generated Instructions",
                "Review the changes below:", // message before diff
                () => onApply(newInstructions) // apply callback
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (prompt.trim() && !isLoading) {
                handleGenerate();
            }
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg">
            <ModalContent>
                <ModalHeader>Generate Instructions</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-4">
                        {error && (
                            <div className="p-2 bg-red-50 border border-red-200 rounded-lg flex gap-2 justify-between items-center text-sm">
                                <p className="text-red-600">{error}</p>
                                <Button
                                    size="sm"
                                    color="danger"
                                    onClick={() => {
                                        setError(null);
                                        handleGenerate();
                                    }}
                                >
                                    Retry
                                </Button>
                            </div>
                        )}
                        <Textarea
                            ref={textareaRef}
                            label="What should this agent do?"
                            placeholder="e.g., This agent should help users analyze their data and provide insights..."
                            variant="bordered"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading}
                        />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button 
                        variant="light" 
                        onPress={onClose}
                        disabled={isLoading}
                    >
                        Cancel
                    </Button>
                    <Button 
                        color="primary"
                        onPress={handleGenerate}
                        isLoading={isLoading}
                        disabled={!prompt.trim()}
                    >
                        Generate
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
