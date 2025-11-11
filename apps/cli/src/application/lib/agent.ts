import { Message, MessageList } from "../entities/message.js";
import { z } from "zod";
import { Step, StepInputT, StepOutputT } from "./step.js";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { generateText, ModelMessage, stepCountIs, streamText, tool, Tool, ToolSet, jsonSchema } from "ai";
import { Agent, AgentTool } from "../entities/agent.js";
import { WorkDir } from "../config/config.js";
import fs from "fs";
import path from "path";
import { loadWorkflow } from "./utils.js";

const BashTool = tool({
    description: "Run a command in the shell",
    inputSchema: z.object({
        command: z.string(),
    }),
});

const AskHumanTool = tool({
    description: "Ask the human for input",
    inputSchema: z.object({
        question: z.string(),
    }),
});

function mapAgentTool(t: z.infer<typeof AgentTool>): Tool {
    switch (t.type) {
        case "mcp":
            return tool({
                name: t.name,
                description: t.description,
                inputSchema: jsonSchema(t.inputSchema),
            });
        case "workflow":
            const workflow = loadWorkflow(t.name);
            if (!workflow) {
                throw new Error(`Workflow ${t.name} not found`);
            }
            return tool({
                name: t.name,
                description: workflow.description,
                inputSchema: z.object({
                    message: z.string().describe("The message to send to the workflow"),
                }),
            });
        case "builtin":
            switch (t.name) {
                case "bash":
                    return BashTool;
                case "ask-human":
                    return AskHumanTool;
                default:
                    throw new Error(`Unknown builtin tool: ${t.name}`);
            }
    }
}

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
            case "tool":
                result.push({
                    role: "tool",
                    content: [
                        {
                            type: "tool-result",
                            toolCallId: msg.toolCallId,
                            toolName: msg.toolName,
                            output: {
                                type: "text",
                                value: msg.content,
                            },
                        },
                    ],
                });
                break;
        }
    }
    return result;
}

export class AgentNode implements Step {
    private id: string;
    private asTool: boolean;
    private agent: z.infer<typeof Agent>;

    constructor(id: string, asTool: boolean) {
        this.id = id;
        this.asTool = asTool;
        const agentPath = path.join(WorkDir, "agents", `${id}.json`);
        const agent = fs.readFileSync(agentPath, "utf8");
        this.agent = Agent.parse(JSON.parse(agent));
     }

    tools(): Record<string, z.infer<typeof AgentTool>> {
        return this.agent.tools ?? {};
    }

    async* execute(input: StepInputT): StepOutputT {
        // console.log("\n\n\t>>>>\t\tinput", JSON.stringify(input));
        const tools: ToolSet = {};
        // if (!this.background) {
        //     tools["ask-human"] = AskHumanTool;
        // }
        for (const [name, tool] of Object.entries(this.agent.tools ?? {})) {
            if (this.asTool && name === "ask-human") {
                continue;
            }
            try {
                tools[name] = mapAgentTool(tool);
            } catch (error) {
                console.error(`Error mapping tool ${name}:`, error);
                continue;
            }
        }

        // console.log("\n\n\t>>>>\t\ttools", JSON.stringify(tools, null, 2));

        const { fullStream } = streamText({
            model: openai("gpt-4.1"),
            // model: google("gemini-2.5-flash"),
            messages: convertFromMessages(input),
            system: this.agent.instructions,
            stopWhen: stepCountIs(1),
            tools,
        });

        for await (const event of fullStream) {
            // console.log("\n\n\t>>>>\t\tstream event", JSON.stringify(event));
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