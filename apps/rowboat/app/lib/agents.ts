// External dependencies
import { Agent, AgentInputItem, run, Tool } from "@openai/agents";
import { RECOMMENDED_PROMPT_PREFIX } from "@openai/agents-core/extensions";
import { aisdk } from "@openai/agents-extensions";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import crypto from "crypto";

// Internal dependencies
import { createTools, createRagTool } from "./agent-tools";
import { ConnectedEntity, sanitizeTextWithMentions, Workflow, WorkflowAgent, WorkflowPipeline, WorkflowPrompt, WorkflowTool } from "./types/workflow_types";
import { CHILD_TRANSFER_RELATED_INSTRUCTIONS, CONVERSATION_TYPE_INSTRUCTIONS, PIPELINE_TYPE_INSTRUCTIONS, RAG_INSTRUCTIONS, TASK_TYPE_INSTRUCTIONS } from "./agent_instructions";
import { PrefixLogger } from "./utils";
import { Message, AssistantMessage, AssistantMessageWithToolCalls, ToolMessage } from "./types/types";

// Provider configuration
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || undefined;
const MODEL = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4o';

const openai = createOpenAI({
    apiKey: PROVIDER_API_KEY,
    baseURL: PROVIDER_BASE_URL,
});

const ZUsage = z.object({
    tokens: z.object({
        total: z.number(),
        prompt: z.number(),
        completion: z.number(),
    }),
});

const ZOutMessage = z.union([
    AssistantMessage,
    AssistantMessageWithToolCalls,
    ToolMessage,
]);

// Helper to create an agent
function createAgent(
    logger: PrefixLogger,
    projectId: string,
    config: z.infer<typeof WorkflowAgent>,
    tools: Record<string, Tool>,
    workflow: z.infer<typeof Workflow>,
    promptConfig: Record<string, z.infer<typeof WorkflowPrompt>>,
): { agent: Agent, entities: z.infer<typeof ConnectedEntity>[] } {
    const agentLogger = logger.child(`createAgent: ${config.name}`);

    // Combine instructions and examples
    let instructions = `${RECOMMENDED_PROMPT_PREFIX}

## Your Name
${config.name}

## Description
${config.description}

## About You

${config.outputVisibility === 'user_facing'
    ? CONVERSATION_TYPE_INSTRUCTIONS()
    : config.type === 'pipeline'
        ? PIPELINE_TYPE_INSTRUCTIONS()
        : TASK_TYPE_INSTRUCTIONS()}

## Instructions

${config.instructions}

${config.examples ? ('# Examples\n' + config.examples) : ''}

${'-'.repeat(100)}

${CHILD_TRANSFER_RELATED_INSTRUCTIONS}
`;

    let { sanitized, entities } = sanitizeTextWithMentions(instructions, workflow, config);

    // Remove agent transfer instructions for pipeline agents
    if (config.type === 'pipeline') {
        sanitized = sanitized.replace(CHILD_TRANSFER_RELATED_INSTRUCTIONS, '');
    }

    agentLogger.log(`instructions: ${JSON.stringify(sanitized)}`);
    agentLogger.log(`mentions: ${JSON.stringify(entities)}`);

    const agentTools = entities.filter(e => e.type === 'tool').map(e => tools[e.name]).filter(Boolean) as Tool[];

    // Add RAG tool if needed
    if (config.ragDataSources?.length) {
        const ragTool = createRagTool(logger, config, projectId);
        agentTools.push(ragTool);

        // update instructions to include RAG instructions
        sanitized = sanitized + '\n\n' + ('-'.repeat(100)) + '\n\n' + RAG_INSTRUCTIONS(ragTool.name);
        agentLogger.log(`added rag instructions`);
    }

    // Create the agent with the dynamic instructions
    const agent = new Agent({
        name: config.name,
        instructions: sanitized,
        tools: agentTools,
        model: aisdk(openai(config.model)),
        // model: config.model,
        modelSettings: {
            temperature: 0.0,
        }
    });
    agentLogger.log(`created agent`);

    return {
        agent,
        entities,
    };
}

// Convert messages to agent input items
function convertMsgsInput(messages: z.infer<typeof Message>[]): AgentInputItem[] {
    const msgs: AgentInputItem[] = [];

    for (const msg of messages) {
        if (msg.role === 'assistant' && msg.content) {
            msgs.push({
                role: 'assistant',
                content: [{
                    type: 'output_text',
                    text: `${msg.content}`,
                }],
                status: 'completed',
            });
        } else if (msg.role === 'user') {
            msgs.push({
                role: 'user',
                content: msg.content,
            });
        } else if (msg.role === 'system') {
            msgs.push({
                role: 'system',
                content: msg.content,
            });
        }
    }

    return msgs;
}

