// Agent handoffs using OpenAI Agents SDK native capabilities
import { Agent, handoff, Handoff } from "@openai/agents";
import { z } from "zod";
import { PrefixLogger } from "./utils";
import { 
    WorkflowAgent
} from "./types/workflow_types";
import {
    HandoffContext, 
    PipelineContext, 
    TaskContext, 
    PipelineExecutionState 
} from "./agents";

// Types for handoff input data (from SDK)
export interface HandoffInputData {
    inputHistory: string | any[];
    preHandoffItems: any[];
    newItems: any[];
    runContext?: any;
}

export type HandoffContextType = 'pipeline' | 'task' | 'direct';

export interface AgentHandoffConfig {
    inputSchema?: z.ZodObject<any>;
    onHandoff?: (context: any, input: any) => void;
    inputFilter?: (data: HandoffInputData) => HandoffInputData;
    logger?: PrefixLogger;
}

// Get default schema based on context type
function getDefaultSchemaForContext(contextType: HandoffContextType): z.ZodObject<any> {
    switch (contextType) {
        case 'pipeline':
            return PipelineContext;
        case 'task':
            return TaskContext;
        case 'direct':
        default:
            return HandoffContext;
    }
}

// Create context-aware input filter
function createDefaultInputFilter(contextType: HandoffContextType) {
    return (data: HandoffInputData): HandoffInputData => {
        switch (contextType) {
            case 'pipeline':
                return filterForPipeline(data);
            case 'task':
                return filterForTask(data);
            case 'direct':
            default:
                return data; // Pass through all context for direct handoffs
        }
    };
}

// Filter context for pipeline execution
function filterForPipeline(data: HandoffInputData): HandoffInputData {
    // Keep recent context relevant to pipeline execution
    const maxHistoryItems = 10; // Configurable limit
    
    return {
        ...data,
        inputHistory: Array.isArray(data.inputHistory) 
            ? data.inputHistory.slice(-maxHistoryItems)
            : data.inputHistory,
        // Filter out non-pipeline related tool calls
        preHandoffItems: data.preHandoffItems.filter(item => 
            !item.type || 
            item.type === 'message' || 
            item.type === 'tool_call' && item.name?.includes('pipeline')
        )
    };
}

// Filter context for task delegation
function filterForTask(data: HandoffInputData): HandoffInputData {
    // Keep task-relevant context only
    const maxHistoryItems = 20; // Tasks may need more context
    
    return {
        ...data,
        inputHistory: Array.isArray(data.inputHistory)
            ? data.inputHistory.slice(-maxHistoryItems)
            : data.inputHistory,
        // Keep all items for task context
        preHandoffItems: data.preHandoffItems
    };
}

// Create SDK-native handoff with rich context
export function createAgentHandoff(
    targetAgent: Agent,
    contextType: HandoffContextType,
    config: AgentHandoffConfig = {}
): Handoff {
    const inputSchema = config.inputSchema || getDefaultSchemaForContext(contextType);
    const logger = config.logger;
    
    logger?.log(`Creating handoff to ${targetAgent.name} with context type: ${contextType}`);
    
    // Create OpenAI API compliant tool name
    const sanitizedAgentName = targetAgent.name
        .replace(/[^a-zA-Z0-9_-]/g, '_')  // Replace invalid chars with underscore
        .replace(/_+/g, '_')              // Replace multiple underscores with single
        .replace(/^_+|_+$/g, '')          // Remove leading/trailing underscores
        .substring(0, 50);                // Limit length
    
    const toolName = `handoff_to_${sanitizedAgentName}`;
    
    logger?.log(`Creating handoff tool: ${toolName} -> ${targetAgent.name}`);
    
    return handoff(targetAgent, {
        inputType: inputSchema,
        toolNameOverride: toolName,
        toolDescriptionOverride: `Transfer control to ${targetAgent.name} with structured context data`,
        
        onHandoff: async (runContext, inputString) => {
            try {
                const inputStr = typeof inputString === 'string' ? inputString : '{}';
                let input = JSON.parse(inputStr || '{}');
                
                // Validate and enrich the parsed input with defaults
                const schema = config.inputSchema || getDefaultSchemaForContext(contextType);
                const validationResult = schema.safeParse(input);
                
                if (!validationResult.success) {
                    logger?.log(`Handoff input validation failed for ${targetAgent.name}, enriching with defaults:`, validationResult.error.issues.map(i => i.path.join('.') + ': ' + i.message));
                    // Parse with defaults to get a valid object
                    input = schema.parse({});
                    logger?.log(`Using default context for handoff to ${targetAgent.name}`);
                } else {
                    logger?.log(`Handoff input validation succeeded for ${targetAgent.name}`);
                    input = validationResult.data;
                }
                
                logger?.log(`Handoff to ${targetAgent.name} with input:`, input);
                
                // Execute custom handoff logic
                config.onHandoff?.(runContext, input);
                
                // Log the handoff for debugging
                logHandoffEvent(targetAgent.name, contextType, input, logger);
                
            } catch (error) {
                logger?.log(`Error in handoff to ${targetAgent.name}:`, error);
                throw error;
            }
        },
        
        inputFilter: config.inputFilter || createDefaultInputFilter(contextType)
    });
}

