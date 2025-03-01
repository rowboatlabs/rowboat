'use server';
import { convertFromAgenticAPIChatMessages } from "../lib/types/agents_api_types";
import { AgenticAPIChatRequest } from "../lib/types/agents_api_types";
import { WorkflowAgent } from "../lib/types/workflow_types";
import { EmbeddingRecord } from "../lib/types/datasource_types";
import { WebpageCrawlResponse } from "../lib/types/tool_types";
import { GetInformationToolResult } from "../lib/types/tool_types";
import { EmbeddingDoc } from "../lib/types/datasource_types";
import { generateObject, generateText, embed } from "ai";
import { dataSourceDocsCollection, dataSourcesCollection, embeddingsCollection, webpagesCollection } from "../lib/mongodb";
import { z } from 'zod';
import { openai } from "@ai-sdk/openai";
import FirecrawlApp, { ScrapeResponse } from '@mendable/firecrawl-js';
import { embeddingModel } from "../lib/embedding";
import { apiV1 } from "rowboat-shared";
import { Claims, getSession } from "@auth0/nextjs-auth0";
import { callClientToolWebhook, getAgenticApiResponse, mockToolResponse, runRAGToolCall } from "../lib/utils";
import { check_query_limit } from "../lib/rate_limiting";
import { QueryLimitError } from "../lib/client_utils";
import { projectAuthCheck } from "./project_actions";
import { qdrantClient } from "../lib/qdrant";
import { ObjectId } from "mongodb";
import { TestProfile } from "../lib/types/testing_types";

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

export async function suggestToolResponse(toolId: string, projectId: string, messages: z.infer<typeof apiV1.ChatMessage>[], testProfile: z.infer<typeof TestProfile>): Promise<string> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

    return await mockToolResponse(toolId, messages, testProfile);
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
    scenario: string,
): Promise<string> {
    await projectAuthCheck(projectId);
    if (!await check_query_limit(projectId)) {
        throw new QueryLimitError();
    }

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
    prompt = scenarioPrompt
        .replace('{{scenario}}', scenario);

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