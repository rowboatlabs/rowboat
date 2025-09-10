// External dependencies
import { tool, Tool } from "@openai/agents";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, generateText } from "ai";
import { z } from "zod";
import { composio } from "@/src/application/lib/composio/composio";
import { SignJWT } from "jose";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { tempBinaryCache } from "@/src/application/services/temp-binary-cache";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Internal dependencies
import { embeddingModel } from "@/app/lib/embedding";
import { getMcpClient } from "@/app/lib/mcp";
import { qdrantClient } from "@/app/lib/qdrant";
import { EmbeddingRecord } from "@/app/lib/types/datasource_types";
import { WorkflowAgent, WorkflowTool } from "@/app/lib/types/workflow_types";
import { PrefixLogger } from "@/app/lib/utils";
import { UsageTracker } from "@/app/lib/billing";
import { DataSource } from "@/src/entities/models/data-source";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { container } from "@/di/container";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";

// Provider configuration
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || undefined;
const MODEL = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4o';

const openai = createOpenAI({
    apiKey: PROVIDER_API_KEY,
    baseURL: PROVIDER_BASE_URL,
});

// Image generation (Gemini) defaults
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image-preview";

// Helper to generate an image using Gemini
export async function invokeGenerateImageTool(
    logger: PrefixLogger,
    usageTracker: UsageTracker,
    prompt: string,
    options?: {
        modelName?: string;
    }
): Promise<{
    texts: string[];
    images: { mimeType: string; bytes: number; dataBase64: string }[];
    model: string;
}> {
    const log = logger.child("invokeGenerateImageTool");
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
        throw new Error("Missing API key. Set GOOGLE_API_KEY or GEMINI_API_KEY.");
    }

    const modelName = options?.modelName || DEFAULT_IMAGE_MODEL;

    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: modelName });

    log.log(`Generating image with model: ${modelName}`);
    const result = await model.generateContent(prompt);
    const response = result.response as any;

    // Track usage if available
    try {
        const inputTokens = response?.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response?.usageMetadata?.candidatesTokenCount || 0;
        usageTracker.track({
            type: "LLM_USAGE",
            modelName: modelName,
            inputTokens,
            outputTokens,
            context: "agents_runtime.gemini_image_generation",
        });
    } catch (_) {
        // ignore usage tracking errors
    }

    const candidates = (response?.candidates ?? []) as any[];
    if (!candidates.length) {
        throw new Error("No candidates returned in response.");
    }

    const parts = (candidates[0]?.content?.parts ?? []) as any[];
    if (!parts.length) {
        throw new Error("No parts in candidate content.");
    }

    const texts: string[] = [];
    const images: { mimeType: string; bytes: number; dataBase64: string }[] = [];

    for (const part of parts) {
        if (typeof part.text === "string" && part.text.length) {
            texts.push(part.text);
            continue;
        }

        const dataB64 = part?.inlineData?.data as string | undefined;
        if (dataB64) {
            const mime = part?.inlineData?.mimeType || "image/png";
            const buf = Buffer.from(dataB64, "base64");

            images.push({ mimeType: mime, bytes: buf.length, dataBase64: dataB64 });
        }
    }

    if (!images.length) {
        log.log("No image part found in response.");
    }

    return { texts, images, model: modelName };
}

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
    const dataSourceDocsRepository = container.resolve<IDataSourceDocsRepository>('dataSourceDocsRepository');

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
    const docs = await dataSourceDocsRepository.bulkFetch(results.map(r => r.docId));
    logger.log(`fetched docs: ${docs.length}`);

    // map the results to the docs
    results = results.map(r => {
        const doc = docs.find(d => d.id === r.docId);
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

    const projectsRepository = container.resolve<IProjectsRepository>('projectsRepository');

    const project = await projectsRepository.fetch(projectId);
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
    const projectsRepository = container.resolve<IProjectsRepository>('projectsRepository');
    const project = await projectsRepository.fetch(projectId);
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
        const projectsRepository = container.resolve<IProjectsRepository>('projectsRepository');
        const project = await projectsRepository.fetch(projectId);
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
                    error: "Tool execution failed!",
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
                    error: "Tool execution failed!",
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
                    error: "Tool execution failed!",
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
                    error: "Tool execution failed!",
                });
            }
        }
    });
}