// Create handoff for pipeline execution
export function createPipelineHandoff(
    targetAgent: Agent,
    pipelineState: z.infer<typeof PipelineExecutionState>,
    logger?: PrefixLogger
): Handoff {
    const pipelineContext = {
        reason: 'pipeline_execution' as const,
        parentAgent: pipelineState.callingAgent,
        transferCount: 0,
        pipelineName: pipelineState.pipelineName,
        currentStep: pipelineState.currentStep,
        totalSteps: pipelineState.totalSteps,
        isLastStep: pipelineState.currentStep >= pipelineState.totalSteps - 1,
        pipelineData: pipelineState.pipelineData || null,
        stepResults: pipelineState.stepResults || null
    };
    
    return createAgentHandoff(targetAgent, 'pipeline', {
        inputSchema: PipelineContext,
        onHandoff: (context, input) => {
            logger?.log(`Pipeline step ${pipelineState.currentStep + 1}/${pipelineState.totalSteps} - handing off to ${targetAgent.name}`);
            
            // Store pipeline state for the target agent
            storePipelineStateForAgent(targetAgent.name, pipelineState);
        },
        inputFilter: (data) => {
            // Inject pipeline context into the conversation
            const contextMessage = createPipelineContextMessage(pipelineContext);
            
            return {
                ...data,
                newItems: [
                    ...data.newItems,
                    {
                        type: 'message',
                        role: 'system',
                        content: contextMessage
                    }
                ]
            };
        },
        logger
    });
}

// Create handoff for task delegation
export function createTaskHandoff(
    targetAgent: Agent,
    taskContext: {
        taskType: string;
        priority: 'low' | 'medium' | 'high';
        parentAgent: string;
        requirements?: string[];
        resources?: Record<string, any>;
    },
    logger?: PrefixLogger
): Handoff {
    return createAgentHandoff(targetAgent, 'task', {
        inputSchema: TaskContext,
        onHandoff: (context, input) => {
            logger?.log(`Task delegation to ${targetAgent.name}:`, {
                taskType: taskContext.taskType,
                priority: taskContext.priority
            });
        },
        logger
    });
}

// Get schema based on agent configuration
export function getSchemaForAgent(agentConfig: z.infer<typeof WorkflowAgent>): z.ZodObject<any> {
    // Always start with basic HandoffContext - more specific contexts are used
    // only when explicitly creating pipeline or task handoffs
    return HandoffContext;
    
    // NOTE: PipelineContext and TaskContext are used only in specific creation functions
    // like createPipelineHandoff() and createTaskHandoff(), not for general agent handoffs
}

// Create context filter based on agent configuration
export function createContextFilterForAgent(agentConfig: z.infer<typeof WorkflowAgent>) {
    return (data: HandoffInputData): HandoffInputData => {
        // Use basic passthrough filtering for regular handoffs
        // Specific filtering is handled by createPipelineHandoff and createTaskHandoff
        return data;
    };
}

// Helper functions
function logHandoffEvent(
    targetAgent: string,
    contextType: string,
    input: any,
    logger?: PrefixLogger
) {
    logger?.log(`🔄 SDK HANDOFF: -> ${targetAgent} (${contextType})`, {
        targetAgent,
        contextType,
        hasContext: !!input && Object.keys(input).length > 0
    });
}

// Simple storage for pipeline state (in production, use proper state management)
const pipelineStates = new Map<string, z.infer<typeof PipelineExecutionState>>();

function storePipelineStateForAgent(
    agentName: string, 
    state: z.infer<typeof PipelineExecutionState>
) {
    pipelineStates.set(agentName, state);
}

export function getPipelineStateForAgent(
    agentName: string
): z.infer<typeof PipelineExecutionState> | null {
    return pipelineStates.get(agentName) || null;
}

function createPipelineContextMessage(context: any): string {
    return `## Pipeline Execution Context
Pipeline: ${context.pipelineName}
Step: ${context.currentStep + 1}/${context.totalSteps}
${context.isLastStep ? '**Final Step**: Provide complete results.' : '**Continue**: Pass results to next step.'}

${context.stepResults && context.stepResults.length > 0 
    ? `Previous Results:\n${JSON.stringify(context.stepResults, null, 2)}`
    : 'No previous results.'
}

${context.pipelineData 
    ? `Pipeline Data:\n${JSON.stringify(context.pipelineData, null, 2)}`
    : ''
}`;
}