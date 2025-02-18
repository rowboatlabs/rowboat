"use client";
import { WithStringId } from "../../../lib/types/types";
import { Workflow } from "../../../lib/types/workflow_types";
import { WorkflowTool } from "../../../lib/types/workflow_types";
import { WorkflowPrompt } from "../../../lib/types/workflow_types";
import { WorkflowAgent } from "../../../lib/types/workflow_types";
import { DataSource } from "../../../lib/types/datasource_types";
import { useReducer, Reducer, useState, useCallback, useEffect, useRef } from "react";
import { produce, applyPatches, enablePatches, produceWithPatches, Patch } from 'immer';
import { AgentConfig } from "./agent_config";
import { ToolConfig } from "./tool_config";
import { App as ChatApp } from "../playground/app";
import { z } from "zod";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip } from "@nextui-org/react";
import { PromptConfig } from "./prompt_config";
import { EditableField } from "../../../lib/components/editable-field";
import { RelativeTime } from "@primer/react";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "../../../../components/ui/resizable"
import { Copilot } from "./copilot";
import { apiV1 } from "rowboat-shared";
import { publishWorkflow, renameWorkflow, saveWorkflow } from "../../../actions/workflow_actions";
import { PublishedBadge } from "./published_badge";
import { BackIcon, HamburgerIcon, WorkflowIcon } from "../../../lib/components/icons";
import { CopyIcon, Layers2Icon, RadioIcon, RedoIcon, Sparkles, UndoIcon } from "lucide-react";
import { EntityList } from "./entity_list";
import { CopilotMessage } from "../../../lib/types/copilot_types";
import { InfoIcon } from "lucide-react";
import { clsx } from "clsx";

enablePatches();

interface StateItem {
    workflow: WithStringId<z.infer<typeof Workflow>>;
    publishedWorkflowId: string | null;
    publishing: boolean;
    selection: {
        type: "agent" | "tool" | "prompt";
        name: string;
    } | null;
    saving: boolean;
    publishError: string | null;
    publishSuccess: boolean;
    pendingChanges: boolean;
    chatKey: number;
    lastUpdatedAt: string;
}

interface State {
    present: StateItem;
    patches: Patch[][];
    inversePatches: Patch[][];
    currentIndex: number;
}

export type Action = {
    type: "update_workflow_name";
    name: string;
} | {
    type: "set_publishing";
    publishing: boolean;
} | {
    type: "set_published_workflow_id";
    workflowId: string;
} | {
    type: "add_agent";
    agent: Partial<z.infer<typeof WorkflowAgent>>;
} | {
    type: "add_tool";
    tool: Partial<z.infer<typeof WorkflowTool>>;
} | {
    type: "add_prompt";
    prompt: Partial<z.infer<typeof WorkflowPrompt>>;
} | {
    type: "select_agent";
    name: string;
} | {
    type: "select_tool";
    name: string;
} | {
    type: "delete_agent";
    name: string;
} | {
    type: "delete_tool";
    name: string;
} | {
    type: "update_agent";
    name: string;
    agent: Partial<z.infer<typeof WorkflowAgent>>;
} | {
    type: "update_tool";
    name: string;
    tool: Partial<z.infer<typeof WorkflowTool>>;
} | {
    type: "set_saving";
    saving: boolean;
} | {
    type: "unselect_agent";
} | {
    type: "unselect_tool";
} | {
    type: "undo";
} | {
    type: "redo";
} | {
    type: "select_prompt";
    name: string;
} | {
    type: "unselect_prompt";
} | {
    type: "delete_prompt";
    name: string;
} | {
    type: "update_prompt";
    name: string;
    prompt: Partial<z.infer<typeof WorkflowPrompt>>;
} | {
    type: "toggle_agent";
    name: string;
} | {
    type: "set_main_agent";
    name: string;
} | {
    type: "set_publish_error";
    error: string | null;
} | {
    type: "set_publish_success";
    success: boolean;
} | {
    type: "restore_state";
    state: StateItem;
};

