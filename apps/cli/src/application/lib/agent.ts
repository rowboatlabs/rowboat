import { jsonSchema, ModelMessage } from "ai";
import fs from "fs";
import path from "path";
import { ModelConfig, WorkDir } from "../config/config.js";
import { Agent, ToolAttachment } from "../entities/agent.js";
import { createInterface, Interface } from "node:readline/promises";
import { AssistantContentPart, AssistantMessage, Message, MessageList, ToolCallPart, ToolMessage, UserMessage } from "../entities/message.js";
import { runIdGenerator } from "./run-id-gen.js";
import { LanguageModel, stepCountIs, streamText, tool, Tool, ToolSet } from "ai";
import { z } from "zod";
import { getProvider } from "./models.js";
import { LlmStepStreamEvent } from "../entities/llm-step-events.js";
import { execTool } from "./exec-tool.js";
import { RunEvent } from "../entities/run-events.js";
import { BuiltinTools } from "./builtin-tools.js";

export async function mapAgentTool(t: z.infer<typeof ToolAttachment>): Promise<Tool> {
    switch (t.type) {
        case "mcp":
            return tool({
                name: t.name,
                description: t.description,
                inputSchema: jsonSchema(t.inputSchema),
            });
        case "agent":
            const agent = await loadAgent(t.name);
            if (!agent) {
                throw new Error(`Agent ${t.name} not found`);
            }
            return tool({
                name: t.name,
                description: agent.description,
                inputSchema: z.object({
                    message: z.string().describe("The message to send to the workflow"),
                }),
            });
        case "builtin":
            if (t.name === "ask-human") {
                return tool({
                    description: "Ask a human before proceeding",
                    inputSchema: z.object({
                        question: z.string().describe("The question to ask the human"),
                    }),
                });
            }
            const match = BuiltinTools[t.name];
            if (!match) {
                throw new Error(`Unknown builtin tool: ${t.name}`);
            }
            return tool({
                description: match.description,
                inputSchema: match.inputSchema,
            });
    }
}

export class RunLogger {
    private logFile: string;
    private fileHandle: fs.WriteStream;

    ensureRunsDir() {
        const runsDir = path.join(WorkDir, "runs");
        if (!fs.existsSync(runsDir)) {
            fs.mkdirSync(runsDir, { recursive: true });
        }
    }

    constructor(runId: string) {
        this.ensureRunsDir();
        this.logFile = path.join(WorkDir, "runs", `${runId}.jsonl`);
        this.fileHandle = fs.createWriteStream(this.logFile, {
            flags: "a",
            encoding: "utf8",
        });
    }

    log(event: z.infer<typeof RunEvent>) {
        if (event.type !== "stream-event") {
            this.fileHandle.write(JSON.stringify(event) + "\n");
        }
    }

    close() {
        this.fileHandle.close();
    }
}

export class StreamStepMessageBuilder {
    private parts: z.infer<typeof AssistantContentPart>[] = [];
    private textBuffer: string = "";
    private reasoningBuffer: string = "";

    flushBuffers() {
        // skip reasoning
        // if (this.reasoningBuffer) {
        //     this.parts.push({ type: "reasoning", text: this.reasoningBuffer });
        //     this.reasoningBuffer = "";
        // }
        if (this.textBuffer) {
            this.parts.push({ type: "text", text: this.textBuffer });
            this.textBuffer = "";
        }
    }

    ingest(event: z.infer<typeof LlmStepStreamEvent>) {
        switch (event.type) {
            case "reasoning-start":
            case "reasoning-end":
            case "text-start":
            case "text-end":
                this.flushBuffers();
                break;
            case "reasoning-delta":
                this.reasoningBuffer += event.delta;
                break;
            case "text-delta":
                this.textBuffer += event.delta;
                break;
            case "tool-call":
                this.parts.push({
                    type: "tool-call",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    arguments: event.input,
                });
                break;
        }
    }

    get(): z.infer<typeof AssistantMessage> {
        this.flushBuffers();
        return {
            role: "assistant",
            content: this.parts,
        };
    }
}

function normaliseAskHumanToolCall(message: z.infer<typeof AssistantMessage>) {
    if (typeof message.content === "string") {
        return;
    }
    let askHumanToolCall: z.infer<typeof ToolCallPart> | null = null;
    const newParts = [];
    for (const part of message.content as z.infer<typeof AssistantContentPart>[]) {
        if (part.type === "tool-call" && part.toolName === "ask-human") {
            if (!askHumanToolCall) {
                askHumanToolCall = part;
            } else {
                (askHumanToolCall as z.infer<typeof ToolCallPart>).arguments += "\n" + part.arguments;
            }
            break;
        } else {
            newParts.push(part);
        }
    }
    if (askHumanToolCall) {
        newParts.push(askHumanToolCall);
    }
    message.content = newParts;
}

