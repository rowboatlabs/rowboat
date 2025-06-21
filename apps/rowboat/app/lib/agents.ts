// External dependencies
import { Agent, AgentInputItem, run, tool, Tool } from "@openai/agents";
import { RECOMMENDED_PROMPT_PREFIX } from "@openai/agents-core/extensions";
import { aisdk } from "@openai/agents-extensions";
import { createOpenAI } from "@ai-sdk/openai";
import { CoreMessage, embed, generateText } from "ai";
import { ObjectId } from "mongodb";
import { z } from "zod";

// Internal dependencies
import { embeddingModel } from '../lib/embedding';
import { getMcpClient } from "./mcp";
import { dataSourceDocsCollection, dataSourcesCollection } from "./mongodb";
import { qdrantClient } from '../lib/qdrant';
import { EmbeddingRecord } from "./types/datasource_types";
import { ConnectedEntity, sanitizeTextWithMentions, Workflow, WorkflowAgent, WorkflowPrompt, WorkflowTool } from "./types/workflow_types";
import { CHILD_TRANSFER_RELATED_INSTRUCTIONS } from "./agent_instructions";
import { PrefixLogger } from "./utils";
import { Message, AssistantMessageWithToolCalls, ToolMessage } from "./types/types";

const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || undefined;
const MODEL = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4o';

const openai = createOpenAI({
    apiKey: PROVIDER_API_KEY,
    baseURL: PROVIDER_BASE_URL,
});

export const Done = z.object({
    tokens: z.object({
        total: z.number(),
        prompt: z.number(),
        completion: z.number(),
    }),
});

// Helper to handle mock tool responses
async function invokeMockTool(
    logger: PrefixLogger,
    toolName: string,
    args: string,
    description: string,
    mockInstructions: string
): Promise<string> {
    logger = logger.child(`invokeMockTool`);
    logger.log(`toolName: ${toolName}`);
    logger.log(`args: ${args}`);
    logger.log(`description: ${description}`);
    logger.log(`mockInstructions: ${mockInstructions}`);

    const messages: CoreMessage[] = [{
        role: "system" as const,
        content: `You are simulating the execution of a tool called '${toolName}'. Here is the description of the tool: ${description}. Here are the instructions for the mock tool: ${mockInstructions}. Generate a realistic response as if the tool was actually executed with the given parameters.`
    }, {
        role: "user" as const,
        content: `Generate a realistic response for the tool '${toolName}' with these parameters: ${args}. The response should be concise and focused on what the tool would actually return.`
    }];

    const { text } = await generateText({
        model: openai(MODEL),
        messages,
    });
    logger.log(`generated text: ${text}`);

    return text;
}

// Helper to handle RAG tool calls
async function invokeRagTool(
    logger: PrefixLogger,
    projectId: string,
    query: string,
    sourceIds: string[],
    returnType: 'chunks' | 'content',
    k: number
): Promise<{
    title: string;
    name: string;
    content: string;
    docId: string;
    sourceId: string;
}[]> {
    logger = logger.child(`invokeRagTool`);
    logger.log(`projectId: ${projectId}`);
    logger.log(`query: ${query}`);
    logger.log(`sourceIds: ${sourceIds.join(', ')}`);
    logger.log(`returnType: ${returnType}`);
    logger.log(`k: ${k}`);

    // Create embedding for question
    const { embedding } = await embed({
        model: embeddingModel,
        value: query,
    });

    // Fetch all data sources for this project
    const sources = await dataSourcesCollection.find({
        projectId: projectId,
        active: true,
    }).toArray();
    const validSourceIds = sources
        .filter(s => sourceIds.includes(s._id.toString())) // id should be in sourceIds
        .filter(s => s.active) // should be active
        .map(s => s._id.toString());
    logger.log(`valid source ids: ${validSourceIds.join(', ')}`);

    // if no sources found, return empty response
    if (validSourceIds.length === 0) {
        logger.log(`no valid source ids found, returning empty response`);
        return [];
    }

    // Perform vector search
    const qdrantResults = await qdrantClient.query("embeddings", {
        query: embedding,
        filter: {
            must: [
                { key: "projectId", match: { value: projectId } },
                { key: "sourceId", match: { any: validSourceIds } },
            ],
        },
        limit: k,
        with_payload: true,
    });
    logger.log(`found ${qdrantResults.points.length} results`);

    // if return type is chunks, return the chunks
    let results = qdrantResults.points.map((point) => {
        const { title, name, content, docId, sourceId } = point.payload as z.infer<typeof EmbeddingRecord>['payload'];
        return {
            title,
            name,
            content,
            docId,
            sourceId,
        };
    });

    if (returnType === 'chunks') {
        logger.log(`returning chunks`);
        return results;
    }

    // otherwise, fetch the doc contents from mongodb
    const docs = await dataSourceDocsCollection.find({
        _id: { $in: results.map(r => new ObjectId(r.docId)) },
    }).toArray();
    logger.log(`fetched docs: ${docs.length}`);

    // map the results to the docs
    results = results.map(r => {
        const doc = docs.find(d => d._id.toString() === r.docId);
        return {
            ...r,
            content: doc?.content || '',
        };
    });

    return results;
}

