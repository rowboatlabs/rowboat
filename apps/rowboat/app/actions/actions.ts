'use server';
import { convertToCopilotWorkflow } from "../lib/types/copilot_types";
import { convertFromAgenticAPIChatMessages } from "../lib/types/agents_api_types";
import { convertToCopilotMessage } from "../lib/types/copilot_types";
import { convertToCopilotApiMessage } from "../lib/types/copilot_types";
import { convertToCopilotApiChatContext } from "../lib/types/copilot_types";
import { CopilotAPIResponse } from "../lib/types/copilot_types";
import { CopilotAPIRequest } from "../lib/types/copilot_types";
import { CopilotChatContext } from "../lib/types/copilot_types";
import { CopilotMessage } from "../lib/types/copilot_types";
import { CopilotAssistantMessage } from "../lib/types/copilot_types";
import { AgenticAPIChatRequest } from "../lib/types/agents_api_types";
import { CopilotWorkflow } from "../lib/types/copilot_types";
import { Workflow } from "../lib/types/workflow_types";
import { WorkflowTool } from "../lib/types/workflow_types";
import { WorkflowPrompt } from "../lib/types/workflow_types";
import { WorkflowAgent } from "../lib/types/workflow_types";
import { EmbeddingRecord } from "../lib/types/datasource_types";
import { WebpageCrawlResponse } from "../lib/types/tool_types";
import { GetInformationToolResult } from "../lib/types/tool_types";
import { EmbeddingDoc } from "../lib/types/datasource_types";
import { SimulationData } from "../lib/types/testing_types";
import { generateObject, generateText, embed } from "ai";
import { dataSourceDocsCollection, dataSourcesCollection, embeddingsCollection, webpagesCollection } from "../lib/mongodb";
import { z } from 'zod';
import { openai } from "@ai-sdk/openai";
import FirecrawlApp, { ScrapeResponse } from '@mendable/firecrawl-js';
import { embeddingModel } from "../lib/embedding";
import { apiV1 } from "rowboat-shared";
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Claims, getSession } from "@auth0/nextjs-auth0";
import { callClientToolWebhook, getAgenticApiResponse, runRAGToolCall } from "../lib/utils";
import { assert } from "node:console";
import { check_query_limit } from "../lib/rate_limiting";
import { QueryLimitError } from "../lib/client_utils";
import { projectAuthCheck } from "./project_actions";
import { qdrantClient } from "../lib/qdrant";
import { ObjectId } from "mongodb";

const crawler = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

export async function authCheck(): Promise<Claims> {
    const { user } = await getSession() || {};
    if (!user) {
        throw new Error('User not authenticated');
    }
    return user;
}

export async function scrapeWebpage(url: string): Promise<z.infer<typeof WebpageCrawlResponse>> {
    const page = await webpagesCollection.findOne({
        "_id": url,
        lastUpdatedAt: {
            '$gte': new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 24 hours
        },
    });
    if (page) {
        // console.log("found webpage in db", url);
        return {
            title: page.title,
            content: page.contentSimple,
        };
    }

    // otherwise use firecrawl
    const scrapeResult = await crawler.scrapeUrl(
        url,
        {
            formats: ['markdown'],
            onlyMainContent: true
        }
    ) as ScrapeResponse;

    // save the webpage using upsert
    await webpagesCollection.updateOne(
        { _id: url },
        {
            $set: {
                title: scrapeResult.metadata?.title || '',
                contentSimple: scrapeResult.markdown || '',
                lastUpdatedAt: (new Date()).toISOString(),
            }
        },
        { upsert: true }
    );

    // console.log("crawled webpage", url);
    return {
        title: scrapeResult.metadata?.title || '',
        content: scrapeResult.markdown || '',
    };
}

export async function getAssistantResponse(
    projectId: string,
    request: z.infer<typeof AgenticAPIChatRequest>,
): Promise<{
    messages: z.infer<typeof apiV1.ChatMessage>[],
    state: unknown,
    rawRequest: unknown,
    rawResponse: unknown,
}> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    const response = await getAgenticApiResponse(request);
    return {
        messages: convertFromAgenticAPIChatMessages(response.messages),
        state: response.state,
        rawRequest: request,
        rawResponse: response.rawAPIResponse,
    };
}

