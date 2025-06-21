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

    const agentTools = entities.filter(e => e.type === 'tool').map(e => tools[e.name]).filter(Boolean);

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

    // if last agent isn't set, return start agent
    if (!stack.length) {
        logger.log(`no stack, returning start agent: ${workflow.startAgent}`);
        return workflow.startAgent;
    }

    // if control type is retain, return last agent
    const lastAgentName = stack.pop() || workflow.startAgent;
    const lastAgentConfig = agentConfig[lastAgentName];
    if (!lastAgentConfig) {
        logger.log(`last agent ${lastAgentName} not found in agent config, returning start agent: ${workflow.startAgent}`);
        return workflow.startAgent;
    }
    switch (lastAgentConfig.controlType) {
        case 'retain':
            logger.log(`last agent ${lastAgentName} control type is retain, returning last agent: ${lastAgentName}`);
            return lastAgentName;
        case 'relinquish_to_parent':
            const parentAgentName = stack.pop() || workflow.startAgent;
            logger.log(`last agent ${lastAgentName} control type is relinquish_to_parent, returning most recent parent: ${parentAgentName}`);
            return parentAgentName;
        case 'relinquish_to_start':
            logger.log(`last agent ${lastAgentName} control type is relinquish_to_start, returning start agent: ${workflow.startAgent}`);
            return workflow.startAgent;
    }
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

class AgentToAgentCallCounter {
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

    // Ensure that system message, if any, is not blank
    if (messages.length > 0 && messages[0].role === 'system' && !messages[0].content) {
        messages[0].content = 'You are a helpful assistant.';
        logger.log(`updated system message: ${messages[0].content}`);
    }

    // Ensure system message is set
    if (messages.length && messages[0].role !== 'system') {
        messages.unshift({
            role: 'system',
            content: 'You are a helpful assistant.',
        });
        logger.log(`added system message: ${messages[0].content}`);
    }

    // If there is nothing but a system message, handle it as a greeting turn
    if (messages.length === 1 && messages[0].role === 'system') {
        const greetingPrompt = workflow.prompts.find(p => p.type === 'greeting')?.prompt || 'How can I help you today?';
        logger.log(`greeting turn: ${greetingPrompt}`);
        yield* emitEvent(logger, {
            role: 'assistant',
            content: greetingPrompt,
            agentName: workflow.startAgent,
            responseType: 'external',
        });
        yield* emitEvent(logger, new UsageTracker().asEvent());
        return;
    }

    // create map of agent, tool and prompt configs
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

    // create agent call stack from messages
    const stack: string[] = [];
    for (const msg of messages) {
        if (msg.role === 'assistant' && msg.content) {
            stack.push(msg.agentName || workflow.startAgent);
        }
    }

    // Create tools
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

    // extract mentions from agent instructions
    const mentions: Record<string, z.infer<typeof ConnectedEntity>[]> = {};

    // Create agents, record connections
    const agents: Record<string, Agent> = {};
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

    // Set up agent handoffs
    for (const [agentName, agent] of Object.entries(agents)) {
        const connectedAgentNames = (mentions[agentName] || []).filter(e => e.type === 'agent').map(e => e.name);
        agent.handoffs = connectedAgentNames.map(e => agents[e]).filter(Boolean);
        logger.log(`set handoffs for ${agentName}: ${connectedAgentNames.join(',')}`);
    }

    // Track agent to agent calls
    const a2aCounter = new AgentToAgentCallCounter();

    // Track usage
    const usageTracker = new UsageTracker();

    // get next agent name
    const nextAgentName = getNextAgentName(logger, stack, agentConfig, workflow);
    logger.log(`next agent name: ${nextAgentName}`);

