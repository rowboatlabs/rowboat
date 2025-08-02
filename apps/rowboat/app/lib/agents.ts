// External dependencies
import { Agent, AgentInputItem, run, tool, Tool } from "@openai/agents";
import { RECOMMENDED_PROMPT_PREFIX } from "@openai/agents-core/extensions";
import { aisdk } from "@openai/agents-extensions";
import { createOpenAI } from "@ai-sdk/openai";
import { CoreMessage, embed, generateText } from "ai";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { Composio } from '@composio/core';
import { SignJWT } from "jose";
import crypto from "crypto";

// Internal dependencies
import { embeddingModel } from '../lib/embedding';
import { getMcpClient } from "./mcp";
import { dataSourceDocsCollection, dataSourcesCollection, projectsCollection } from "./mongodb";
import { qdrantClient } from '../lib/qdrant';
import { EmbeddingRecord } from "./types/datasource_types";
import { ConnectedEntity, sanitizeTextWithMentions, Workflow, WorkflowAgent, WorkflowPrompt, WorkflowTool } from "./types/workflow_types";
import { CHILD_TRANSFER_RELATED_INSTRUCTIONS, CONVERSATION_TYPE_INSTRUCTIONS, RAG_INSTRUCTIONS, TASK_TYPE_INSTRUCTIONS } from "./agent_instructions";
import { PrefixLogger } from "./utils";
import { Message, AssistantMessage, AssistantMessageWithToolCalls, ToolMessage } from "./types/types";

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

async function invokeWebhookTool(
    logger: PrefixLogger,
    projectId: string,
    name: string,
    input: any,
): Promise<unknown> {
    logger = logger.child(`invokeWebhookTool`);
    logger.log(`projectId: ${projectId}`);
    logger.log(`name: ${name}`);
    logger.log(`input: ${JSON.stringify(input)}`);

    const project = await projectsCollection.findOne({
        "_id": projectId,
    });
    if (!project) {
        throw new Error('Project not found');
    }

    if (!project.webhookUrl) {
        throw new Error('Webhook URL not found');
    }

    // prepare request body
    const toolCall: z.infer<typeof AssistantMessageWithToolCalls.shape.toolCalls>[number] = {
        id: crypto.randomUUID(),
        type: "function",
        function: {
            name,
            arguments: JSON.stringify(input),
        },
    }
    const content = JSON.stringify({
        toolCall,
    });
    const requestId = crypto.randomUUID();
    const bodyHash = crypto
        .createHash('sha256')
        .update(content, 'utf8')
        .digest('hex');

    // sign request
    const jwt = await new SignJWT({
        requestId,
        projectId,
        bodyHash,
    })
        .setProtectedHeader({
            alg: 'HS256',
            typ: 'JWT',
        })
        .setIssuer('rowboat')
        .setAudience(project.webhookUrl)
        .setSubject(`tool-call-${toolCall.id}`)
        .setJti(requestId)
        .setIssuedAt()
        .setExpirationTime("5 minutes")
        .sign(new TextEncoder().encode(project.secret));

    // make request
    const request = {
        requestId,
        content,
    };
    const response = await fetch(project.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-signature-jwt': jwt,
        },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        throw new Error(`Failed to call webhook: ${response.status}: ${response.statusText}`);
    }
    const responseBody = await response.json();
    return responseBody;
}

// Helper to handle MCP tool calls
async function invokeMcpTool(
    logger: PrefixLogger,
    projectId: string,
    name: string,
    input: any,
    mcpServerName: string
) {
    logger = logger.child(`invokeMcpTool`);
    logger.log(`projectId: ${projectId}`);
    logger.log(`name: ${name}`);
    logger.log(`input: ${JSON.stringify(input)}`);
    logger.log(`mcpServerName: ${mcpServerName}`);

    // Get project configuration
    const project = await projectsCollection.findOne({ _id: projectId });
    if (!project) {
        throw new Error(`project ${projectId} not found`);
    }

    // get server url from project data
    const mcpServerURL = project.customMcpServers?.[mcpServerName]?.serverUrl;
    if (!mcpServerURL) {
        throw new Error(`mcp server url not found for project ${projectId} and server ${mcpServerName}`);
    }

    const client = await getMcpClient(mcpServerURL, mcpServerName);
    const result = await client.callTool({
        name,
        arguments: input,
    });
    logger.log(`mcp tool result: ${JSON.stringify(result)}`);
    await client.close();
    return result;
}

