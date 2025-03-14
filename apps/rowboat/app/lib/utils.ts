import { convertFromAgenticAPIChatMessages } from "./types/agents_api_types";
import { ClientToolCallRequest } from "./types/tool_types";
import { ClientToolCallJwt, GetInformationToolResult } from "./types/tool_types";
import { ClientToolCallRequestBody } from "./types/tool_types";
import { AgenticAPIChatResponse } from "./types/agents_api_types";
import { AgenticAPIChatRequest } from "./types/agents_api_types";
import { Workflow, WorkflowAgent } from "./types/workflow_types";
import { AgenticAPIChatMessage } from "./types/agents_api_types";
import { z } from "zod";
import { dataSourceDocsCollection, dataSourcesCollection, projectsCollection } from "./mongodb";
import { apiV1 } from "rowboat-shared";
import { SignJWT } from "jose";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { embeddingModel } from "./embedding";
import { embed, generateObject } from "ai";
import { qdrantClient } from "./qdrant";
import { EmbeddingRecord } from "./types/datasource_types";
import { ApiMessage } from "./types/types";
import { openai } from "@ai-sdk/openai";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export async function callMcpTool(
    projectId: string,
    mcpServerName: string,
    toolName: string,
    parameters: Record<string, unknown>,
): Promise<unknown> {
    const project = await projectsCollection.findOne({
        "_id": projectId,
    });
    if (!project) {
        throw new Error('Project not found');
    }

    const mcpServer = project.mcpServers?.find(s => s.name === mcpServerName);
    if (!mcpServer) {
        throw new Error('MCP server not found');
    }

    const transport = new SSEClientTransport(new URL(mcpServer.url));

    const client = new Client(
        {
            name: "rowboat-client",
            version: "1.0.0"    
        },
        {
            capabilities: {
                prompts: {},
                resources: {},
                tools: {}   
            }
        }
    );

    await client.connect(transport);

    const result = await client.callTool({
        name: toolName,
        arguments: parameters,
    });

    await client.close();

    return result;  
}

export async function callClientToolWebhook(
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number],
    messages: z.infer<typeof ApiMessage>[],
    projectId: string,
): Promise<unknown> {
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
    const content = JSON.stringify({
        toolCall,
        messages,
    } as z.infer<typeof ClientToolCallRequestBody>);
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
    } as z.infer<typeof ClientToolCallJwt>)
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
    const request: z.infer<typeof ClientToolCallRequest> = {
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

export async function getAgenticApiResponse(
    request: z.infer<typeof AgenticAPIChatRequest>,
): Promise<{
    messages: z.infer<typeof AgenticAPIChatMessage>[],
    state: unknown,
    rawAPIResponse: unknown,
}> {
    // call agentic api
    console.log(`agentic request`, JSON.stringify(request, null, 2));
    const response = await fetch(process.env.AGENTS_API_URL + '/chat', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.AGENTS_API_KEY || 'test'}`,
        },
    });
    if (!response.ok) {
        console.error('Failed to call agentic api', response);
        throw new Error(`Failed to call agentic api: ${response.statusText}`);
    }
    const responseJson = await response.json();
    const result: z.infer<typeof AgenticAPIChatResponse> = responseJson;
    return {
        messages: result.messages,
        state: result.state,
        rawAPIResponse: result,
    };
}

export async function runRAGToolCall(
    projectId: string,
    query: string,
    sourceIds: string[],
    returnType: z.infer<typeof WorkflowAgent>['ragReturnType'],
    k: number,
): Promise<z.infer<typeof GetInformationToolResult>> {
    // create embedding for question
    const embedResult = await embed({
        model: embeddingModel,
        value: query,
    });

    // fetch all data sources for this project
    const sources = await dataSourcesCollection.find({
        projectId: projectId,
        active: true,
    }).toArray();
    const validSourceIds = sources
        .filter(s => sourceIds.includes(s._id.toString())) // id should be in sourceIds
        .filter(s => s.active) // should be active
        .map(s => s._id.toString());

    // if no sources found, return empty response
    if (validSourceIds.length === 0) {
        return {
            results: [],
        };
    }

    // perform qdrant vector search
    const qdrantResults = await qdrantClient.query("embeddings", {
        query: embedResult.embedding,
        filter: {
            must: [
                { key: "projectId", match: { value: projectId } },
                { key: "sourceId", match: { any: validSourceIds } },
            ],
        },
        limit: k,
        with_payload: true,
    });

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
        return {
            results,
        };
    }

    // otherwise, fetch the doc contents from mongodb
    const docs = await dataSourceDocsCollection.find({
        _id: { $in: results.map(r => new ObjectId(r.docId)) },
    }).toArray();

    // map the results to the docs
    results = results.map(r => {
        const doc = docs.find(d => d._id.toString() === r.docId);
        return {
            ...r,
            content: doc?.content || '',
        };
    });

    return {
        results,
    };
}
// create a PrefixLogger class that wraps console.log with a prefix
// and allows chaining with a parent logger
export class PrefixLogger {
    private prefix: string;
    private parent: PrefixLogger | null;

    constructor(prefix: string, parent: PrefixLogger | null = null) {
        this.prefix = prefix;
        this.parent = parent;
    }

    log(...args: any[]) {
        const timestamp = new Date().toISOString();
        const prefix = '[' + this.prefix + ']';

        if (this.parent) {
            this.parent.log(prefix, ...args);
        } else {
            console.log(timestamp, prefix, ...args);
        }
    }

    child(childPrefix: string): PrefixLogger {
        return new PrefixLogger(childPrefix, this);
    }
}

export async function mockToolResponse(toolId: string, messages: z.infer<typeof ApiMessage>[], mockInstructions: string): Promise<string> {
    const prompt = `Given below is a chat between a user and a customer support assistant.
The assistant has requested a tool call with ID {{toolID}}.

Your job is to come up with the data that the tool call should return.

In order to help you mock the responses, the user has provided some contextual information,
and also some instructions on how to mock the tool call.

>>>CHAT_HISTORY
{{messages}}
<<<END_OF_CHAT_HISTORY

>>>MOCK_INSTRUCTIONS
{{mockInstructions}}
<<<END_OF_MOCK_INSTRUCTIONS

The current date is {{date}}.
`
        .replace('{{toolID}}', toolId)
        .replace(`{{date}}`, new Date().toISOString())
        .replace('{{mockInstructions}}', mockInstructions)
        .replace('{{messages}}', JSON.stringify(messages.map((m) => {
            let tool_calls;
            if ('tool_calls' in m && m.role == 'assistant') {
                tool_calls = m.tool_calls;
            }
            let { role, content } = m;
            return {
                role,
                content,
                tool_calls,
            }
        })));
    // console.log(prompt);

    const { object } = await generateObject({
        model: openai("gpt-4o"),
        prompt: prompt,
        schema: z.object({
            result: z.any(),
        }),
    });

    return JSON.stringify(object);
}