// Helper to handle MCP tool calls
async function invokeMcpTool(
    logger: PrefixLogger,
    projectId: string,
    name: string,
    input: any,
    mcpServerURL: string,
    mcpServerName: string
) {
    logger = logger.child(`invokeMcpTool`);
    logger.log(`projectId: ${projectId}`);
    logger.log(`name: ${name}`);
    logger.log(`input: ${JSON.stringify(input)}`);
    logger.log(`mcpServerURL: ${mcpServerURL}`);
    logger.log(`mcpServerName: ${mcpServerName}`);

    const client = await getMcpClient(mcpServerURL, mcpServerName || '');
    const result = await client.callTool({
        name,
        arguments: input,
    });
    logger.log(`mcp tool result: ${JSON.stringify(result)}`);
    await client.close();
    return result;
}

// Helper to create RAG tool
function createRagTool(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowAgent>,
    projectId: string
): Tool | null {
    if (!config.ragDataSources?.length) return null;

    return tool({
        name: "rag_search",
        description: "Get information about an article",
        parameters: z.object({
            query: z.string().describe("The query to search for")
        }),
        async execute(input: { query: string }) {
            const results = await invokeRagTool(
                logger,
                projectId,
                input.query,
                config.ragDataSources || [],
                config.ragReturnType || 'chunks',
                config.ragK || 3
            );
            return JSON.stringify({
                results,
            });
        }
    });
}

// Helper to create a mock tool
function createMockTool(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowTool>,
): Tool {
    return tool({
        name: "mock_tool",
        description: "Mock tool",
        parameters: z.object({
            query: z.string().describe("The query to search for")
        }),
        async execute(input: { query: string }) {
            try {
                const result = await invokeMockTool(
                    logger,
                    config.name,
                    JSON.stringify(input),
                    config.description,
                    config.mockInstructions || ''
                );
                return JSON.stringify({
                    result,
                });
            } catch (error) {
                logger.log(`Error executing mock tool ${config.name}:`, error);
                return JSON.stringify({
                    error: `Mock tool execution failed: ${error}`,
                });
            }
        }
    });
}

// Helper to create an mcp tool
function createMcpTool(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowTool>,
    projectId: string
): Tool {
    const { name, description, parameters, mcpServerName, mcpServerURL } = config;

    return tool({
        name,
        description,
        strict: false,
        parameters: {
            type: 'object',
            properties: parameters.properties,
            required: parameters.required || [],
            additionalProperties: true,
        },
        async execute(input: any) {
            try {
                const result = await invokeMcpTool(logger, projectId, name, input, mcpServerURL || '', mcpServerName || '');
                return JSON.stringify({
                    result,
                });
            } catch (error) {
                logger.log(`Error executing mcp tool ${name}:`, error);
                return JSON.stringify({
                    error: `Tool execution failed: ${error}`,
                });
            }
        }
    });
}

