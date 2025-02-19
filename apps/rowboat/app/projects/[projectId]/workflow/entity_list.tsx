import { z } from "zod";
import { AgenticAPITool } from "../../../lib/types/agents_api_types";
import { WorkflowPrompt } from "../../../lib/types/workflow_types";
import { WorkflowAgent } from "../../../lib/types/workflow_types";
import { Dropdown, DropdownItem, DropdownTrigger, DropdownMenu } from "@nextui-org/react";
import { useRef, useEffect } from "react";
import { ActionButton, StructuredPanel } from "../../../lib/components/structured-panel";
import clsx from "clsx";
import { EllipsisVerticalIcon } from "lucide-react";

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
}

function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
    return (
        <div className="flex items-center justify-between px-2 py-1 mt-4 first:mt-0 border-b border-gray-200">
            <div className="text-xs font-semibold text-gray-400 uppercase">{title}</div>
            <ActionButton
                icon={<svg className="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14m-7 7V5" />
                </svg>}
                onClick={onAdd}
            >
                Add
            </ActionButton>
        </div>
    );
}

function ListItem({ 
    name, 
    isSelected, 
    onClick, 
    disabled,
    rightElement,
    selectedRef 
}: { 
    name: string;
    isSelected: boolean;
    onClick: () => void;
    disabled?: boolean;
    rightElement?: React.ReactNode;
    selectedRef?: React.RefObject<HTMLButtonElement>;
}) {
    return (
        <button
            ref={selectedRef as any}
            onClick={onClick}
            className={clsx("flex items-center justify-between rounded-md px-2 py-1", {
                "bg-gray-100": isSelected,
                "hover:bg-gray-50": !isSelected,
            })}
        >
            <div className={clsx("truncate text-sm", {
                "text-gray-400": disabled,
            })}>{name}</div>
            {rightElement}
        </button>
    );
}

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
}: EntityListProps) {
    const selectedRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (selectedEntity && selectedRef.current) {
            selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedEntity]);

    return (
        <StructuredPanel 
            title="WORKFLOW" 
            tooltip="Browse and manage your agents, tools, and prompts in this sidebar"
        >
            <div className="overflow-auto flex flex-col gap-1 justify-start">
                {/* Agents Section */}
                <SectionHeader title="Agents" onAdd={() => onAddAgent({})} />
                {agents.map((agent, index) => (
                    <ListItem
                        key={`agent-${index}`}
                        name={agent.name}
                        isSelected={selectedEntity?.type === "agent" && selectedEntity.name === agent.name}
                        onClick={() => onSelectAgent(agent.name)}
                        disabled={agent.disabled}
                        selectedRef={selectedEntity?.type === "agent" && selectedEntity.name === agent.name ? selectedRef : undefined}
                        rightElement={
                            <div className="flex items-center gap-2">
                                {startAgentName === agent.name && (
                                    <div className="text-xs border bg-blue-500 text-white px-2 py-1 rounded-md">Start</div>
                                )}
                                <AgentDropdown
                                    agent={agent}
                                    isStartAgent={startAgentName === agent.name}
                                    onToggle={onToggleAgent}
                                    onSetMainAgent={onSetMainAgent}
                                    onDelete={onDeleteAgent}
                                />
                            </div>
                        }
                    />
                ))}

                {/* Tools Section */}
                <SectionHeader title="Tools" onAdd={() => onAddTool({})} />
                {tools.map((tool, index) => (
                    <ListItem
                        key={`tool-${index}`}
                        name={tool.name}
                        isSelected={selectedEntity?.type === "tool" && selectedEntity.name === tool.name}
                        onClick={() => onSelectTool(tool.name)}
                        selectedRef={selectedEntity?.type === "tool" && selectedEntity.name === tool.name ? selectedRef : undefined}
                        rightElement={<EntityDropdown name={tool.name} onDelete={onDeleteTool} />}
                    />
                ))}

                {/* Prompts Section */}
                <SectionHeader title="Prompts" onAdd={() => onAddPrompt({})} />
                {prompts.map((prompt, index) => (
                    <ListItem
                        key={`prompt-${index}`}
                        name={prompt.name}
                        isSelected={selectedEntity?.type === "prompt" && selectedEntity.name === prompt.name}
                        onClick={() => onSelectPrompt(prompt.name)}
                        selectedRef={selectedEntity?.type === "prompt" && selectedEntity.name === prompt.name ? selectedRef : undefined}
                        rightElement={<EntityDropdown name={prompt.name} onDelete={onDeletePrompt} />}
                    />
                ))}
            </div>
        </StructuredPanel>
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