// Helper to determine the next agent name based on control settings
function getStartOfTurnAgentName(
    logger: PrefixLogger,
    messages: z.infer<typeof Message>[],
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>,
    workflow: z.infer<typeof Workflow>,
): string {

    function createAgentCallStack(messages: z.infer<typeof Message>[]): string[] {
        const stack: string[] = [];
        for (const msg of messages) {
            if (msg.role === 'assistant' && msg.agentName) {
                // skip duplicate entries
                if (stack.length > 0 && stack[stack.length - 1] === msg.agentName) {
                    continue;
                }
                // add to stack
                stack.push(msg.agentName);
            }
        }
        return stack;
    }

    logger = logger.child(`getStartOfTurnAgentName`);
    const startAgentStack = createAgentCallStack(messages);
    logger.log(`startAgentStack: ${JSON.stringify(startAgentStack)}`);

    // if control type is retain, return last agent
    const lastAgentName = startAgentStack.pop() || workflow.startAgent;
    logger.log(`setting last agent name initially to: ${lastAgentName}`);
    const lastAgentConfig = agentConfig[lastAgentName];
    if (!lastAgentConfig) {
        logger.log(`last agent ${lastAgentName} not found in agent config, returning start agent: ${workflow.startAgent}`);
        return workflow.startAgent;
    }

    // For other agents, check control type
    switch (lastAgentConfig.controlType) {
        case 'retain':
            logger.log(`last agent ${lastAgentName} control type is retain, returning last agent: ${lastAgentName}`);
            return lastAgentName;
        case 'relinquish_to_parent':
            const parentAgentName = startAgentStack.pop() || workflow.startAgent;
            logger.log(`last agent ${lastAgentName} control type is relinquish_to_parent, returning most recent parent: ${parentAgentName}`);
            return parentAgentName;
        case 'relinquish_to_start':
            logger.log(`last agent ${lastAgentName} control type is relinquish_to_start, returning start agent: ${workflow.startAgent}`);
            return workflow.startAgent;
        default:
            // Fallback for any unexpected control type
            logger.log(`last agent ${lastAgentName} has unexpected control type: ${lastAgentConfig.controlType}, returning start agent: ${workflow.startAgent}`);
            return workflow.startAgent;
    }
}

// Logs an event and then yields it
async function* emitEvent(
    logger: PrefixLogger,
    event: z.infer<typeof ZOutMessage> | z.infer<typeof ZUsage>,
): AsyncIterable<z.infer<typeof ZOutMessage> | z.infer<typeof ZUsage>> {
    logger.log(`-> emitting event: ${JSON.stringify(event)}`);
    yield event;
    return;
}

// Emits an agent -> agent transfer event
function createTransferEvents(
    fromAgent: string,
    toAgent: string,
): [z.infer<typeof AssistantMessageWithToolCalls>, z.infer<typeof ToolMessage>] {
    const toolCallId = crypto.randomUUID();
    const m1: z.infer<typeof Message> = {
        role: 'assistant',
        content: null,
        toolCalls: [{
            id: toolCallId,
            type: 'function',
            function: {
                name: 'transfer_to_agent',
                arguments: JSON.stringify({ assistant: toAgent }),
            },
        }],
        agentName: fromAgent,
    };

    const m2: z.infer<typeof Message> = {
        role: 'tool',
        content: JSON.stringify({ assistant: toAgent }),
        toolCallId: toolCallId,
        toolName: 'transfer_to_agent',
    };

    return [m1, m2];
}

// Tracks agent to agent transfer counts
class AgentTransferCounter {
    private calls: Record<string, number> = {};

    increment(fromAgent: string, toAgent: string): void {
        const key = `${fromAgent}:${toAgent}`;
        this.calls[key] = (this.calls[key] || 0) + 1;
    }

    get(fromAgent: string, toAgent: string): number {
        const key = `${fromAgent}:${toAgent}`;
        return this.calls[key] || 0;
    }
}

class UsageTracker {
    private usage: {
        total: number;
        prompt: number;
        completion: number;
    } = { total: 0, prompt: 0, completion: 0 };

    increment(total: number, prompt: number, completion: number): void {
        this.usage.total += total;
        this.usage.prompt += prompt;
        this.usage.completion += completion;
    }

    get(): { total: number, prompt: number, completion: number } {
        return this.usage;
    }

    asEvent(): z.infer<typeof ZUsage> {
        return {
            tokens: this.usage,
        };
    }
}