// Helper to create a Gemini image generation tool
export function createGenerateImageTool(
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
                const prompt: string = input?.prompt || '';
                if (!prompt) {
                    return JSON.stringify({ error: "Missing required field: prompt" });
                }
                const modelName: string | undefined = input?.modelName;
                const result = await invokeGenerateImageTool(
                    logger,
                    usageTracker,
                    prompt,
                    { modelName }
                );
                // If S3 bucket configured, store in S3 under generated_images/<c>/<d>/<filename>
                const s3Bucket = process.env.UPLOADS_S3_BUCKET || '';
                if (s3Bucket) {
                    const s3Region = process.env.UPLOADS_AWS_REGION || 'us-east-1';
                    const s3 = new S3Client({
                        region: s3Region,
                        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
                            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                        } as any : undefined,
                    });

                    const images = await Promise.all(result.images.map(async (img) => {
                        const buf = Buffer.from(img.dataBase64, 'base64');
                        const ext = img.mimeType === 'image/jpeg' ? '.jpg' : img.mimeType === 'image/webp' ? '.webp' : '.png';
                        const base = `${projectId}-${Math.floor(Math.random() * 1e12).toString(36)}`;
                        const last2 = base.slice(-2).padStart(2, '0');
                        const dirA = last2.charAt(0);
                        const dirB = last2.charAt(1);
                        const filename = `${base}${ext}`;
                        const key = `generated_images/${dirA}/${dirB}/${filename}`;
                        await s3.send(new PutObjectCommand({
                            Bucket: s3Bucket,
                            Key: key,
                            Body: buf,
                            ContentType: img.mimeType,
                        }));
                        const url = `/api/generated-images/${dirA}/${dirB}/${filename}`;
                        return { mimeType: img.mimeType, bytes: buf.length, url };
                    }));
                    const payload = {
                        model: result.model,
                        texts: result.texts,
                        images,
                        storage: 's3',
                    } as any;
                    return JSON.stringify(payload);
                }

                // Otherwise, use in-memory temp cache URLs
                const ttlSec = 10 * 60; // 10 minutes
                const ttlMs = ttlSec * 1000;
                const images = result.images.map(img => {
                    try {
                        const buf = Buffer.from(img.dataBase64, 'base64');
                        const id = tempBinaryCache.put(buf, img.mimeType, ttlMs);
                        const url = `/api/tmp-images/${id}`;
                        return { mimeType: img.mimeType, bytes: buf.length, url };
                    } catch {
                        return { mimeType: img.mimeType, bytes: img.bytes, url: null };
                    }
                });
                const payload = {
                    model: result.model,
                    texts: result.texts,
                    images,
                    storage: 'temp',
                    expiresInSec: ttlSec,
                } as any;
                return JSON.stringify(payload);
            } catch (error) {
                logger.log(`Error executing generate image tool ${name}:`, error);
                return JSON.stringify({
                    error: "Tool execution failed!",
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
        toolLogger.log(`creating tool: ${toolName} (type: ${config.mockTool ? 'mock' : config.isMcp ? 'mcp' : config.isComposio ? 'composio' : config.isGeminiImage ? 'gemini-image' : 'webhook'})`);
        
        if (config.mockTool) {
            tools[toolName] = createMockTool(logger, usageTracker, config);
            toolLogger.log(`✓ created mock tool: ${toolName}`);
        } else if (config.isMcp) {
            tools[toolName] = createMcpTool(logger, usageTracker, config, projectId);
            toolLogger.log(`✓ created mcp tool: ${toolName} (server: ${config.mcpServerName || 'unknown'})`);
        } else if (config.isComposio) {
            tools[toolName] = createComposioTool(logger, usageTracker, config, projectId);
            toolLogger.log(`✓ created composio tool: ${toolName}`);
        } else if (config.isGeminiImage) {
            tools[toolName] = createGenerateImageTool(logger, usageTracker, config, projectId);
            toolLogger.log(`✓ created gemini image tool: ${toolName}`);
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
