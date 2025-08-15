// External dependencies
import { tool, Tool } from "@openai/agents";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, generateText } from "ai";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { composio } from "./composio/composio";
import { SignJWT } from "jose";
import crypto from "crypto";

// Internal dependencies
import { embeddingModel } from '../lib/embedding';
import { getMcpClient } from "./mcp";
import { dataSourceDocsCollection, projectsCollection } from "./mongodb";
import { qdrantClient } from '../lib/qdrant';
import { EmbeddingRecord } from "./types/datasource_types";
import { WorkflowAgent, WorkflowTool } from "./types/workflow_types";
import { PrefixLogger } from "./utils";
import { UsageTracker } from "./billing";
import { DataSource } from "@/src/entities/models/data-source";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { container } from "@/di/container";

// Provider configuration
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || undefined;
const MODEL = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4o';

const openai = createOpenAI({
    apiKey: PROVIDER_API_KEY,
    baseURL: PROVIDER_BASE_URL,
});

// Helper to handle mock tool responses
export async function invokeMockTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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

    const messages: Parameters<typeof generateText>[0]['messages'] = [{
        role: "system" as const,
        content: `You are simulating the execution of a tool called '${toolName}'. Here is the description of the tool: ${description}. Here are the instructions for the mock tool: ${mockInstructions}. Generate a realistic response as if the tool was actually executed with the given parameters.`
    }, {
        role: "user" as const,
        content: `Generate a realistic response for the tool '${toolName}' with these parameters: ${args}. The response should be concise and focused on what the tool would actually return.`
    }];

    const { text, usage } = await generateText({
        model: openai(MODEL),
        messages,
    });
    logger.log(`generated text: ${text}`);

    // track usage
    usageTracker.track({
        type: "LLM_USAGE",
        modelName: MODEL,
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        context: "agents_runtime.mock_tool",
    });

    return text;
}

// Helper to handle RAG tool calls
export async function invokeRagTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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

    const dataSourcesRepository = container.resolve<IDataSourcesRepository>('dataSourcesRepository');

    // Create embedding for question
    const { embedding, usage } = await embed({
        model: embeddingModel,
        value: query,
    });

    // track usage

    // track usage
    usageTracker.track({
        type: "EMBEDDING_MODEL_USAGE",
        modelName: embeddingModel.modelId,
        tokens: usage.tokens,
        context: "agents_runtime.rag_tool.embedding_usage",
    });

    // Fetch all data sources for this project
    const sources: z.infer<typeof DataSource>[] = [];
    let cursor = undefined;
    do {
        const resp = await dataSourcesRepository.list(projectId, {
            active: true,
        }, cursor);
        sources.push(...resp.items);
        cursor = resp.nextCursor;
    } while(cursor);

    const validSourceIds = sources
        .filter(s => sourceIds.includes(s.id)) // id should be in sourceIds
        .map(s => s.id);
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

export async function invokeWebhookTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
    const toolCall = {
        id: crypto.randomUUID(),
        type: "function" as const,
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
export async function invokeMcpTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
export async function invokeComposioTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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

    const result = await composio.tools.execute(slug, {
        userId: projectId,
        arguments: input,
        connectedAccountId: connectedAccountId,
    });
    logger.log(`composio tool result: ${JSON.stringify(result)}`);

    // track usage
    usageTracker.track({
        type: "COMPOSIO_TOOL_USAGE",
        toolSlug: slug,
        context: "agents_runtime.composio_tool",
    });

    return result.data;
}

// Helper to create RAG tool
export function createRagTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
                usageTracker,
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
export function createMockTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
                    usageTracker,
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
export function createWebhookTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
                const result = await invokeWebhookTool(logger, usageTracker, projectId, name, input);
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
export function createMcpTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
                const result = await invokeMcpTool(logger, usageTracker, projectId, name, input, mcpServerName || '');
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
export function createComposioTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
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
                const result = await invokeComposioTool(logger, usageTracker, projectId, name, composioData, input);
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

export function createTools(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
    projectId: string,
    workflow: { tools: z.infer<typeof WorkflowTool>[] },
    toolConfig: Record<string, z.infer<typeof WorkflowTool>>,
): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    const toolLogger = logger.child('createTools');
    
    toolLogger.log(`=== CREATING ${Object.keys(toolConfig).length} TOOLS ===`);

    for (const [toolName, config] of Object.entries(toolConfig)) {
        toolLogger.log(`creating tool: ${toolName} (type: ${config.mockTool ? 'mock' : config.isMcp ? 'mcp' : config.isComposio ? 'composio' : 'webhook'})`);
        
        if (config.mockTool) {
            tools[toolName] = createMockTool(logger, usageTracker, config);
            toolLogger.log(`✓ created mock tool: ${toolName}`);
        } else if (config.isMcp) {
            tools[toolName] = createMcpTool(logger, usageTracker, config, projectId);
            toolLogger.log(`✓ created mcp tool: ${toolName} (server: ${config.mcpServerName || 'unknown'})`);
        } else if (config.isComposio) {
            tools[toolName] = createComposioTool(logger, usageTracker, config, projectId);
            toolLogger.log(`✓ created composio tool: ${toolName}`);
        } else if (config.isWebhook) {
            tools[toolName] = createWebhookTool(logger, usageTracker, config, projectId);
            toolLogger.log(`✓ created webhook tool: ${toolName} (fallback)`);
        } else { // this is for placeholder tools
            tools[toolName] = createMockTool(logger, usageTracker, config);
            toolLogger.log(`✓ created mock tool: ${toolName}`);
        }
    }
    
    toolLogger.log(`=== TOOL CREATION COMPLETE ===`);
    return tools;
}