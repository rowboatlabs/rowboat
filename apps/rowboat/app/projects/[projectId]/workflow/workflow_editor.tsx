"use client";
import React, { useReducer, Reducer, useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { MCPServer, Message, WithStringId } from "../../../lib/types/types";
import { Workflow, WorkflowTool, WorkflowPrompt, WorkflowAgent, WorkflowPipeline } from "../../../lib/types/workflow_types";
import { DataSource } from "@/src/entities/models/data-source";
import { Project } from "@/src/entities/models/project";
import { produce, applyPatches, enablePatches, produceWithPatches, Patch } from 'immer';
import { AgentConfig } from "../entities/agent_config";
import { PipelineConfig } from "../entities/pipeline_config";
import { ToolConfig } from "../entities/tool_config";
import { App as ChatApp } from "../playground/app";
import { z } from "zod";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
import { PromptConfig } from "../entities/prompt_config";
import { DataSourceConfig } from "../entities/datasource_config";
import { RelativeTime } from "@primer/react";
import { USE_PRODUCT_TOUR, USE_CHAT_WIDGET } from "@/app/lib/feature_flags";

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Copilot } from "../copilot/app";
import { publishWorkflow } from "@/app/actions/project.actions";
import { saveWorkflow } from "@/app/actions/project.actions";
import { updateProjectName } from "@/app/actions/project.actions";
import { listProjects } from "@/app/actions/project.actions";
import { BackIcon, HamburgerIcon, WorkflowIcon } from "../../../lib/components/icons";
import { CopyIcon, ImportIcon, RadioIcon, RedoIcon, ServerIcon, Sparkles, UndoIcon, RocketIcon, PenLine, AlertTriangle, DownloadIcon, XIcon, SettingsIcon, ChevronDownIcon, PhoneIcon, MessageCircleIcon, ZapIcon } from "lucide-react";
import { EntityList } from "./entity_list";
import { ProductTour } from "@/components/common/product-tour";
import { ModelsResponse } from "@/app/lib/types/billing_types";
import { AgentGraphVisualizer } from "../entities/AgentGraphVisualizer";
import { Panel } from "@/components/common/panel-common";
import { Button as CustomButton } from "@/components/ui/button";

import { InputField } from "@/app/lib/components/input-field";
import { VoiceSection } from "../config/components/voice";
import { TopBar } from "./components/TopBar";

enablePatches();

const PANEL_RATIOS = {
    entityList: 25,    // Left panel
    chatApp: 40,       // Middle panel
    copilot: 35        // Right panel
} as const;

interface StateItem {
    workflow: z.infer<typeof Workflow>;
    publishing: boolean;
    selection: {
        type: "agent" | "tool" | "prompt" | "datasource" | "pipeline" | "visualise";
        name: string;
    } | null;
    saving: boolean;
    publishError: string | null;
    publishSuccess: boolean;
    pendingChanges: boolean;
    chatKey: number;
    lastUpdatedAt: string;
    isLive: boolean;
    showWorkflowChangeBanner: boolean;
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
    type: "switch_to_draft_due_to_changes";
} | {
    type: "show_workflow_change_banner";
} | {
    type: "clear_workflow_change_banner";
} | {
    type: "set_is_live";
    isLive: boolean;
} | {
    type: "set_publishing";
    publishing: boolean;
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
    type: "add_prompt_no_select";
    prompt: Partial<z.infer<typeof WorkflowPrompt>>;
} | {
    type: "add_pipeline";
    pipeline: Partial<z.infer<typeof WorkflowPipeline>>;
    defaultModel?: string;
} | {
    type: "select_agent";
    name: string;
} | {
    type: "select_tool";
    name: string;
} | {
    type: "select_pipeline";
    name: string;
} | {
    type: "delete_agent";
    name: string;
} | {
    type: "delete_tool";
    name: string;
} | {
    type: "delete_pipeline";
    name: string;
} | {
    type: "update_pipeline";
    name: string;
    pipeline: Partial<z.infer<typeof WorkflowPipeline>>;
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
    type: "unselect_pipeline";
} | {
    type: "delete_prompt";
    name: string;
} | {
    type: "update_prompt";
    name: string;
    prompt: Partial<z.infer<typeof WorkflowPrompt>>;
} | {
    type: "update_prompt_no_select";
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
} | {
    type: "reorder_agents";
    agents: z.infer<typeof WorkflowAgent>[];
} | {
    type: "reorder_pipelines";
    pipelines: z.infer<typeof WorkflowPipeline>[];
} | {
    type: "select_datasource";
    id: string;
} | {
    type: "unselect_datasource";
} | {
    type: "show_visualise";
} | {
    type: "hide_visualise";
};

