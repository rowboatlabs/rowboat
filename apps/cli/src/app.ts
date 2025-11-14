import { LogAndYield, MappedToolCall, RunLogger, StreamStepMessageBuilder } from "./application/lib/exec-agent.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { createInterface, Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Message, MessageList, ToolCallPart, ToolMessage, UserMessage } from "./application/entities/message.js";
import { runIdGenerator } from "./application/lib/run-id-gen.js";
import { jsonSchema, LanguageModel, ModelMessage, stepCountIs, streamText, tool, Tool, ToolSet } from "ai";
import { Agent, ToolAttachment } from "./application/entities/agent.js";
import fs from "fs";
import path from "path";
import { ModelConfig, WorkDir } from "./application/config/config.js";
import { z } from "zod";
import { getProvider } from "./application/lib/models.js";
import { LlmStepStreamEvent } from "./application/entities/llm-step-events.js";
import { execTool } from "./application/lib/exec-tool.js";
import { RunEvent } from "./application/entities/run-events.js";
import { BuiltinTools } from "./application/lib/builtin-tools.js";
import { CopilotAgent } from "./application/assistant/agent.js";

const BashTool = tool({
    description: "Run a command in the shell",
    inputSchema: z.object({
        command: z.string(),
    }),
});

async function mapAgentTool(t: z.infer<typeof ToolAttachment>): Promise<Tool> {
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

export async function app(opts: {
    agent: string;
    runId?: string;
    input?: string;
}) {
    const renderer = new StreamRenderer();
    for await (const event of streamAgent({
        ...opts,
        interactive: true,
    })) {
        renderer.render(event);
        if (event?.type === "error") {
            process.exitCode = 1;
        }
    }
}

export async function* streamAgent(opts: {
    agent: string;
    runId?: string;
    input?: string;
    interactive?: boolean;
}) {
    const messages: z.infer<typeof MessageList> = [];

    // load existing and assemble state if required
    if (opts.runId) {
        console.error("loading run", opts.runId);
        let stream: fs.ReadStream | null = null;
        let rl: Interface | null = null;
        try {
            const logFile = path.join(WorkDir, "runs", `${opts.runId}.jsonl`);
            stream = fs.createReadStream(logFile, { encoding: "utf8" });
            rl = createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                if (line.trim() === "") {
                    continue;
                }
                const parsed = JSON.parse(line);
                const event = RunEvent.parse(parsed);
                switch (event.type) {
                    case "message":
                        messages.push(event.message);
                        break;
                }
            }
        } finally {
            stream?.close();
        }
    }

    // create runId if not present
    if (!opts.runId) {
        opts.runId = runIdGenerator.next();
    }

    // load agent data
    let agent: z.infer<typeof Agent> | null = null;
    if (opts.agent === "copilot") {
        agent = CopilotAgent;
    } else {
        agent = await loadAgent(opts.agent);
    }
    if (!agent) {
        throw new Error("unable to load agent");
    }

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
    const logger = new RunLogger(opts.runId);
    const ly = new LogAndYield(logger);
    const provider = getProvider(agent.provider);
    const model = provider(agent.model || ModelConfig.defaults.model);

    // get first input if needed
    let rl: Interface | null = null;
    if (opts.interactive) {
        rl = createInterface({ input, output });
    }
    if (opts.input) {
        const m: z.infer<typeof UserMessage> = {
            role: "user",
            content: opts.input,
        };
        messages.push(m);
        ly.logAndYield({
            type: "message",
            message: m,
        });
    }
    try {
        // loop b/w user and agent
        while (true) {
            // get input in interactive mode when last message is not user
            if (opts.interactive && (messages.length === 0 || messages[messages.length - 1].role !== "user")) {
                const input = await rl!.question("You: ");
                // Exit condition
                if (["q", "quit", "exit"].includes(input.toLowerCase())) {
                    console.log("\n👋 Goodbye!");
                    return;
                }

                const m: z.infer<typeof UserMessage> = {
                    role: "user",
                    content: input,
                };
                messages.push(m);
                yield* ly.logAndYield({
                    type: "message",
                    message: m,
                });
            }

            // inner loop to handle tool calls
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
                    yield* ly.logAndYield({
                        type: "stream-event",
                        event: event,
                    });
                }

                // build and emit final message from agent response
                const msg = messageBuilder.get();
                messages.push(msg);
                yield* ly.logAndYield({
                    type: "message",
                    message: msg,
                });

                // handle tool calls
                const mappedToolCalls: z.infer<typeof MappedToolCall>[] = [];
                let msgToolCallParts: z.infer<typeof ToolCallPart>[] = [];
                if (msg.content instanceof Array) {
                    msgToolCallParts = msg.content.filter(part => part.type === "tool-call");
                }
                const hasToolCalls = msgToolCallParts.length > 0;
                console.log(msgToolCallParts);

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

                for (const call of mappedToolCalls) {
                    const { agentTool, toolCall } = call;
                    yield* ly.logAndYield({
                        type: "tool-invocation",
                        toolName: toolCall.toolName,
                        input: JSON.stringify(toolCall.arguments),
                    });
                    const result = await execTool(agentTool, toolCall.arguments);
                    const resultMsg: z.infer<typeof ToolMessage> = {
                        role: "tool",
                        content: JSON.stringify(result),
                        toolCallId: toolCall.toolCallId,
                        toolName: toolCall.toolName,
                    };
                    messages.push(resultMsg);
                    yield* ly.logAndYield({
                        type: "tool-result",
                        toolName: toolCall.toolName,
                        result: result,
                    });
                    yield* ly.logAndYield({
                        type: "message",
                        message: resultMsg,
                    });
                }

                // if the agent response had tool calls, replay this agent
                if (hasToolCalls) {
                    continue;
                }

                // otherwise, break
                break;
            }

            // if not interactive, return
            if (!opts.interactive) {
                break;
            }
        }
    } finally {
        rl?.close();
        logger.close();
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

async function loadAgent(id: string): Promise<z.infer<typeof Agent>> {
    const agentPath = path.join(WorkDir, "agents", `${id}.json`);
    const agent = fs.readFileSync(agentPath, "utf8");
    return Agent.parse(JSON.parse(agent));
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
        providerOptions: {
            openai: {
                reasoningEffort: "low",
                reasoningSummary: "auto",
            },
        }
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