// Helper to create an agent
function createAgentFromConfig(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowAgent>,
    tools: Record<string, Tool>,
    projectTools: z.infer<typeof WorkflowTool>[],
    workflow: z.infer<typeof Workflow>,
): { agent: Agent, entities: z.infer<typeof ConnectedEntity>[] } {
    // Combine instructions and examples
    const compiledInstructions = config.instructions +
        (config.examples ? '\n\n# Examples\n' + config.examples : '');

    const { sanitized, entities } = sanitizeTextWithMentions(compiledInstructions, workflow, projectTools);

    const agentTools = entities.filter(e => e.type === 'tool').map(e => tools[e.name]).filter(Boolean) as Tool[];

    // Add RAG tool if needed
    if (config.ragDataSources?.length) {
        const ragTool = createRagTool(logger, config, workflow.projectId);
        if (ragTool) {
            agentTools.push(ragTool);
        }
    }

    // Create the agent
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

    // add child transfer related instructions
    agent.instructions = agent.instructions + `\n\n${'-'.repeat(100)}\n\n${CHILD_TRANSFER_RELATED_INSTRUCTIONS}`;

    // add openai recommended instructions
    agent.instructions = RECOMMENDED_PROMPT_PREFIX + '\n\n' + agent.instructions;

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
                    text: msg.content,
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
function getNextAgentName(
    logger: PrefixLogger,
    stack: string[],
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>,
    workflow: z.infer<typeof Workflow>,
): string {
    logger = logger.child(`getNextAgentName`);
    logger.log(`stack: ${stack.join(', ')}`);

    // get the last agent from the stack
    // if stack is empty, use the start agent
    const lastAgentName = stack.pop() || workflow.startAgent;

    return lastAgentName;

    // TODO: control-type logic is being ignored for now
    // if control type is retain, return last agent
    // const lastAgentName = stack.pop() || workflow.startAgent;
    // const lastAgentConfig = agentConfig[lastAgentName];
    // if (!lastAgentConfig) {
    //     logger.log(`last agent ${lastAgentName} not found in agent config, returning start agent: ${workflow.startAgent}`);
    //     return workflow.startAgent;
    // }
    // switch (lastAgentConfig.controlType) {
    //     case 'retain':
    //         logger.log(`last agent ${lastAgentName} control type is retain, returning last agent: ${lastAgentName}`);
    //         return lastAgentName;
    //     case 'relinquish_to_parent':
    //         const parentAgentName = stack.pop() || workflow.startAgent;
    //         logger.log(`last agent ${lastAgentName} control type is relinquish_to_parent, returning most recent parent: ${parentAgentName}`);
    //         return parentAgentName;
    //     case 'relinquish_to_start':
    //         logger.log(`last agent ${lastAgentName} control type is relinquish_to_start, returning start agent: ${workflow.startAgent}`);
    //         return workflow.startAgent;
    // }
}

// Logs an event and then yields it
async function* emitEvent(
    logger: PrefixLogger,
    event: z.infer<typeof Message> | z.infer<typeof Done>,
): AsyncGenerator<z.infer<typeof Message> | z.infer<typeof Done>> {
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

    asEvent(): z.infer<typeof Done> {
        return {
            tokens: this.usage,
        };
    }
}

function ensureSystemMessage(logger: PrefixLogger, messages: z.infer<typeof Message>[]) {
    logger = logger.child(`ensureSystemMessage`);

    // ensure that a system message is set
    if (messages.length > 0 && messages[0]?.role !== 'system') {
        messages.unshift({
            role: 'system',
            content: 'You are a helpful assistant.',
        });
        logger.log(`added system message: ${messages[0]?.content}`);
    }

    // ensure that system message isn't blank
    if (messages.length > 0 && messages[0]?.role === 'system' && !messages[0].content) {
        messages[0].content = 'You are a helpful assistant.';
        logger.log(`updated system message: ${messages[0].content}`);
    }
}

function mapConfig(workflow: z.infer<typeof Workflow>, projectTools: z.infer<typeof WorkflowTool>[]): {
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>;
    toolConfig: Record<string, z.infer<typeof WorkflowTool>>;
    promptConfig: Record<string, z.infer<typeof WorkflowPrompt>>;
} {
    const agentConfig: Record<string, z.infer<typeof WorkflowAgent>> = workflow.agents.reduce((acc, agent) => ({
        ...acc,
        [agent.name]: agent
    }), {});
    const toolConfig: Record<string, z.infer<typeof WorkflowTool>> = [
        ...workflow.tools,
        ...projectTools,
    ].reduce((acc, tool) => ({
        ...acc,
        [tool.name]: tool
    }), {});
    const promptConfig: Record<string, z.infer<typeof WorkflowPrompt>> = workflow.prompts.reduce((acc, prompt) => ({
        ...acc,
        [prompt.name]: prompt
    }), {});
    return { agentConfig, toolConfig, promptConfig };
}

async function* emitGreetingTurn(logger: PrefixLogger, workflow: z.infer<typeof Workflow>): AsyncGenerator<z.infer<typeof Message> | z.infer<typeof Done>> {
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

function createAgentCallStack(messages: z.infer<typeof Message>[]): string[] {
    const stack: string[] = [];
    for (const msg of messages) {
        if (msg.role === 'assistant' && msg.agentName) {
            stack.push(msg.agentName);
        }
    }
    return stack;
}

function createTools(logger: PrefixLogger, workflow: z.infer<typeof Workflow>, toolConfig: Record<string, z.infer<typeof WorkflowTool>>): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const [toolName, config] of Object.entries(toolConfig)) {
        if (config.isMcp) {
            tools[toolName] = createMcpTool(logger, config, workflow.projectId);
            logger.log(`created mcp tool: ${toolName}`);
        } else if (config.mockTool) {
            tools[toolName] = createMockTool(logger, config);
            logger.log(`created mock tool: ${toolName}`);
        } else {
            logger.log(`unsupported tool type: ${toolName}`);
        }
    }
    return tools;
}