function reducer(state: State, action: Action): State {
    console.log('running reducer', action);
    let newState: State;

    if (action.type === "restore_state") {
        return {
            present: action.state,
            patches: [],
            inversePatches: [],
            currentIndex: 0
        };
    }

    const isLive = state.present.workflow._id == state.present.publishedWorkflowId;

    switch (action.type) {
        case "undo": {
            if (state.currentIndex <= 0) return state;
            newState = produce(state, draft => {
                const inverse = state.inversePatches[state.currentIndex - 1];
                draft.present = applyPatches(state.present, inverse);
                draft.currentIndex--;
                draft.present.pendingChanges = true;
                draft.present.chatKey++;
            });
            break;
        }
        case "redo": {
            if (state.currentIndex >= state.patches.length) return state;
            newState = produce(state, draft => {
                const patch = state.patches[state.currentIndex];
                draft.present = applyPatches(state.present, patch);
                draft.currentIndex++;
                draft.present.pendingChanges = true;
                draft.present.chatKey++;
             });
            break;
        }
        case "update_workflow_name": {
            newState = produce(state, draft => {
                draft.present.workflow.name = action.name;
            });
            break;
        }
        case "set_publishing": {
            newState = produce(state, draft => {
                draft.present.publishing = action.publishing;
            });
            break;
        }
        case "set_published_workflow_id": {
            newState = produce(state, draft => {
                draft.present.publishedWorkflowId = action.workflowId;
            });
            break;
        }
        case "set_publish_error": {
            newState = produce(state, draft => {
                draft.present.publishError = action.error;
            });
            break;
        }
        case "set_publish_success": {
            newState = produce(state, draft => {
                draft.present.publishSuccess = action.success;
            });
            break;
        }
        case "set_saving": {
            newState = produce(state, draft => {
                draft.present.saving = action.saving;
                draft.present.pendingChanges = action.saving;
                draft.present.lastUpdatedAt = !action.saving ? new Date().toISOString() : state.present.workflow.lastUpdatedAt;
            });
            break;
        }
        default: {
            const [nextState, patches, inversePatches] = produceWithPatches(
                state.present,
                (draft) => {
                    switch (action.type) {
                        case "select_agent":
                            draft.selection = {
                                type: "agent",
                                name: action.name
                            };
                            break;
                        case "select_tool":
                            draft.selection = {
                                type: "tool",
                                name: action.name
                            };
                            break;
                        case "select_prompt":
                            draft.selection = {
                                type: "prompt",
                                name: action.name
                            };
                            break;
                        case "unselect_agent":
                        case "unselect_tool":
                        case "unselect_prompt":
                            draft.selection = null;
                            break;
                        case "add_agent": {
                            if (isLive) {
                                break;
                            }
                            let newAgentName = "New agent";
                            if (draft.workflow?.agents.some((agent) => agent.name === newAgentName)) {
                                newAgentName = `New agent ${draft.workflow.agents.filter((agent) =>
                                    agent.name.startsWith("New agent")).length + 1}`;
                            }
                            draft.workflow?.agents.push({
                                name: newAgentName,
                                type: "conversation",
                                description: "",
                                disabled: false,
                                instructions: "",
                                model: "gpt-4o",
                                locked: false,
                                toggleAble: true,
                                ragReturnType: "chunks",
                                ragK: 3,
                                controlType: "retain",
                                ...action.agent
                            });
                            draft.selection = {
                                type: "agent",
                                name: action.agent.name || newAgentName
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        case "add_tool": {
                            if (isLive) {
                                break;
                            }
                            let newToolName = "New tool";
                            if (draft.workflow?.tools.some((tool) => tool.name === newToolName)) {
                                newToolName = `New tool ${draft.workflow.tools.filter((tool) =>
                                    tool.name.startsWith("New tool")).length + 1}`;
                            }
                            draft.workflow?.tools.push({
                                name: newToolName,
                                description: "",
                                parameters: {
                                    type: "object",
                                    properties: {},
                                },
                                mockInPlayground: true,
                                autoSubmitMockedResponse: true,
                                ...action.tool
                            });
                            draft.selection = {
                                type: "tool",
                                name: action.tool.name || newToolName
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        case "add_prompt": {
                            if (isLive) {
                                break;
                            }
                            let newPromptName = "New prompt";
                            if (draft.workflow?.prompts.some((prompt) => prompt.name === newPromptName)) {
                                newPromptName = `New prompt ${draft.workflow?.prompts.filter((prompt) =>
                                    prompt.name.startsWith("New prompt")).length + 1}`;
                            }
                            draft.workflow?.prompts.push({
                                name: newPromptName,
                                type: "base_prompt",
                                prompt: "",
                                ...action.prompt
                            });
                            draft.selection = {
                                type: "prompt",
                                name: action.prompt.name || newPromptName
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        case "delete_agent":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.agents = draft.workflow.agents.filter(
                                (agent) => agent.name !== action.name
                            );
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "delete_tool":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.tools = draft.workflow.tools.filter(
                                (tool) => tool.name !== action.name
                            );
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "delete_prompt":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.prompts = draft.workflow.prompts.filter(
                                (prompt) => prompt.name !== action.name
                            );
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "update_agent":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.agents = draft.workflow.agents.map((agent) =>
                                agent.name === action.name ? { ...agent, ...action.agent } : agent
                            );
                            if (action.agent.name && draft.workflow.startAgent === action.name) {
                                draft.workflow.startAgent = action.agent.name;
                            }
                            // if (action.agent.name && action.agent.name !== action.name) {
                            //     draft.workflow.agents = draft.workflow.agents.map(agent => ({
                            //         ...agent,
                            //         connectedAgents: agent.connectedAgents.map(connectedAgent =>
                            //             connectedAgent === action.name ? action.agent.name! : connectedAgent
                            //         )
                            //     }));
                            // }
                            if (action.agent.name && draft.selection?.type === "agent" && draft.selection.name === action.name) {
                                draft.selection = {
                                    type: "agent",
                                    name: action.agent.name
                                };
                            }
                            draft.selection = {
                                type: "agent",
                                name: action.agent.name || action.name,
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "update_tool":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.tools = draft.workflow.tools.map((tool) =>
                                tool.name === action.name ? { ...tool, ...action.tool } : tool
                            );
                            // if (action.tool.name && action.tool.name !== action.name) {
                            //     draft.workflow.agents = draft.workflow.agents.map(agent => ({
                            //         ...agent,
                            //         tools: agent.tools.map(toolName =>
                            //             toolName === action.name ? action.tool.name! : toolName
                            //         )
                            //     }));
                            // }
                            if (action.tool.name && draft.selection?.type === "tool" && draft.selection.name === action.name) {
                                draft.selection = {
                                    type: "tool",
                                    name: action.tool.name
                                };
                            }
                            draft.selection = {
                                type: "tool",
                                name: action.tool.name || action.name,
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "update_prompt":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.prompts = draft.workflow.prompts.map((prompt) =>
                                prompt.name === action.name ? { ...prompt, ...action.prompt } : prompt
                            );
                            // draft.workflow.agents = draft.workflow.agents.map(agent => ({
                            //     ...agent,
                            //     prompts: agent.prompts.map(promptName =>
                            //         promptName === action.name ? action.prompt.name! : promptName
                            //     )
                            // }));
                            if (action.prompt.name && draft.selection?.type === "prompt" && draft.selection.name === action.name) {
                                draft.selection = {
                                    type: "prompt",
                                    name: action.prompt.name
                                };
                            }
                            draft.selection = {
                                type: "prompt",
                                name: action.prompt.name || action.name,
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "toggle_agent":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.agents = draft.workflow.agents.map(agent =>
                                agent.name === action.name ? { ...agent, disabled: !agent.disabled } : agent
                            );
                            draft.chatKey++;
                            break;
                        case "set_main_agent":
                            if (isLive) {
                                break;
                            }
                            draft.workflow.startAgent = action.name;
                            draft.chatKey++;
                            break;
                    }
                }
            );

            newState = produce(state, draft => {
                draft.patches.splice(state.currentIndex);
                draft.inversePatches.splice(state.currentIndex);
                draft.patches.push(patches);
                draft.inversePatches.push(inversePatches);
                draft.currentIndex++;
                draft.present = nextState;
            });

        }
    }

    return newState;
}

export function WorkflowEditor({
    dataSources,
    workflow,
    publishedWorkflowId,
    handleShowSelector,
    handleCloneVersion,
}: {
    dataSources: WithStringId<z.infer<typeof DataSource>>[];
    workflow: WithStringId<z.infer<typeof Workflow>>;
    publishedWorkflowId: string | null;
    handleShowSelector: () => void;
    handleCloneVersion: (workflowId: string) => void;
}) {
    const [state, dispatch] = useReducer<Reducer<State, Action>>(reducer, {
        patches: [],
        inversePatches: [],
        currentIndex: 0,
        present: {
            publishing: false,
            selection: null,
            workflow: workflow,
            publishedWorkflowId: publishedWorkflowId,
            saving: false,
            publishError: null,
            publishSuccess: false,
            pendingChanges: false,
            chatKey: 0,
            lastUpdatedAt: workflow.lastUpdatedAt,
        }
    });
    const [chatMessages, setChatMessages] = useState<z.infer<typeof apiV1.ChatMessage>[]>([]);
    const updateChatMessages = useCallback((messages: z.infer<typeof apiV1.ChatMessage>[]) => {
        setChatMessages(messages);
    }, []);
    const saveQueue = useRef<z.infer<typeof Workflow>[]>([]);
    const saving = useRef(false);
    const isLive = state.present.workflow._id == state.present.publishedWorkflowId;
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [showCopilot, setShowCopilot] = useState(false);
    const [copilotWidth, setCopilotWidth] = useState(25);
    const [copilotKey, setCopilotKey] = useState(0);
    const [copilotMessages, setCopilotMessages] = useState<z.infer<typeof CopilotMessage>[]>([]);
    const [loadingResponse, setLoadingResponse] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("Thinking...");
    const [responseError, setResponseError] = useState<string | null>(null);

    console.log(`workflow editor chat key: ${state.present.chatKey}`);

    function handleSelectAgent(name: string) {
        dispatch({ type: "select_agent", name });
    }

    function handleSelectTool(name: string) {
        dispatch({ type: "select_tool", name });
    }

    function handleSelectPrompt(name: string) {
        dispatch({ type: "select_prompt", name });
    }

    function handleUnselectAgent() {
        dispatch({ type: "unselect_agent" });
    }

    function handleUnselectTool() {
        dispatch({ type: "unselect_tool" });
    }

    function handleUnselectPrompt() {
        dispatch({ type: "unselect_prompt" });
    }

    function handleAddAgent(agent: Partial<z.infer<typeof WorkflowAgent>> = {}) {
        dispatch({ type: "add_agent", agent });
    }

    function handleAddTool(tool: Partial<z.infer<typeof WorkflowTool>> = {}) {
        dispatch({ type: "add_tool", tool });
    }

    function handleAddPrompt(prompt: Partial<z.infer<typeof WorkflowPrompt>> = {}) {
        dispatch({ type: "add_prompt", prompt });
    }

    function handleUpdateAgent(name: string, agent: Partial<z.infer<typeof WorkflowAgent>>) {
        dispatch({ type: "update_agent", name, agent });
    }

    function handleDeleteAgent(name: string) {
        if (window.confirm(`Are you sure you want to delete the agent "${name}"?`)) {
            dispatch({ type: "delete_agent", name });
        }
    }

    function handleUpdateTool(name: string, tool: Partial<z.infer<typeof WorkflowTool>>) {
        dispatch({ type: "update_tool", name, tool });
    }

    function handleDeleteTool(name: string) {
        if (window.confirm(`Are you sure you want to delete the tool "${name}"?`)) {
            dispatch({ type: "delete_tool", name });
        }
    }

    function handleUpdatePrompt(name: string, prompt: Partial<z.infer<typeof WorkflowPrompt>>) {
        dispatch({ type: "update_prompt", name, prompt });
    }

    function handleDeletePrompt(name: string) {
        if (window.confirm(`Are you sure you want to delete the prompt "${name}"?`)) {
            dispatch({ type: "delete_prompt", name });
        }
    }

    function handleToggleAgent(name: string) {
        dispatch({ type: "toggle_agent", name });
    }

    function handleSetMainAgent(name: string) {
        dispatch({ type: "set_main_agent", name });
    }

    async function handleRenameWorkflow(name: string) {
        await renameWorkflow(state.present.workflow.projectId, state.present.workflow._id, name);
        dispatch({ type: "update_workflow_name", name });
    }

    async function handlePublishWorkflow() {
        dispatch({ type: "set_publishing", publishing: true });
        await publishWorkflow(state.present.workflow.projectId, state.present.workflow._id);
        dispatch({ type: "set_publishing", publishing: false });
        dispatch({ type: "set_published_workflow_id", workflowId: state.present.workflow._id });
    }

    function handleCopyJSON() {
        const { _id, projectId, ...workflow } = state.present.workflow;
        const json = JSON.stringify(workflow, null, 2);
        navigator.clipboard.writeText(json);
        setShowCopySuccess(true);
        setTimeout(() => {
            setShowCopySuccess(false);
        }, 1500);
    }

    const processQueue = useCallback(async (state: State, dispatch: React.Dispatch<Action>) => {
        if (saving.current || saveQueue.current.length === 0) return;

        saving.current = true;
        const workflowToSave = saveQueue.current[saveQueue.current.length - 1];
        saveQueue.current = [];

        try {
            if (isLive) {
                return;
            } else {
                await saveWorkflow(state.present.workflow.projectId, state.present.workflow._id, workflowToSave);
            }
        } finally {
            saving.current = false;
            if (saveQueue.current.length > 0) {
                processQueue(state, dispatch);
            } else {
                dispatch({ type: "set_saving", saving: false });
            }
        }
    }, [isLive]);

    useEffect(() => {
        if (state.present.pendingChanges && state.present.workflow) {
            saveQueue.current.push(state.present.workflow);
            const timeoutId = setTimeout(() => {
                dispatch({ type: "set_saving", saving: true });
                processQueue(state, dispatch);
            }, 2000);

            return () => clearTimeout(timeoutId);
        }
    }, [state.present.workflow, state.present.pendingChanges, processQueue, state]);

    return <div className="flex flex-col h-full relative">
        <div className="shrink-0 flex justify-between items-center pb-2">
            <div className="flex items-center gap-1 border-1 border-gray-200 rounded-md px-2 text-gray-800">
                <WorkflowIcon size={16} />
                <EditableField
                    key={state.present.workflow._id}
                    value={state.present.workflow?.name || ''}
                    onChange={handleRenameWorkflow}
                    placeholder="Name this version"
                    className="text-sm font-semibold"
                />
                {state.present.publishing && <Spinner size="sm" />}
                {isLive && <PublishedBadge />}
                <Dropdown>
                    <DropdownTrigger>
                        <button className="p-1 text-gray-400 hover:text-black">
                            <HamburgerIcon size={16} />
                        </button>
                    </DropdownTrigger>
                    <DropdownMenu
                        disabledKeys={[
                            ...(state.present.pendingChanges ? ['switch', 'clone'] : []),
                            ...(isLive ? ['publish'] : []),
                        ]}
                        onAction={(key) => {
                            if (key === 'switch') {
                                handleShowSelector();
                            }
                            if (key === 'clone') {
                                handleCloneVersion(state.present.workflow._id);
                            }
                            if (key === 'publish') {
                                handlePublishWorkflow();
                            }
                            if (key === 'clipboard') {
                                handleCopyJSON();
                            }
                        }}
                    >
                        <DropdownItem
                            key="switch"
                            startContent={<BackIcon size={16} />}
                        >
                            Switch version
                        </DropdownItem>
                        <DropdownItem
                            key="clone"
                            startContent={<Layers2Icon size={16} />}
                        >
                            Clone this version
                        </DropdownItem>
                        <DropdownItem
                            key="publish"
                            color="danger"
                            startContent={<RadioIcon size={16} />}
                        >
                            Deploy to Production
                        </DropdownItem>
                        <DropdownItem
                            key="clipboard"
                            startContent={<CopyIcon size={16} />}
                        >
                            Copy as JSON
                        </DropdownItem>
                    </DropdownMenu>
                </Dropdown>
            </div>
            {showCopySuccess && <div className="flex items-center gap-2">
                <div className="text-green-500">Copied to clipboard</div>
            </div>}
            <div className="flex items-center gap-2">
                {isLive && <div className="flex items-center gap-2">
                    <div className="bg-yellow-50 text-yellow-500 px-2 py-1 rounded-md text-sm">
                        This version is locked. You cannot make changes.
                    </div>
                    <Button
                        variant="bordered"
                        size="sm"
                        onClick={() => handleCloneVersion(state.present.workflow._id)}
                    >
                        Clone this version
                    </Button>
                </div>}
                {!isLive && <div className="text-xs text-gray-400">
                    {state.present.saving && <div className="flex items-center gap-1">
                        <Spinner size="sm" />
                        <div>Saving...</div>
                    </div>}
                    {!state.present.saving && state.present.workflow && <div>
                        Updated <RelativeTime date={new Date(state.present.lastUpdatedAt)} />
                    </div>}
                </div>}
                {!isLive && <>
                    <button
                        className="p-1 text-gray-400 hover:text-black hover:cursor-pointer"
                        title="Undo"
                        disabled={state.currentIndex <= 0}
                        onClick={() => dispatch({ type: "undo" })}
                    >
                        <UndoIcon size={16} />
                    </button>
                    <button
                        className="p-1 text-gray-400 hover:text-black hover:cursor-pointer"
                        title="Redo"
                        disabled={state.currentIndex >= state.patches.length}
                        onClick={() => dispatch({ type: "redo" })}
                    >
                        <RedoIcon size={16} />
                    </button>
                    <button
                        className="p-1 text-blue-600 hover:text-blue-800 hover:cursor-pointer"
                        title="Toggle Copilot"
                        onClick={() => setShowCopilot(!showCopilot)}
                    >
                        <Sparkles size={16} />
                    </button>
                </>}
            </div>
        </div>
        <ResizablePanelGroup direction="horizontal" className="grow flex overflow-auto gap-1">
            <ResizablePanel minSize={10} defaultSize={15}>
                <EntityList
                    agents={state.present.workflow.agents}
                    tools={state.present.workflow.tools}
                    prompts={state.present.workflow.prompts}
                    selectedEntity={state.present.selection}
                    startAgentName={state.present.workflow.startAgent}
                    onSelectAgent={handleSelectAgent}
                    onSelectTool={handleSelectTool}
                    onSelectPrompt={handleSelectPrompt}
                    onAddAgent={handleAddAgent}
                    onAddTool={handleAddTool}
                    onAddPrompt={handleAddPrompt}
                    onToggleAgent={handleToggleAgent}
                    onSetMainAgent={handleSetMainAgent}
                    onDeleteAgent={handleDeleteAgent}
                    onDeleteTool={handleDeleteTool}
                    onDeletePrompt={handleDeletePrompt}
                />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel 
                minSize={20} 
                defaultSize={showCopilot ? 85 - copilotWidth : 85} 
                className="overflow-auto"
            >
                <ChatApp
                    key={'' + state.present.chatKey}
                    hidden={state.present.selection !== null}
                    projectId={state.present.workflow.projectId}
                    workflow={state.present.workflow}
                    messageSubscriber={updateChatMessages}
                />
                {state.present.selection?.type === "agent" && <AgentConfig
                    key={state.present.selection.name}
                    agent={state.present.workflow.agents.find((agent) => agent.name === state.present.selection!.name)!}
                    usedAgentNames={new Set(state.present.workflow.agents.filter((agent) => agent.name !== state.present.selection!.name).map((agent) => agent.name))}
                    agents={state.present.workflow.agents}
                    tools={state.present.workflow.tools}
                    prompts={state.present.workflow.prompts}
                    dataSources={dataSources}
                    handleUpdate={handleUpdateAgent.bind(null, state.present.selection.name)}
                    handleClose={handleUnselectAgent}
                />}
                {state.present.selection?.type === "tool" && <ToolConfig
                    key={state.present.selection.name}
                    tool={state.present.workflow.tools.find((tool) => tool.name === state.present.selection!.name)!}
                    usedToolNames={new Set(state.present.workflow.tools.filter((tool) => tool.name !== state.present.selection!.name).map((tool) => tool.name))}
                    handleUpdate={handleUpdateTool.bind(null, state.present.selection.name)}
                    handleClose={handleUnselectTool}
                />}
                {state.present.selection?.type === "prompt" && <PromptConfig
                    key={state.present.selection.name}
                    prompt={state.present.workflow.prompts.find((prompt) => prompt.name === state.present.selection!.name)!}
                    agents={state.present.workflow.agents}
                    tools={state.present.workflow.tools}
                    prompts={state.present.workflow.prompts}
                    usedPromptNames={new Set(state.present.workflow.prompts.filter((prompt) => prompt.name !== state.present.selection!.name).map((prompt) => prompt.name))}
                    handleUpdate={handleUpdatePrompt.bind(null, state.present.selection.name)}
                    handleClose={handleUnselectPrompt}
                />}
            </ResizablePanel>
            {showCopilot && <>
                <ResizableHandle />
                <ResizablePanel 
                    minSize={10} 
                    defaultSize={copilotWidth}
                    onResize={(size) => setCopilotWidth(size)}
                >
                    <Copilot
                        key={copilotKey}
                        projectId={state.present.workflow.projectId}
                        workflow={state.present.workflow}
                        dispatch={dispatch}
                        chatContext={
                            state.present.selection ? {
                                type: state.present.selection.type,
                                name: state.present.selection.name
                            } : chatMessages.length > 0 ? {
                                type: 'chat',
                                messages: chatMessages
                            } : undefined
                        }
                        onNewChat={() => {
                            setCopilotKey(prev => prev + 1);
                            setCopilotMessages([]);
                            setLoadingResponse(false);
                            setLoadingMessage("Thinking...");
                            setResponseError(null);
                        }}
                        messages={copilotMessages}
                        setMessages={setCopilotMessages}
                        loadingResponse={loadingResponse}
                        setLoadingResponse={setLoadingResponse}
                        loadingMessage={loadingMessage}
                        setLoadingMessage={setLoadingMessage}
                        responseError={responseError}
                        setResponseError={setResponseError}
                    />
                </ResizablePanel>
            </>}
        </ResizablePanelGroup>
    </div>;
}