function ensureSystemMessage(logger: PrefixLogger, messages: z.infer<typeof Message>[]) {
    logger = logger.child(`ensureSystemMessage`);

    // ensure that a system message is set
    if (messages[0]?.role !== 'system') {
        messages.unshift({
            role: 'system',
            content: '',
        });
        logger.log(`added system message: ${messages[0]?.content}`);
    }

    // ensure that system message isn't blank
    if (!messages[0].content) {
        const defaultContext = `You are a helpful assistant.

Basic context:
    - The date-time right now is ${new Date().toISOString()}`;

        messages[0].content = defaultContext;
        logger.log(`updated system message with default context: ${messages[0].content}`);
    }
}

function mapConfig(workflow: z.infer<typeof Workflow>): {
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>;
    toolConfig: Record<string, z.infer<typeof WorkflowTool>>;
    promptConfig: Record<string, z.infer<typeof WorkflowPrompt>>;
    pipelineConfig: Record<string, z.infer<typeof WorkflowPipeline>>;
} {
    const agentConfig: Record<string, z.infer<typeof WorkflowAgent>> = workflow.agents.reduce((acc, agent) => ({
        ...acc,
        [agent.name]: agent
    }), {});
    const toolConfig: Record<string, z.infer<typeof WorkflowTool>> = workflow.tools.reduce((acc, tool) => ({
        ...acc,
        [tool.name]: tool
    }), {});
    const promptConfig: Record<string, z.infer<typeof WorkflowPrompt>> = workflow.prompts.reduce((acc, prompt) => ({
        ...acc,
        [prompt.name]: prompt
    }), {});

    const pipelineConfig: Record<string, z.infer<typeof WorkflowPipeline>> = (workflow.pipelines || []).reduce((acc, pipeline) => ({
        ...acc,
        [pipeline.name]: pipeline
    }), {});

    return { agentConfig, toolConfig, promptConfig, pipelineConfig };
}

async function* emitGreetingTurn(logger: PrefixLogger, workflow: z.infer<typeof Workflow>): AsyncIterable<z.infer<typeof ZOutMessage> | z.infer<typeof ZUsage>> {
    // find the greeting prompt
    const prompt = workflow.prompts.find(p => p.type === 'greeting')?.prompt || 'How can I help you today?';
    logger.log(`greeting turn: ${prompt}`);

    // emit greeting turn
    yield* emitEvent(logger, {
        role: 'assistant',
        content: prompt,
        agentName: workflow.startAgent,
        responseType: 'external',
    });

    // emit final usage information
    yield* emitEvent(logger, new UsageTracker().asEvent());
}


