import { z } from "zod";
import { AgenticAPITool } from "../../../lib/types/agents_api_types";
import { WorkflowPrompt } from "../../../lib/types/workflow_types";
import { WorkflowAgent } from "../../../lib/types/workflow_types";
import { Dropdown, DropdownItem, DropdownTrigger, DropdownMenu } from "@heroui/react";
import { useRef, useEffect } from "react";
import { EllipsisVerticalIcon, ImportIcon, PlusIcon, Brain, Wrench, PenLine } from "lucide-react";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { clsx } from "clsx";

const MAX_SECTION_HEIGHTS = {
    AGENTS: '20rem',
    TOOLS: '15rem',
    PROMPTS: '15rem',
} as const;

interface EntityListProps {
    agents: z.infer<typeof WorkflowAgent>[];
    tools: z.infer<typeof AgenticAPITool>[];
    prompts: z.infer<typeof WorkflowPrompt>[];
    selectedEntity: {
        type: "agent" | "tool" | "prompt";
        name: string;
    } | null;
    startAgentName: string | null;
    onSelectAgent: (name: string) => void;
    onSelectTool: (name: string) => void;
    onSelectPrompt: (name: string) => void;
    onAddAgent: (agent: Partial<z.infer<typeof WorkflowAgent>>) => void;
    onAddTool: (tool: Partial<z.infer<typeof AgenticAPITool>>) => void;
    onAddPrompt: (prompt: Partial<z.infer<typeof WorkflowPrompt>>) => void;
    onToggleAgent: (name: string) => void;
    onSetMainAgent: (name: string) => void;
    onDeleteAgent: (name: string) => void;
    onDeleteTool: (name: string) => void;
    onDeletePrompt: (name: string) => void;
    triggerMcpImport: () => void;
}

interface EmptyStateProps {
    entity: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ entity }) => (
    <div className="flex items-center justify-center h-24 text-sm text-zinc-400 dark:text-zinc-500">
        No {entity} created
    </div>
);

const ListItemWithMenu = ({ 
    name, 
    isSelected, 
    onClick, 
    disabled, 
    selectedRef,
    menuContent,
    statusLabel,
    icon,
}: {
    name: string;
    isSelected?: boolean;
    onClick?: () => void;
    disabled?: boolean;
    selectedRef?: React.RefObject<HTMLButtonElement>;
    menuContent: React.ReactNode;
    statusLabel?: React.ReactNode;
    icon?: React.ReactNode;
}) => (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800">
        <button
            ref={selectedRef}
            className={clsx(
                "flex-1 flex items-center gap-2 text-sm text-left",
                {
                    "text-zinc-900 dark:text-zinc-100": !disabled,
                    "text-zinc-400 dark:text-zinc-600": disabled,
                }
            )}
            onClick={onClick}
            disabled={disabled}
        >
            {icon}
            {name}
        </button>
        <div className="flex items-center gap-2">
            {statusLabel}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                {menuContent}
            </div>
        </div>
    </div>
);

const StartLabel = () => (
    <div className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30 px-1.5 py-0.5 rounded">
        Start
    </div>
);