export async function getCopilotResponse(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    context: z.infer<typeof CopilotChatContext> | null,
): Promise<{
    message: z.infer<typeof CopilotAssistantMessage>,
    rawRequest: unknown,
    rawResponse: unknown,
}> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    // prepare request
    const request: z.infer<typeof CopilotAPIRequest> = {
        messages: messages.map(convertToCopilotApiMessage),
        workflow_schema: JSON.stringify(zodToJsonSchema(CopilotWorkflow)),
        current_workflow_config: JSON.stringify(convertToCopilotWorkflow(current_workflow_config)),
        context: context ? convertToCopilotApiChatContext(context) : null,
    };
    console.log(`copilot request`, JSON.stringify(request, null, 2));

    // call copilot api
    const response = await fetch(process.env.COPILOT_API_URL + '/chat', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.COPILOT_API_KEY || 'test'}`,
        },
    });
    if (!response.ok) {
        console.error('Failed to call copilot api', response);
        throw new Error(`Failed to call copilot api: ${response.statusText}`);
    }

    // parse and return response
    const json: z.infer<typeof CopilotAPIResponse> = await response.json();
    console.log(`copilot response`, JSON.stringify(json, null, 2));
    if ('error' in json) {
        throw new Error(`Failed to call copilot api: ${json.error}`);
    }
    // remove leading ```json and trailing ```
    const msg = convertToCopilotMessage({
        role: 'assistant',
        content: json.response.replace(/^```json\n/, '').replace(/\n```$/, ''),
    });

    // validate response schema
    assert(msg.role === 'assistant');
    if (msg.role === 'assistant') {
        for (const part of msg.content.response) {
            if (part.type === 'action') {
                switch (part.content.config_type) {
                    case 'tool': {
                        const test = {
                            name: 'test',
                            description: 'test',
                            parameters: {
                                type: 'object',
                                properties: {},
                                required: [],
                            },
                        } as z.infer<typeof WorkflowTool>;
                        // iterate over each field in part.content.config_changes
                        // and test if the final object schema is valid
                        // if not, discard that field
                        for (const [key, value] of Object.entries(part.content.config_changes)) {
                            const result = WorkflowTool.safeParse({
                                ...test,
                                [key]: value,
                            });
                            if (!result.success) {
                                console.log(`discarding field ${key} from ${part.content.config_type}: ${part.content.name}`, result.error.message);
                                delete part.content.config_changes[key];
                            }
                        }
                        break;
                    }
                    case 'agent': {
                        const test = {
                            name: 'test',
                            description: 'test',
                            type: 'conversation',
                            instructions: 'test',
                            prompts: [],
                            tools: [],
                            model: 'gpt-4o',
                            ragReturnType: 'chunks',
                            ragK: 10,
                            connectedAgents: [],
                            controlType: 'retain',
                        } as z.infer<typeof WorkflowAgent>;
                        // iterate over each field in part.content.config_changes
                        // and test if the final object schema is valid
                        // if not, discard that field
                        for (const [key, value] of Object.entries(part.content.config_changes)) {
                            const result = WorkflowAgent.safeParse({
                                ...test,
                                [key]: value,
                            });
                            if (!result.success) {
                                console.log(`discarding field ${key} from ${part.content.config_type}: ${part.content.name}`, result.error.message);
                                delete part.content.config_changes[key];
                            }
                        }
                        break;
                    }
                    case 'prompt': {
                        const test = {
                            name: 'test',
                            type: 'base_prompt',
                            prompt: "test",
                        } as z.infer<typeof WorkflowPrompt>;
                        // iterate over each field in part.content.config_changes
                        // and test if the final object schema is valid
                        // if not, discard that field
                        for (const [key, value] of Object.entries(part.content.config_changes)) {
                            const result = WorkflowPrompt.safeParse({
                                ...test,
                                [key]: value,
                            });
                            if (!result.success) {
                                console.log(`discarding field ${key} from ${part.content.config_type}: ${part.content.name}`, result.error.message);
                                delete part.content.config_changes[key];
                            }
                        }
                        break;
                    }
                    default: {
                        part.content.error = `Unknown config type: ${part.content.config_type}`;
                        break;
                    }
                }
            }
        }
    }

    return {
        message: msg as z.infer<typeof CopilotAssistantMessage>,
        rawRequest: request,
        rawResponse: json,
    };
}

export async function suggestToolResponse(toolId: string, projectId: string, messages: z.infer<typeof apiV1.ChatMessage>[]): Promise<string> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    const prompt = `
# Your Specific Task:
Here is a chat between a user and a customer support assistant.
The assistant has requested a tool call with ID {{toolID}}.
Your job is to come up with an example of the data that the tool call should return.
The current date is {{date}}.

CONVERSATION:
{{messages}}
`
        .replace('{{toolID}}', toolId)
        .replace(`{{date}}`, new Date().toISOString())
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

export async function getInformationTool(
    projectId: string,
    query: string,
    sourceIds: string[],
    returnType: z.infer<typeof WorkflowAgent>['ragReturnType'],
    k: number,
): Promise<z.infer<typeof GetInformationToolResult>> {
    await projectAuthCheck(projectId);

    return await runRAGToolCall(projectId, query, sourceIds, returnType, k);
}

export async function simulateUserResponse(
    projectId: string,
    messages: z.infer<typeof apiV1.ChatMessage>[],
    simulationData: z.infer<typeof SimulationData>
): Promise<string> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    const articlePrompt = `
# Your Specific Task:

## Context:

Here is a help article:

Content:
<START_ARTICLE_CONTENT>
Title: {{title}}
{{content}}
<END_ARTICLE_CONTENT> 

## Task definition:

Pretend to be a user reaching out to customer support. Chat with the
customer support assistant, assuming your issue or query is from this article.
Ask follow-up questions and make it real-world like. Don't do dummy
conversations. Your conversation should be a maximum of 5 user turns.

As output, simply provide your (user) turn of conversation.

After you are done with the chat, keep replying with a single word EXIT
in all capitals.
`;

    const scenarioPrompt = `
# Your Specific Task:

## Context:

Here is a scenario:

Scenario:
<START_SCENARIO>
{{scenario}}
<END_SCENARIO> 

## Task definition:

Pretend to be a user reaching out to customer support. Chat with the
customer support assistant, assuming your issue is based on this scenario.
Ask follow-up questions and make it real-world like. Don't do dummy
conversations. Your conversation should be a maximum of 5 user turns.

As output, simply provide your (user) turn of conversation.

After you are done with the chat, keep replying with a single word EXIT
in all capitals.
`;

    const previousChatPrompt = `
# Your Specific Task:

## Context:

Here is a chat between a user and a customer support assistant:

Chat:
<PREVIOUS_CHAT>
{{messages}}
<END_PREVIOUS_CHAT> 

## Task definition:

Pretend to be a user reaching out to customer support. Chat with the
customer support assistant, assuming your issue based on this previous chat.
Ask follow-up questions and make it real-world like. Don't do dummy
conversations. Your conversation should be a maximum of 5 user turns.

As output, simply provide your (user) turn of conversation.

After you are done with the chat, keep replying with a single word EXIT
in all capitals.
`;
    await projectAuthCheck(projectId);

    // flip message assistant / user message
    // roles from chat messages
    // use only text response messages
    const flippedMessages: { role: 'user' | 'assistant', content: string }[] = messages
        .filter(m => m.role == 'assistant' || m.role == 'user')
        .map(m => ({
            role: m.role == 'assistant' ? 'user' : 'assistant',
            content: m.content || '',
        }));

    // simulate user call
    let prompt;
    if ('articleUrl' in simulationData) {
        prompt = articlePrompt
            .replace('{{title}}', simulationData.articleTitle || '')
            .replace('{{content}}', simulationData.articleContent || '');
    }
    if ('scenario' in simulationData) {
        prompt = scenarioPrompt
            .replace('{{scenario}}', simulationData.scenario);
    }
    if ('chatMessages' in simulationData) {
        prompt = previousChatPrompt
            .replace('{{messages}}', simulationData.chatMessages);
    }
    const { text } = await generateText({
        model: openai("gpt-4o"),
        system: prompt || '',
        messages: flippedMessages,
    });

    return text.replace(/\. EXIT$/, '.');
}

export async function executeClientTool(
    toolCall: z.infer<typeof apiV1.AssistantMessageWithToolCalls>['tool_calls'][number],
    messages: z.infer<typeof apiV1.ChatMessage>[],
    projectId: string,
): Promise<unknown> {
    await projectAuthCheck(projectId);

    const result = await callClientToolWebhook(toolCall, messages, projectId);
    return result;
}