function createAgents(
    logger: PrefixLogger,
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>,
    tools: Record<string, Tool>,
    promptConfig: Record<string, z.infer<typeof WorkflowPrompt>>,
    pipelineConfig: Record<string, z.infer<typeof WorkflowPipeline>>,
): { agents: Record<string, Agent>, mentions: Record<string, z.infer<typeof ConnectedEntity>[]>, originalInstructions: Record<string, string>, originalHandoffs: Record<string, Agent[]> } {
    const agentsLogger = logger.child('createAgents');
    const agents: Record<string, Agent> = {};
    const mentions: Record<string, z.infer<typeof ConnectedEntity>[]> = {};
    const originalInstructions: Record<string, string> = {};
    const originalHandoffs: Record<string, Agent[]> = {};

    agentsLogger.log(`=== CREATING ${Object.keys(agentConfig).length} AGENTS ===`);

    // Create pipeline entities that will be available for @ referencing
    const pipelineEntities: z.infer<typeof ConnectedEntity>[] = Object.keys(pipelineConfig).map(pipelineName => ({
        type: 'pipeline' as const,
        name: pipelineName,
    }));
    if (pipelineEntities.length > 0) {
        agentsLogger.log(`available pipeline entities for @ referencing: ${pipelineEntities.map(p => p.name).join(', ')}`);
    }

    // create agents
    for (const [agentName, config] of Object.entries(agentConfig)) {
        agentsLogger.log(`creating agent: ${agentName} (type: ${config.outputVisibility}, control: ${config.controlType})`);

        // Pipeline agents get special handling:
        // - Different instruction template (PIPELINE_TYPE_INSTRUCTIONS)
        // - Filtered mentions (tools only, no agents)
        // - No agent transfer instructions

        const { agent, entities } = createAgent(
            logger,
            projectId,
            config,
            tools,
            workflow,
            promptConfig,
        );
        agents[agentName] = agent;

        // Add pipeline entities to the agent's available mentions (unless it's a pipeline agent itself)
        // Pipeline agents cannot reference other agents or pipelines, only tools
        let agentEntities = entities;
        if (config.type !== 'pipeline') {
            agentEntities = [...entities, ...pipelineEntities];
            agentsLogger.log(`${agentName} can reference: ${entities.length} entities + ${pipelineEntities.length} pipelines`);
        } else {
            agentsLogger.log(`${agentName} (pipeline agent) can reference: ${entities.length} entities only`);
        }

        mentions[agentName] = agentEntities;
        originalInstructions[agentName] = agent.instructions as string;
        // handoffs will be set after all agents are created
    }

    agentsLogger.log(`=== SETTING UP HANDOFFS ===`);

    // set handoffs
    for (const [agentName, agent] of Object.entries(agents)) {
        const connectedAgentNames = (mentions[agentName] || []).filter(e => e.type === 'agent').map(e => e.name);
        const connectedPipelineNames = (mentions[agentName] || []).filter(e => e.type === 'pipeline').map(e => e.name);

        // Pipeline agents have no agent handoffs (filtered out in validatePipelineAgentMentions)
        // They only have tool connections, no agent transfers allowed

        // Filter out pipeline agents from being handoff targets
        // Only allow handoffs to non-pipeline agents
        const validAgentNames = connectedAgentNames.filter(name => {
            const targetConfig = agentConfig[name];
            return targetConfig && targetConfig.type !== 'pipeline';
        });

        // Convert pipeline mentions to handoffs to the first agent in each pipeline
        const pipelineFirstAgents: string[] = [];
        for (const pipelineName of connectedPipelineNames) {
            const pipeline = pipelineConfig[pipelineName];
            if (pipeline && pipeline.agents.length > 0) {
                const firstAgent = pipeline.agents[0];
                if (agentConfig[firstAgent] && !pipelineFirstAgents.includes(firstAgent)) {
                    pipelineFirstAgents.push(firstAgent);
                    agentsLogger.log(`${agentName} pipeline mention ${pipelineName} -> handoff to first agent: ${firstAgent}`);
                }
            }
        }

        // Combine regular agent handoffs with pipeline first agents
        const allHandoffTargets = [...validAgentNames, ...pipelineFirstAgents];

        // Only store Agent objects in handoffs (filter out Handoff if present)
        const agentHandoffs = allHandoffTargets.map(e => agents[e]).filter(Boolean) as Agent[];
        agent.handoffs = agentHandoffs;
        originalHandoffs[agentName] = agentHandoffs.filter(h => h instanceof Agent);
        agentsLogger.log(`set handoffs for ${agentName}: ${JSON.stringify(allHandoffTargets)}`);
    }

    // Set up pipeline agent handoff chains
    agentsLogger.log(`=== SETTING UP PIPELINE CHAINS ===`);
    for (const [pipelineName, pipeline] of Object.entries(pipelineConfig)) {
        agentsLogger.log(`setting up pipeline chain: ${pipelineName} -> [${pipeline.agents.join(' -> ')}]`);

        for (let i = 0; i < pipeline.agents.length; i++) {
            const currentAgentName = pipeline.agents[i];
            const currentAgent = agents[currentAgentName];

            if (!currentAgent) {
                agentsLogger.log(`warning: pipeline agent ${currentAgentName} not found in agent config`);
                continue;
            }

            // Pipeline agents have NO handoffs - they just execute once
            currentAgent.handoffs = [];

            // Add pipeline metadata to the agent for easy lookup
            (currentAgent as any).pipelineName = pipelineName;
            (currentAgent as any).pipelineIndex = i;
            (currentAgent as any).isLastInPipeline = i === pipeline.agents.length - 1;

            // Update originalHandoffs to reflect the final pipeline state
            originalHandoffs[currentAgentName] = [];

            agentsLogger.log(`pipeline agent ${currentAgentName} has no handoffs (will be controlled by pipeline controller)`);
            agentsLogger.log(`pipeline agent ${currentAgentName} metadata: pipeline=${pipelineName}, index=${i}, isLast=${i === pipeline.agents.length - 1}`);

            // Configure pipeline agents to relinquish control after completing their task
            const agentConfigObj = agentConfig[currentAgentName];
            if (agentConfigObj && agentConfigObj.type === 'pipeline') {
                agentsLogger.log(`configuring pipeline agent ${currentAgentName} to relinquish control after task completion`);
            }
        }
    }

    return { agents, mentions, originalInstructions, originalHandoffs };
}

