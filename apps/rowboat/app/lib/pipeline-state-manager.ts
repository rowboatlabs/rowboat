// Pipeline State Manager for handling complex pipeline execution flow
import { Agent } from "@openai/agents";
import { z } from "zod";
import { PipelineExecutionState, WorkflowPipeline, WorkflowAgent } from "./types/workflow_types";
import { PrefixLogger } from "./utils";
import { createPipelineHandoff } from "./agent-handoffs";

export interface PipelineExecutionResult {
    action: 'handoff' | 'complete' | 'error';
    nextAgent?: string;
    handoff?: any; // SDK Handoff object
    context?: any;
    results?: any;
    returnToAgent?: string;
    error?: string;
}

export class PipelineStateManager {
    private pipelineStates = new Map<string, z.infer<typeof PipelineExecutionState>>();
    private logger: PrefixLogger;

    constructor(logger: PrefixLogger) {
        this.logger = logger.child('PipelineStateManager');
    }

    // Initialize a new pipeline execution
    initializePipelineExecution(
        pipelineName: string,
        callingAgent: string,
        pipelineConfig: z.infer<typeof WorkflowPipeline>,
        initialData?: Record<string, any>
    ): z.infer<typeof PipelineExecutionState> {
        const state: z.infer<typeof PipelineExecutionState> = {
            pipelineName,
            currentStep: 0,
            totalSteps: pipelineConfig.agents.length,
            callingAgent,
            pipelineData: initialData || null,
            stepResults: null,
            currentStepResult: null,
            startTime: new Date().toISOString(),
            metadata: {
                pipelineDescription: pipelineConfig.description
            }
        };

        // Store initial state for the first agent
        const firstAgent = pipelineConfig.agents[0];
        this.storePipelineState(firstAgent, state);

        this.logger.log(`🚀 Initialized pipeline "${pipelineName}" with ${state.totalSteps} steps`);
        this.logger.log(`First agent: ${firstAgent}, called by: ${callingAgent}`);

        return state;
    }

    // Handle pipeline execution step
    async handlePipelineExecution(
        currentAgentName: string,
        pipelineConfig: Record<string, z.infer<typeof WorkflowPipeline>>,
        agents: Record<string, Agent>,
        stepResult?: Record<string, any>
    ): Promise<PipelineExecutionResult> {
        const state = this.getPipelineState(currentAgentName);
        
        if (!state) {
            return {
                action: 'error',
                error: `No pipeline state found for agent ${currentAgentName}`
            };
        }

        const pipeline = pipelineConfig[state.pipelineName];
        if (!pipeline) {
            return {
                action: 'error', 
                error: `Pipeline ${state.pipelineName} not found in configuration`
            };
        }

        // Store current step result
        if (stepResult) {
            // Safely handle stepResults as flexible union type
            const existingResults = Array.isArray(state.stepResults) ? state.stepResults : [];
            state.stepResults = [...existingResults, stepResult];
            state.currentStepResult = stepResult;
            
            // Update pipeline data if result contains data to pass forward
            if (stepResult.pipelineData) {
                // Safely handle pipelineData as flexible union type
                const existingData = (typeof state.pipelineData === 'object' && state.pipelineData !== null) ? state.pipelineData : {};
                const newData = (typeof stepResult.pipelineData === 'object' && stepResult.pipelineData !== null) ? stepResult.pipelineData : {};
                
                state.pipelineData = {
                    ...existingData,
                    ...newData
                };
            }
        }

        this.logger.log(`📊 Pipeline "${state.pipelineName}" step ${state.currentStep + 1}/${state.totalSteps} completed by ${currentAgentName}`);

        // Check if this is the last step
        if (state.currentStep >= pipeline.agents.length - 1) {
            // Pipeline complete - return to calling agent
            this.logger.log(`✅ Pipeline "${state.pipelineName}" completed, returning to ${state.callingAgent}`);
            
            const finalResults = {
                pipelineName: state.pipelineName,
                totalSteps: state.totalSteps,
                stepResults: state.stepResults,
                finalData: state.pipelineData,
                completionTime: new Date().toISOString(),
                duration: Date.now() - new Date(state.startTime).getTime()
            };

            // Clean up state
            this.clearPipelineState(currentAgentName);

            return {
                action: 'complete',
                results: finalResults,
                returnToAgent: state.callingAgent
            };
        }

        // Continue to next step
        const nextStepIndex = state.currentStep + 1;
        const nextAgentName = pipeline.agents[nextStepIndex];
        
        if (!agents[nextAgentName]) {
            return {
                action: 'error',
                error: `Next agent ${nextAgentName} not found in agents configuration`
            };
        }

        // Update state for next step
        const nextState: z.infer<typeof PipelineExecutionState> = {
            ...state,
            currentStep: nextStepIndex,
            currentStepResult: null // Reset for next step
        };

        // Store state for next agent
        this.storePipelineState(nextAgentName, nextState);

        // Create SDK handoff with rich context
        const handoff = createPipelineHandoff(
            agents[nextAgentName], 
            nextState, 
            this.logger
        );

        this.logger.log(`➡️ Pipeline "${state.pipelineName}": ${currentAgentName} -> ${nextAgentName} (step ${nextStepIndex + 1}/${state.totalSteps})`);

        return {
            action: 'handoff',
            nextAgent: nextAgentName,
            handoff,
            context: {
                reason: 'pipeline_execution',
                pipelineName: state.pipelineName,
                currentStep: nextStepIndex,
                totalSteps: state.totalSteps,
                isLastStep: nextStepIndex >= state.totalSteps - 1,
                pipelineData: nextState.pipelineData,
                stepResults: nextState.stepResults
            }
        };
    }