function createAgents(logger: PrefixLogger, workflow: z.infer<typeof Workflow>, agentConfig: Record<string, z.infer<typeof WorkflowAgent>>, tools: Record<string, Tool>, projectTools: z.infer<typeof WorkflowTool>[]): { agents: Record<string, Agent>, mentions: Record<string, z.infer<typeof ConnectedEntity>[]> } {
    const agents: Record<string, Agent> = {};
    const mentions: Record<string, z.infer<typeof ConnectedEntity>[]> = {};
    for (const [agentName, config] of Object.entries(agentConfig)) {
        const { agent, entities } = createAgentFromConfig(
            logger,
            config,
            tools,
            projectTools,
            workflow
        );
        agents[agentName] = agent;
        mentions[agentName] = entities;
        logger.log(`created agent: ${agentName}`);
    }
    return { agents, mentions };
}

function setHandoffs(logger: PrefixLogger, agents: Record<string, Agent>, mentions: Record<string, z.infer<typeof ConnectedEntity>[]>): void {
    for (const [agentName, agent] of Object.entries(agents)) {
        const connectedAgentNames = (mentions[agentName] || []).filter(e => e.type === 'agent').map(e => e.name);
        agent.handoffs = connectedAgentNames.map(e => agents[e]).filter(Boolean) as Agent[];
        logger.log(`set handoffs for ${agentName}: ${connectedAgentNames.join(',')}`);
    }
}