// Helper to get give up control instructions for child agents
function getGiveUpControlInstructions(
    agent: Agent,
    parentAgentName: string,
    logger: PrefixLogger
): string {
    let dynamicInstructions: string;
    if (typeof agent.instructions === 'string') {
        dynamicInstructions = agent.instructions;
    } else {
        throw new Error('Agent instructions must be a string for dynamic injection.');
    }
    // Only include the @mention for the parent, not the tool call format
    const parentBlock = `@agent:${parentAgentName}`;
    // Import the template
    const { TRANSFER_GIVE_UP_CONTROL_INSTRUCTIONS } = require('./agent_instructions');
    dynamicInstructions = dynamicInstructions + '\n\n' + TRANSFER_GIVE_UP_CONTROL_INSTRUCTIONS(parentBlock);
    // For tracking
    logger.log(`Added give up control instructions for ${agent.name} with parent ${parentAgentName}`);
    return dynamicInstructions;
}

// Helper to dynamically inject give up control instructions and handoff
function maybeInjectGiveUpControlInstructions(
    agents: Record<string, Agent>,
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>,
    childAgentName: string,
    parentAgentName: string,
    logger: PrefixLogger,
    originalInstructions: Record<string, string>,
    originalHandoffs: Record<string, Agent[]>
) {
    // Reset to original before injecting
    agents[childAgentName].instructions = originalInstructions[childAgentName];
    agents[childAgentName].handoffs = [...originalHandoffs[childAgentName]];

    const agentConfigObj = agentConfig[childAgentName];
    const isInternal = agentConfigObj?.outputVisibility === 'internal';
    const isPipeline = agentConfigObj?.type === 'pipeline';
    const isRetain = agentConfigObj?.controlType === 'retain';
    const injectLogger = logger.child(`inject`);
    injectLogger.log(`isInternal: ${isInternal}`);
    injectLogger.log(`isPipeline: ${isPipeline}`);
    injectLogger.log(`isRetain: ${isRetain}`);

    // For pipeline agents, they should continue pipeline execution, so no need to inject give up control
    if (isPipeline) {
        injectLogger.log(`Pipeline agent ${childAgentName} continues pipeline execution, no give up control needed`);
        return;
    }

    if (!isInternal && isRetain) {
        // inject give up control instructions
        agents[childAgentName].instructions = getGiveUpControlInstructions(agents[childAgentName], parentAgentName, injectLogger);
        injectLogger.log(`Added give up control instructions for ${childAgentName} with parent ${parentAgentName}`);
        // add the parent agent to the handoff list if not already present
        if (!agents[childAgentName].handoffs.includes(agents[parentAgentName])) {
            agents[childAgentName].handoffs.push(agents[parentAgentName]);
        }
        injectLogger.log(`Added parent ${parentAgentName} to handoffs for ${childAgentName}`);
    }
}

// Pipeline controller function to handle pipeline agent execution and transfers
function handlePipelineAgentExecution(
    currentAgent: Agent,
    currentAgentName: string,
    pipelineConfig: Record<string, z.infer<typeof WorkflowPipeline>>,
    stack: string[],
    logger: PrefixLogger,
    turnMsgs: z.infer<typeof Message>[],
    transferCounter: AgentTransferCounter,
    createTransferEvents: (fromAgent: string, toAgent: string) => [z.infer<typeof AssistantMessageWithToolCalls>, z.infer<typeof ToolMessage>]
): { nextAgentName: string | null; shouldContinue: boolean; transferEvents?: [z.infer<typeof AssistantMessageWithToolCalls>, z.infer<typeof ToolMessage>] } {
    const pipelineName = (currentAgent as any).pipelineName;
    const pipelineIndex = (currentAgent as any).pipelineIndex;
    const isLastInPipeline = (currentAgent as any).isLastInPipeline;

    if (!pipelineName || pipelineIndex === undefined) {
        logger.log(`warning: pipeline agent ${currentAgentName} missing pipeline metadata`);
        return { nextAgentName: null, shouldContinue: false };
    }

    const pipeline = pipelineConfig[pipelineName];
    if (!pipeline) {
        logger.log(`warning: pipeline ${pipelineName} not found in config`);
        return { nextAgentName: null, shouldContinue: false };
    }

    let nextAgentName: string | null = null;

    if (!isLastInPipeline) {
        // Not the last agent - continue to next agent in pipeline
        nextAgentName = pipeline.agents[pipelineIndex + 1];
        logger.log(`-- pipeline controller: ${currentAgentName} -> ${nextAgentName} (continuing pipeline ${pipelineName})`);
    } else {
        // Last agent - return to calling agent
        nextAgentName = stack.pop()!;
        logger.log(`-- pipeline controller: ${currentAgentName} -> ${nextAgentName} (pipeline ${pipelineName} complete, returning to caller)`);
    }

    if (nextAgentName) {
        // Create transfer events for pipeline continuation
        const transferEvents = createTransferEvents(currentAgentName, nextAgentName);
        const [transferStart, transferComplete] = transferEvents;

        // Add messages to turn
        turnMsgs.push(transferStart);
        turnMsgs.push(transferComplete);

        // Update transfer counter
        transferCounter.increment(currentAgentName, nextAgentName);

        logger.log(`switched to agent: ${nextAgentName} || reason: pipeline controller transfer`);

        return { nextAgentName, shouldContinue: true, transferEvents };
    }

    return { nextAgentName: null, shouldContinue: false };
}

