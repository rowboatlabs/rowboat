import { z } from "zod";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { Message } from "./types/types";

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

export async function mockToolResponse(toolId: string, messages: z.infer<typeof Message>[], mockInstructions: string): Promise<string> {
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