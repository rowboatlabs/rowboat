"use client";
import { WithStringId } from "../../../lib/types/types";
import { WorkflowPrompt, WorkflowAgent, Workflow, WorkflowTool } from "../../../lib/types/workflow_types";
import { DataSource } from "../../../lib/types/datasource_types";
import { z } from "zod";
import { PlusIcon, Sparkles, X as XIcon, ChevronDown, ChevronRight, Trash2, Maximize2, Minimize2, StarIcon, DatabaseIcon, UserIcon, Settings, Info } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { usePreviewModal } from "../workflow/preview-modal";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Select, SelectItem, Chip, SelectSection } from "@heroui/react";
import { PreviewModalProvider } from "../workflow/preview-modal";
import { CopilotMessage } from "@/app/lib/types/copilot_types";
import { getCopilotAgentInstructions } from "@/app/actions/copilot_actions";
import { Dropdown as CustomDropdown } from "../../../lib/components/dropdown";
import { createAtMentions } from "../../../lib/components/atmentions";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/common/panel-common";
import { Button as CustomButton } from "@/components/ui/button";
import clsx from "clsx";
import { InputField } from "@/app/lib/components/input-field";
import { USE_TRANSFER_CONTROL_OPTIONS } from "@/app/lib/feature_flags";
import { Input } from "@/components/ui/input";
import { Info as InfoIcon } from "lucide-react";
import { useCopilot } from "../copilot/use-copilot";
import { BillingUpgradeModal } from "@/components/common/billing-upgrade-modal";
import { ModelsResponse } from "@/app/lib/types/billing_types";
import { SectionCard } from "@/components/common/section-card";

// Common section header styles
const sectionHeaderStyles = "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

// Common textarea styles
const textareaStyles = "rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500";

// Add this type definition after the imports
type TabType = 'instructions' | 'configurations';