// Main function to stream an agentic response
// using OpenAI Agents SDK
export async function* streamResponse(
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    messages: z.infer<typeof Message>[],
): AsyncIterable<z.infer<typeof ZOutMessage> | z.infer<typeof ZUsage>> {
    // Divider log for tracking agent loop start
    console.log('-------------------- AGENT LOOP START --------------------');
    // set up logging
    let logger = new PrefixLogger(`agent-loop`)
    logger.log('projectId', projectId);

    // ensure valid system message
    ensureSystemMessage(logger, messages);

    // if there is only a system message, emit greeting turn and return
    if (messages.length === 1 && messages[0]?.role === 'system') {
        yield* emitGreetingTurn(logger, workflow);
        return;
    }

    // create map of agent, tool and prompt configs
    const { agentConfig, toolConfig, promptConfig, pipelineConfig } = mapConfig(workflow);

    // Debug: Log configuration summary
    logger.log(`=== WORKFLOW CONFIGURATION ===`);
    logger.log(`agents: ${Object.keys(agentConfig).length} (${Object.keys(agentConfig).join(', ')})`);
    logger.log(`tools: ${Object.keys(toolConfig).length} (${Object.keys(toolConfig).join(', ')})`);
    logger.log(`prompts: ${Object.keys(promptConfig).length} (${Object.keys(promptConfig).join(', ')})`);
    logger.log(`pipelines: ${Object.keys(pipelineConfig).length} (${Object.keys(pipelineConfig).join(', ')})`);
    logger.log(`start agent: ${workflow.startAgent}`);
    logger.log(`=== END CONFIGURATION ===`);

    const stack: string[] = [];
    logger.log(`initialized stack: ${JSON.stringify(stack)}`);

    // create tools
    const tools = createTools(logger, projectId, workflow, toolConfig);

    // create agents
    const { agents, originalInstructions, originalHandoffs } = createAgents(logger, projectId, workflow, agentConfig, tools, promptConfig, pipelineConfig);

    // track agent to agent calls
    const transferCounter = new AgentTransferCounter();

    // get the agent that should be starting this turn
    const startOfTurnAgentName = getStartOfTurnAgentName(logger, messages, agentConfig, workflow);
    logger.log(`🎯 START AGENT DECISION: ${startOfTurnAgentName}`);

    let agentName = startOfTurnAgentName;

    // start the turn loop
    const usageTracker = new UsageTracker();
    const turnMsgs: z.infer<typeof Message>[] = [...messages];

    logger.log('🎬 STARTING AGENT TURN');

    // stack-based agent execution loop
    let iter = 0;
    const MAXTURNITERATIONS = 10;

    // loop indefinitely
    turnLoop: while (true) {

        logger.log(`🔄 TURN ITERATION: ${iter + 1}/${MAXTURNITERATIONS}`);
        const loopLogger = logger.child(`iter-${iter + 1}`);

        loopLogger.log(`🤖 CURRENT AGENT: ${agentName}`);
        loopLogger.log(`📚 AGENT STACK: [${stack.join(' -> ')}]`);

        // increment loop counter
        iter++;

        // set up logging
        // const loopLogger = logger.child(`iter-${iter}`);

        // log agent info
        // loopLogger.log(`agent name: ${agentName}`);
        // loopLogger.log(`stack: ${JSON.stringify(stack)}`);
        if (!agents[agentName]) {
            throw new Error(`agent not found in agent config!`);
        }
        const agent: Agent = agents[agentName]!;

        // convert messages to agents sdk compatible input
        const inputs = convertMsgsInput(turnMsgs);

        // run the agent
        const result = await run(
            agent,
            inputs,
            {
                stream: true,
            }
        );

        // handle streaming events
        for await (const event of result) {
            const eventLogger = loopLogger.child(event.type);

            switch (event.type) {
                case 'raw_model_stream_event':
                    if (event.data.type === 'response_done') {
                        for (const output of event.data.response.output) {
                            // handle tool call invocation
                            // except for transfer_to_* tool calls
                            if (output.type === 'function_call' && !output.name.startsWith('transfer_to')) {
                                const m: z.infer<typeof Message> = {
                                    role: 'assistant',
                                    content: null,
                                    toolCalls: [{
                                        id: output.callId,
                                        type: 'function',
                                        function: {
                                            name: output.name,
                                            arguments: output.arguments,
                                        },
                                    }],
                                    agentName: agentName,
                                };

                                // add message to turn
                                turnMsgs.push(m);

                                // emit event
                                yield* emitEvent(eventLogger, m);
                            }
                        }

                        // update usage information
                        usageTracker.increment(
                            event.data.response.usage.totalTokens,
                            event.data.response.usage.inputTokens,
                            event.data.response.usage.outputTokens
                        );
                        eventLogger.log(`updated usage information: ${JSON.stringify(usageTracker.get())}`);
                    }
                    break;
                case 'run_item_stream_event':
                    // handle handoff event
                    if (event.name === 'handoff_occurred' && event.item.type === 'handoff_output_item') {
                        eventLogger.log(`🔄 HANDOFF EVENT: ${agentName} -> ${event.item.targetAgent.name}`);

                        // skip if its the same agent
                        if (agentName === event.item.targetAgent.name) {
                            eventLogger.log(`⚠️ SKIPPING: handoff to same agent: ${agentName}`);
                            break;
                        }

                        // Only apply max calls limit to internal agents (task agents)
                        const targetAgentConfig = agentConfig[event.item.targetAgent.name];
                        if (targetAgentConfig?.outputVisibility === 'internal') {
                            const maxCalls = targetAgentConfig?.maxCallsPerParentAgent || 3;
                            const currentCalls = transferCounter.get(agentName, event.item.targetAgent.name);
                            if (currentCalls >= maxCalls) {
                                eventLogger.log(`⚠️ SKIPPING: handoff to ${event.item.targetAgent.name} - max calls ${maxCalls} exceeded from ${agentName}`);
                                continue;
                            }
                            eventLogger.log(`📊 TRANSFER COUNT: ${agentName} -> ${event.item.targetAgent.name} = ${currentCalls}/${maxCalls}`);
                        }

                        // inject give up control instructions if needed (parent handing off to child)
                        maybeInjectGiveUpControlInstructions(
                            agents,
                            agentConfig,
                            event.item.targetAgent.name, // child
                            agentName, // parent
                            eventLogger,
                            originalInstructions,
                            originalHandoffs
                        );

                        // emit transfer tool call invocation
                        const [transferStart, transferComplete] = createTransferEvents(agentName, event.item.targetAgent.name);

                        // add messages to turn
                        turnMsgs.push(transferStart);
                        turnMsgs.push(transferComplete);

                        // emit events
                        yield* emitEvent(eventLogger, transferStart);
                        yield* emitEvent(eventLogger, transferComplete);

                        // update transfer counter
                        transferCounter.increment(agentName, event.item.targetAgent.name);

                        const newAgentName = event.item.targetAgent.name;

                        loopLogger.log(`🔄 AGENT SWITCH: ${agentName} -> ${newAgentName} (reason: handoff)`);

                        // add current agent to stack only if new agent is internal
                        const newAgentConfig = agentConfig[newAgentName];
                        if (newAgentConfig?.outputVisibility === 'internal' || newAgentConfig?.type === 'pipeline') {
                            stack.push(agentName);
                            loopLogger.log(`📚 STACK PUSH: ${agentName} (new agent ${newAgentName} is internal/pipeline)`);
                            loopLogger.log(`📚 STACK NOW: [${stack.join(' -> ')}]`);
                        }

                        // set this as the new agent name
                        agentName = newAgentName;

                    }

                    // handle tool call result
                    if (event.item.type === 'tool_call_output_item' &&
                        event.item.rawItem.type === 'function_call_result' &&
                        event.item.rawItem.status === 'completed' &&
                        event.item.rawItem.output.type === 'text') {
                        const m: z.infer<typeof Message> = {
                            role: 'tool',
                            content: event.item.rawItem.output.text,
                            toolCallId: event.item.rawItem.callId,
                            toolName: event.item.rawItem.name,
                        };

                        // add message to turn
                        turnMsgs.push(m);

                        // emit event
                        yield* emitEvent(eventLogger, m);
                    }

                    // handle model response message output
                    if (event.item.type === 'message_output_item' &&
                        event.item.rawItem.type === 'message' &&
                        event.item.rawItem.status === 'completed') {
                        // check response visibility
                        const agentConfigObj = agentConfig[agentName];
                        const isInternal = agentConfigObj?.outputVisibility === 'internal' || agentConfigObj?.type === 'pipeline';
                        for (const content of event.item.rawItem.content) {
                            if (content.type === 'output_text') {
                                // create message
                                const msg: z.infer<typeof Message> = {
                                    role: 'assistant',
                                    content: content.text,
                                    agentName: agentName,
                                    responseType: isInternal ? 'internal' : 'external',
                                };

                                // add message to turn
                                turnMsgs.push(msg);

                                // emit event
                                yield* emitEvent(eventLogger, msg);
                            }
                        }

                        // if this is an internal agent or pipeline agent, switch to previous agent
                        if (isInternal) {
                            const current = agentName;
                            const currentAgentConfig = agentConfig[agentName];

                            // Check if this is a pipeline agent that needs to continue the pipeline
                            if (currentAgentConfig?.type === 'pipeline') {
                                const result = handlePipelineAgentExecution(
                                    agents[current], // Use the correct agent from agents collection
                                    current,
                                    pipelineConfig,
                                    stack,
                                    loopLogger,
                                    turnMsgs,
                                    transferCounter,
                                    createTransferEvents
                                );

                                // Emit transfer events if they exist
                                if (result.transferEvents) {
                                    const [transferStart, transferComplete] = result.transferEvents;
                                    yield* emitEvent(eventLogger, transferStart);
                                    yield* emitEvent(eventLogger, transferComplete);
                                }

                                if (result.shouldContinue) {
                                    agentName = result.nextAgentName!;
                                    // Run the turn from the next agent
                                    continue turnLoop;
                                }
                            }

                            // Check control type to determine next action for non-pipeline agents
                            if (currentAgentConfig?.controlType === 'relinquish_to_parent' || currentAgentConfig?.controlType === 'retain') {
                                agentName = stack.pop()!;
                                loopLogger.log(`-- popped agent from stack: ${agentName} || reason: ${current} is an internal agent, it put out a message and it has a control type of ${currentAgentConfig?.controlType}, hence the flow of control needs to return to the previous agent`);
                            } else if (currentAgentConfig?.controlType === 'relinquish_to_start') {
                                agentName = workflow.startAgent;
                                loopLogger.log(`-- using start agent: ${agentName} || reason: ${current} is an internal agent, it put out a message and it has a control type of ${currentAgentConfig?.controlType}, hence the flow of control needs to return to the start agent`);
                            }

                            // Only emit transfer events if we're actually changing agents
                            if (agentName !== current) {
                                loopLogger.log(`-- stack is now: ${JSON.stringify(stack)}`);

                                // emit transfer tool call invocation
                                const [transferStart, transferComplete] = createTransferEvents(current, agentName);

                                // add messages to turn
                                turnMsgs.push(transferStart);
                                turnMsgs.push(transferComplete);

                                // emit events
                                yield* emitEvent(eventLogger, transferStart);
                                yield* emitEvent(eventLogger, transferComplete);

                                // update transfer counter
                                transferCounter.increment(current, agentName);

                                // set this as the new agent name
                                loopLogger.log(`switched to agent: ${agentName} || reason: internal agent (${current}) put out a message`);

                                // run the turn from the previous agent
                                continue turnLoop;
                            }
                        }
                        break;
                    }
                    break;
                default:
                    break;
            }
        }

        // if the last message was a text response by a user-facing agent, complete the turn
        // loopLogger.log(`iter end, turnMsgs: ${JSON.stringify(turnMsgs)}, agentName: ${agentName}`);
        const lastMessage = turnMsgs[turnMsgs.length - 1];
        if (agentConfig[agentName]?.outputVisibility === 'user_facing' &&
            lastMessage?.role === 'assistant' &&
            lastMessage?.content !== null &&
            lastMessage?.agentName === agentName
        ) {
            loopLogger.log(`last message was by a user_facing agent, breaking out of parent loop`);
            break turnLoop;
        }
    }

    // emit usage information
    yield* emitEvent(logger, usageTracker.asEvent());
}

// this is a sync version of streamResponse
export async function getResponse(
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    messages: z.infer<typeof Message>[],
): Promise<{
    messages: z.infer<typeof ZOutMessage>[],
    usage: z.infer<typeof ZUsage>,
}> {
    const out: z.infer<typeof ZOutMessage>[] = [];
    let usage: z.infer<typeof ZUsage> = {
        tokens: {
            total: 0,
            prompt: 0,
            completion: 0,
        },
    };
    for await (const event of streamResponse(projectId, workflow, messages)) {
        if ('role' in event) {
            out.push(event);
        }
        if ('tokens' in event) {
            usage = event;
        }
    }
    return { messages: out, usage };
}