    // Store pipeline state for an agent
    storePipelineState(agentName: string, state: z.infer<typeof PipelineExecutionState>): void {
        this.pipelineStates.set(agentName, state);
        this.logger.log(`💾 Stored pipeline state for ${agentName}: step ${state.currentStep + 1}/${state.totalSteps}`);
    }

    // Retrieve pipeline state for an agent
    getPipelineState(agentName: string): z.infer<typeof PipelineExecutionState> | null {
        return this.pipelineStates.get(agentName) || null;
    }

    // Clear pipeline state (cleanup)
    clearPipelineState(agentName: string): void {
        this.pipelineStates.delete(agentName);
        this.logger.log(`🗑️ Cleared pipeline state for ${agentName}`);
    }

    // Check if agent is in a pipeline
    isAgentInPipeline(agentName: string): boolean {
        return this.pipelineStates.has(agentName);
    }

    // Get all active pipelines (for debugging)
    getActivePipelines(): Array<{agentName: string, state: z.infer<typeof PipelineExecutionState>}> {
        return Array.from(this.pipelineStates.entries()).map(([agentName, state]) => ({
            agentName,
            state
        }));
    }

    // Inject pipeline context into agent instructions
    injectPipelineContext(
        agent: Agent, 
        agentName: string, 
        originalInstructions: string
    ): string {
        const state = this.getPipelineState(agentName);
        if (!state) {
            return originalInstructions;
        }

        const contextPrompt = this.createPipelineContextPrompt(state);
        const enhancedInstructions = `${originalInstructions}\n\n${contextPrompt}`;
        
        this.logger.log(`📝 Injected pipeline context for ${agentName} in pipeline "${state.pipelineName}"`);
        
        return enhancedInstructions;
    }

    // Create pipeline context prompt
    private createPipelineContextPrompt(state: z.infer<typeof PipelineExecutionState>): string {
        const stepInfo = `Step ${state.currentStep + 1} of ${state.totalSteps}`;
        const isLast = state.currentStep >= state.totalSteps - 1;
        
        let contextPrompt = `## 🔄 Pipeline Execution Context

**Pipeline**: ${state.pipelineName}
**Current Step**: ${stepInfo}
**Status**: ${isLast ? 'FINAL STEP - Provide complete results' : 'Intermediate step - Pass results forward'}

`;

        if (state.stepResults && Array.isArray(state.stepResults) && state.stepResults.length > 0) {
            contextPrompt += `**Previous Step Results**:
\`\`\`json
${JSON.stringify(state.stepResults, null, 2)}
\`\`\`

`;
        }

        if (state.pipelineData && typeof state.pipelineData === 'object' && state.pipelineData !== null && Object.keys(state.pipelineData).length > 0) {
            contextPrompt += `**Pipeline Data**:
\`\`\`json
${JSON.stringify(state.pipelineData, null, 2)}
\`\`\`

`;
        }

        if (isLast) {
            contextPrompt += `⚠️ **IMPORTANT**: This is the final step in the pipeline. Your response will be returned to the calling agent "${state.callingAgent}". Provide comprehensive results.

`;
        } else {
            contextPrompt += `➡️ **NEXT**: After completing your task, results will automatically flow to the next step in the pipeline.

`;
        }

        return contextPrompt;
    }

    // Error recovery - handle pipeline failures
    handlePipelineError(
        agentName: string,
        error: string | Error,
        shouldReturnToCaller: boolean = true
    ): PipelineExecutionResult {
        const state = this.getPipelineState(agentName);
        const errorMessage = typeof error === 'string' ? error : error.message;
        
        this.logger.log(`❌ Pipeline error in agent ${agentName}: ${errorMessage}`);
        
        if (state && shouldReturnToCaller) {
            // Clean up and return to caller with error
            this.clearPipelineState(agentName);
            
            return {
                action: 'complete',
                results: {
                    pipelineName: state.pipelineName,
                    error: errorMessage,
                    completedSteps: state.currentStep,
                    totalSteps: state.totalSteps,
                    stepResults: state.stepResults
                },
                returnToAgent: state.callingAgent
            };
        }
        
        return {
            action: 'error',
            error: errorMessage
        };
    }

    // Get pipeline statistics (for monitoring)
    getPipelineStats(): {
        activePipelines: number;
        pipelinesByName: Record<string, number>;
        averageStepsCompleted: number;
    } {
        const pipelines = this.getActivePipelines();
        const pipelinesByName: Record<string, number> = {};
        let totalSteps = 0;

        pipelines.forEach(({state}) => {
            pipelinesByName[state.pipelineName] = (pipelinesByName[state.pipelineName] || 0) + 1;
            totalSteps += state.currentStep + 1;
        });

        return {
            activePipelines: pipelines.length,
            pipelinesByName,
            averageStepsCompleted: pipelines.length > 0 ? totalSteps / pipelines.length : 0
        };
    }
}