export async function loadAgent(id: string): Promise<z.infer<typeof Agent>> {
    const agentPath = path.join(WorkDir, "agents", `${id}.json`);
    const agent = fs.readFileSync(agentPath, "utf8");
    return Agent.parse(JSON.parse(agent));
}

export function convertFromMessages(messages: z.infer<typeof Message>[]): ModelMessage[] {
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


export async function* streamAgentTurn(opts: {
    agent: z.infer<typeof Agent>;
    messages: z.infer<typeof MessageList>;
}): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
    const { agent, messages } = opts;

    // set up tools
    const tools: ToolSet = {};
    for (const [name, tool] of Object.entries(agent.tools ?? {})) {
        try {
            tools[name] = await mapAgentTool(tool);
        } catch (error) {
            console.error(`Error mapping tool ${name}:`, error);
            continue;
        }
    }

    // set up
    const provider = getProvider(agent.provider);
    const model = provider(agent.model || ModelConfig.defaults.model);

    // run one turn
    while (true) {
        // stream agent response and build message
        const messageBuilder = new StreamStepMessageBuilder();
        for await (const event of streamLlm(
            model,
            messages,
            agent.instructions,
            tools,
        )) {
            messageBuilder.ingest(event);
            yield {
                type: "stream-event",
                event: event,
            };
        }

        // build and emit final message from agent response
        const msg = messageBuilder.get();
        normaliseAskHumanToolCall(msg);
        messages.push(msg);
        yield {
            type: "message",
            message: msg,
        };

        // handle tool calls
        const mappedToolCalls: z.infer<typeof MappedToolCall>[] = [];
        let msgToolCallParts: z.infer<typeof ToolCallPart>[] = [];
        if (msg.content instanceof Array) {
            msgToolCallParts = msg.content.filter(part => part.type === "tool-call");
        }
        const hasToolCalls = msgToolCallParts.length > 0;

        // validate and map tool calls
        for (const part of msgToolCallParts) {
            const agentTool = tools[part.toolName];
            if (!agentTool) {
                throw new Error(`Tool ${part.toolName} not found`);
            }
            mappedToolCalls.push({
                toolCall: part,
                agentTool: agent.tools![part.toolName],
            });
        }

        // first, handle tool calls other than ask-human
        for (const call of mappedToolCalls) {
            if (call.toolCall.toolName === "ask-human") {
                continue;
            }
            const { agentTool, toolCall } = call;
            yield {
                type: "tool-invocation",
                toolName: toolCall.toolName,
                input: JSON.stringify(toolCall.arguments),
            };
            const result = await execTool(agentTool, toolCall.arguments);
            const resultMsg: z.infer<typeof ToolMessage> = {
                role: "tool",
                content: JSON.stringify(result),
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
            };
            messages.push(resultMsg);
            yield {
                type: "tool-result",
                toolName: toolCall.toolName,
                result: result,
            };
            yield {
                type: "message",
                message: resultMsg,
            };
        }

        // then, handle ask-human (only first one)
        const askHumanCall = mappedToolCalls.filter(call => call.toolCall.toolName === "ask-human")[0];
        if (askHumanCall) {
            yield {
                type: "pause-for-human-input",
                toolCallId: askHumanCall.toolCall.toolCallId,
                question: askHumanCall.toolCall.arguments.question as string,
            };
            return;
        }

        // if the agent response had tool calls, replay this agent
        if (hasToolCalls) {
            continue;
        }

        // otherwise, break
        return;
    }
}

async function* streamLlm(
    model: LanguageModel,
    messages: z.infer<typeof MessageList>,
    instructions: string,
    tools: ToolSet,
): AsyncGenerator<z.infer<typeof LlmStepStreamEvent>, void, unknown> {
    const { fullStream } = streamText({
        model,
        messages: convertFromMessages(messages),
        system: instructions,
        tools,
        stopWhen: stepCountIs(1),
        // providerOptions: {
        //     openai: {
        //         reasoningEffort: "low",
        //         reasoningSummary: "auto",
        //     },
        // }
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
export const MappedToolCall = z.object({
    toolCall: ToolCallPart,
    agentTool: ToolAttachment,
});