    // set up initial state for loop
    logger.log('@@ starting agent loop @@');
    let iter = 0;
    const accumulatedMessages: z.infer<typeof Message>[] = [...messages];
    let currentAgent = agents[nextAgentName];
    if (!currentAgent) {
        throw new Error(`Start agent ${nextAgentName} not found`);
    }
    outerLoop: while (true) {
        // increment loop counter
        iter++;

        // set up logging
        const loopLogger = logger.child(`iter-${iter}`);
        loopLogger.log(`current agent: ${currentAgent.name}`);
        loopLogger.log(`stack: ${stack.join(', ')}`);

        // Run the agent
        const agentInputs = convertMsgsInput(accumulatedMessages);
        const result = await run(currentAgent, agentInputs, {
            stream: true,
        });

        for await (const event of result) {
            const innerLoopLogger = loopLogger.child(event.type);

            // count tokens
            switch (event.type) {
                case 'raw_model_stream_event':
                    // if response is done
                    if (event.data.type === 'response_done') {
                        const outputs = event.data.response.output;
                        // emit tool call invocation
                        for (const output of outputs) {
                            if (output.type === 'function_call' && !output.name.startsWith('transfer_to')) {
                                const m: z.infer<typeof Message> = {
                                    role: 'assistant',
                                    content: null,
                                    toolCalls: [{
                                        id: output.callId,
                                        type: 'function',
                                        function: {
                                            name: output.name || '',
                                            arguments: output.arguments || '',
                                        },
                                    }],
                                    agentName: currentAgent.name,
                                };
                                accumulatedMessages.push(m);
                                yield* emitEvent(innerLoopLogger, m);
                            }
                        }

                        // update usage information
                        usageTracker.increment(
                            event.data.response.usage.totalTokens,
                            event.data.response.usage.inputTokens,
                            event.data.response.usage.outputTokens
                        );
                        innerLoopLogger.log(`updated usage information: ${JSON.stringify(usageTracker.get())}`);
                    }
                    break;
                case 'run_item_stream_event':
                    // handle handoff event
                    if (event.name === 'handoff_occurred' && event.item.type === 'handoff_output_item') {
                        // skip if its the same agent
                        if (currentAgent.name === event.item.targetAgent.name) {
                            innerLoopLogger.log(`current agent: ${currentAgent.name}`);
                            innerLoopLogger.log(`target agent: ${event.item.targetAgent.name}`);
                            innerLoopLogger.log(`skipping handoff to same agent: ${currentAgent.name}`);
                            continue;
                        }

                        // emit transfer tool call invocation
                        const [m1, m2] = createTransferEvents(currentAgent.name, event.item.targetAgent.name);
                        accumulatedMessages.push(m1);
                        // skip if we've already called this child too many times
                        const maxCalls = agentConfig[event.item.targetAgent.name]?.maxCallsPerParentAgent || 3;
                        if (a2aCounter.get(currentAgent.name, event.item.targetAgent.name) >= maxCalls) {
                            innerLoopLogger.log(`skipping handoff to child agent: ${event.item.targetAgent.name} (max calls reached)`);
                            accumulatedMessages.push({
                                ...m2,
                                content: JSON.stringify({
                                    error: `You've already called this child agent too many times. DO NOT ATTEMPT TO CALL IT AGAIN!.`,
                                }),
                            });
                            continue outerLoop;
                        }
                        accumulatedMessages.push(m2);
                        yield* emitEvent(innerLoopLogger, m1);
                        yield* emitEvent(innerLoopLogger, m2);

                        // switch to child
                        if (agentConfig[event.item.targetAgent.name].outputVisibility === 'internal') {
                            stack.push(currentAgent.name);
                        }
                        a2aCounter.increment(currentAgent.name, event.item.targetAgent.name);
                        currentAgent = agents[event.item.targetAgent.name];
                        break;
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
                        accumulatedMessages.push(m);
                        yield* emitEvent(innerLoopLogger, m);
                        // get next event
                        continue;
                    }

                    // handle model ressage output
                    if (event.item.type === 'message_output_item' &&
                        event.item.rawItem.type === 'message' &&
                        event.item.rawItem.status === 'completed') {
                        // check response visibility
                        const isInternal = agentConfig[event.item.agent.name].outputVisibility === 'internal';
                        for (const content of event.item.rawItem.content) {
                            if (content.type === 'output_text') {
                                const msg: z.infer<typeof Message> = {
                                    role: 'assistant',
                                    content: content.text,
                                    agentName: event.item.agent.name,
                                    responseType: isInternal ? 'internal' : 'external',
                                };
                                accumulatedMessages.push(msg);
                                yield* emitEvent(innerLoopLogger, msg);
                            }
                        }

                        // if this is an internal agent
                        // switch to parent / start agent and continue
                        if (isInternal) {
                            const prevAgent = stack.pop() || workflow.startAgent;
                            const [m1, m2] = createTransferEvents(event.item.agent.name, prevAgent);
                            accumulatedMessages.push(m1);
                            accumulatedMessages.push(m2);
                            yield* emitEvent(innerLoopLogger, m1);
                            yield* emitEvent(innerLoopLogger, m2);
                            a2aCounter.increment(event.item.agent.name, prevAgent);
                            currentAgent = agents[prevAgent];
                            innerLoopLogger.log(`switched to parent agent: ${prevAgent}`);
                            continue outerLoop;
                        }

                        // if external, break out of loop
                        break;
                    }
                    break;
                default:
                    break;
            }
        }

        // if the last message was by a user_facing agent text message, break out of loop
        const lastMessage = accumulatedMessages[accumulatedMessages.length - 1];
        if (agentConfig[currentAgent.name].outputVisibility === 'user_facing' &&
            lastMessage.role === 'assistant' &&
            lastMessage.content &&
            lastMessage.agentName === currentAgent.name
        ) {
            loopLogger.log(`last message was by a user_facing agent, breaking out of parent loop`);
            break;
        }
    }

    // emit usage information
    yield* emitEvent(logger, usageTracker.asEvent());
}