export function EntityList({
    agents,
    tools,
    prompts,
    selectedEntity,
    startAgentName,
    onSelectAgent,
    onSelectTool,
    onSelectPrompt,
    onAddAgent,
    onAddTool,
    onAddPrompt,
    onToggleAgent,
    onSetMainAgent,
    onDeleteAgent,
    onDeleteTool,
    onDeletePrompt,
    triggerMcpImport,
}: EntityListProps) {
    const selectedRef = useRef<HTMLButtonElement | null>(null);
    const headerClasses = "font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between w-full";
    const buttonClasses = "text-sm px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-400";

    useEffect(() => {
        if (selectedEntity && selectedRef.current) {
            selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedEntity]);

    return (
        <div className="flex flex-col gap-6 h-full overflow-hidden">
            <div className="flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                {/* Agents Panel */}
                <Panel variant="projects"
                    title={
                        <div className={headerClasses}>
                            <div className="flex items-center gap-2">
                                <Brain className="w-4 h-4" />
                                <span>Agents</span>
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onAddAgent({})}
                                className={`group ${buttonClasses}`}
                                showHoverContent={true}
                                hoverContent="Add Agent"
                            >
                                <PlusIcon className="w-4 h-4" />
                            </Button>
                        </div>
                    }
                    maxHeight={MAX_SECTION_HEIGHTS.AGENTS}
                >
                    <div className="flex flex-col">
                        {agents.length > 0 ? (
                            <div className="space-y-1 pb-2">
                                {agents.map((agent, index) => (
                                    <ListItemWithMenu
                                        key={`agent-${index}`}
                                        name={agent.name}
                                        isSelected={selectedEntity?.type === "agent" && selectedEntity.name === agent.name}
                                        onClick={() => onSelectAgent(agent.name)}
                                        disabled={agent.disabled}
                                        selectedRef={selectedEntity?.type === "agent" && selectedEntity.name === agent.name ? selectedRef : undefined}
                                        statusLabel={startAgentName === agent.name ? <StartLabel /> : null}
                                        menuContent={
                                            <AgentDropdown
                                                agent={agent}
                                                isStartAgent={startAgentName === agent.name}
                                                onToggle={onToggleAgent}
                                                onSetMainAgent={onSetMainAgent}
                                                onDelete={onDeleteAgent}
                                            />
                                        }
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState entity="agents" />
                        )}
                    </div>
                </Panel>

                {/* Tools Panel */}
                <Panel variant="projects"
                    title={
                        <div className={headerClasses}>
                            <div className="flex items-center gap-2">
                                <Wrench className="w-4 h-4" />
                                <span>Tools</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={triggerMcpImport}
                                    className={buttonClasses}
                                    showHoverContent={true}
                                    hoverContent="Import from MCP"
                                >
                                    <ImportIcon className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onAddTool({
                                        type: 'custom',
                                        implementation: 'mock'
                                    })}
                                    className={`group ${buttonClasses}`}
                                    showHoverContent={true}
                                    hoverContent="Add Tool"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    }
                    maxHeight={MAX_SECTION_HEIGHTS.TOOLS}
                >
                    <div className="flex flex-col">
                        {tools.length > 0 ? (
                            <div className="space-y-1 pb-2">
                                {tools.map((tool, index) => (
                                    <ListItemWithMenu
                                        key={`tool-${index}`}
                                        name={tool.name}
                                        isSelected={selectedEntity?.type === "tool" && selectedEntity.name === tool.name}
                                        onClick={() => onSelectTool(tool.name)}
                                        selectedRef={selectedEntity?.type === "tool" && selectedEntity.name === tool.name ? selectedRef : undefined}
                                        icon={tool.isMcp ? <ImportIcon className="w-4 h-4 text-blue-700" /> : undefined}
                                        menuContent={
                                            <EntityDropdown 
                                                name={tool.name} 
                                                onDelete={onDeleteTool} 
                                            />
                                        }
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState entity="tools" />
                        )}
                    </div>
                </Panel>

                {/* Prompts Panel */}
                <Panel variant="projects"
                    title={
                        <div className={headerClasses}>
                            <div className="flex items-center gap-2">
                                <PenLine className="w-4 h-4" />
                                <span>Prompts</span>
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onAddPrompt({})}
                                className={`group ${buttonClasses}`}
                                showHoverContent={true}
                                hoverContent="Add Prompt"
                            >
                                <PlusIcon className="w-4 h-4" />
                            </Button>
                        </div>
                    }
                    maxHeight={MAX_SECTION_HEIGHTS.PROMPTS}
                >
                    <div className="flex flex-col">
                        {prompts.length > 0 ? (
                            <div className="space-y-1 pb-2">
                                {prompts.map((prompt, index) => (
                                    <ListItemWithMenu
                                        key={`prompt-${index}`}
                                        name={prompt.name}
                                        isSelected={selectedEntity?.type === "prompt" && selectedEntity.name === prompt.name}
                                        onClick={() => onSelectPrompt(prompt.name)}
                                        selectedRef={selectedEntity?.type === "prompt" && selectedEntity.name === prompt.name ? selectedRef : undefined}
                                        menuContent={
                                            <EntityDropdown 
                                                name={prompt.name} 
                                                onDelete={onDeletePrompt} 
                                            />
                                        }
                                    />
                                ))}
                            </div>
                        ) : (
                            <EmptyState entity="prompts" />
                        )}
                    </div>
                </Panel>
            </div>
        </div>
    );
}

function AgentDropdown({
    agent,
    isStartAgent,
    onToggle,
    onSetMainAgent,
    onDelete
}: {
    agent: z.infer<typeof WorkflowAgent>;
    isStartAgent: boolean;
    onToggle: (name: string) => void;
    onSetMainAgent: (name: string) => void;
    onDelete: (name: string) => void;
}) {
    return (
        <Dropdown>
            <DropdownTrigger>
                <EllipsisVerticalIcon size={16} />
            </DropdownTrigger>
            <DropdownMenu
                disabledKeys={[
                    ...(!agent.toggleAble ? ['toggle'] : []),
                    ...(agent.locked ? ['delete', 'set-main-agent'] : []),
                    ...(isStartAgent ? ['set-main-agent', 'delete', 'toggle'] : []),
                ]}
                onAction={(key) => {
                    switch (key) {
                        case 'set-main-agent':
                            onSetMainAgent(agent.name);
                            break;
                        case 'delete':
                            onDelete(agent.name);
                            break;
                        case 'toggle':
                            onToggle(agent.name);
                            break;
                    }
                }}
            >
                <DropdownItem key="set-main-agent">Set as start agent</DropdownItem>
                <DropdownItem key="toggle">{agent.disabled ? 'Enable' : 'Disable'}</DropdownItem>
                <DropdownItem key="delete" className="text-danger">Delete</DropdownItem>
            </DropdownMenu>
        </Dropdown>
    );
}

function EntityDropdown({
    name,
    onDelete
}: {
    name: string;
    onDelete: (name: string) => void;
}) {
    return (
        <Dropdown>
            <DropdownTrigger>
                <EllipsisVerticalIcon size={16} />
            </DropdownTrigger>
            <DropdownMenu
                onAction={(key) => {
                    if (key === 'delete') {
                        onDelete(name);
                    }
                }}
            >
                <DropdownItem key="delete" className="text-danger">Delete</DropdownItem>
            </DropdownMenu>
        </Dropdown>
    );
} 