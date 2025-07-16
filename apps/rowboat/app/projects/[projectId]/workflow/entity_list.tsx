import { z } from "zod";
import { WorkflowPrompt, WorkflowAgent, WorkflowTool } from "../../../lib/types/workflow_types";
import { Dropdown, DropdownItem, DropdownTrigger, DropdownMenu } from "@heroui/react";
import { useRef, useEffect, useState } from "react";
import { EllipsisVerticalIcon, ImportIcon, PlusIcon, Brain, Boxes, Wrench, PenLine, Library, ChevronDown, ChevronRight, ServerIcon, Component, ScrollText, GripVertical, Users, Cog, CheckCircle2 } from "lucide-react";
import { DndContext, DragEndEvent, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import { PictureImg } from "@/components/ui/picture-img";
import { clsx } from "clsx";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ServerLogo } from '../tools/components/MCPServersCommon';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import { ComposioToolsModal } from './components/ComposioToolsModal';

// Reduced gap size to match Cursor's UI
const GAP_SIZE = 4; // 1 unit * 4px (tailwind's default spacing unit)

// Panel height ratios
const PANEL_RATIOS = {
    expanded: {
        agents: 50,
        tools: 50,
        prompts: 20
    }
} as const;

// Common classes
const headerClasses = "font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between w-full";
const buttonClasses = "text-sm px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-400";

interface EntityListProps {
    agents: z.infer<typeof WorkflowAgent>[];
    tools: z.infer<typeof WorkflowTool>[];
    projectTools: z.infer<typeof WorkflowTool>[];
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
    onAddTool: (tool: Partial<z.infer<typeof WorkflowTool>>) => void;
    onAddPrompt: (prompt: Partial<z.infer<typeof WorkflowPrompt>>) => void;
    onToggleAgent: (name: string) => void;
    onSetMainAgent: (name: string) => void;
    onDeleteAgent: (name: string) => void;
    onDeleteTool: (name: string) => void;
    onDeletePrompt: (name: string) => void;
    onProjectToolsUpdated?: () => void;
}

