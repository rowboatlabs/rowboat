import React, { forwardRef, useImperativeHandle } from "react";
import { z } from "zod";
import { WorkflowPrompt, WorkflowAgent, WorkflowTool, Workflow } from "../../../lib/types/workflow_types";
import { Project } from "../../../lib/types/project_types";
import { DataSource } from "../../../lib/types/datasource_types";
import { WithStringId } from "../../../lib/types/types";
import { Dropdown, DropdownItem, DropdownTrigger, DropdownMenu } from "@heroui/react";
import { useRef, useEffect, useState } from "react";
import { EllipsisVerticalIcon, ImportIcon, PlusIcon, Brain, Boxes, Wrench, PenLine, Library, ChevronDown, ChevronRight, ServerIcon, Component, ScrollText, GripVertical, Users, Cog, CheckCircle2, LinkIcon, UnlinkIcon, MoreVertical, Eye, Trash2, AlertTriangle, Circle, Database } from "lucide-react";
import { Tooltip } from "@heroui/react";
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
import { ToolsModal } from './components/ToolsModal';
import { DataSourcesModal } from './components/DataSourcesModal';
import { DataSourceIcon } from '../../../lib/components/datasource-icon';
import { deleteDataSource } from '../../../actions/datasource_actions';
import { ToolkitAuthModal } from '../tools/components/ToolkitAuthModal';
import { deleteConnectedAccount } from '@/app/actions/composio_actions';
import { ProjectWideChangeConfirmationModal } from '@/components/common/project-wide-change-confirmation-modal';

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
    prompts: z.infer<typeof WorkflowPrompt>[];
    dataSources: WithStringId<z.infer<typeof DataSource>>[];
    workflow: z.infer<typeof Workflow>;
    selectedEntity: {
        type: "agent" | "tool" | "prompt" | "datasource" | "visualise";
        name: string;
    } | null;
    startAgentName: string | null;
    onSelectAgent: (name: string) => void;
    onSelectTool: (name: string) => void;
    onSelectPrompt: (name: string) => void;
    onSelectDataSource?: (id: string) => void;
    onAddAgent: (agent: Partial<z.infer<typeof WorkflowAgent>>) => void;
    onAddTool: (tool: Partial<z.infer<typeof WorkflowTool>>) => void;
    onAddPrompt: (prompt: Partial<z.infer<typeof WorkflowPrompt>>) => void;
    onToggleAgent: (name: string) => void;
    onSetMainAgent: (name: string) => void;
    onDeleteAgent: (name: string) => void;
    onDeleteTool: (name: string) => void;
    onDeletePrompt: (name: string) => void;
    onShowVisualise: (name: string) => void;
    onProjectToolsUpdated?: () => void;
    onDataSourcesUpdated?: () => void;
    projectConfig?: z.infer<typeof Project>;
    useRagUploads: boolean;
    useRagS3Uploads: boolean;
    useRagScraping: boolean;
}