function reducer(state: State, action: Action): State {
    let newState: State;

    if (action.type === "restore_state") {
        return {
            present: action.state,
            patches: [],
            inversePatches: [],
            currentIndex: 0
        };
    }

    const isLive = state.present.isLive;

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
        case "set_publishing": {
            newState = produce(state, draft => {
                draft.present.publishing = action.publishing;
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
        case "switch_to_draft_due_to_changes": {
            newState = produce(state, draft => {
                draft.present.isLive = false;
            });
            break;
        }
        case "set_is_live": {
            newState = produce(state, draft => {
                draft.present.isLive = action.isLive;
            });
            break;
        }
        case "clear_workflow_change_banner": {
            newState = produce(state, draft => {
                draft.present.showWorkflowChangeBanner = false;
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
        case "reorder_agents": {
            const newState = produce(state.present, draft => {
                draft.workflow.agents = action.agents;
                draft.lastUpdatedAt = new Date().toISOString();
            });
            const [nextState, patches, inversePatches] = produceWithPatches(state.present, draft => {
                draft.workflow.agents = action.agents;
                draft.lastUpdatedAt = new Date().toISOString();
            });
            return {
                ...state,
                present: nextState,
                patches: [...state.patches.slice(0, state.currentIndex), patches],
                inversePatches: [...state.inversePatches.slice(0, state.currentIndex), inversePatches],
                currentIndex: state.currentIndex + 1,
            };
        }
        case "reorder_pipelines": {
            const newState = produce(state.present, draft => {
                draft.workflow.pipelines = action.pipelines;
                draft.lastUpdatedAt = new Date().toISOString();
            });
            const [nextState, patches, inversePatches] = produceWithPatches(state.present, draft => {
                draft.workflow.pipelines = action.pipelines;
                draft.lastUpdatedAt = new Date().toISOString();
            });
            return {
                ...state,
                present: nextState,
                patches: [...state.patches.slice(0, state.currentIndex), patches],
                inversePatches: [...state.inversePatches.slice(0, state.currentIndex), inversePatches],
                currentIndex: state.currentIndex + 1,
            };
        }
        case "show_visualise": {
            newState = produce(state, draft => {
                draft.present.selection = { type: "visualise", name: "visualise" };
            });
            break;
        }
        case "hide_visualise": {
            newState = produce(state, draft => {
                draft.present.selection = null;
            });
            break;
        }
        default: {
            // Check if this is a workflow modification action in live mode
            const isWorkflowModification = [
                "add_agent", "add_tool", "add_prompt", "add_prompt_no_select", "add_pipeline",
                "update_agent", "update_tool", "update_prompt", "update_prompt_no_select", "update_pipeline",
                "delete_agent", "delete_tool", "delete_prompt", "delete_pipeline",
                "toggle_agent", "set_main_agent", "reorder_agents", "reorder_pipelines"
            ].includes(action.type);

            const [nextState, patches, inversePatches] = produceWithPatches(
                state.present,
                (draft) => {
                    // If this is a workflow modification in live mode, switch to draft
                    if (isWorkflowModification && isLive) {
                        draft.isLive = false;
                        draft.showWorkflowChangeBanner = true;
                    }
                    
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
                        case "select_pipeline":
                            draft.selection = {
                                type: "pipeline",
                                name: action.name
                            };
                            break;
                        case "select_datasource":
                            draft.selection = {
                                type: "datasource",
                                name: action.id
                            };
                            break;
                        case "unselect_agent":
                        case "unselect_tool":
                        case "unselect_prompt":
                        case "unselect_datasource":
                        case "unselect_pipeline":
                            draft.selection = null;
                            break;
                        case "add_agent": {
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
                                model: "",
                                locked: false,
                                toggleAble: true,
                                ragReturnType: "chunks",
                                ragK: 3,
                                controlType: "retain",
                                outputVisibility: "user_facing",
                                maxCallsPerParentAgent: 3,
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
                            let newToolName = "new_tool";
                            if (draft.workflow?.tools.some((tool) => tool.name === newToolName)) {
                                newToolName = `new_tool_${draft.workflow.tools.filter((tool) =>
                                    tool.name.startsWith("new_tool")).length + 1}`;
                            }
                            draft.workflow?.tools.push({
                                name: newToolName,
                                description: "",
                                parameters: {
                                    type: 'object',
                                    properties: {},
                                    required: []
                                },
                                mockTool: false,
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
                            let newPromptName = "New Variable";
                            if (draft.workflow?.prompts.some((prompt) => prompt.name === newPromptName)) {
                                newPromptName = `New Variable ${draft.workflow?.prompts.filter((prompt) =>
                                    prompt.name.startsWith("New Variable")).length + 1}`;
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
                        case "add_prompt_no_select": {
                            let newPromptName = "New Variable";
                            if (draft.workflow?.prompts.some((prompt) => prompt.name === newPromptName)) {
                                newPromptName = `New Variable ${draft.workflow?.prompts.filter((prompt) =>
                                    prompt.name.startsWith("New Variable")).length + 1}`;
                            }
                            draft.workflow?.prompts.push({
                                name: newPromptName,
                                type: "base_prompt",
                                prompt: "",
                                ...action.prompt
                            });
                            // Don't set selection - this is the key difference
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        // TODO: parameterize this instead of writing if else based on pipeline length (pipelineAgents.length)
                        case "add_pipeline": {
                            
                            if (!draft.workflow.pipelines) {
                                draft.workflow.pipelines = [];
                            }
                            
                            // 1. ✅ Create the pipeline definition FIRST with the action data
                            const pipelineName = action.pipeline.name || "New pipeline";
                            const pipelineDescription = action.pipeline.description || "";
                            let pipelineAgents = action.pipeline.agents || [];
                            
                            // 2. ✅ Handle manual creation (no agents provided) vs copilot creation (agents provided)
                            if (pipelineAgents.length === 0) {
                                // Manual creation: create a default first agent to prevent 0-step pipelines
                                const defaultAgentName = `${pipelineName} Step 1`;
                                pipelineAgents = [defaultAgentName];
                                
                                // Create the default agent
                                draft.workflow.agents.push({
                                    name: defaultAgentName,
                                    type: "pipeline",
                                    description: `Default agent for ${pipelineName} pipeline`,
                                    disabled: false,
                                    instructions: `You are the first step in the ${pipelineName} pipeline. Focus on your specific role.`,
                                    model: action.defaultModel || "gpt-4.1",
                                    locked: false,
                                    toggleAble: true,
                                    ragReturnType: "chunks",
                                    ragK: 3,
                                    controlType: "relinquish_to_parent",
                                    outputVisibility: "internal",
                                    maxCallsPerParentAgent: 3,
                                });
                            } else {
                                // Copilot creation: ensure all referenced agents exist
                                for (const agentName of pipelineAgents) {
                                    const existingAgent = draft.workflow.agents.find(a => a.name === agentName);
                                    if (!existingAgent) {
                                        // Create the agent with proper pipeline type
                                        draft.workflow.agents.push({
                                            name: agentName,
                                            type: "pipeline",
                                            description: `Agent for ${pipelineName} pipeline`,
                                            disabled: false,
                                            instructions: `You are part of the ${pipelineName} pipeline. Focus on your specific role.`,
                                            model: action.defaultModel || "gpt-4.1",
                                            locked: false,
                                            toggleAble: true,
                                            ragReturnType: "chunks",
                                            ragK: 3,
                                            controlType: "relinquish_to_parent",
                                            outputVisibility: "internal",
                                            maxCallsPerParentAgent: 3,
                                        });
                                    }
                                }
                            }
                            
                            // 3. ✅ Create the pipeline with the agents
                            draft.workflow.pipelines.push({
                                name: pipelineName,
                                description: pipelineDescription,
                                agents: pipelineAgents,
                                ...action.pipeline
                            });
                            
                            // 4. ✅ Select the first agent for configuration
                            if (pipelineAgents.length > 0) {
                                draft.selection = {
                                    type: "agent",
                                    name: pipelineAgents[0]
                                };
                            }
                            
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        case "delete_agent":
                            // Remove the agent
                            draft.workflow.agents = draft.workflow.agents.filter(
                                (agent) => agent.name !== action.name
                            );
                            
                            // Update references to deleted agent in other agents' instructions
                            draft.workflow.agents = draft.workflow.agents.map(agent => ({
                                ...agent,
                                instructions: agent.instructions.replace(
                                    new RegExp(`\\[@agent:${action.name}\\]\\(#mention\\)`, 'g'),
                                    ''
                                )
                            }));
                            
                            // Update references in prompts
                            draft.workflow.prompts = draft.workflow.prompts.map(prompt => ({
                                ...prompt,
                                prompt: prompt.prompt.replace(
                                    new RegExp(`\\[@agent:${action.name}\\]\\(#mention\\)`, 'g'),
                                    ''
                                )
                            }));
                            
                            // Update references in pipelines
                            if (draft.workflow.pipelines) {
                                draft.workflow.pipelines = draft.workflow.pipelines.map(pipeline => ({
                                    ...pipeline,
                                    agents: pipeline.agents.filter(agentName => agentName !== action.name)
                                }));
                            }
                            
                            // Update start agent if it was the deleted agent
                            if (draft.workflow.startAgent === action.name) {
                                // Set to first available agent, or empty string if no agents left
                                draft.workflow.startAgent = draft.workflow.agents.length > 0 
                                    ? draft.workflow.agents[0].name 
                                    : '';
                            }
                            
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "delete_tool":
                            draft.workflow.tools = draft.workflow.tools.filter(
                                (tool) => tool.name !== action.name
                            );
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "delete_prompt":
                            draft.workflow.prompts = draft.workflow.prompts.filter(
                                (prompt) => prompt.name !== action.name
                            );
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "delete_pipeline":
                            if (draft.workflow.pipelines) {
                                // Find the pipeline to get its associated agents
                                const pipelineToDelete = draft.workflow.pipelines.find(
                                    (pipeline) => pipeline.name === action.name
                                );
                                
                                if (pipelineToDelete) {
                                    // Remove all agents that belong to this pipeline
                                    const agentsToDelete = pipelineToDelete.agents || [];
                                    
                                    // Check if startAgent is one of the agents being deleted
                                    const startAgentBeingDeleted = agentsToDelete.includes(draft.workflow.startAgent);
                                    
                                    draft.workflow.agents = draft.workflow.agents.filter(
                                        (agent) => !agentsToDelete.includes(agent.name)
                                    );
                                    
                                    // Update references to deleted agents in other agents' instructions
                                    agentsToDelete.forEach(agentName => {
                                        draft.workflow.agents = draft.workflow.agents.map(agent => ({
                                            ...agent,
                                            instructions: agent.instructions.replace(
                                                new RegExp(`\\[@agent:${agentName}\\]\\(#mention\\)`, 'g'),
                                                ''
                                            )
                                        }));
                                        
                                        // Update references in prompts
                                        draft.workflow.prompts = draft.workflow.prompts.map(prompt => ({
                                            ...prompt,
                                            prompt: prompt.prompt.replace(
                                                new RegExp(`\\[@agent:${agentName}\\]\\(#mention\\)`, 'g'),
                                                ''
                                            )
                                        }));
                                    });
                                    
                                    // Update start agent if it was one of the deleted agents (same logic as regular agent deletion)
                                    if (startAgentBeingDeleted) {
                                        // Set to first available agent, or empty string if no agents left
                                        draft.workflow.startAgent = draft.workflow.agents.length > 0 
                                            ? draft.workflow.agents[0].name 
                                            : '';
                                    }
                                }
                                
                                // Remove the pipeline itself
                                draft.workflow.pipelines = draft.workflow.pipelines.filter(
                                    (pipeline) => pipeline.name !== action.name
                                );
                            }
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "update_pipeline": {
                            if (draft.workflow.pipelines) {
                                draft.workflow.pipelines = draft.workflow.pipelines.map(pipeline =>
                                    pipeline.name === action.name ? { ...pipeline, ...action.pipeline } : pipeline
                                );
                            }
                            draft.selection = null;
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        case "update_agent": {

                            // update agent data
                            draft.workflow.agents = draft.workflow.agents.map((agent) =>
                                agent.name === action.name ? { ...agent, ...action.agent } : agent
                            );

                            // if the agent is renamed
                            if (action.agent.name && action.agent.name !== action.name) {
                                // update start agent pointer if this is the start agent
                                if (action.agent.name && draft.workflow.startAgent === action.name) {
                                    draft.workflow.startAgent = action.agent.name;
                                }

                                // update this agents references in other agents / prompts
                                draft.workflow.agents = draft.workflow.agents.map(agent => ({
                                    ...agent,
                                    instructions: agent.instructions.replace(
                                        `[@agent:${action.name}](#mention)`,
                                        `[@agent:${action.agent.name}](#mention)`
                                    )
                                }));
                                draft.workflow.prompts = draft.workflow.prompts.map(prompt => ({
                                    ...prompt,
                                    prompt: prompt.prompt.replace(
                                        `[@agent:${action.name}](#mention)`,
                                        `[@agent:${action.agent.name}](#mention)`
                                    )
                                }));

                                // update pipeline references if this agent is part of any pipeline
                                if (draft.workflow.pipelines) {
                                    draft.workflow.pipelines = draft.workflow.pipelines.map(pipeline => ({
                                        ...pipeline,
                                        agents: pipeline.agents.map(agentName => 
                                            agentName === action.name ? action.agent.name! : agentName
                                        )
                                    }));
                                }

                                // update the selection pointer if this is the selected agent
                                if (draft.selection?.type === "agent" && draft.selection.name === action.name) {
                                    draft.selection = {
                                        type: "agent",
                                        name: action.agent.name
                                    };
                                }
                            }

                            // select this agent
                            draft.selection = {
                                type: "agent",
                                name: action.agent.name || action.name,
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        }
                        case "update_tool":

                            // update tool data
                            draft.workflow.tools = draft.workflow.tools.map((tool) =>
                                tool.name === action.name ? { ...tool, ...action.tool } : tool
                            );

                            // if the tool is renamed
                            if (action.tool.name && action.tool.name !== action.name) {
                                // update this tools references in other agents / prompts
                                draft.workflow.agents = draft.workflow.agents.map(agent => ({
                                    ...agent,
                                    instructions: agent.instructions.replace(
                                        `[@tool:${action.name}](#mention)`,
                                        `[@tool:${action.tool.name}](#mention)`
                                    )
                                }));
                                draft.workflow.prompts = draft.workflow.prompts.map(prompt => ({
                                    ...prompt,
                                    prompt: prompt.prompt.replace(
                                        `[@tool:${action.name}](#mention)`,
                                        `[@tool:${action.tool.name}](#mention)`
                                    )
                                }));

                                // if this is the selected tool, update the selection
                                if (draft.selection?.type === "tool" && draft.selection.name === action.name) {
                                    draft.selection = {
                                        type: "tool",
                                        name: action.tool.name
                                    };
                                }
                            }

                            // select this tool
                            draft.selection = {
                                type: "tool",
                                name: action.tool.name || action.name,
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "update_prompt":

                            // update prompt data
                            draft.workflow.prompts = draft.workflow.prompts.map((prompt) =>
                                prompt.name === action.name ? { ...prompt, ...action.prompt } : prompt
                            );

                            // if the prompt is renamed
                            if (action.prompt.name && action.prompt.name !== action.name) {
                                // update this prompts references in other agents / prompts
                                draft.workflow.agents = draft.workflow.agents.map(agent => ({
                                    ...agent,
                                    instructions: agent.instructions.replace(
                                        `[@prompt:${action.name}](#mention)`,
                                        `[@prompt:${action.prompt.name}](#mention)`
                                    )
                                }));
                                draft.workflow.prompts = draft.workflow.prompts.map(prompt => ({
                                    ...prompt,
                                    prompt: prompt.prompt.replace(
                                        `[@prompt:${action.name}](#mention)`,
                                        `[@prompt:${action.prompt.name}](#mention)`
                                    )
                                }));

                                // if this is the selected prompt, update the selection
                                if (draft.selection?.type === "prompt" && draft.selection.name === action.name) {
                                    draft.selection = {
                                        type: "prompt",
                                        name: action.prompt.name
                                    };
                                }
                            }

                            // select this prompt
                            draft.selection = {
                                type: "prompt",
                                name: action.prompt.name || action.name,
                            };
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "update_prompt_no_select":

                            // update prompt data
                            draft.workflow.prompts = draft.workflow.prompts.map((prompt) =>
                                prompt.name === action.name ? { ...prompt, ...action.prompt } : prompt
                            );

                            // if the prompt is renamed
                            if (action.prompt.name && action.prompt.name !== action.name) {
                                // update this prompts references in other agents / prompts
                                draft.workflow.agents = draft.workflow.agents.map(agent => ({
                                    ...agent,
                                    instructions: agent.instructions.replace(
                                        `[@prompt:${action.name}](#mention)`,
                                        `[@prompt:${action.prompt.name}](#mention)`
                                    )
                                }));
                                draft.workflow.prompts = draft.workflow.prompts.map(prompt => ({
                                    ...prompt,
                                    prompt: prompt.prompt.replace(
                                        `[@prompt:${action.name}](#mention)`,
                                        `[@prompt:${action.prompt.name}](#mention)`
                                    )
                                }));

                                // if this is the selected prompt, update the selection
                                if (draft.selection?.type === "prompt" && draft.selection.name === action.name) {
                                    draft.selection = {
                                        type: "prompt",
                                        name: action.prompt.name
                                    };
                                }
                            }

                            // Don't set selection - this is the key difference
                            draft.pendingChanges = true;
                            draft.chatKey++;
                            break;
                        case "toggle_agent":
                            draft.workflow.agents = draft.workflow.agents.map(agent =>
                                agent.name === action.name ? { ...agent, disabled: !agent.disabled } : agent
                            );
                            draft.chatKey++;
                            break;
                        case "set_main_agent":
                            draft.workflow.startAgent = action.name;
                            draft.pendingChanges = true;
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

// Context for entity selection
export const EntitySelectionContext = createContext<{
    onSelectAgent: (name: string) => void;
    onSelectTool: (name: string) => void;
    onSelectPrompt: (name: string) => void;
} | null>(null);

export function useEntitySelection() {
    const ctx = useContext(EntitySelectionContext);
    if (!ctx) throw new Error('useEntitySelection must be used within EntitySelectionContext');
    return ctx;
}

export function WorkflowEditor({
    projectId,
    dataSources,
    workflow,
    useRag,
    useRagUploads,
    useRagS3Uploads,
    useRagScraping,
    defaultModel,
    projectConfig,
    eligibleModels,
    isLive,
    onChangeMode,
    onRevertToLive,
    onProjectToolsUpdated,
    onDataSourcesUpdated,
    onProjectConfigUpdated,
    chatWidgetHost,
}: {
    projectId: string;
    dataSources: z.infer<typeof DataSource>[];
    workflow: z.infer<typeof Workflow>;
    useRag: boolean;
    useRagUploads: boolean;
    useRagS3Uploads: boolean;
    useRagScraping: boolean;
    defaultModel: string;
    projectConfig: z.infer<typeof Project>;
    eligibleModels: z.infer<typeof ModelsResponse> | "*";
    isLive: boolean;
    onChangeMode: (mode: 'draft' | 'live') => void;
    onRevertToLive: () => void;
    onProjectToolsUpdated?: () => void;
    onDataSourcesUpdated?: () => void;
    onProjectConfigUpdated?: () => void;
    chatWidgetHost: string;
}) {

    const [state, dispatch] = useReducer(reducer, {
        patches: [],
        inversePatches: [],
        currentIndex: 0,
        present: {
            publishing: false,
            selection: null,
            workflow: workflow,
            saving: false,
            publishError: null,
            publishSuccess: false,
            pendingChanges: false,
            chatKey: 0,
            lastUpdatedAt: workflow.lastUpdatedAt,
            isLive,
            showWorkflowChangeBanner: false,
        }
    });

    const [chatMessages, setChatMessages] = useState<z.infer<typeof Message>[]>([]);
    const updateChatMessages = useCallback((messages: z.infer<typeof Message>[]) => {
        setChatMessages(messages);
    }, []);
    const saveQueue = useRef<z.infer<typeof Workflow>[]>([]);
    const saving = useRef(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [activePanel, setActivePanel] = useState<'playground' | 'copilot'>('copilot');
    const [isInitialState, setIsInitialState] = useState(true);
    const [showBuildModeBanner, setShowBuildModeBanner] = useState(false);
    const [showTour, setShowTour] = useState(true);
    const copilotRef = useRef<{ handleUserMessage: (message: string) => void }>(null);
    const entityListRef = useRef<{ openDataSourcesModal: () => void } | null>(null);
    
    // Modal state for revert confirmation
    const { isOpen: isRevertModalOpen, onOpen: onRevertModalOpen, onClose: onRevertModalClose } = useDisclosure();
    
    // Modal state for phone/Twilio configuration
    const { isOpen: isPhoneModalOpen, onOpen: onPhoneModalOpen, onClose: onPhoneModalClose } = useDisclosure();
    
    // Modal state for chat widget configuration
    const { isOpen: isChatWidgetModalOpen, onOpen: onChatWidgetModalOpen, onClose: onChatWidgetModalClose } = useDisclosure();
    
    // Project name state
    const [localProjectName, setLocalProjectName] = useState<string>(projectConfig.name || '');
    const [projectNameError, setProjectNameError] = useState<string | null>(null);
    const [isEditingProjectName, setIsEditingProjectName] = useState<boolean>(false);
    const [pendingProjectName, setPendingProjectName] = useState<string | null>(null);

    // Load agent order from localStorage on mount
    // useEffect(() => {
    //     const mode = isLive ? 'live' : 'draft';
    //     const storedOrder = localStorage.getItem(`${mode}_workflow_${projectId}_agent_order`);
    //     if (storedOrder) {
    //         try {
    //             const orderMap = JSON.parse(storedOrder);
    //             const orderedAgents = [...workflow.agents].sort((a, b) => {
    //                 const orderA = orderMap[a.name] ?? Number.MAX_SAFE_INTEGER;
    //                 const orderB = orderMap[b.name] ?? Number.MAX_SAFE_INTEGER;
    //                 return orderA - orderB;
    //             });
    //             if (JSON.stringify(orderedAgents) !== JSON.stringify(workflow.agents)) {
    //                 dispatch({ type: "reorder_agents", agents: orderedAgents });
    //             }
    //         } catch (e) {
    //             console.error("Error loading agent order:", e);
    //         }
    //     }
    // }, [workflow.agents, isLive, projectId]);

    // Function to trigger copilot chat
    const triggerCopilotChat = useCallback((message: string) => {
        setActivePanel('copilot');
        // Small delay to ensure copilot is mounted
        setTimeout(() => {
            copilotRef.current?.handleUserMessage(message);
        }, 100);
    }, []);

    const handleOpenDataSourcesModal = useCallback(() => {
        entityListRef.current?.openDataSourcesModal();
    }, []);

    console.log(`workflow editor chat key: ${state.present.chatKey}`);

    // Auto-show copilot and increment key when prompt is present
    useEffect(() => {
        const prompt = localStorage.getItem(`project_prompt_${projectId}`);
        console.log('init project prompt', prompt);
        if (prompt) {
            setActivePanel('copilot');
        }
    }, [projectId]);

    // Switch to playground when switching to live mode
    useEffect(() => {
        if (isLive) {
            setActivePanel('playground');
        }
    }, [isLive]);

    // If reducer switched to draft (internal flag) while outer prop is still live,
    // trigger external mode change and show banner. Guard against publish in-flight.
    useEffect(() => {
        if (isLive && state.present.isLive === false && !state.present.publishing) {
            onChangeMode('draft');
            setShowBuildModeBanner(true);
            setTimeout(() => setShowBuildModeBanner(false), 5000);
        }
    }, [isLive, state.present.isLive, state.present.publishing, onChangeMode]);

    // Show banner when switching from live to draft due to workflow changes
    useEffect(() => {
        if (state.present.showWorkflowChangeBanner) {
            setShowBuildModeBanner(true);
            // Auto-hide banner after 5 seconds
            setTimeout(() => setShowBuildModeBanner(false), 5000);
            // Clear the flag
            dispatch({ type: "clear_workflow_change_banner" });
        }
    }, [state.present.showWorkflowChangeBanner]);

    // Reset initial state when user interacts with copilot or opens other menus
    useEffect(() => {
        if (state.present.selection !== null) {
            setIsInitialState(false);
        }
    }, [state.present.selection]);

    // Track copilot actions
    useEffect(() => {
        if (state.present.pendingChanges && state.present.workflow) {
            setIsInitialState(false);
        }
    }, [state.present.workflow, state.present.pendingChanges]);

    function handleSelectAgent(name: string) {
        dispatch({ type: "select_agent", name });
    }

    function handleSelectTool(name: string) {
        dispatch({ type: "select_tool", name });
    }

    function handleSelectPrompt(name: string) {
        dispatch({ type: "select_prompt", name });
    }
    function handleSelectDataSource(id: string) {
        dispatch({ type: "select_datasource", id });
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
    
    function handleShowVisualise() {
        dispatch({ type: "show_visualise" });
    }
    
    function handleHideVisualise() {
        dispatch({ type: "hide_visualise" });
    }

    function handleAddAgent(agent: Partial<z.infer<typeof WorkflowAgent>> = {}) {
        const agentWithModel = {
            ...agent,
            model: agent.model || defaultModel || "gpt-4.1"
        };
        dispatchGuarded({ type: "add_agent", agent: agentWithModel });
    }

    function handleAddTool(tool: Partial<z.infer<typeof WorkflowTool>> = {}) {
        dispatchGuarded({ type: "add_tool", tool });
    }

    function handleAddPrompt(prompt: Partial<z.infer<typeof WorkflowPrompt>> = {}) {
        dispatchGuarded({ type: "add_prompt", prompt });
    }

    function handleSelectPipeline(name: string) {
        dispatch({ type: "select_pipeline", name });
    }

    function handleAddPipeline(pipeline: Partial<z.infer<typeof WorkflowPipeline>> = {}) {
        dispatchGuarded({ type: "add_pipeline", pipeline, defaultModel });
    }

    function handleDeletePipeline(name: string) {
        if (window.confirm(`Are you sure you want to delete the pipeline "${name}"?`)) {
            dispatch({ type: "delete_pipeline", name });
        }
    }

    function handleAddAgentToPipeline(pipelineName: string) {
        // Create a pipeline agent and add it to the specified pipeline
        const newAgentName = `${pipelineName} Step ${(state.present.workflow.pipelines?.find(p => p.name === pipelineName)?.agents.length || 0) + 1}`;
        
        const agentWithModel = {
            name: newAgentName,
            type: 'pipeline' as const,
            outputVisibility: 'internal' as const,
            model: defaultModel || "gpt-4.1"
        };
        
        // First add the agent
        dispatchGuarded({ type: "add_agent", agent: agentWithModel });
        
        // Then add it to the pipeline
        const pipeline = state.present.workflow.pipelines?.find(p => p.name === pipelineName);
        if (pipeline) {
            dispatchGuarded({ 
                type: "update_pipeline", 
                name: pipelineName, 
                pipeline: { 
                    ...pipeline, 
                    agents: [...pipeline.agents, newAgentName] 
                } 
            });
        }
        
        // Select the newly created agent to open it in agent_config
        dispatch({ type: "select_agent", name: newAgentName });
    }

    function handleUpdateAgent(name: string, agent: Partial<z.infer<typeof WorkflowAgent>>) {
        dispatch({ type: "update_agent", name, agent });
    }

    function handleUpdatePipeline(name: string, pipeline: Partial<z.infer<typeof WorkflowPipeline>>) {
        dispatch({ type: "update_pipeline", name, pipeline });
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

    // Modal-specific handlers that don't auto-select
    function handleAddPromptFromModal(prompt: Partial<z.infer<typeof WorkflowPrompt>>) {
        dispatch({ type: "add_prompt_no_select", prompt });
    }

    function handleUpdatePromptFromModal(name: string, prompt: Partial<z.infer<typeof WorkflowPrompt>>) {
        dispatch({ type: "update_prompt_no_select", name, prompt });
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

    function handleReorderAgents(agents: z.infer<typeof WorkflowAgent>[]) {
        handleWorkflowChange();
        // Save order to localStorage
        const orderMap = agents.reduce((acc, agent, index) => {
            acc[agent.name] = index;
            return acc;
        }, {} as Record<string, number>);
        const mode = isLive ? 'live' : 'draft';
        localStorage.setItem(`${mode}_workflow_${projectId}_agent_order`, JSON.stringify(orderMap));
        
        dispatch({ type: "reorder_agents", agents });
    }

    function handleReorderPipelines(pipelines: z.infer<typeof WorkflowPipeline>[]) {
        handleWorkflowChange();
        // Save order to localStorage
        const orderMap = pipelines.reduce((acc, pipeline, index) => {
            acc[pipeline.name] = index;
            return acc;
        }, {} as Record<string, number>);
        const mode = isLive ? 'live' : 'draft';
        localStorage.setItem(`${mode}_workflow_${projectId}_pipeline_order`, JSON.stringify(orderMap));
        
        dispatch({ type: "reorder_pipelines", pipelines });
    }

    async function handlePublishWorkflow() {
        dispatch({ type: 'set_publishing', publishing: true });
        try {
            await publishWorkflow(projectId, state.present.workflow);
            // reflect live mode both internally and externally in one go
            dispatch({ type: 'set_is_live', isLive: true });
            onChangeMode('live');
        } finally {
            dispatch({ type: 'set_publishing', publishing: false });
        }
    }

    function handleRevertToLive() {
        onRevertModalOpen();
    }

    function handleConfirmRevert() {
        onRevertToLive();
        onRevertModalClose();
    }

    // Remove handleCopyJSON and add handleDownloadJSON
    function handleDownloadJSON() {
        const workflow = state.present.workflow;
        
        // Create a copy of the workflow and replace variable values with dummy text
        const workflowCopy = {
            ...workflow,
            prompts: workflow.prompts.map(prompt => {
                // If this is a variable (base_prompt type), replace its value with dummy text
                if (prompt.type === 'base_prompt') {
                    return {
                        ...prompt,
                        prompt: '<needs to be added>'
                    };
                }
                return prompt;
            })
        };
        
        const json = JSON.stringify(workflowCopy, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workflow.json';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
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
                await saveWorkflow(projectId, workflowToSave);
            }
        } finally {
            saving.current = false;
            if (saveQueue.current.length > 0) {
                processQueue(state, dispatch);
            } else {
                dispatch({ type: "set_saving", saving: false });
            }
        }
    }, [isLive, projectId]);

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

    // Sync project name from server when not editing and no pending commit in-flight
    useEffect(() => {
        if (!isEditingProjectName && pendingProjectName === null) {
            setLocalProjectName(projectConfig.name || '');
        }
    }, [projectConfig.name, isEditingProjectName, pendingProjectName]);

    // When a commit is pending, wait until server reflects it to clear the lock
    useEffect(() => {
        if (
            pendingProjectName &&
            (projectConfig.name || '').trim().toLowerCase() === pendingProjectName.trim().toLowerCase()
        ) {
            setPendingProjectName(null);
            setLocalProjectName(projectConfig.name || '');
        }
    }, [projectConfig.name, pendingProjectName]);

    function handlePlaygroundClick() {
        setIsInitialState(false);
    }

    // Centralized draft switch for any workflow modification while in live mode
    const ensureDraftForModify = useCallback(() => {
        if (isLive && !state.present.publishing) {
            onChangeMode('draft');
            setShowBuildModeBanner(true);
            setTimeout(() => setShowBuildModeBanner(false), 5000);
        }
    }, [isLive, state.present.publishing, onChangeMode]);

    const WORKFLOW_MOD_ACTIONS = useRef(new Set([
        'add_agent','add_tool','add_prompt','add_prompt_no_select','add_pipeline',
        'update_agent','update_tool','update_prompt','update_prompt_no_select','update_pipeline',
        'delete_agent','delete_tool','delete_prompt','delete_pipeline',
        'toggle_agent','set_main_agent','reorder_agents','reorder_pipelines'
    ])).current;

    const dispatchGuarded = useCallback((action: Action) => {
        if (WORKFLOW_MOD_ACTIONS.has((action as any).type) && isLive && !state.present.publishing) {
            onChangeMode('draft');
            setShowBuildModeBanner(true);
            setTimeout(() => setShowBuildModeBanner(false), 5000);
        }
        dispatch(action);
    }, [WORKFLOW_MOD_ACTIONS, isLive, state.present.publishing, onChangeMode, dispatch]);

    function handleTogglePanel() {
        if (isLive && activePanel === 'playground') {
            // User is trying to switch to Build mode in live mode
            onChangeMode('draft');
            setActivePanel('copilot'); // Switch to Build mode as intended
            setShowBuildModeBanner(true);
            // Auto-hide banner after 5 seconds
            setTimeout(() => setShowBuildModeBanner(false), 5000);
        } else {
            setActivePanel(activePanel === 'playground' ? 'copilot' : 'playground');
        }
    }

    function handleWorkflowChange() {
        if (isLive) {
            // User is making changes in live mode - switch to draft
            onChangeMode('draft');
            setShowBuildModeBanner(true);
            // Auto-hide banner after 5 seconds
            setTimeout(() => setShowBuildModeBanner(false), 5000);
        }
    }

    const validateProjectName = (value: string) => {
        if (value.length === 0) {
            setProjectNameError("Project name cannot be empty");
            return false;
        }
        setProjectNameError(null);
        return true;
    };

    const handleProjectNameChange = (value: string) => {
        setLocalProjectName(value);
        setIsEditingProjectName(true);
        // Do not validate or save on every keystroke
    };

    const handleProjectNameCommit = async (value: string) => {
        const trimmed = value.trim();
        // If unchanged, just clear editing state
        if (trimmed === (projectConfig.name || '')) {
            setProjectNameError(null);
            setIsEditingProjectName(false);
            return;
        }

        if (!validateProjectName(trimmed)) {
            setIsEditingProjectName(false);
            return;
        }

        try {
            // Validate uniqueness against other projects (case-insensitive)
            const projects = await listProjects();
            const isDuplicate = projects.some(p => ((p as any).id ?? (p as any)._id) !== projectId && (p.name || '').trim().toLowerCase() === trimmed.toLowerCase());
            if (isDuplicate) {
                setProjectNameError("This name is already taken by another project");
                return;
            }
            // Lock local sync until server reflects the change
            setPendingProjectName(trimmed);
            await updateProjectName(projectId, trimmed);
            onProjectConfigUpdated?.();
            setProjectNameError(null);
        } catch (error) {
            setProjectNameError("Failed to update project name");
            console.error('Failed to update project name:', error);
            // Clear pending state so we resync from server
            setPendingProjectName(null);
            setLocalProjectName(projectConfig.name || '');
        } finally {
            setIsEditingProjectName(false);
        }
    };

    return (
        <EntitySelectionContext.Provider value={{
            onSelectAgent: handleSelectAgent,
            onSelectTool: handleSelectTool,
            onSelectPrompt: handleSelectPrompt,
        }}>
            <div className="h-full flex flex-col gap-5">
                {/* Top Bar - Isolated like sidebar */}
                <TopBar
                    localProjectName={localProjectName}
                    projectNameError={projectNameError}
                    onProjectNameChange={handleProjectNameChange}
                    onProjectNameCommit={handleProjectNameCommit}
                    publishing={state.present.publishing}
                    isLive={isLive}
                    showCopySuccess={showCopySuccess}
                    showBuildModeBanner={showBuildModeBanner}
                    canUndo={state.currentIndex > 0}
                    canRedo={state.currentIndex < state.patches.length}
                    activePanel={activePanel}
                    onUndo={() => dispatchGuarded({ type: "undo" })}
                    onRedo={() => dispatchGuarded({ type: "redo" })}
                    onDownloadJSON={handleDownloadJSON}
                    onPublishWorkflow={handlePublishWorkflow}
                    onChangeMode={onChangeMode}
                    onRevertToLive={handleRevertToLive}
                    onTogglePanel={handleTogglePanel}
                />
                
                {/* Content Area */}
                <ResizablePanelGroup direction="horizontal" className="flex-1 flex overflow-auto gap-1 rounded-xl bg-zinc-50 dark:bg-zinc-900">
                    <ResizablePanel minSize={10} defaultSize={PANEL_RATIOS.entityList}>
                        <div className="flex flex-col h-full">
                            <EntityList
                                ref={entityListRef}
                                agents={state.present.workflow.agents}
                                tools={state.present.workflow.tools}
                                prompts={state.present.workflow.prompts}
                                pipelines={state.present.workflow.pipelines || []}
                                dataSources={dataSources}
                                workflow={state.present.workflow}
                                selectedEntity={
                                    state.present.selection &&
                                    (state.present.selection.type === "agent" ||
                                     state.present.selection.type === "tool" ||
                                     state.present.selection.type === "prompt" ||
                                     state.present.selection.type === "datasource" ||
                                     state.present.selection.type === "pipeline")
                                      ? state.present.selection
                                      : null
                                }
                                startAgentName={state.present.workflow.startAgent}
                                onSelectAgent={handleSelectAgent}
                                onSelectTool={handleSelectTool}
                                onSelectPrompt={handleSelectPrompt}
                                onSelectPipeline={handleSelectPipeline}
                                onSelectDataSource={handleSelectDataSource}
                                onAddAgent={handleAddAgent}
                                onAddTool={handleAddTool}
                                onAddPrompt={handleAddPrompt}
                                onUpdatePrompt={handleUpdatePrompt}
                                onAddPromptFromModal={handleAddPromptFromModal}
                                onUpdatePromptFromModal={handleUpdatePromptFromModal}
                                onAddPipeline={handleAddPipeline}
                                onAddAgentToPipeline={handleAddAgentToPipeline}
                                onToggleAgent={handleToggleAgent}
                                onSetMainAgent={handleSetMainAgent}
                                onDeleteAgent={handleDeleteAgent}
                                onDeleteTool={handleDeleteTool}
                                onDeletePrompt={handleDeletePrompt}
                                onDeletePipeline={handleDeletePipeline}
                                onShowVisualise={handleShowVisualise}
                                projectId={projectId}
                                onProjectToolsUpdated={onProjectToolsUpdated}
                                onDataSourcesUpdated={onDataSourcesUpdated}
                                projectConfig={projectConfig}
                                onReorderAgents={handleReorderAgents}
                                onReorderPipelines={handleReorderPipelines}
                                useRagUploads={useRagUploads}
                                useRagS3Uploads={useRagS3Uploads}
                                useRagScraping={useRagScraping}
                            />
                        </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle className="w-[3px] bg-transparent" />
                    <ResizablePanel
                        minSize={20}
                        defaultSize={PANEL_RATIOS.chatApp + PANEL_RATIOS.copilot}
                        className="overflow-auto"
                    >
                        <div className={(activePanel === 'playground' && state.present.selection === null) ? 'block h-full' : 'hidden h-full'}>
                            <ChatApp
                                key={'' + state.present.chatKey}
                                hidden={state.present.selection !== null}
                                projectId={projectId}
                                workflow={state.present.workflow}
                                messageSubscriber={updateChatMessages}
                                onPanelClick={handlePlaygroundClick}
                                triggerCopilotChat={triggerCopilotChat}
                                isLiveWorkflow={isLive}
                                activePanel={activePanel}
                                onTogglePanel={handleTogglePanel}
                            />
                        </div>
                        <div className={(activePanel === 'copilot' && state.present.selection === null) ? 'block h-full' : 'hidden h-full'}>
                            <Copilot
                                ref={copilotRef}
                                projectId={projectId}
                                workflow={state.present.workflow}
                                dispatch={dispatch}
                                chatContext={
                                    state.present.selection &&
                                    (state.present.selection.type === "agent" ||
                                     state.present.selection.type === "tool" ||
                                     state.present.selection.type === "prompt")
                                      ? {
                                          type: state.present.selection.type,
                                          name: state.present.selection.name
                                        }
                                      : chatMessages.length > 0
                                        ? { type: 'chat', messages: chatMessages }
                                        : undefined
                                }
                                isInitialState={isInitialState}
                                dataSources={dataSources}
                                activePanel={activePanel}
                                onTogglePanel={handleTogglePanel}
                            />
                        </div>
                        {state.present.selection?.type === "agent" && <AgentConfig
                            key={`agent-${state.present.workflow.agents.findIndex(agent => agent.name === state.present.selection!.name)}`}
                            projectId={projectId}
                            workflow={state.present.workflow}
                            agent={state.present.workflow.agents.find((agent) => agent.name === state.present.selection!.name)!}
                            usedAgentNames={new Set(state.present.workflow.agents.filter((agent) => agent.name !== state.present.selection!.name).map((agent) => agent.name))}
                            usedPipelineNames={new Set((state.present.workflow.pipelines || []).map((pipeline) => pipeline.name))}
                            agents={state.present.workflow.agents}
                            tools={state.present.workflow.tools}
                            prompts={state.present.workflow.prompts}
                            dataSources={dataSources}
                            handleUpdate={(update) => { dispatchGuarded({ type: "update_agent", name: state.present.selection!.name, agent: update }); }}
                            handleClose={handleUnselectAgent}
                            useRag={useRag}
                            triggerCopilotChat={triggerCopilotChat}
                            eligibleModels={eligibleModels === "*" ? "*" : eligibleModels.agentModels}
                            onOpenDataSourcesModal={handleOpenDataSourcesModal}
                        />}
                        {state.present.selection?.type === "tool" && (() => {
                            const selectedTool = state.present.workflow.tools.find(
                                (tool) => tool.name === state.present.selection!.name
                            );
                            return <ToolConfig
                                key={state.present.selection.name}
                                tool={selectedTool!}
                                usedToolNames={new Set([
                                    ...state.present.workflow.tools.filter((tool) => tool.name !== state.present.selection!.name).map((tool) => tool.name),
                                ])}
                                handleUpdate={(update) => { dispatchGuarded({ type: "update_tool", name: state.present.selection!.name, tool: update }); }}
                                handleClose={handleUnselectTool}
                            />;
                        })()}
                        {state.present.selection?.type === "prompt" && <PromptConfig
                            key={state.present.selection.name}
                            prompt={state.present.workflow.prompts.find((prompt) => prompt.name === state.present.selection!.name)!}
                            agents={state.present.workflow.agents}
                            tools={state.present.workflow.tools}
                            prompts={state.present.workflow.prompts}
                            usedPromptNames={new Set(state.present.workflow.prompts.filter((prompt) => prompt.name !== state.present.selection!.name).map((prompt) => prompt.name))}
                            handleUpdate={(update) => { dispatchGuarded({ type: "update_prompt", name: state.present.selection!.name, prompt: update }); }}
                            handleClose={handleUnselectPrompt}
                        />}
                        {state.present.selection?.type === "datasource" && <DataSourceConfig
                            key={state.present.selection.name}
                            dataSourceId={state.present.selection.name}
                            handleClose={() => dispatch({ type: "unselect_datasource" })}
                            onDataSourceUpdate={onDataSourcesUpdated}
                        />}
                        {state.present.selection?.type === "pipeline" && <PipelineConfig
                            key={state.present.selection.name}
                            projectId={projectId}
                            workflow={state.present.workflow}
                            pipeline={state.present.workflow.pipelines?.find((pipeline) => pipeline.name === state.present.selection!.name)!}
                            usedPipelineNames={new Set((state.present.workflow.pipelines || []).filter((pipeline) => pipeline.name !== state.present.selection!.name).map((pipeline) => pipeline.name))}
                            usedAgentNames={new Set(state.present.workflow.agents.map((agent) => agent.name))}
                            agents={state.present.workflow.agents}
                            pipelines={state.present.workflow.pipelines || []}
                            handleUpdate={handleUpdatePipeline.bind(null, state.present.selection.name)}
                            handleClose={() => dispatch({ type: "unselect_pipeline" })}
                        />}
                        {state.present.selection?.type === "visualise" && (
                            <Panel 
                                title={
                                    <div className="flex items-center justify-between w-full">
                                        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                                            Agent Graph Visualizer
                                        </div>
                                        <CustomButton
                                            variant="secondary"
                                            size="sm"
                                            onClick={handleHideVisualise}
                                            showHoverContent={true}
                                            hoverContent="Close"
                                        >
                                            <XIcon className="w-4 h-4" />
                                        </CustomButton>
                                    </div>
                                }
                            >
                                <div className="h-full overflow-hidden">
                                    <AgentGraphVisualizer workflow={state.present.workflow} />
                                </div>
                            </Panel>
                        )}
                    </ResizablePanel>
                </ResizablePanelGroup>
                {USE_PRODUCT_TOUR && showTour && (
                    <ProductTour
                        projectId={projectId}
                        onComplete={() => setShowTour(false)}
                    />
                )}
                
                {/* Revert to Live Confirmation Modal */}
                <Modal isOpen={isRevertModalOpen} onClose={onRevertModalClose}>
                    <ModalContent>
                        <ModalHeader className="flex flex-col gap-1">
                            Revert to Live Workflow
                        </ModalHeader>
                        <ModalBody>
                            <p>
                                Are you sure you want to revert to the live workflow? This will discard all your current draft changes and switch back to the live version.
                            </p>
                        </ModalBody>
                        <ModalFooter>
                            <Button color="danger" variant="light" onPress={onRevertModalClose}>
                                Cancel
                            </Button>
                            <Button color="danger" onPress={handleConfirmRevert}>
                                Revert to Live
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>
                

                
                {/* Phone/Twilio Modal */}
                <Modal 
                    isOpen={isPhoneModalOpen} 
                    onClose={onPhoneModalClose}
                    size="4xl"
                    scrollBehavior="inside"
                >
                    <ModalContent className="h-[80vh]">
                        <ModalHeader className="flex flex-col gap-1">
                            Phone Configuration
                        </ModalHeader>
                        <ModalBody className="p-0">
                            <VoiceSection projectId={projectId} />
                        </ModalBody>
                    </ModalContent>
                </Modal>
                
                {/* Chat Widget Modal */}
                {/*
                <Modal 
                    isOpen={isChatWidgetModalOpen} 
                    onClose={onChatWidgetModalClose}
                    size="4xl"
                    scrollBehavior="inside"
                >
                    <ModalContent className="h-[70vh]">
                        <ModalHeader className="flex flex-col gap-1">
                            Chat Widget
                        </ModalHeader>
                        <ModalBody className="p-0">
                            <div className="p-6">
                                <ChatWidgetSection 
                                    projectId={projectId} 
                                    chatWidgetHost={chatWidgetHost} 
                                />
                            </div>
                        </ModalBody>
                    </ModalContent>
                </Modal>
                */}
                
            </div>
        </EntitySelectionContext.Provider>
    );
}
