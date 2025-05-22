"use client";
import { WithStringId } from "../../../lib/types/types";
import { AgenticAPITool } from "../../../lib/types/agents_api_types";
import { WorkflowPrompt, WorkflowAgent, Workflow, WorkflowTool } from "../../../lib/types/workflow_types";
import { DataSource } from "../../../lib/types/datasource_types";
import { z } from "zod";
import { PlusIcon, Sparkles, X as XIcon, ChevronDown, ChevronRight, Trash2, Maximize2, Minimize2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { usePreviewModal } from "../workflow/preview-modal";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Select, SelectItem } from "@heroui/react";
import { PreviewModalProvider } from "../workflow/preview-modal";
import { CopilotMessage } from "@/app/lib/types/copilot_types";
import { getCopilotAgentInstructions } from "@/app/actions/copilot_actions";
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";
import { Dropdown as CustomDropdown } from "../../../lib/components/dropdown";
import { createAtMentions } from "../../../lib/components/atmentions";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/common/panel-common";
import { Button as CustomButton } from "@/components/ui/button";
import clsx from "clsx";
import { EditableField } from "@/app/lib/components/editable-field";
import { USE_TRANSFER_CONTROL_OPTIONS } from "@/app/lib/feature_flags";
import { Input } from "@/components/ui/input";
import { Info } from "lucide-react";
import { useCopilot } from "../copilot/use-copilot";

// Common section header styles
const sectionHeaderStyles = "text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

// Common textarea styles
const textareaStyles = "rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500";

// Add this type definition after the imports
type TabType = 'instructions' | 'examples' | 'configurations' | 'rag';