// Main function to generate an agentic response
// using OpenAI Agents SDK
export async function* generateAgenticResponse(
    workflow: z.infer<typeof Workflow>,
    projectTools: z.infer<typeof WorkflowTool>[],
    messages: z.infer<typeof Message>[],
): AsyncGenerator<z.infer<typeof Message> | z.infer<typeof Done>> {
    // set up logging
    let logger = new PrefixLogger(`agent-loop`)
    logger.log('projectId', workflow.projectId);
    logger.log('workflow', workflow.name);

    // ensure valid system message
    ensureSystemMessage(logger, messages);

    // if there is only a system message, emit greeting turn and return
    if (messages.length === 1 && messages[0]?.role === 'system') {
        yield* emitGreetingTurn(logger, workflow);
        return;
    }

    // create map of agent, tool and prompt configs
    const { agentConfig, toolConfig, promptConfig } = mapConfig(workflow, projectTools);

    // create agent call stack from input messages
    const stack = createAgentCallStack(messages);

    // create tools
    const tools = createTools(logger, workflow, toolConfig);

    // create agents, record connections
    const { agents, mentions } = createAgents(logger, workflow, agentConfig, tools, projectTools);

    // set up agent handoffs
    setHandoffs(logger, agents, mentions);

    // track agent to agent calls
    const transferCounter = new AgentTransferCounter();

    // track usage
    const usageTracker = new UsageTracker();

    // get next agent name
    let agentName = getNextAgentName(logger, stack, agentConfig, workflow);

    // set up initial state for loop
    logger.log('@@ starting agent turn @@');
    let iter = 0;
    const turnMsgs: z.infer<typeof Message>[] = [...messages];

    // loop indefinitely
    turnLoop: while (true) {
        // increment loop counter
        iter++;

        // set up logging
        const loopLogger = logger.child(`iter-${iter}`);

        // log agent info
        loopLogger.log(`agent name: ${agentName}`);
        loopLogger.log(`stack: ${stack.join(', ')}`);
        if (!agents[agentName]) {
            throw new Error(`agent not found in agent config!`);
        }
        const agent: Agent = agents[agentName]!;

        // convert messages to agents sdk compatible input
        const inputs = convertMsgsInput(turnMsgs);

        // run the agent
        const result = await run(agent, inputs, {
            stream: true,
        });

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
                        // skip if its the same agent
                        if (agentName === event.item.targetAgent.name) {
                            eventLogger.log(`skipping handoff to same agent: ${agentName}`);
                            break;
                        }

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

                        // add current agent to stack
                        stack.push(agentName);

                        // set this as the new agent name
                        agentName = event.item.targetAgent.name;
                        loopLogger.log(`switched to agent: ${agentName}`);
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
                        const isInternal = agentConfig[agentName]?.outputVisibility === 'internal';
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

                        // if this is an internal agent, switch to previous agent
                        if (isInternal) {
                            const prevAgent = stack.pop() || workflow.startAgent;

                            // emit transfer tool call invocation
                            const [transferStart, transferComplete] = createTransferEvents(agentName, prevAgent);

                            // add messages to turn
                            turnMsgs.push(transferStart);
                            turnMsgs.push(transferComplete);

                            // emit events
                            yield* emitEvent(eventLogger, transferStart);
                            yield* emitEvent(eventLogger, transferComplete);

                            // update transfer counter
                            transferCounter.increment(agentName, prevAgent);

                            // add current agent to stack
                            stack.push(agentName);

                            // set this as the new agent name
                            agentName = prevAgent;
                            loopLogger.log(`switched to agent (reason: internal agent put out a message): ${agentName}`);

                            // run the turn from the previous agent
                            continue turnLoop;
                        }
                        break;
                    }
                    break;
                default:
                    break;
            }
        }

        // if the last message was a text response by a user-facing agent, complete the turn
        const lastMessage = turnMsgs[turnMsgs.length - 1];
        if (agentConfig[agent.name]?.outputVisibility === 'user_facing' &&
            lastMessage?.role === 'assistant' &&
            lastMessage?.content !== null &&
            lastMessage?.agentName === agent.name
        ) {
            loopLogger.log(`last message was by a user_facing agent, breaking out of parent loop`);
            break turnLoop;
        }
    }

    // emit usage information
    yield* emitEvent(logger, usageTracker.asEvent());
}