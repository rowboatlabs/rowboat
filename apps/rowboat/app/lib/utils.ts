import { AgenticAPIChatResponse, AgenticAPIChatRequest, AgenticAPIChatMessage, AgenticAPIInitStreamResponse } from "./types/agents_api_types";
import { z } from "zod";
import { generateObject } from "ai";
import { ApiMessage } from "./types/types";
import { openai } from "@ai-sdk/openai";
import { redisClient } from "./redis";

export async function getAgenticApiResponse(
    request: z.infer<typeof AgenticAPIChatRequest>,
): Promise<{
    messages: z.infer<typeof AgenticAPIChatMessage>[],
    state: unknown,
    rawAPIResponse: unknown,
}> {
    // call agentic api
    console.log(`sending agentic api request`, JSON.stringify(request));
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
    console.log(`received agentic api response`, JSON.stringify(responseJson));
    const result: z.infer<typeof AgenticAPIChatResponse> = responseJson;
    return {
        messages: result.messages,
        state: result.state,
        rawAPIResponse: result,
    };
}

export async function getAgenticResponseStreamId(
    request: z.infer<typeof AgenticAPIChatRequest>,
): Promise<z.infer<typeof AgenticAPIInitStreamResponse>> {
    // serialize the request
    const payload = JSON.stringify(request);

    // create a uuid for the stream
    const streamId = crypto.randomUUID();

    // store payload in redis
    await redisClient.set(`chat-stream-${streamId}`, payload, {
        EX: 60 * 10, // expire in 10 minutes
    });

    return {
        streamId,
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