export function AgentConfig({
    projectId,
    workflow,
    agent,
    usedAgentNames,
    agents,
    tools,
    projectTools,
    prompts,
    dataSources,
    handleUpdate,
    handleClose,
    useRag,
    triggerCopilotChat,
}: {
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    agent: z.infer<typeof WorkflowAgent>,
    usedAgentNames: Set<string>,
    agents: z.infer<typeof WorkflowAgent>[],
    tools: z.infer<typeof AgenticAPITool>[],
    projectTools: z.infer<typeof WorkflowTool>[],
    prompts: z.infer<typeof WorkflowPrompt>[],
    dataSources: WithStringId<z.infer<typeof DataSource>>[],
    handleUpdate: (agent: z.infer<typeof WorkflowAgent>) => void,
    handleClose: () => void,
    useRag: boolean,
    triggerCopilotChat: (message: string) => void,
}) {
    const [isAdvancedConfigOpen, setIsAdvancedConfigOpen] = useState(false);
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [isInstructionsMaximized, setIsInstructionsMaximized] = useState(false);
    const [isExamplesMaximized, setIsExamplesMaximized] = useState(false);
    const { showPreview } = usePreviewModal();
    const [localName, setLocalName] = useState(agent.name);
    const [nameError, setNameError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('instructions');
    const [showRagCta, setShowRagCta] = useState(false);
    const [previousRagSources, setPreviousRagSources] = useState<string[]>([]);
    
    const {
        start: startCopilotChat,
    } = useCopilot({
        projectId,
        workflow,
        context: null,
        dataSources
    });

    useEffect(() => {
        setLocalName(agent.name);
    }, [agent.name]);

    // Track changes in RAG datasources
    useEffect(() => {
        const currentSources = agent.ragDataSources || [];
        // Show CTA when transitioning from 0 to 1 datasource
        if (currentSources.length === 1 && previousRagSources.length === 0) {
            setShowRagCta(true);
        }
        // Hide CTA when all datasources are deleted
        if (currentSources.length === 0) {
            setShowRagCta(false);
        }
        setPreviousRagSources(currentSources);
    }, [agent.ragDataSources, previousRagSources.length]);

    const handleUpdateInstructions = async () => {
        const message = `Update the instructions for agent "${agent.name}" to use the rag tool (rag_search) since data sources have been added. If this has already been done, do not take any action, but let me know.`;
        triggerCopilotChat(message);
        setShowRagCta(false);
    };

    // Add effect to handle control type update when transfer control is disabled
    useEffect(() => {
        if (!USE_TRANSFER_CONTROL_OPTIONS && agent.controlType !== 'retain') {
            handleUpdate({ ...agent, controlType: 'retain' });
        }
    }, [agent.controlType, agent, handleUpdate]);

    // Add effect to handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isInstructionsMaximized) {
                    setIsInstructionsMaximized(false);
                }
                if (isExamplesMaximized) {
                    setIsExamplesMaximized(false);
                }
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isInstructionsMaximized, isExamplesMaximized]);

    const validateName = (value: string) => {
        if (value.length === 0) {
            setNameError("Name cannot be empty");
            return false;
        }
        if (value !== agent.name && usedAgentNames.has(value)) {
            setNameError("This name is already taken");
            return false;
        }
        if (!/^[a-zA-Z0-9_-\s]+$/.test(value)) {
            setNameError("Name must contain only letters, numbers, underscores, hyphens, and spaces");
            return false;
        }
        setNameError(null);
        return true;
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newName = e.target.value;
        setLocalName(newName);
        
        if (validateName(newName)) {
            handleUpdate({
                ...agent,
                name: newName
            });
        }
    };

    const atMentions = createAtMentions({
        agents,
        prompts,
        tools: [...tools, ...projectTools],
        currentAgentName: agent.name
    });

    return (
        <Panel 
            title={
                <div className="flex items-center justify-between w-full">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {agent.name}
                    </div>
                    <CustomButton
                        variant="secondary"
                        size="sm"
                        onClick={handleClose}
                        showHoverContent={true}
                        hoverContent="Close"
                    >
                        <XIcon className="w-4 h-4" />
                    </CustomButton>
                </div>
            }
        >
            <div className="flex flex-col gap-6 p-4 h-[calc(100vh-100px)] min-h-0 flex-1">
                {/* Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                    {(['instructions', 'examples', 'configurations', 'rag'] as TabType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={clsx(
                                "px-4 py-2 text-sm font-medium transition-colors relative",
                                activeTab === tab
                                    ? "text-indigo-600 dark:text-indigo-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500 dark:after:bg-indigo-400"
                                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                            )}
                        >
                            {tab === 'rag' ? 'RAG' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="mt-4 flex-1 flex flex-col min-h-0 h-0">
                    {activeTab === 'instructions' && (
                        <>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <label className={sectionHeaderStyles}>
                                        Instructions
                                    </label>
                                    <CustomButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setIsInstructionsMaximized(!isInstructionsMaximized)}
                                        showHoverContent={true}
                                        hoverContent={isInstructionsMaximized ? "Minimize" : "Maximize"}
                                    >
                                        {isInstructionsMaximized ? (
                                            <Minimize2 className="w-4 h-4" />
                                        ) : (
                                            <Maximize2 className="w-4 h-4" />
                                        )}
                                    </CustomButton>
                                </div>
                                <CustomButton
                                    variant="primary"
                                    size="sm"
                                    onClick={() => setShowGenerateModal(true)}
                                    startContent={<Sparkles className="w-4 h-4" />}
                                >
                                    Generate
                                </CustomButton>
                            </div>
                            {isInstructionsMaximized ? (
                                <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
                                    <div className="h-full flex flex-col">
                                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center gap-2">
                                                <label className={sectionHeaderStyles}>
                                                    Instructions
                                                </label>
                                                <CustomButton
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setIsInstructionsMaximized(false)}
                                                    showHoverContent={true}
                                                    hoverContent="Minimize"
                                                >
                                                    <Minimize2 className="w-4 h-4" />
                                                </CustomButton>
                                            </div>
                                            <CustomButton
                                                variant="primary"
                                                size="sm"
                                                onClick={() => setShowGenerateModal(true)}
                                                startContent={<Sparkles className="w-4 h-4" />}
                                            >
                                                Generate
                                            </CustomButton>
                                        </div>
                                        <div className="flex-1 overflow-hidden p-4">
                                            <EditableField
                                                key="instructions-maximized"
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
                                                showSaveButton={true}
                                                showDiscardButton={true}
                                                className="h-full min-h-0 overflow-auto"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
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
                                    showSaveButton={true}
                                    showDiscardButton={true}
                                    className="h-full min-h-0 overflow-auto"
                                />
                            )}
                        </>
                    )}

                    {activeTab === 'examples' && (
                        <>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <label className={sectionHeaderStyles}>
                                        Examples
                                    </label>
                                    <CustomButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setIsExamplesMaximized(!isExamplesMaximized)}
                                        showHoverContent={true}
                                        hoverContent={isExamplesMaximized ? "Minimize" : "Maximize"}
                                    >
                                        {isExamplesMaximized ? (
                                            <Minimize2 className="w-4 h-4" />
                                        ) : (
                                            <Maximize2 className="w-4 h-4" />
                                        )}
                                    </CustomButton>
                                </div>
                            </div>
                            {isExamplesMaximized ? (
                                <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
                                    <div className="h-full flex flex-col">
                                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center gap-2">
                                                <label className={sectionHeaderStyles}>
                                                    Examples
                                                </label>
                                                <CustomButton
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setIsExamplesMaximized(false)}
                                                    showHoverContent={true}
                                                    hoverContent="Minimize"
                                                >
                                                    <Minimize2 className="w-4 h-4" />
                                                </CustomButton>
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-hidden p-4">
                                            <EditableField
                                                key="examples-maximized"
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
                                                showSaveButton={true}
                                                showDiscardButton={true}
                                                className="h-full min-h-0 overflow-auto"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
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
                                    showSaveButton={true}
                                    showDiscardButton={true}
                                    className="h-full min-h-0 overflow-auto"
                                />
                            )}
                        </>
                    )}

                    {activeTab === 'configurations' && (
                        <div className="space-y-6">
                            {!agent.locked && (
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
                                                value={agent.name}
                                                useValidation={true}
                                                updateOnBlur={true}
                                                validate={(value) => {
                                                    const error = validateAgentName(value, agent.name, usedAgentNames);
                                                    setNameError(error);
                                                    return { valid: !error, errorMessage: error || undefined };
                                                }}
                                                onValidatedChange={(value) => {
                                                    handleUpdate({
                                                        ...agent,
                                                        name: value
                                                    });
                                                }}
                                                placeholder="Enter agent name..."
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
                                <div className="space-y-2">
                                    <label className={sectionHeaderStyles}>
                                        Description
                                    </label>
                                    <Textarea
                                        value={agent.description || ""}
                                        onChange={(e) => {
                                            handleUpdate({
                                                ...agent,
                                                description: e.target.value
                                            });
                                        }}
                                        placeholder="Enter a description for this agent"
                                        className={textareaStyles}
                                        autoResize
                                    />
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="flex items-center">
                                    <label className={sectionHeaderStyles}>
                                        Agent Type
                                    </label>
                                    <div className="relative ml-2 group">
                                        <Info 
                                            className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition-colors"
                                        />
                                        <div className="absolute bottom-full left-0 mb-2 p-3 w-80 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs invisible group-hover:visible z-50">
                                            <div className="mb-1 font-medium">Agent Types</div>
                                            Conversation agents&apos; responses are user-facing. You can use conversation agents for multi-turn conversations with users.
                                            <br />
                                            <br />
                                            Task agents&apos; responses are internal and available to other agents. You can use them to build pipelines and DAGs within workflows. E.g. Conversation Agent {'->'} Task Agent {'->'} Task Agent.
                                            <div className="absolute h-2 w-2 bg-white dark:bg-gray-800 transform rotate-45 -bottom-1 left-4 border-r border-b border-gray-200 dark:border-gray-700"></div>
                                        </div>
                                    </div>
                                </div>
                                <CustomDropdown
                                    value={agent.outputVisibility}
                                    options={[
                                        { key: "user_facing", label: "Conversation Agent" },
                                        { key: "internal", label: "Task Agent" }
                                    ]}
                                    onChange={(value) => handleUpdate({
                                        ...agent,
                                        outputVisibility: value as z.infer<typeof WorkflowAgent>['outputVisibility']
                                    })}
                                />
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center">
                                    <label className={sectionHeaderStyles}>
                                        Model
                                    </label>
                                    <div className="relative ml-2 group">
                                        <Info 
                                            className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition-colors"
                                        />
                                        <div className="absolute bottom-full left-0 mb-2 p-3 w-80 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs invisible group-hover:visible z-50">
                                            <div className="mb-1 font-medium">Model Configuration</div>
                                            Set this according to the PROVIDER_BASE_URL you have set in your .env file (such as your LiteLLM, gateway). 
                                            <br />
                                            <br />
                                            E.g. LiteLLM&apos;s naming convention is like: &apos;claude-3-7-sonnet-latest&apos;, but you may have set alias model names or might be using a different provider like openrouter, openai etc. 
                                            <br />
                                            <br />
                                            By default, the model is set to gpt-4.1, assuming your OpenAI API key is set in PROVIDER_API_KEY and PROVIDER_BASE_URL is not set.
                                            <div className="absolute h-2 w-2 bg-white dark:bg-gray-800 transform rotate-45 -bottom-1 left-4 border-r border-b border-gray-200 dark:border-gray-700"></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="w-full">
                                    <Input
                                        value={agent.model}
                                        onChange={(e) => handleUpdate({
                                            ...agent,
                                            model: e.target.value as z.infer<typeof WorkflowAgent>['model']
                                        })}
                                        className="w-full max-w-64"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center">
                                    <label className={sectionHeaderStyles}>
                                        Max calls from parent agent per turn
                                    </label>
                                    <div className="relative ml-2 group">
                                        <Info 
                                            className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition-colors"
                                        />
                                        <div className="absolute bottom-full left-0 mb-2 p-3 w-80 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs invisible group-hover:visible z-50">
                                            <div className="mb-1 font-medium">Max Calls Configuration</div>
                                            This setting limits how many times a parent agent can call this agent in a single turn, to prevent infinite loops.
                                            <div className="absolute h-2 w-2 bg-white dark:bg-gray-800 transform rotate-45 -bottom-1 left-4 border-r border-b border-gray-200 dark:border-gray-700"></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="w-full">
                                    <Input
                                        type="number"
                                        min="1"
                                        value={agent.maxCallsPerParentAgent || 3}
                                        onChange={(e) => handleUpdate({
                                            ...agent,
                                            maxCallsPerParentAgent: parseInt(e.target.value)
                                        })}
                                        className="w-full max-w-24"
                                    />
                                </div>
                            </div>

                            {USE_TRANSFER_CONTROL_OPTIONS && (
                                <div className="space-y-4">
                                    <label className={sectionHeaderStyles}>
                                        Conversation control after turn
                                    </label>
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
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'rag' && useRag && (
                        <div className="space-y-6">
                            <div className="flex flex-col gap-3">
                                <div className="space-y-2">
                                    <label className={sectionHeaderStyles}>
                                        DATA SOURCES
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <Select
                                            variant="bordered"
                                            placeholder="Add data source"
                                            size="sm"
                                            className="w-64"
                                            onSelectionChange={(keys) => {
                                                const key = keys.currentKey as string;
                                                if (key) {
                                                    handleUpdate({
                                                        ...agent,
                                                        ragDataSources: [...(agent.ragDataSources || []), key]
                                                    });
                                                }
                                            }}
                                            startContent={<PlusIcon className="w-4 h-4 text-gray-500" />}
                                        >
                                            {dataSources
                                                .filter((ds) => !(agent.ragDataSources || []).includes(ds._id))
                                                .map((ds) => (
                                                    <SelectItem key={ds._id}>
                                                        {ds.name}
                                                    </SelectItem>
                                                ))
                                            }
                                        </Select>

                                        {showRagCta && (
                                            <CustomButton
                                                variant="primary"
                                                size="sm"
                                                onClick={handleUpdateInstructions}
                                                className="whitespace-nowrap"
                                            >
                                                Update Instructions
                                            </CustomButton>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    {(agent.ragDataSources || []).map((source) => {
                                        const ds = dataSources.find((ds) => ds._id === source);
                                        return (
                                            <div 
                                                key={source}
                                                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-indigo-50 dark:bg-indigo-900/20">
                                                        <svg 
                                                            className="w-4 h-4 text-indigo-600 dark:text-indigo-400" 
                                                            fill="none" 
                                                            viewBox="0 0 24 24" 
                                                            stroke="currentColor"
                                                        >
                                                            <path 
                                                                strokeLinecap="round" 
                                                                strokeLinejoin="round" 
                                                                strokeWidth={2} 
                                                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" 
                                                            />
                                                        </svg>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {ds?.name || "Unknown"}
                                                        </span>
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                                            Data Source
                                                        </span>
                                                    </div>
                                                </div>
                                                <CustomButton
                                                    variant="tertiary"
                                                    size="sm"
                                                    className="text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                    onClick={() => {
                                                        const newSources = agent.ragDataSources?.filter((s) => s !== source);
                                                        handleUpdate({
                                                            ...agent,
                                                            ragDataSources: newSources
                                                        });
                                                    }}
                                                    startContent={<Trash2 className="w-4 h-4" />}
                                                >
                                                    Remove
                                                </CustomButton>
                                            </div>
                                        );
                                    })}
                                </div>

                                {agent.ragDataSources !== undefined && agent.ragDataSources.length > 0 && (
                                    <>
                                        <div className="mt-4">
                                            <button
                                                onClick={() => setIsAdvancedConfigOpen(!isAdvancedConfigOpen)}
                                                className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                                            >
                                                {isAdvancedConfigOpen ? 
                                                    <ChevronDown className="w-4 h-4 text-gray-400" /> : 
                                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                                }
                                                Advanced RAG configuration
                                            </button>
                                            
                                            {isAdvancedConfigOpen && (
                                                <div className="mt-3 ml-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                                    <div className="grid gap-6">
                                                        <div className="space-y-2">
                                                            <label className={sectionHeaderStyles}>
                                                                Return type
                                                            </label>
                                                            <div className="flex gap-4">
                                                                {["chunks", "content"].map((type) => (
                                                                    <button
                                                                        key={type}
                                                                        onClick={() => handleUpdate({
                                                                            ...agent,
                                                                            ragReturnType: type as z.infer<typeof WorkflowAgent>['ragReturnType']
                                                                        })}
                                                                        className={clsx(
                                                                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                                                            agent.ragReturnType === type
                                                                                ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-2 border-indigo-200 dark:border-indigo-800"
                                                                                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                                                                        )}
                                                                    >
                                                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <label className={sectionHeaderStyles}>
                                                                Number of matches
                                                            </label>
                                                            <div className="flex items-center gap-3">
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    max="20"
                                                                    className="w-24 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 focus:border-indigo-500 dark:focus:border-indigo-400"
                                                                    value={agent.ragK}
                                                                    onChange={(e) => handleUpdate({
                                                                        ...agent,
                                                                        ragK: parseInt(e.target.value)
                                                                    })}
                                                                />
                                                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                                                    matches
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                Number of relevant chunks to retrieve (1-20)
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

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
        </Panel>
    );
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
                true,
                "Generated Instructions",
                "Review the changes below:",
                () => onApply(newInstructions)
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
                                <CustomButton
                                    variant="primary"
                                    size="sm"
                                    onClick={() => {
                                        setError(null);
                                        handleGenerate();
                                    }}
                                >
                                    Retry
                                </CustomButton>
                            </div>
                        )}
                        <Textarea
                            ref={textareaRef}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading}
                            placeholder="e.g., This agent should help users analyze their data and provide insights..."
                            className={textareaStyles}
                            autoResize
                        />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <CustomButton
                        variant="secondary"
                        size="sm"
                        onClick={onClose}
                        disabled={isLoading}
                    >
                        Cancel
                    </CustomButton>
                    <CustomButton
                        variant="primary"
                        size="sm"
                        onClick={handleGenerate}
                        disabled={!prompt.trim() || isLoading}
                        isLoading={isLoading}
                    >
                        Generate
                    </CustomButton>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}

function validateAgentName(value: string, currentName?: string, usedNames?: Set<string>) {
    if (value.length === 0) {
        return "Name cannot be empty";
    }
    if (currentName && value !== currentName && usedNames?.has(value)) {
        return "This name is already taken";
    }
    if (!/^[a-zA-Z0-9_-\s]+$/.test(value)) {
        return "Name must contain only letters, numbers, underscores, hyphens, and spaces";
    }
    return null;
}