interface EmptyStateProps {
    entity: string;
    hasFilteredItems: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = ({ entity, hasFilteredItems }) => (
    <div className="flex items-center justify-center h-24 text-sm text-zinc-400 dark:text-zinc-500">
        {hasFilteredItems ? "No tools to show" : `No ${entity} created`}
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
    iconClassName,
    mcpServerName,
    dragHandle,
}: {
    name: string;
    isSelected?: boolean;
    onClick?: () => void;
    disabled?: boolean;
    selectedRef?: React.RefObject<HTMLButtonElement | null>;
    menuContent: React.ReactNode;
    statusLabel?: React.ReactNode;
    icon?: React.ReactNode;
    iconClassName?: string;
    mcpServerName?: string;
    dragHandle?: React.ReactNode;
}) => {
    return (
        <div className={clsx(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md",
            {
                "bg-indigo-50 dark:bg-indigo-950/30": isSelected,
                "hover:bg-zinc-50 dark:hover:bg-zinc-800": !isSelected
            }
        )}>
            {dragHandle}
            <button
                ref={selectedRef}
                className={clsx(
                    "flex-1 flex items-center gap-2 text-sm text-left",
                    {
                        "text-zinc-900 dark:text-zinc-100": !disabled,
                        "text-zinc-400 dark:text-zinc-600": disabled,
                    }
                )}
                onClick={() => {
                    onClick?.();
                }}
                disabled={disabled}
            >
                <div className={clsx("shrink-0 flex items-center justify-center w-4 h-4", iconClassName)}>
                    {mcpServerName ? (
                        <ServerLogo 
                            serverName={mcpServerName} 
                            className="h-4 w-4" 
                            fallback={<ImportIcon className="w-4 h-4 text-blue-600 dark:text-blue-500" />} 
                        />
                    ) : icon}
                </div>
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
};

const StartLabel = () => (
    <div className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30 px-1.5 py-0.5 rounded">
        Start
    </div>
);

interface ServerCardProps {
    serverName: string;
    tools: z.infer<typeof WorkflowTool>[];
    selectedEntity: {
        type: "agent" | "tool" | "prompt";
        name: string;
    } | null;
    onSelectTool: (name: string) => void;
    onDeleteTool: (name: string) => void;
    selectedRef: React.RefObject<HTMLButtonElement | null>;
}

const ServerCard = ({
    serverName,
    tools,
    selectedEntity,
    onSelectTool,
    onDeleteTool,
    selectedRef,
}: ServerCardProps) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="mb-2">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md text-sm text-left"
            >
                {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
                <div className="flex items-center gap-1">
                    <ServerLogo 
                        serverName={serverName} 
                        className="h-4 w-4" 
                        fallback={<ImportIcon className="w-4 h-4 text-blue-600 dark:text-blue-500" />}
                    />
                    <span>{serverName}</span>
                </div>
            </button>
            {isExpanded && (
                <div className="ml-6 mt-1 space-y-1">
                    {tools.map((tool, index) => (
                        <ListItemWithMenu
                            key={`tool-${index}`}
                            name={tool.name}
                            isSelected={selectedEntity?.type === "tool" && selectedEntity.name === tool.name}
                            onClick={() => onSelectTool(tool.name)}
                            selectedRef={selectedEntity?.type === "tool" && selectedEntity.name === tool.name ? selectedRef : undefined}
                            mcpServerName={serverName}
                            menuContent={
                                <EntityDropdown 
                                    name={tool.name} 
                                    onDelete={onDeleteTool}
                                    isLocked={tool.isMcp || tool.isLibrary}
                                />
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

type ComposioToolkit = {
    slug: string;
    name: string;
    logo: string;
    tools: z.infer<typeof WorkflowTool>[];
}

export function EntityList({
    agents,
    tools,
    projectTools,
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
    onProjectToolsUpdated,
    projectId,
    onReorderAgents,
}: EntityListProps & { 
    projectId: string,
    onReorderAgents: (agents: z.infer<typeof WorkflowAgent>[]) => void 
}) {
    const [showAgentTypeModal, setShowAgentTypeModal] = useState(false);
    const [showComposioToolsModal, setShowComposioToolsModal] = useState(false);

    const handleAddAgentWithType = (agentType: 'internal' | 'user_facing') => {
        onAddAgent({
            outputVisibility: agentType
        });
    };
    // Merge workflow tools with project tools
    const mergedTools = [...tools, ...projectTools];
    const selectedRef = useRef<HTMLButtonElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState<number>(0);

    // collect composio tools
    const composioTools: Record<string, ComposioToolkit> = {};
    for (const tool of mergedTools) {
        if (tool.isComposio) {
            if (!composioTools[tool.composioData?.toolkitSlug || '']) {
                composioTools[tool.composioData?.toolkitSlug || ''] = {
                    name: tool.composioData?.toolkitName || '',
                    slug: tool.composioData?.toolkitSlug || '',
                    logo: tool.composioData?.logo || '',
                    tools: []
                };
            }
            composioTools[tool.composioData?.toolkitSlug || ''].tools.push(tool);
        }
    }

    // Panel expansion states
    const [expandedPanels, setExpandedPanels] = useState({
        agents: true,
        tools: true,
        prompts: false
    });

    // Default sizes when panels are expanded
    const DEFAULT_SIZES = {
        agents: 40,
        tools: 40,
        prompts: 20
    };

    // Calculate panel sizes based on expanded state
    const getPanelSize = (panelName: 'agents' | 'tools' | 'prompts') => {
        if (!expandedPanels[panelName]) {
            return 8; // Collapsed height (53px equivalent)
        }

        // Base size when expanded
        let size = DEFAULT_SIZES[panelName];

        // Redistribute space from collapsed panels to the panel above
        if (panelName === 'agents') {
            if (!expandedPanels.tools) {
                size += DEFAULT_SIZES.tools;
            }
            if (!expandedPanels.prompts) {
                size += DEFAULT_SIZES.prompts;
            }
        } else if (panelName === 'tools') {
            if (!expandedPanels.prompts && expandedPanels.agents) {
                size += DEFAULT_SIZES.prompts;
            }
        }

        return size;
    };

    useEffect(() => {
        const updateHeight = () => {
            if (containerRef.current) {
                setContainerHeight(containerRef.current.clientHeight);
            }
        };

        updateHeight();
        window.addEventListener('resize', updateHeight);
        return () => window.removeEventListener('resize', updateHeight);
    }, []);

    useEffect(() => {
        if (selectedEntity && selectedRef.current) {
            selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedEntity]);

    function handleToolSelection(name: string) {
        onSelectTool(name);
    }

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        
        if (over && active.id !== over.id) {
            const oldIndex = agents.findIndex(agent => agent.name === active.id);
            const newIndex = agents.findIndex(agent => agent.name === over.id);
            
            const newAgents = [...agents];
            const [movedAgent] = newAgents.splice(oldIndex, 1);
            newAgents.splice(newIndex, 0, movedAgent);
            
            // Update order numbers
            const updatedAgents = newAgents.map((agent, index) => ({
                ...agent,
                order: index * 100
            }));
            
            onReorderAgents(updatedAgents);
        }
    };

    return (
        <div ref={containerRef} className="flex flex-col h-full">
            <ResizablePanelGroup 
                direction="vertical" 
                className="h-full"
                style={{ gap: `${GAP_SIZE}px` }}
            >
                {/* Agents Panel */}
                <ResizablePanel 
                    defaultSize={getPanelSize('agents')}
                    minSize={expandedPanels.agents ? 20 : 8}
                    maxSize={100}
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-agents"
                        className={clsx(
                            "h-full overflow-hidden",
                            !expandedPanels.agents && "h-[53px]!"
                        )}
                        title={
                            <button 
                                onClick={() => setExpandedPanels(prev => ({ ...prev, agents: !prev.agents }))}
                                className={`${headerClasses} hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors h-full`}
                            >
                                <div className="flex items-center gap-2 h-full">
                                    {expandedPanels.agents ? (
                                        <ChevronDown className="w-4 h-4" />
                                    ) : (
                                        <ChevronRight className="w-4 h-4" />
                                    )}
                                    <Brain className="w-4 h-4" />
                                    <span>Agents</span>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedPanels(prev => ({ ...prev, agents: true }));
                                        setShowAgentTypeModal(true);
                                    }}
                                    className={`group ${buttonClasses}`}
                                    showHoverContent={true}
                                    hoverContent="Add Agent"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                </Button>
                            </button>
                        }
                    >
                        {expandedPanels.agents && (
                            <div className="h-[calc(100%-53px)] overflow-y-auto">
                                <div className="p-2">
                                    {agents.length > 0 ? (
                                        <DndContext
                                            sensors={sensors}
                                            collisionDetection={closestCenter}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <SortableContext
                                                items={agents.map(a => a.name)}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="space-y-1">
                                                    {agents.map((agent) => (
                                                        <SortableAgentItem
                                                            key={agent.name}
                                                            agent={agent}
                                                            isSelected={selectedEntity?.type === "agent" && selectedEntity.name === agent.name}
                                                            onClick={() => onSelectAgent(agent.name)}
                                                            selectedRef={selectedEntity?.type === "agent" && selectedEntity.name === agent.name ? selectedRef : undefined}
                                                            statusLabel={startAgentName === agent.name ? <StartLabel /> : null}
                                                            onToggle={onToggleAgent}
                                                            onSetMainAgent={onSetMainAgent}
                                                            onDelete={onDeleteAgent}
                                                            isStartAgent={startAgentName === agent.name}
                                                        />
                                                    ))}
                                                </div>
                                            </SortableContext>
                                        </DndContext>
                                    ) : (
                                        <EmptyState entity="agents" hasFilteredItems={false} />
                                    )}
                                </div>
                            </div>
                        )}
                    </Panel>
                </ResizablePanel>

                <ResizableHandle withHandle className="w-[3px] bg-transparent" />

                {/* Tools Panel */}
                <ResizablePanel 
                    defaultSize={getPanelSize('tools')}
                    minSize={expandedPanels.tools ? 20 : 8}
                    maxSize={100}
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-tools"
                        className={clsx(
                            "h-full overflow-hidden",
                            !expandedPanels.tools && "h-[53px]!"
                        )}
                        title={
                            <button 
                                onClick={() => setExpandedPanels(prev => ({ ...prev, tools: !prev.tools }))}
                                className={`${headerClasses} hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors h-full`}
                            >
                                <div className="flex items-center gap-2 h-full">
                                    {expandedPanels.tools ? (
                                        <ChevronDown className="w-4 h-4" />
                                    ) : (
                                        <ChevronRight className="w-4 h-4" />
                                    )}
                                    <Wrench className="w-4 h-4" />
                                    <span>Tools</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedPanels(prev => ({ ...prev, tools: true }));
                                            setShowComposioToolsModal(true);
                                        }}
                                        className={`group ${buttonClasses}`}
                                        showHoverContent={true}
                                        hoverContent="Composio Tools"
                                    >
                                        <Component className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedPanels(prev => ({ ...prev, tools: true }));
                                            onAddTool({});
                                        }}
                                        className={`group ${buttonClasses}`}
                                        showHoverContent={true}
                                        hoverContent="Add Tool"
                                    >
                                        <PlusIcon className="w-4 h-4" />
                                    </Button>
                                </div>
                            </button>
                        }
                    >
                        {expandedPanels.tools && (
                            <div className="h-full overflow-y-auto">
                                <div className="p-2">
                                    {mergedTools.length > 0 ? (
                                        <div className="space-y-1">
                                            {/* Group tools by server */}
                                            {(() => {
                                                // Get custom tools (non-MCP tools)
                                                const customTools = mergedTools.filter(tool => !tool.isMcp && !tool.isComposio);
                                                
                                                // Group MCP tools by server
                                                const serverTools = mergedTools.reduce((acc, tool) => {
                                                    if (tool.isMcp && tool.mcpServerName) {
                                                        if (!acc[tool.mcpServerName]) {
                                                            acc[tool.mcpServerName] = [];
                                                        }
                                                        acc[tool.mcpServerName].push(tool);
                                                    }
                                                    return acc;
                                                }, {} as Record<string, typeof mergedTools>);

                                                return (
                                                    <>
                                                        {/* Show composio cards */}
                                                        {Object.values(composioTools).map((card) => (
                                                            <ComposioCard 
                                                                key={card.slug} 
                                                                card={card}
                                                                selectedEntity={selectedEntity}
                                                                onSelectTool={handleToolSelection}
                                                                onDeleteTool={onDeleteTool}
                                                                selectedRef={selectedRef}
                                                            />
                                                        ))}

                                                        {/* Show MCP server cards */}
                                                        {Object.entries(serverTools).map(([serverName, tools]) => (
                                                            <ServerCard
                                                                key={serverName}
                                                                serverName={serverName}
                                                                tools={tools}
                                                                selectedEntity={selectedEntity}
                                                                onSelectTool={handleToolSelection}
                                                                onDeleteTool={onDeleteTool}
                                                                selectedRef={selectedRef}
                                                            />
                                                        ))}

                                                        {/* Show custom tools */}
                                                        {customTools.length > 0 && (
                                                            <div className="mt-2">
                                                                {customTools.map((tool, index) => (
                                                                    <ListItemWithMenu
                                                                        key={`custom-tool-${index}`}
                                                                        name={tool.name}
                                                                        isSelected={selectedEntity?.type === "tool" && selectedEntity.name === tool.name}
                                                                        onClick={() => handleToolSelection(tool.name)}
                                                                        selectedRef={selectedEntity?.type === "tool" && selectedEntity.name === tool.name ? selectedRef : undefined}
                                                                        icon={<Boxes className="w-4 h-4 text-blue-600/70 dark:text-blue-500/70" />}
                                                                        menuContent={
                                                                            <EntityDropdown 
                                                                                name={tool.name} 
                                                                                onDelete={onDeleteTool}
                                                                                isLocked={tool.isLibrary}
                                                                            />
                                                                        }
                                                                    />
                                                                ))}
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <EmptyState 
                                            entity="tools" 
                                            hasFilteredItems={false}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </Panel>
                </ResizablePanel>

                <ResizableHandle withHandle className="w-[3px] bg-transparent" />

                {/* Prompts Panel */}
                <ResizablePanel 
                    defaultSize={getPanelSize('prompts')}
                    minSize={expandedPanels.prompts ? 20 : 8}
                    maxSize={100}
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-prompts"
                        className={clsx(
                            "h-full overflow-hidden",
                            !expandedPanels.prompts && "h-[53px]!"
                        )}
                        title={
                            <button 
                                onClick={() => setExpandedPanels(prev => ({ ...prev, prompts: !prev.prompts }))}
                                className={`${headerClasses} hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors h-full`}
                            >
                                <div className="flex items-center gap-2 h-full">
                                    {expandedPanels.prompts ? (
                                        <ChevronDown className="w-4 h-4" />
                                    ) : (
                                        <ChevronRight className="w-4 h-4" />
                                    )}
                                    <PenLine className="w-4 h-4" />
                                    <span>Prompts</span>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedPanels(prev => ({ ...prev, prompts: true }));
                                        onAddPrompt({});
                                    }}
                                    className={`group ${buttonClasses}`}
                                    showHoverContent={true}
                                    hoverContent="Add Prompt"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                </Button>
                            </button>
                        }
                    >
                        {expandedPanels.prompts && (
                            <div className="h-[calc(100%-53px)] overflow-y-auto">
                                <div className="p-2">
                                    {prompts.length > 0 ? (
                                        <div className="space-y-1">
                                            {prompts.map((prompt, index) => (
                                                <ListItemWithMenu
                                                    key={`prompt-${index}`}
                                                    name={prompt.name}
                                                    isSelected={selectedEntity?.type === "prompt" && selectedEntity.name === prompt.name}
                                                    onClick={() => onSelectPrompt(prompt.name)}
                                                    selectedRef={selectedEntity?.type === "prompt" && selectedEntity.name === prompt.name ? selectedRef : undefined}
                                                    icon={<ScrollText className="w-4 h-4 text-blue-600/70 dark:text-blue-500/70" />}
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
                                        <EmptyState entity="prompts" hasFilteredItems={false} />
                                    )}
                                </div>
                            </div>
                        )}
                    </Panel>
                </ResizablePanel>
            </ResizablePanelGroup>
            
            <AgentTypeModal
                isOpen={showAgentTypeModal}
                onClose={() => setShowAgentTypeModal(false)}
                onConfirm={handleAddAgentWithType}
            />
            <ComposioToolsModal
                isOpen={showComposioToolsModal}
                onClose={() => setShowComposioToolsModal(false)}
                projectId={projectId}
                onToolsUpdated={onProjectToolsUpdated}
            />
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
    onDelete,
    isLocked,
}: {
    name: string;
    onDelete: (name: string) => void;
    isLocked?: boolean;
}) {
    return (
        <Dropdown>
            <DropdownTrigger>
                <EllipsisVerticalIcon size={16} />
            </DropdownTrigger>
            <DropdownMenu
                disabledKeys={isLocked ? ['delete'] : []}
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

interface ComposioCardProps {
    card: ComposioToolkit;
    selectedEntity: {
        type: "agent" | "tool" | "prompt";
        name: string;
    } | null;
    onSelectTool: (name: string) => void;
    onDeleteTool: (name: string) => void;
    selectedRef: React.RefObject<HTMLButtonElement | null>;
}

const ComposioCard = ({
    card,
    selectedEntity,
    onSelectTool,
    onDeleteTool,
    selectedRef,
}: ComposioCardProps) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="mb-2">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md text-sm text-left"
            >
                {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
                <div className="flex items-center gap-1">
                    {card.logo ? (
                        <div className="relative w-4 h-4">
                            <PictureImg
                                src={card.logo}
                                alt={`${card.name} logo`}
                                className="w-full h-full object-contain rounded"
                            />
                        </div>
                    ) : (
                        <ImportIcon className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                    )}
                    <span>{card.name}</span>
                </div>
            </button>
            {isExpanded && (
                <div className="ml-6 mt-1 space-y-1">
                    {card.tools.map((tool, index) => (
                        <ListItemWithMenu
                            key={`composio-tool-${index}`}
                            name={tool.name}
                            isSelected={selectedEntity?.type === "tool" && selectedEntity.name === tool.name}
                            onClick={() => onSelectTool(tool.name)}
                            disabled={tool.isLibrary}
                            selectedRef={selectedEntity?.type === "tool" && selectedEntity.name === tool.name ? selectedRef : undefined}
                            icon={
                                card.logo ? (
                                    <div className="relative w-4 h-4">
                                        <PictureImg
                                            src={card.logo}
                                            alt={`${card.name} logo`}
                                            className="w-full h-full object-contain rounded"
                                        />
                                    </div>
                                ) : (
                                    <ImportIcon className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                                )
                            }
                            menuContent={
                                <EntityDropdown 
                                    name={tool.name} 
                                    onDelete={onDeleteTool}
                                    isLocked={tool.isComposio}
                                />
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Add SortableItem component for agents
const SortableAgentItem = ({ agent, isSelected, onClick, selectedRef, statusLabel, onToggle, onSetMainAgent, onDelete, isStartAgent }: {
    agent: z.infer<typeof WorkflowAgent>;
    isSelected?: boolean;
    onClick?: () => void;
    selectedRef?: React.RefObject<HTMLButtonElement | null>;
    statusLabel?: React.ReactNode;
    onToggle: (name: string) => void;
    onSetMainAgent: (name: string) => void;
    onDelete: (name: string) => void;
    isStartAgent: boolean;
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: agent.name });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            <ListItemWithMenu
                name={agent.name}
                isSelected={isSelected}
                onClick={onClick}
                disabled={agent.disabled}
                selectedRef={selectedRef}
                statusLabel={statusLabel}
                icon={<Component className="w-4 h-4 text-blue-600/70 dark:text-blue-500/70" />}
                dragHandle={
                    <button className="cursor-grab" {...listeners}>
                        <GripVertical className="w-4 h-4 text-gray-400" />
                    </button>
                }
                menuContent={
                    <AgentDropdown
                        agent={agent}
                        isStartAgent={isStartAgent}
                        onToggle={onToggle}
                        onSetMainAgent={onSetMainAgent}
                        onDelete={onDelete}
                    />
                }
            />
        </div>
    );
}; 

interface AgentTypeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (agentType: 'internal' | 'user_facing') => void;
}

function AgentTypeModal({ isOpen, onClose, onConfirm }: AgentTypeModalProps) {
    const [selectedType, setSelectedType] = useState<'internal' | 'user_facing'>('internal');

    const handleConfirm = () => {
        onConfirm(selectedType);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" className="max-w-3xl w-full">
            <ModalContent className="max-w-3xl w-full">
                <ModalHeader>
                    <div className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-indigo-600" />
                        <span>Create New Agent</span>
                    </div>
                </ModalHeader>
                <ModalBody>
                    <div className="space-y-6">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Choose the type of agent you want to create:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Task Agent (Internal) */}
                            <button
                                type="button"
                                onClick={() => setSelectedType('internal')}
                                className={clsx(
                                    "relative group p-6 rounded-2xl border-2 flex flex-col items-start transition-all duration-200 text-left shadow-sm focus:outline-none",
                                    selectedType === 'internal'
                                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 shadow-lg scale-[1.03]"
                                        : "border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:shadow-md bg-white dark:bg-gray-900"
                                )}
                            >
                                <div className="flex items-center gap-4 w-full mb-2">
                                    <div className={clsx(
                                        "flex items-center justify-center w-12 h-12 rounded-lg transition-colors",
                                        selectedType === 'internal'
                                            ? "bg-indigo-100 dark:bg-indigo-900/60"
                                            : "bg-gray-100 dark:bg-gray-800"
                                    )}>
                                        <Cog className={clsx(
                                            "w-6 h-6 transition-colors",
                                            selectedType === 'internal'
                                                ? "text-indigo-600 dark:text-indigo-400"
                                                : "text-gray-600 dark:text-gray-400"
                                        )} />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                                            Task Agent
                                        </h3>
                                        <span className="inline-block align-middle">
                                            <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded">
                                                Internal
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <ul className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-1 list-disc pl-5 space-y-1">
                                  <li>Perform specific internal tasks, such as parts of workflows, pipelines, and data processing</li>
                                  <li>Cannot put out user-facing responses directly</li>
                                  <li>Can call other agents (both conversation and task agents)</li>
                                </ul>
                            </button>

                            {/* Conversation Agent (User-facing) */}
                            <button
                                type="button"
                                onClick={() => setSelectedType('user_facing')}
                                className={clsx(
                                    "relative group p-6 rounded-2xl border-2 flex flex-col items-start transition-all duration-200 text-left shadow-sm focus:outline-none",
                                    selectedType === 'user_facing'
                                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 shadow-lg scale-[1.03]"
                                        : "border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:shadow-md bg-white dark:bg-gray-900"
                                )}
                            >
                                <div className="flex items-center gap-4 w-full mb-2">
                                    <div className={clsx(
                                        "flex items-center justify-center w-12 h-12 rounded-lg transition-colors",
                                        selectedType === 'user_facing'
                                            ? "bg-indigo-100 dark:bg-indigo-900/60"
                                            : "bg-gray-100 dark:bg-gray-800"
                                    )}>
                                        <Users className={clsx(
                                            "w-6 h-6 transition-colors",
                                            selectedType === 'user_facing'
                                                ? "text-indigo-600 dark:text-indigo-400"
                                                : "text-gray-600 dark:text-gray-400"
                                        )} />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                                            Conversation Agent
                                        </h3>
                                        <span className="inline-block align-middle">
                                            <span className="text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                                User-facing
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <ul className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-1 list-disc pl-5 space-y-1">
                                  <li>Interact directly with users</li>
                                  <li>Ideal for specific roles in customer support, chat interfaces, and other end-user interactions</li>
                                  <li>Can call other agents (both conversation and task agents)</li>
                                </ul>
                            </button>
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleConfirm}
                    >
                        Create Agent
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
} 