export function AgentConfig({
    projectId,
    workflow,
    agent,
    usedAgentNames,
    usedPipelineNames,
    agents,
    tools,
    prompts,
    dataSources,
    handleUpdate,
    handleClose,
    useRag,
    triggerCopilotChat,
    eligibleModels,
    onOpenDataSourcesModal,
}: {
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    agent: z.infer<typeof WorkflowAgent>,
    usedAgentNames: Set<string>,
    usedPipelineNames: Set<string>,
    agents: z.infer<typeof WorkflowAgent>[],
    tools: z.infer<typeof WorkflowTool>[],
    prompts: z.infer<typeof WorkflowPrompt>[],
    dataSources: WithStringId<z.infer<typeof DataSource>>[],
    handleUpdate: (agent: z.infer<typeof WorkflowAgent>) => void,
    handleClose: () => void,
    useRag: boolean,
    triggerCopilotChat: (message: string) => void,
    eligibleModels: z.infer<typeof ModelsResponse.shape.agentModels> | "*",
    onOpenDataSourcesModal?: () => void,
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
    const [billingError, setBillingError] = useState<string | null>(null);
    const [showSavedBanner, setShowSavedBanner] = useState(false);

    // Check if this agent is part of any pipeline
    const isPartOfPipeline = workflow.pipelines?.some(pipeline => 
        pipeline.agents.includes(agent.name)
    ) || false;

    const {
        start: startCopilotChat,
    } = useCopilot({
        projectId,
        workflow,
        context: null,
        dataSources
    });

    // Function to show saved banner
    const showSavedMessage = () => {
        setShowSavedBanner(true);
        setTimeout(() => setShowSavedBanner(false), 2000);
    };

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

    // Add effect to handle control type update to ensure agents have correct control types
    useEffect(() => {
        let correctControlType: "retain" | "relinquish_to_parent" | "relinquish_to_start" | undefined = undefined;

        // Determine the correct control type based on output visibility
        if (agent.outputVisibility === "pipeline") {
            correctControlType = "relinquish_to_parent";
        } else if (agent.outputVisibility === "internal") {
            correctControlType = "relinquish_to_parent";
        } else if (agent.outputVisibility === "user_facing") {
            correctControlType = "retain";
        }

        // Handle undefined control type
        if (agent.controlType === undefined) {
            if (agent.outputVisibility === "user_facing") {
                correctControlType = "retain";
            } else {
                correctControlType = "relinquish_to_parent";
            }
        }

        // Update if the control type is incorrect
        if (correctControlType && agent.controlType !== correctControlType) {
            handleUpdate({ ...agent, controlType: correctControlType });
        }
    }, [agent.controlType, agent.outputVisibility, agent, handleUpdate]);

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
            setNameError("This name is already taken by another agent");
            return false;
        }
        // Check for conflicts with pipeline names
        if (usedPipelineNames.has(value)) {
            setNameError("This name is already taken by a pipeline");
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
        agents: agents,
        prompts,
        tools,
        pipelines: agent.outputVisibility === "pipeline" ? [] : (workflow.pipelines || []), // Pipeline agents can't reference pipelines
        currentAgentName: agent.name,
        currentAgent: agent
    });

    // Add local state for max calls input
    const [maxCallsInput, setMaxCallsInput] = useState(String(agent.maxCallsPerParentAgent || 3));
    const [maxCallsError, setMaxCallsError] = useState<string | null>(null);
    // Sync local state with agent prop
    useEffect(() => {
      setMaxCallsInput(String(agent.maxCallsPerParentAgent || 3));
    }, [agent.maxCallsPerParentAgent]);

    return (
        <Panel 
            title={
                <div className="flex items-center justify-between w-full">
                    <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
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
                               {/* Saved Banner */}
               {showSavedBanner && (
                   <div className="absolute top-4 left-4 z-10 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 duration-300">
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                       </svg>
                       <span className="text-sm font-medium">Changes saved</span>
                   </div>
               )}

                {/* Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                    {(['instructions', 'configurations'] as TabType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={clsx(
                                "px-4 py-2 text-base font-semibold transition-colors relative",
                                activeTab === tab
                                    ? "text-indigo-600 dark:text-indigo-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500 dark:after:bg-indigo-400"
                                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                            )}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="mt-4 flex-1 flex flex-col min-h-0 h-0">
                    {activeTab === 'instructions' && (
                        <>
                            {isInstructionsMaximized ? (
                                <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
                                    <div className="h-full flex flex-col">
                                        {/* Saved Banner for maximized instructions */}
                                        {showSavedBanner && (
                                            <div className="absolute top-4 left-4 z-10 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 duration-300">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                <span className="text-sm font-medium">Changes saved</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{agent.name}</span>
                                                <span className="text-sm text-gray-500 dark:text-gray-400">/</span>
                                                <span className="text-sm text-gray-500 dark:text-gray-400">Instructions</span>
                                            </div>
                                            <button
                                                type="button"
                                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                                                style={{ lineHeight: 0 }}
                                                onClick={() => setIsInstructionsMaximized(false)}
                                            >
                                                <Minimize2 className="w-4 h-4" style={{ width: 16, height: 16 }} />
                                            </button>
                                        </div>
                                        <div className="flex-1 overflow-hidden p-4">
                                            <InputField
                                                type="text"
                                                key="instructions-maximized"
                                                value={agent.instructions}
                                                onChange={(value) => {
                                                    handleUpdate({
                                                        ...agent,
                                                        instructions: value
                                                    });
                                                    showSavedMessage();
                                                }}
                                                markdown
                                                multiline
                                                mentions
                                                mentionsAtValues={atMentions}
                                                className="h-full min-h-0 overflow-auto"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Instructions Section */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <label className={sectionHeaderStyles}>Instructions</label>
                                                <button
                                                    type="button"
                                                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                                                    style={{ lineHeight: 0 }}
                                                    onClick={() => setIsInstructionsMaximized(!isInstructionsMaximized)}
                                                >
                                                    {isInstructionsMaximized ? (
                                                        <Minimize2 className="w-4 h-4" style={{ width: 16, height: 16 }} />
                                                    ) : (
                                                        <Maximize2 className="w-4 h-4" style={{ width: 16, height: 16 }} />
                                                    )}
                                                </button>
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
                                        {!isInstructionsMaximized && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                💡 Tip: Use the maximized view for a better editing experience
                                            </div>
                                        )}
                                        <InputField
                                            type="text"
                                            key="instructions"
                                            value={agent.instructions}
                                            onChange={(value) => {
                                                handleUpdate({
                                                    ...agent,
                                                    instructions: value
                                                });
                                                showSavedMessage();
                                            }}
                                            markdown
                                            multiline
                                            mentions
                                            mentionsAtValues={atMentions}
                                            className="h-full min-h-0 overflow-auto !mb-0 !mt-0"
                                        />
                                    </div>
                                    {/* Examples Section */}
                                    <div className="space-y-2 mb-6">
                                        <div className="flex items-center gap-2">
                                            <label className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Examples</label>
                                            <button
                                                type="button"
                                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                                                style={{ lineHeight: 0 }}
                                                onClick={() => setIsExamplesMaximized(!isExamplesMaximized)}
                                            >
                                                {isExamplesMaximized ? (
                                                    <Minimize2 className="w-4 h-4" style={{ width: 16, height: 16 }} />
                                                ) : (
                                                    <Maximize2 className="w-4 h-4" style={{ width: 16, height: 16 }} />
                                                )}
                                            </button>
                                        </div>
                                        {!isExamplesMaximized && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                💡 Tip: Use the maximized view for a better editing experience
                                            </div>
                                        )}
                                        {isExamplesMaximized ? (
                                            <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
                                                <div className="h-full flex flex-col">
                                                    {/* Saved Banner for maximized examples */}
                                                    {showSavedBanner && (
                                                        <div className="absolute top-4 left-4 z-10 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 duration-300">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                            <span className="text-sm font-medium">Changes saved</span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{agent.name}</span>
                                                            <span className="text-sm text-gray-500 dark:text-gray-400">/</span>
                                                            <span className="text-sm text-gray-500 dark:text-gray-400">Examples</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                                                            style={{ lineHeight: 0 }}
                                                            onClick={() => setIsExamplesMaximized(false)}
                                                        >
                                                            <Minimize2 className="w-4 h-4" style={{ width: 16, height: 16 }} />
                                                        </button>
                                                    </div>
                                                    <div className="flex-1 overflow-hidden p-4">
                                                        <InputField
                                                            type="text"
                                                            key="examples-maximized"
                                                            value={agent.examples || ""}
                                                            onChange={(value) => {
                                                                handleUpdate({
                                                                    ...agent,
                                                                    examples: value
                                                                });
                                                                showSavedMessage();
                                                            }}
                                                            placeholder="Enter examples for this agent"
                                                            markdown
                                                            multiline
                                                            mentions
                                                            mentionsAtValues={atMentions}
                                                            className="h-full min-h-0 overflow-auto !mb-0 !mt-0"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <InputField
                                                type="text"
                                                key="examples"
                                                value={agent.examples || ""}
                                                onChange={(value) => {
                                                    handleUpdate({
                                                        ...agent,
                                                        examples: value
                                                    });
                                                    showSavedMessage();
                                                }}
                                                placeholder="Enter examples for this agent"
                                                markdown
                                                multiline
                                                mentions
                                                mentionsAtValues={atMentions}
                                                className="h-full min-h-0 overflow-auto !mb-0 !mt-0"
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}



                    {activeTab === 'configurations' && (
                        <div className="flex flex-col gap-4 pb-4 pt-0">
                            {/* Identity Section Card */}
                            <SectionCard
                                icon={<UserIcon className="w-5 h-5 text-indigo-500" />}
                                title="Identity"
                                labelWidth="md:w-32"
                                className="mb-1"
                            >
                                <div className="flex flex-col gap-6">
                                    <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                        <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Name</label>
                                        <div className="flex-1">
                                            <InputField
                                                type="text"
                                                value={localName}
                                                onChange={(value) => {
                                                    setLocalName(value);
                                                    if (validateName(value)) {
                                                        handleUpdate({
                                                            ...agent,
                                                            name: value
                                                        });
                                                    }
                                                    showSavedMessage();
                                                }}
                                                error={nameError}
                                                className="w-full"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                        <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Description</label>
                                        <div className="flex-1">
                                            <InputField
                                                type="text"
                                                value={agent.description || ""}
                                                onChange={(value: string) => {
                                                    handleUpdate({ ...agent, description: value });
                                                    showSavedMessage();
                                                }}
                                                multiline={true}
                                                placeholder="Enter a description for this agent"
                                                className="w-full"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </SectionCard>
                            {/* Behavior Section Card */}
                            <SectionCard
                                icon={<Settings className="w-5 h-5 text-indigo-500" />}
                                title="Behavior"
                                labelWidth="md:w-32"
                                className="mb-1"
                            >
                                <div className="flex flex-col gap-6">
                                    <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                        <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Agent Type</label>
                                        <div className="flex-1">
                                            {isPartOfPipeline ? (
                                                // For pipeline agents, show read-only display
                                                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 rounded-lg">
                                                    <span className="text-sm text-gray-900 dark:text-gray-100">
                                                        Pipeline Agent
                                                    </span>
                                                </div>
                                            ) : (
                                                // For non-pipeline agents, show dropdown without pipeline option
                                                <CustomDropdown
                                                    value={agent.outputVisibility}
                                                    options={[
                                                        { key: "user_facing", label: "Conversation Agent" },
                                                        { key: "internal", label: "Task Agent" }
                                                    ]}
                                                    onChange={(value) => {
                                                        handleUpdate({
                                                            ...agent,
                                                            outputVisibility: value as z.infer<typeof WorkflowAgent>["outputVisibility"]
                                                        });
                                                        showSavedMessage();
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                        <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Model</label>
                                        <div className="flex-1">
                                            {/* Model select/input logic unchanged */}
                                            {eligibleModels === "*" && <InputField
                                                type="text"
                                                value={agent.model}
                                                onChange={(value: string) => {
                                                    handleUpdate({
                                                        ...agent,
                                                        model: value as z.infer<typeof WorkflowAgent>["model"]
                                                    });
                                                    showSavedMessage();
                                                }}
                                                className="w-full max-w-64"
                                            />}
                                            {eligibleModels !== "*" && <Select
                                                variant="bordered"
                                                placeholder="Select model"
                                                className="w-full max-w-64"
                                                selectedKeys={[agent.model]}
                                                onSelectionChange={(keys) => {
                                                    const key = keys.currentKey as string;
                                                    const model = eligibleModels.find((m) => m.name === key);
                                                    if (!model) {
                                                        return;
                                                    }
                                                    if (!model.eligible) {
                                                        setBillingError(`Please upgrade to the ${model.plan.toUpperCase()} plan to use this model.`);
                                                        return;
                                                    }
                                                    handleUpdate({
                                                        ...agent,
                                                        model: key as z.infer<typeof WorkflowAgent>["model"]
                                                    });
                                                    showSavedMessage();
                                                }}
                                            >
                                                <SelectSection title="Available">
                                                    {eligibleModels.filter((model) => model.eligible).map((model) => (
                                                        <SelectItem
                                                            key={model.name}
                                                        >
                                                            {model.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectSection>
                                                <SelectSection title="Requires plan upgrade">
                                                    {eligibleModels.filter((model) => !model.eligible).map((model) => (
                                                        <SelectItem
                                                            key={model.name}
                                                            endContent={<Chip
                                                                color="warning"
                                                                size="sm"
                                                                variant="bordered"
                                                            >
                                                                {model.plan.toUpperCase()}
                                                            </Chip>
                                                            }
                                                            startContent={<StarIcon className="w-4 h-4 text-warning" />}
                                                        >
                                                            {model.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectSection>
                                            </Select>
                                            }
                                        </div>
                                    </div>
                                    {agent.outputVisibility === "internal" && !isPartOfPipeline && (
                                        <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                            <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Max Calls From Parent</label>
                                            <div className="flex-1">
                                                <InputField
                                                    type="number"
                                                    value={maxCallsInput}
                                                    onChange={(value: string) => {
                                                        setMaxCallsInput(value);
                                                        setMaxCallsError(null);
                                                        const num = Number(value);
                                                        if (value && !isNaN(num) && num >= 1 && Number.isInteger(num)) {
                                                            if (num !== agent.maxCallsPerParentAgent) {
                                                                handleUpdate({
                                                                    ...agent,
                                                                    maxCallsPerParentAgent: num
                                                                });
                                                            }
                                                        }
                                                    }}
                                                    validate={(value: string) => {
                                                        const num = Number(value);
                                                        if (!value || isNaN(num) || num < 1 || !Number.isInteger(num)) {
                                                            return { valid: false, errorMessage: "Must be an integer >= 1" };
                                                        }
                                                        return { valid: true };
                                                    }}
                                                    error={maxCallsError}
                                                    min={1}
                                                    className="w-full max-w-24"
                                                />
                                                {maxCallsError && (
                                                    <p className="text-sm text-red-500 mt-1">{maxCallsError}</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {USE_TRANSFER_CONTROL_OPTIONS && !isPartOfPipeline && (
                                        <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                            <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">After Turn</label>
                                            <div className="flex-1">
                                                <CustomDropdown
                                                    value={agent.controlType || 'retain'}
                                                    options={
                                                        agent.outputVisibility === "pipeline"
                                                            ? [
                                                                { key: "relinquish_to_parent", label: "Relinquish to parent" }
                                                            ]
                                                            : agent.outputVisibility === "internal"
                                                            ? [
                                                                { key: "relinquish_to_parent", label: "Relinquish to parent" },
                                                                { key: "relinquish_to_start", label: "Relinquish to 'start' agent" }
                                                            ]
                                                            : [
                                                                { key: "retain", label: "Retain control" },
                                                                { key: "relinquish_to_parent", label: "Relinquish to parent" },
                                                                { key: "relinquish_to_start", label: "Relinquish to 'start' agent" }
                                                            ]
                                                    }
                                                    onChange={(value) => {
                                                        handleUpdate({
                                                            ...agent,
                                                            controlType: value as z.infer<typeof WorkflowAgent>["controlType"]
                                                        });
                                                        showSavedMessage();
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </SectionCard>
                            {/* RAG Data Sources Section Card */}
                            <SectionCard
                                icon={<DatabaseIcon className="w-5 h-5 text-indigo-500" />}
                                title="RAG"
                                labelWidth="md:w-32"
                                className="mb-1"
                            >
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                                        <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Add Source</label>
                                        <div className="flex-1 flex items-center gap-3">
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
                                                    showSavedMessage();
                                                }}
                                                startContent={<PlusIcon className="w-4 h-4 text-gray-500" />}
                                            >
                                                {dataSources
                                                    .filter((ds) => !(agent.ragDataSources || []).includes(ds._id))
                                                    .length > 0 ? (
                                                    dataSources
                                                        .filter((ds) => !(agent.ragDataSources || []).includes(ds._id))
                                                        .map((ds) => (
                                                            <SelectItem key={ds._id}>
                                                                {ds.name}
                                                            </SelectItem>
                                                        ))
                                                ) : (
                                                    <SelectItem key="empty" isReadOnly>
                                                        <div className="flex flex-col items-center justify-center p-4 text-center">
                                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 mb-2">
                                                                <DatabaseIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                                                No data sources available
                                                            </div>
                                                            <CustomButton
                                                                variant="primary"
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    onOpenDataSourcesModal?.();
                                                                }}
                                                                startContent={<DatabaseIcon className="w-3 h-3" />}
                                                            >
                                                                Add Data Source
                                                            </CustomButton>
                                                        </div>
                                                    </SelectItem>
                                                )}
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
                                    {agent.ragDataSources !== undefined && agent.ragDataSources.length > 0 && (
                                        <div className="flex flex-col gap-2 mt-2">
                                            {(agent.ragDataSources || []).map((source) => {
                                                const ds = dataSources.find((ds) => ds._id === source);
                                                return (
                                                    <div
                                                        key={source}
                                                        className="flex items-center justify-between p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-indigo-50 dark:bg-indigo-900/20">
                                                                <DatabaseIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
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
                                                                showSavedMessage();
                                                            }}
                                                            startContent={<Trash2 className="w-4 h-4" />}
                                                        >
                                                            Remove
                                                        </CustomButton>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </SectionCard>
                            {/* The rest of the configuration sections will be refactored in subsequent steps */}
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

                <BillingUpgradeModal
                    isOpen={!!billingError}
                    onClose={() => setBillingError(null)}
                    errorMessage={billingError || ''}
                />
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
    const [billingError, setBillingError] = useState<string | null>(null);
    const { showPreview } = usePreviewModal();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen) {
            setPrompt("");
            setIsLoading(false);
            setError(null);
            setBillingError(null);
            textareaRef.current?.focus();
        }
    }, [isOpen]);

    const handleGenerate = async () => {
        setIsLoading(true);
        setError(null);
        setBillingError(null);
        try {
            const msgs: z.infer<typeof CopilotMessage>[] = [
                {
                    role: 'user',
                    content: prompt,
                },
            ];
            const newInstructions = await getCopilotAgentInstructions(projectId, msgs, workflow, agent.name);
            if (typeof newInstructions === 'object' && 'billingError' in newInstructions) {
                setBillingError(newInstructions.billingError);
                setError(newInstructions.billingError);
                setIsLoading(false);
                return;
            }
            
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
        <>
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
            <BillingUpgradeModal
                isOpen={!!billingError}
                onClose={() => setBillingError(null)}
                errorMessage={billingError || ''}
            />
        </>
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