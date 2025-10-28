import { Message } from "../entities/message.js";
import { z } from "zod";
import { Node, NodeInputT, NodeOutputT } from "./node.js";
import { openai } from "@ai-sdk/openai";
import { generateText, ModelMessage, stepCountIs, streamText } from "ai";
import { Agent } from "../entities/agent.js";
import { WorkDir } from "../config/config.js";
import fs from "fs";
import path from "path";

function convertFromMessages(messages: z.infer<typeof Message>[]): ModelMessage[] {
    const result: ModelMessage[] = [];
    for (const msg of messages) {
        switch (msg.role) {
            case "assistant":
                if (typeof msg.content === 'string') {
                    result.push({
                        role: "assistant",
                        content: msg.content,
                    });
                } else {
                    result.push({
                        role: "assistant",
                        content: msg.content.map(part => {
                            switch (part.type) {
                                case 'text':
                                    return part;
                                case 'reasoning':
                                    return part;
                                case 'tool-call':
                                    return {
                                        type: 'tool-call',
                                        toolCallId: part.toolCallId,
                                        toolName: part.toolName,
                                        input: part.arguments,
                                    };
                            }
                        }),
                    });
                }
                break;
            case "system":
                result.push({
                    role: "system",
                    content: msg.content,
                });
                break;
            case "user":
                result.push({
                    role: "user",
                    content: msg.content,
                });
                break;
        }
    }
    return result;
}

export class AgentNode implements Node {
    private id: string;

    constructor(id: string) {
        this.id = id;
    }

    private loadAgent(id: string): z.infer<typeof Agent> {
        const agentPath = path.join(WorkDir, "agents", `${id}.json`);
        const agent = fs.readFileSync(agentPath, "utf8");
        return Agent.parse(JSON.parse(agent));
    }

    async* execute(input: NodeInputT): NodeOutputT {
        const agent = this.loadAgent(this.id);
        const { fullStream } = await streamText({
            model: openai(agent.model),
            messages: convertFromMessages(input),
            system: agent.instructions,
            stopWhen: stepCountIs(1),
        });

        for await (const event of fullStream) {
            switch (event.type) {
                case "reasoning-start":
                    yield {
                        type: "reasoning-start",
                    };
                    break;
                case "reasoning-delta":
                    yield {
                        type: "reasoning-delta",
                        delta: event.text,
                    };
                    break;
                case "reasoning-end":
                    yield {
                        type: "reasoning-end",
                    };
                    break;
                case "text-start":
                    yield {
                        type: "text-start",
                    };
                    break;
                case "text-delta":
                    yield {
                        type: "text-delta",
                        delta: event.text,
                    };
                    break;
                case "tool-call":
                    yield {
                        type: "tool-call",
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        input: event.input,
                    };
                    break;
                case "finish":
                    yield {
                        type: "usage",
                        usage: event.totalUsage,
                    };
                    break;
                default:
                    // console.warn("Unknown event type", event);
                    continue;
            }
        }
    }
}