interface EmptyStateProps {
    entity: string;
    hasFilteredItems: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = ({ entity, hasFilteredItems }) => (
    <div className={clsx(
        "flex items-center justify-center h-24 text-sm text-zinc-400 dark:text-zinc-500",
        entity === "prompts" && "pb-6"
    )}>
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
    isMocked,
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
    isMocked?: boolean;
}) => {
    return (
        <div className={clsx(
            "group flex items-center gap-2 px-3 py-2 rounded-md min-h-[24px]",
            {
                "bg-indigo-50 dark:bg-indigo-950/30": isSelected,
                "hover:bg-zinc-50 dark:hover:bg-zinc-800": !isSelected
            }
        )}>
            {dragHandle}
            <button
                ref={selectedRef as React.RefObject<HTMLButtonElement>}
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
                <div className={clsx("shrink-0 flex items-center justify-center w-3 h-3", iconClassName)}>
                    {mcpServerName ? (
                        <ServerLogo 
                            serverName={mcpServerName} 
                            className="h-3 w-3" 
                            fallback={<ImportIcon className="w-3 h-3 text-blue-600 dark:text-blue-500" />} 
                        />
                    ) : icon}
                </div>
                <span className="text-xs">{name}</span>
            </button>
            <div className="flex items-center gap-1">
                {statusLabel}
                {isMocked && (
                    <Tooltip content="Mocked" size="sm" delay={500}>
                        <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center text-xs font-medium text-white">
                            M
                        </div>
                    </Tooltip>
                )}
                {menuContent}
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
        type: "agent" | "tool" | "prompt" | "datasource" | "visualise";
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
        <div className="mb-1 group">
            <div className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex-1 flex items-center gap-2 text-sm text-left min-h-[28px]"
                >
                    {/* Chevron - only show when has tools and on hover */}
                    <div className={`w-4 h-4 flex items-center justify-center transition-opacity ${
                        tools.length > 0 ? 'group-hover:opacity-100 opacity-60' : 'opacity-0'
                    }`}>
                        {tools.length > 0 && (isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-gray-500" />
                        ) : (
                            <ChevronRight className="w-3 h-3 text-gray-500" />
                        ))}
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <ServerLogo 
                            serverName={serverName} 
                            className="h-4 w-4" 
                            fallback={<ImportIcon className="w-4 h-4 text-blue-600 dark:text-blue-500" />}
                        />
                        <span className="text-sm">{serverName}</span>
                    </div>
                </button>
                
            </div>
            
            {isExpanded && (
                <div className="ml-6 mt-0.5 space-y-0.5 border-l border-gray-200 dark:border-gray-700 pl-3">
                                                                        {tools.map((tool, index) => (
                                                        <div key={`tool-${index}`} className="group/tool">
                                                            <ListItemWithMenu
                                                                name={tool.name}
                                                                isSelected={selectedEntity?.type === "tool" && selectedEntity.name === tool.name}
                                                                onClick={() => onSelectTool(tool.name)}
                                                                selectedRef={selectedEntity?.type === "tool" && selectedEntity.name === tool.name ? selectedRef : undefined}
                                                                mcpServerName={serverName}
                                                                isMocked={tool.mockTool}
                                                                menuContent={
                                                                    <div className="opacity-0 group-hover/tool:opacity-100 transition-opacity">
                                                                        <EntityDropdown 
                                                                            name={tool.name} 
                                                                            onDelete={onDeleteTool}
                                                                            isLocked={tool.isMcp || tool.isLibrary}
                                                                        />
                                                                    </div>
                                                                }
                                                            />
                                                        </div>
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

export const EntityList = forwardRef<
    { openDataSourcesModal: () => void },
    EntityListProps & { 
        projectId: string,
        onReorderAgents: (agents: z.infer<typeof WorkflowAgent>[]) => void 
    }
>(function EntityList({
    agents,
    tools,
    prompts,
    dataSources,
    workflow,
    selectedEntity,
    startAgentName,
    onSelectAgent,
    onSelectTool,
    onSelectPrompt,
    onSelectDataSource,
    onAddAgent,
    onAddTool,
    onAddPrompt,
    onToggleAgent,
    onSetMainAgent,
    onDeleteAgent,
    onDeleteTool,
    onDeletePrompt,
    onProjectToolsUpdated,
    onDataSourcesUpdated,
    projectId,
    projectConfig,
    onReorderAgents,
    onShowVisualise,
    useRagUploads,
    useRagS3Uploads,
    useRagScraping,
}: EntityListProps & { 
    projectId: string,
    onReorderAgents: (agents: z.infer<typeof WorkflowAgent>[]) => void 
}) {
    const [showAgentTypeModal, setShowAgentTypeModal] = useState(false);
    const [showToolsModal, setShowToolsModal] = useState(false);
    const [showDataSourcesModal, setShowDataSourcesModal] = useState(false);
    // State to track which toolkit's tools panel to open
    const [selectedToolkitSlug, setSelectedToolkitSlug] = useState<string | null>(null);

    const handleAddAgentWithType = (agentType: 'internal' | 'user_facing') => {
        onAddAgent({
            outputVisibility: agentType
        });
    };
    const selectedRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState<number>(0);

    // collect composio tools
    const composioTools: Record<string, ComposioToolkit> = {};
    for (const tool of tools) {
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
        data: true,
        prompts: false
    });

    // Default sizes when panels are expanded
    const DEFAULT_SIZES = {
        agents: 30,
        tools: 30,
        data: 20,
        prompts: 20
    };

    // Calculate panel sizes based on expanded state
    const getPanelSize = (panelName: 'agents' | 'tools' | 'data' | 'prompts') => {
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
            if (!expandedPanels.data) {
                size += DEFAULT_SIZES.data;
            }
            if (!expandedPanels.prompts) {
                size += DEFAULT_SIZES.prompts;
            }
        } else if (panelName === 'tools') {
            if (!expandedPanels.data && expandedPanels.agents) {
                size += DEFAULT_SIZES.data;
            }
            if (!expandedPanels.prompts && expandedPanels.agents) {
                size += DEFAULT_SIZES.prompts;
            }
        } else if (panelName === 'data') {
            if (!expandedPanels.prompts && (expandedPanels.agents || expandedPanels.tools)) {
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

    function handleSelectDataSource(id: string) {
        onSelectDataSource?.(id);
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

    useImperativeHandle(ref, () => ({
        openDataSourcesModal: () => {
            setShowDataSourcesModal(true);
        }
    }));

    return (
        <div ref={containerRef} className="flex flex-col h-full min-h-0">
            <ResizablePanelGroup 
                direction="vertical" 
                className="flex-1 min-h-0 flex flex-col"
                style={{ gap: `${GAP_SIZE}px` }}
            >
                {/* Agents Panel */}
                <ResizablePanel 
                    defaultSize={getPanelSize('agents')}
                    minSize={expandedPanels.agents ? 20 : 8}
                    maxSize={100}
                    className="flex flex-col min-h-0 h-full"
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-agents"
                        className={clsx(
                            "flex flex-col min-h-0 h-full overflow-hidden",
                            !expandedPanels.agents && "h-[53px]!"
                        )}
                        title={
                            <div className={`${headerClasses} rounded-md transition-colors h-full`}>
                                <div className="flex items-center gap-2 h-full">
                                    <button onClick={() => setExpandedPanels(prev => ({ ...prev, agents: !prev.agents }))}>
                                        {expandedPanels.agents ? (
                                            <ChevronDown className="w-4 h-4" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4" />
                                        )}
                                    </button>
                                    <Brain className="w-4 h-4" />
                                    <span>Agents</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onShowVisualise("visualise");
                                        }}
                                        className={`group ${buttonClasses}`}
                                        showHoverContent={true}
                                        hoverContent="Visualise Agents"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </Button>
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
                                </div>
                            </div>
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
                    className="flex flex-col min-h-0 h-full"
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-tools"
                        className={clsx(
                            "flex flex-col min-h-0 h-full overflow-hidden",
                            !expandedPanels.tools && "h-[53px]!"
                        )}
                        title={
                            <div className={`${headerClasses} rounded-md transition-colors h-full`}>
                                <div className="flex items-center gap-2 h-full">
                                    <button onClick={() => setExpandedPanels(prev => ({ ...prev, tools: !prev.tools }))}>
                                        {expandedPanels.tools ? (
                                            <ChevronDown className="w-4 h-4" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4" />
                                        )}
                                    </button>
                                    <Wrench className="w-4 h-4" />
                                    <span>Tools</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedPanels(prev => ({ ...prev, tools: true }));
                                            setShowToolsModal(true);
                                        }}
                                        className={`group ${buttonClasses}`}
                                        showHoverContent={true}
                                        hoverContent="Add Tool"
                                    >
                                        <PlusIcon className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        }
                    >
                        {expandedPanels.tools && (
                            <div className="h-full overflow-y-auto">
                                <div className="p-2">
                                    {tools.length > 0 ? (
                                        <div className="space-y-1">
                                            {/* Group tools by server */}
                                            {(() => {
                                                // Get custom tools (non-MCP tools)
                                                const customTools = tools.filter(tool => !tool.isMcp && !tool.isComposio);
                                                
                                                // Group MCP tools by server
                                                const serverTools = tools.reduce((acc, tool) => {
                                                    if (tool.isMcp && tool.mcpServerName) {
                                                        if (!acc[tool.mcpServerName]) {
                                                            acc[tool.mcpServerName] = [];
                                                        }
                                                        acc[tool.mcpServerName].push(tool);
                                                    }
                                                    return acc;
                                                }, {} as Record<string, typeof tools>);

                                                return (
                                                    <>
                                                        {/* Show composio cards - ordered by status */}
                                                        {Object.values(composioTools)
                                                            .map((card) => (
                                                                <ComposioCard 
                                                                    key={card.slug} 
                                                                    card={card}
                                                                    selectedEntity={selectedEntity}
                                                                    onSelectTool={handleToolSelection}
                                                                    onDeleteTool={onDeleteTool}
                                                                    selectedRef={selectedRef}
                                                                    projectConfig={projectConfig}
                                                                    projectId={projectId}
                                                                    workflow={workflow}
                                                                    onProjectToolsUpdated={onProjectToolsUpdated}
                                                                    setSelectedToolkitSlug={setSelectedToolkitSlug}
                                                                    setShowToolsModal={setShowToolsModal}
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
                                                            <div
                                                                key={`custom-tool-${index}`}
                                                                className={clsx(
                                                                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800",
                                                                    selectedEntity?.type === "tool" && selectedEntity.name === tool.name && "bg-indigo-50 dark:bg-indigo-950/30"
                                                                )}
                                                                onClick={() => handleToolSelection(tool.name)}
                                                            >
                                                                <Boxes className="w-4 h-4 text-blue-600/70 dark:text-blue-500/70" />
                                                                <span className="flex-1 text-xs text-zinc-900 dark:text-zinc-100 whitespace-normal break-words">{tool.name}</span>
                                                                {tool.mockTool && (
                                                                    <span className="ml-2 px-1 py-0 rounded bg-purple-50 text-purple-400 dark:bg-purple-900/40 dark:text-purple-200 text-[11px] font-normal align-middle">Mocked</span>
                                                                )}
                                                                <Tooltip content="Remove tool" size="sm" delay={500}>
                                                                    <button
                                                                        className="ml-1 p-1 pr-2 rounded hover:bg-red-100 dark:hover:bg-red-900 flex items-center"
                                                                        onClick={e => { e.stopPropagation(); onDeleteTool(tool.name); }}
                                                                    >
                                                                        <Trash2 className="w-3 h-3 text-red-500" />
                                                                    </button>
                                                                </Tooltip>
                                                            </div>
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

                {/* Data Panel */}
                <ResizablePanel 
                    defaultSize={getPanelSize('data')}
                    minSize={expandedPanels.data ? 20 : 8}
                    maxSize={100}
                    className="flex flex-col min-h-0 h-full"
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-data"
                        className={clsx(
                            "flex flex-col min-h-0 h-full overflow-hidden",
                            !expandedPanels.data && "h-[53px]!"
                        )}
                        title={
                            <div className={`${headerClasses} rounded-md transition-colors h-full`}>
                                <div className="flex items-center gap-2 h-full">
                                    <button onClick={() => setExpandedPanels(prev => ({ ...prev, data: !prev.data }))}>
                                        {expandedPanels.data ? (
                                            <ChevronDown className="w-4 h-4" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4" />
                                        )}
                                    </button>
                                    <Database className="w-4 h-4" />
                                    <span>Data</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedPanels(prev => ({ ...prev, data: true }));
                                            setShowDataSourcesModal(true);
                                        }}
                                        className={`group ${buttonClasses}`}
                                        showHoverContent={true}
                                        hoverContent="Add Data Source"
                                    >
                                        <PlusIcon className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        }
                    >
                        {expandedPanels.data && (
                            <div className="h-[calc(100%-53px)] overflow-y-auto">
                                <div className="p-2">
                                    {dataSources.length > 0 ? (
                                        <div className="space-y-1">
                                            {dataSources.map((dataSource, index) => {
                                                // Determine data source status
                                                const isActive = dataSource.active && dataSource.status === 'ready';
                                                const isPending = dataSource.status === 'pending';
                                                const isError = dataSource.status === 'error';
                                                
                                                let statusPill = null;
                                                if (isPending) {
                                                    statusPill = (
                                                        <Tooltip content="Processing" size="sm" delay={500}>
                                                            <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700">
                                                                <Circle className="w-2 h-2 animate-pulse" fill="currentColor" />
                                                                <span>Processing</span>
                                                            </span>
                                                        </Tooltip>
                                                    );
                                                } else if (isError) {
                                                    statusPill = (
                                                        <Tooltip content={dataSource.error || "Error"} size="sm" delay={500}>
                                                            <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-red-300 bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-200 dark:border-red-700">
                                                                <Circle className="w-2 h-2" fill="currentColor" />
                                                                <span>Error</span>
                                                            </span>
                                                        </Tooltip>
                                                    );
                                                } else if (isActive) {
                                                    statusPill = (
                                                        <Tooltip content="Active" size="sm" delay={500}>
                                                            <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-green-300 bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200 dark:border-green-700">
                                                                <Circle className="w-2 h-2" fill="currentColor" />
                                                                <span>Active</span>
                                                            </span>
                                                        </Tooltip>
                                                    );
                                                } else {
                                                    statusPill = (
                                                        <Tooltip content="Inactive" size="sm" delay={500}>
                                                            <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-gray-300 bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700">
                                                                <Circle className="w-2 h-2" fill="currentColor" />
                                                                <span>Inactive</span>
                                                            </span>
                                                        </Tooltip>
                                                    );
                                                }

                                                return (
                                                    <div key={`datasource-${index}`} className="group/datasource">
                                                        <div className={clsx(
                                                            "flex items-center gap-2 px-3 py-2 rounded-md min-h-[24px] cursor-pointer",
                                                            {
                                                                "bg-indigo-50 dark:bg-indigo-950/30": selectedEntity?.type === "datasource" && selectedEntity.name === dataSource._id,
                                                                "hover:bg-zinc-50 dark:hover:bg-zinc-800": !(selectedEntity?.type === "datasource" && selectedEntity.name === dataSource._id)
                                                            }
                                                        )}>
                                                            <button
                                                                ref={selectedEntity?.type === "datasource" && selectedEntity.name === dataSource._id ? selectedRef : undefined}
                                                                className="flex-1 flex items-center gap-2 text-sm text-left"
                                                                onClick={() => handleSelectDataSource(dataSource._id)}
                                                            >
                                                                <div className="shrink-0 flex items-center justify-center w-3 h-3">
                                                                    <DataSourceIcon type={
                                                                        dataSource.data.type === 'files_local' || dataSource.data.type === 'files_s3' 
                                                                            ? 'files' 
                                                                            : dataSource.data.type
                                                                    } />
                                                                </div>
                                                                <span className="text-xs flex-1">{dataSource.name}</span>
                                                            </button>
                                                            <div className="flex items-center gap-1">
                                                                {statusPill}
                                                                <div className="opacity-0 group-hover/datasource:opacity-100 transition-opacity">
                                                                    <EntityDropdown 
                                                                        name={dataSource.name} 
                                                                        onDelete={async () => {
                                                                            if (window.confirm(`Are you sure you want to delete the data source "${dataSource.name}"?`)) {
                                                                                await deleteDataSource(projectId, dataSource._id);
                                                                                onDataSourcesUpdated?.();
                                                                            }
                                                                        }} 
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <EmptyState entity="data sources" hasFilteredItems={false} />
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
                    className="flex flex-col min-h-0 h-full"
                >
                    <Panel 
                        variant="entity-list"
                        tourTarget="entity-prompts"
                        className={clsx(
                            "h-full",
                            !expandedPanels.prompts && "h-[53px]!"
                        )}
                        title={
                            <div className={`${headerClasses} rounded-md transition-colors h-full`}>
                                <div className="flex items-center gap-2 h-full">
                                    <button onClick={() => setExpandedPanels(prev => ({ ...prev, prompts: !prev.prompts }))}>
                                        {expandedPanels.prompts ? (
                                            <ChevronDown className="w-4 h-4" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4" />
                                        )}
                                    </button>
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
                            </div>
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
            <ToolsModal
                isOpen={showToolsModal}
                onClose={() => {
                    setShowToolsModal(false);
                    setSelectedToolkitSlug(null);
                }}
                projectId={projectId}
                tools={tools}
                onAddTool={onAddTool}
                initialToolkitSlug={selectedToolkitSlug}
            />
            <DataSourcesModal
                isOpen={showDataSourcesModal}
                onClose={() => setShowDataSourcesModal(false)}
                projectId={projectId}
                onDataSourceAdded={onDataSourcesUpdated}
                useRagUploads={useRagUploads}
                useRagS3Uploads={useRagS3Uploads}
                useRagScraping={useRagScraping}
            />
        </div>
    );
});

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
        type: "agent" | "tool" | "prompt" | "datasource" | "visualise";
        name: string;
    } | null;
    onSelectTool: (name: string) => void;
    onDeleteTool: (name: string) => void;
    selectedRef: React.RefObject<HTMLButtonElement | null>;
    projectConfig?: z.infer<typeof Project>;
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    onProjectToolsUpdated?: () => void;
}

const ComposioCard = ({
    card,
    selectedEntity,
    onSelectTool,
    onDeleteTool,
    selectedRef,
    projectConfig,
    projectId,
    workflow,
    onProjectToolsUpdated,
    setSelectedToolkitSlug,
    setShowToolsModal,
}: ComposioCardProps & { setSelectedToolkitSlug: (slug: string) => void, setShowToolsModal: (open: boolean) => void }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showDisconnectModal, setShowDisconnectModal] = useState(false);
    const [showRemoveToolkitModal, setShowRemoveToolkitModal] = useState(false);
    const [isProcessingAuth, setIsProcessingAuth] = useState(false);
    const [isProcessingRemove, setIsProcessingRemove] = useState(false);

    // Check if the toolkit requires authentication
    const hasToolkitWithAuth = card.tools.some(tool => tool.composioData && !tool.composioData.noAuth);
    // Check if toolkit is connected
    const isToolkitConnected = !hasToolkitWithAuth || projectConfig?.composioConnectedAccounts?.[card.slug]?.status === 'ACTIVE';

    // Remove all tools from this toolkit
    const handleRemoveToolkit = async () => {
        setIsProcessingRemove(true);
        // Disconnect if needed
        if (hasToolkitWithAuth && isToolkitConnected) {
            const connectedAccountId = projectConfig?.composioConnectedAccounts?.[card.slug]?.id;
            try {
                if (connectedAccountId) {
                    await deleteConnectedAccount(projectId, card.slug, connectedAccountId);
                }
            } catch (err) {
                // ignore error, continue to remove tools
            }
        }
        // Remove all tools from this toolkit
        card.tools.forEach(tool => {
            onDeleteTool(tool.name);
        });
        setIsProcessingRemove(false);
        setShowRemoveToolkitModal(false);
        onProjectToolsUpdated?.();
    };

    const handleConnect = () => setShowAuthModal(true);
    const handleDisconnect = () => setShowDisconnectModal(true);
    const handleConfirmDisconnect = async () => {
        const connectedAccountId = projectConfig?.composioConnectedAccounts?.[card.slug]?.id;
        setIsProcessingAuth(true);
        try {
            if (connectedAccountId) {
                await deleteConnectedAccount(projectId, card.slug, connectedAccountId);
                onProjectToolsUpdated?.();
            }
        } catch (err: any) {
            console.error('Disconnect failed:', err);
        } finally {
            setIsProcessingAuth(false);
            setShowDisconnectModal(false);
        }
    };
    const handleAuthComplete = () => {
        setShowAuthModal(false);
        onProjectToolsUpdated?.();
    };

    // Status dot
    const statusDot = (
        <Tooltip content={isToolkitConnected ? "Connected" : "Disconnected"} size="sm" delay={500}>
            <Circle className={clsx(
                "w-3 h-3",
                isToolkitConnected ? "text-green-500" : "text-red-500"
            )} fill="currentColor" />
        </Tooltip>
    );

    let statusPill = null;
    if (!isToolkitConnected && hasToolkitWithAuth) {
        statusPill = (
            <Tooltip content="Toolkit needs to be connected" size="sm" delay={500}>
                <button
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700 transition-colors cursor-pointer"
                    onClick={handleConnect}
                >
                    <AlertTriangle className="w-3 h-3 text-yellow-500" />
                    <span>Connect</span>
                </button>
            </Tooltip>
        );
    } else if (isToolkitConnected && hasToolkitWithAuth) {
        statusPill = (
            <span className="flex items-baseline gap-2 px-1.5 py-0 text-[11px] rounded-full border border-green-200 bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200 dark:border-green-700">
                <span className="flex items-center"><Circle className="w-2 h-2" fill="currentColor" /></span>
                <span className="mt-[1px]">Connected</span>
            </span>
        );
    }

    // Always show the 3-dots menu for all toolkits
    let toolkitMenu = null;
    toolkitMenu = (
        <div>
            <Dropdown>
                <DropdownTrigger>
                    <button className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors">
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                    </button>
                </DropdownTrigger>
                <DropdownMenu
                    onAction={(key) => {
                        switch (key) {
                            case 'disconnect':
                                handleDisconnect && handleDisconnect();
                                break;
                            case 'remove-toolkit':
                                setShowRemoveToolkitModal(true);
                                break;
                            case 'more-tools':
                                setSelectedToolkitSlug(card.slug);
                                setShowToolsModal(true);
                                break;
                        }
                    }}
                    disabledKeys={[
                        ...(isProcessingAuth ? ['disconnect'] : []),
                        ...(isProcessingRemove ? ['remove-toolkit'] : []),
                    ]}
                >
                    <DropdownItem
                        key="more-tools"
                        startContent={<PlusIcon className="h-3 w-3" />}
                    >
                        More tools
                    </DropdownItem>
                    {hasToolkitWithAuth && isToolkitConnected ? (
                        <DropdownItem
                            key="disconnect"
                            startContent={isProcessingAuth ? (
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-600"></div>
                            ) : (
                                <UnlinkIcon className="h-3 w-3" />
                            )}
                        >
                            {isProcessingAuth ? 'Disconnecting...' : 'Disconnect'}
                        </DropdownItem>
                    ) : null}
                    <DropdownItem
                        key="remove-toolkit"
                        startContent={isProcessingRemove ? (
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-600"></div>
                        ) : (
                            <Trash2 className="h-3 w-3" />
                        )}
                    >
                        {isProcessingRemove ? 'Removing...' : 'Remove Toolkit'}
                    </DropdownItem>
                </DropdownMenu>
            </Dropdown>
        </div>
    );

    return (
        <>
            <div className="mb-1 group">
                <div className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex-1 flex items-center gap-2 text-sm text-left min-h-[28px] py-1"
                    >
                        {/* Chevron - only show on hover or when has tools */}
                        <div className={`w-4 h-4 flex items-center justify-center transition-opacity ${
                            card.tools.length > 0 ? 'group-hover:opacity-100 opacity-60' : 'opacity-0'
                        }`}>
                            {card.tools.length > 0 && (isExpanded ? (
                                <ChevronDown className="w-3 h-3 text-gray-500" />
                            ) : (
                                <ChevronRight className="w-3 h-3 text-gray-500" />
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
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
                            <span className="text-xs">{card.name}</span>
                            {statusPill && <span className="ml-2">{statusPill}</span>}
                        </div>
                    </button>
                    <div className="ml-2">{toolkitMenu}</div>
                </div>
                {isExpanded && (
                    <div className="ml-7 mt-0.5 space-y-0.5 border-l border-gray-200 dark:border-gray-700 pl-3">
                        {card.tools.map((tool, index) => (
                            <div
                                key={`composio-tool-${index}`}
                                className={clsx(
                                    "group/tool flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded",
                                    selectedEntity?.type === "tool" && selectedEntity.name === tool.name && "bg-indigo-50 dark:bg-indigo-950/30"
                                )}
                            >
                                {/* Toolkit icon or fallback */}
                                {card.logo ? (
                                    <div className="w-4 h-4 flex items-center justify-center">
                                        <PictureImg
                                            src={card.logo}
                                            alt={`${card.name} logo`}
                                            className="w-full h-full object-contain rounded"
                                        />
                                    </div>
                                ) : (
                                    <ImportIcon className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                                )}
                                <button
                                    className={clsx(
                                        "flex-1 flex items-center gap-2 text-sm text-left bg-transparent border-none p-0 m-0",
                                        tool.isLibrary ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-900 dark:text-zinc-100"
                                    )}
                                    onClick={() => onSelectTool(tool.name)}
                                    disabled={tool.isLibrary}
                                    style={{ minWidth: 0 }}
                                >
                                    <span className="whitespace-normal break-words text-xs">{tool.name}</span>
                                </button>
                                {tool.mockTool && (
                                    <span className="ml-2 px-1 py-0 rounded bg-purple-50 text-purple-400 dark:bg-purple-900/40 dark:text-purple-200 text-[11px] font-normal align-middle">Mocked</span>
                                )}
                                <Tooltip content="Remove tool" size="sm" delay={500}>
                                    <button
                                        className="ml-1 p-1 pr-2 rounded hover:bg-red-100 dark:hover:bg-red-900 flex items-center"
                                        onClick={() => onDeleteTool(tool.name)}
                                    >
                                        <Trash2 className="w-3 h-3 text-red-500" />
                                    </button>
                                </Tooltip>
                            </div>
                        ))}
                        {/* More tools option */}
                        <button
                            className="flex items-center gap-2 px-3 py-2 mt-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded transition-colors"
                            onClick={() => {
                                setSelectedToolkitSlug(card.slug);
                                setShowToolsModal(true);
                            }}
                        >
                            <PlusIcon className="w-4 h-4" />
                            <span>More tools</span>
                        </button>
                    </div>
                )}
            </div>
            {/* Auth Modal */}
            {hasToolkitWithAuth && (
                <ToolkitAuthModal
                    key={card.slug}
                    isOpen={showAuthModal}
                    onClose={() => setShowAuthModal(false)}
                    toolkitSlug={card.slug}
                    projectId={projectId}
                    onComplete={handleAuthComplete}
                />
            )}
            {/* Disconnect Confirmation Modal */}
            <ProjectWideChangeConfirmationModal
                isOpen={showDisconnectModal}
                onClose={() => setShowDisconnectModal(false)}
                onConfirm={handleConfirmDisconnect}
                title={`Disconnect ${card.name}`}
                confirmationQuestion={`Are you sure you want to disconnect the ${card.name} toolkit?`}
                confirmButtonText="Disconnect"
                isLoading={isProcessingAuth}
            />
            {/* Remove Toolkit Confirmation Modal */}
            <ProjectWideChangeConfirmationModal
                isOpen={showRemoveToolkitModal}
                onClose={() => setShowRemoveToolkitModal(false)}
                onConfirm={handleRemoveToolkit}
                title={`Remove ${card.name} Toolkit`}
                confirmationQuestion={`Are you sure you want to remove the ${card.name} toolkit and all its tools? This will disconnect and delete all tools from this toolkit.`}
                confirmButtonText="Remove Toolkit"
                isLoading={isProcessingRemove}
            />
        </>
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