// Helper to handle composio tool calls
async function invokeComposioTool(
    logger: PrefixLogger,
    projectId: string,
    name: string,
    composioData: z.infer<typeof WorkflowTool>['composioData'] & {},
    input: any,
) {
    logger = logger.child(`invokeComposioTool`);
    logger.log(`projectId: ${projectId}`);
    logger.log(`name: ${name}`);
    logger.log(`input: ${JSON.stringify(input)}`);

    const { slug, toolkitSlug, noAuth } = composioData;

    let connectedAccountId: string | undefined = undefined;
    if (!noAuth) {
        const project = await projectsCollection.findOne({ _id: projectId });
        if (!project) {
            throw new Error(`project ${projectId} not found`);
        }
        connectedAccountId = project.composioConnectedAccounts?.[toolkitSlug]?.id;
        if (!connectedAccountId) {
            throw new Error(`connected account id not found for project ${projectId} and toolkit ${toolkitSlug}`);
        }
    }

    const composio = new Composio();

    const result = await composio.tools.execute(slug, {
        userId: projectId,
        arguments: input,
        connectedAccountId: connectedAccountId,
    });
    logger.log(`composio tool result: ${JSON.stringify(result)}`);
    return result.data;
}

// Helper to create RAG tool
function createRagTool(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowAgent>,
    projectId: string
): Tool {
    if (!config.ragDataSources?.length) {
        throw new Error(`data sources not found for agent ${config.name}`);
    }

    return tool({
        name: "rag_search",
        description: config.description,
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
        name: config.name,
        description: config.description,
        strict: false,
        parameters: {
            type: 'object',
            properties: config.parameters.properties,
            required: config.parameters.required || [],
            additionalProperties: true,
        },
        async execute(input: any) {
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

// Helper to create a webhook tool
function createWebhookTool(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowTool>,
    projectId: string,
): Tool {
    const { name, description, parameters } = config;

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
                const result = await invokeWebhookTool(logger, projectId, name, input);
                return JSON.stringify({
                    result,
                });
            } catch (error) {
                logger.log(`Error executing webhook tool ${config.name}:`, error);
                return JSON.stringify({
                    error: `Tool execution failed: ${error}`,
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
    const { name, description, parameters, mcpServerName } = config;

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
                const result = await invokeMcpTool(logger, projectId, name, input, mcpServerName || '');
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

// Helper to create a composio tool
function createComposioTool(
    logger: PrefixLogger,
    config: z.infer<typeof WorkflowTool>,
    projectId: string
): Tool {
    const { name, description, parameters, composioData } = config;

    if (!composioData) {
        throw new Error(`composio data not found for tool ${name}`);
    }

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
                const result = await invokeComposioTool(logger, projectId, name, composioData, input);
                return JSON.stringify({
                    result,
                });
            } catch (error) {
                logger.log(`Error executing composio tool ${name}:`, error);
                return JSON.stringify({
                    error: `Tool execution failed: ${error}`,
                });
            }
        }
    });
}

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

${config.outputVisibility === 'user_facing' ? CONVERSATION_TYPE_INSTRUCTIONS() : TASK_TYPE_INSTRUCTIONS()}

## Instructions

${config.instructions}

${config.examples ? ('# Examples\n' + config.examples) : ''}

${'-'.repeat(100)}

${CHILD_TRANSFER_RELATED_INSTRUCTIONS}
`;

    let { sanitized, entities } = sanitizeTextWithMentions(instructions, workflow);
    agentLogger.log(`instructions: ${JSON.stringify(sanitized)}`);
    agentLogger.log(`mentions: ${JSON.stringify(entities)}`);

    // // add prompts to instructions
    // for (const e of entities) {
    //     if (e.type === 'prompt') {
    //         const prompt = promptConfig[e.name];
    //         if (prompt) {
    //             compiledInstructions = compiledInstructions + '\n\n# ' + prompt.name + '\n' + prompt.prompt;
    //         }
    //     }
    // }

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
    switch (lastAgentConfig.controlType) {
        case 'retain':
            logger.log(`last agent ${lastAgentName} control type is retain, returning last agent: ${lastAgentName}`);
            return lastAgentName;
        case 'relinquish_to_parent':
            const parentAgentName = startAgentStack.pop() || workflow.startAgent;
            if (startAgentStack.length > 0) {
                logger.log(`popped agent from stack: ${lastAgentName} || reason: relinquish to parent triggered`);
            } else {
                logger.log(`using start agent: ${lastAgentName} || reason: empty stack`);
            }
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
    return { agentConfig, toolConfig, promptConfig };
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

function createTools(
    logger: PrefixLogger,
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    toolConfig: Record<string, z.infer<typeof WorkflowTool>>,
): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const [toolName, config] of Object.entries(toolConfig)) {
        if (workflow.mockTools?.[toolName]) {
            tools[toolName] = createMockTool(logger, {
                ...config,
                mockInstructions: workflow.mockTools?.[toolName], // override mock instructions
            });
            logger.log(`created mock tool: ${toolName}`);
        } else if (config.mockTool) {
            tools[toolName] = createMockTool(logger, config);
            logger.log(`created mock tool: ${toolName}`);
        } else if (config.isMcp) {
            tools[toolName] = createMcpTool(logger, config, projectId);
            logger.log(`created mcp tool: ${toolName}`);
        } else if (config.isComposio) {
            tools[toolName] = createComposioTool(logger, config, projectId);
            logger.log(`created composio tool: ${toolName}`);
        } else {
            tools[toolName] = createWebhookTool(logger, config, projectId);
            logger.log(`created webhook tool: ${toolName}`);
        }
    }
    return tools;
}

function createAgents(
    logger: PrefixLogger,
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    agentConfig: Record<string, z.infer<typeof WorkflowAgent>>,
    tools: Record<string, Tool>,
    promptConfig: Record<string, z.infer<typeof WorkflowPrompt>>,
): { agents: Record<string, Agent>, mentions: Record<string, z.infer<typeof ConnectedEntity>[]>, originalInstructions: Record<string, string>, originalHandoffs: Record<string, Agent[]> } {
    const agents: Record<string, Agent> = {};
    const mentions: Record<string, z.infer<typeof ConnectedEntity>[]> = {};
    const originalInstructions: Record<string, string> = {};
    const originalHandoffs: Record<string, Agent[]> = {};

    // create agents
    for (const [agentName, config] of Object.entries(agentConfig)) {
        const { agent, entities } = createAgent(
            logger,
            projectId,
            config,
            tools,
            workflow,
            promptConfig,
        );
        agents[agentName] = agent;
        mentions[agentName] = entities;
        originalInstructions[agentName] = agent.instructions as string;
        // handoffs will be set after all agents are created
    }

    // set handoffs
    for (const [agentName, agent] of Object.entries(agents)) {
        const connectedAgentNames = (mentions[agentName] || []).filter(e => e.type === 'agent').map(e => e.name);
        // Only store Agent objects in handoffs (filter out Handoff if present)
        agent.handoffs = connectedAgentNames.map(e => agents[e]).filter(Boolean) as Agent[];
        originalHandoffs[agentName] = agent.handoffs.filter(h => h instanceof Agent);
        logger.log(`set handoffs for ${agentName}: ${JSON.stringify(connectedAgentNames)}`);
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
    const isRetain = agentConfigObj?.controlType === 'retain';
    const injectLogger = logger.child(`inject`);
    injectLogger.log(`isInternal: ${isInternal}`);
    injectLogger.log(`isRetain: ${isRetain}`);
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
    const { agentConfig, toolConfig, promptConfig } = mapConfig(workflow);

    
    const stack: string[] = [];
    logger.log(`initialized stack: ${JSON.stringify(stack)}`);

    // create tools
    const tools = createTools(logger, projectId, workflow, toolConfig);

    // create agents
    const { agents, originalInstructions, originalHandoffs } = createAgents(logger, projectId, workflow, agentConfig, tools, promptConfig);

    // track agent to agent calls
    const transferCounter = new AgentTransferCounter();

    // track usage
    const usageTracker = new UsageTracker();

    // get next agent name
    let agentName = getStartOfTurnAgentName(logger, messages, agentConfig, workflow);

    // set up initial state for loop
    logger.log('@@ starting agent turn @@');
    let iter = 0;
    const turnMsgs: z.infer<typeof Message>[] = [...messages];

    // loop indefinitely
    turnLoop: while (true) {

        logger.log(`starting turn loop iteration: ${iter}`);
        // increment loop counter
        iter++;

        // set up logging
        const loopLogger = logger.child(`iter-${iter}`);

        // log agent info
        loopLogger.log(`agent name: ${agentName}`);
        loopLogger.log(`stack: ${JSON.stringify(stack)}`);
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
                        // skip if its the same agent
                        if (agentName === event.item.targetAgent.name) {
                            eventLogger.log(`skipping handoff to same agent: ${agentName}`);
                            break;
                        }

                        // Only apply max calls limit to internal agents (task agents)
                        const targetAgentConfig = agentConfig[event.item.targetAgent.name];
                        if (targetAgentConfig?.outputVisibility === 'internal') {
                            const maxCalls = targetAgentConfig?.maxCallsPerParentAgent || 3;
                            const currentCalls = transferCounter.get(agentName, event.item.targetAgent.name);
                            if (currentCalls >= maxCalls) {
                                eventLogger.log(`skipping handoff to ${event.item.targetAgent.name} || reason: max calls ${maxCalls} exceeded from ${agentName} to internal agent ${event.item.targetAgent.name}`);
                                continue;
                            }
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

                        loopLogger.log(`switched to agent: ${newAgentName} || reason: handoff by ${agentName}`);

                        // add current agent to stack only if new agent is internal
                        if (agentConfig[newAgentName]?.outputVisibility === 'internal') {
                            stack.push(agentName);
                            loopLogger.log(`-- pushed agent to stack: ${agentName} || reason: new agent ${newAgentName} is internal`);
                            loopLogger.log(`-- stack is now: ${JSON.stringify(stack)}`);
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
                            const current = agentName;

                            // if the control type is relinquish_to_parent or retain, we need to pop the stack, else if the control type is relinquish_to_start, we need to use the start agent
                            if (agentConfig[agentName]?.controlType === 'relinquish_to_parent' || agentConfig[agentName]?.controlType === 'retain') {
                                agentName = stack.pop()!;
                                loopLogger.log(`-- popped agent from stack: ${agentName} || reason: ${current} is an internal agent, it put out a message and it has a control type of ${agentConfig[agentName]?.controlType}, hence the flow of control needs to return to the previous agent`);
                            } else if (agentConfig[agentName]?.controlType === 'relinquish_to_start') {
                                agentName = workflow.startAgent;
                                loopLogger.log(`-- using start agent: ${agentName} || reason: ${current} is an internal agent, it put out a message and it has a control type of ${agentConfig[agentName]?.controlType}, hence the flow of control needs to return to the start agent`);
                            }
                            
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