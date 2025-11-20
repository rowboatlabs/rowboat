import { jsonSchema, ModelMessage } from "ai";
import fs from "fs";
import path from "path";
import { getModelConfig, WorkDir } from "../config/config.js";
import { Agent, ToolAttachment } from "../entities/agent.js";
import { AssistantContentPart, AssistantMessage, Message, MessageList, ToolCallPart, ToolMessage, UserMessage } from "../entities/message.js";
import { runIdGenerator } from "./run-id-gen.js";
import { LanguageModel, stepCountIs, streamText, tool, Tool, ToolSet } from "ai";
import { z } from "zod";
import { getProvider } from "./models.js";
import { LlmStepStreamEvent } from "../entities/llm-step-events.js";
import { execTool } from "./exec-tool.js";
import { AskHumanRequestEvent, RunEvent, ToolPermissionRequestEvent, ToolPermissionResponseEvent } from "../entities/run-events.js";
import { BuiltinTools } from "./builtin-tools.js";
import { CopilotAgent } from "../assistant/agent.js";
import { isBlocked } from "./command-executor.js";

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
        if (event.type !== "llm-stream-event") {
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
    if (id === "copilot") {
        return CopilotAgent;
    }
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

async function buildTools(agent: z.infer<typeof Agent>): Promise<ToolSet> {
    const tools: ToolSet = {};
    for (const [name, tool] of Object.entries(agent.tools ?? {})) {
        try {
            tools[name] = await mapAgentTool(tool);
        } catch (error) {
            console.error(`Error mapping tool ${name}:`, error);
            continue;
        }
    }
    return tools;
}

export class AgentState {
    logger: RunLogger | null = null;
    runId: string | null = null;
    agent: z.infer<typeof Agent> | null = null;
    agentName: string;
    messages: z.infer<typeof MessageList> = [];
    lastAssistantMsg: z.infer<typeof AssistantMessage> | null = null;
    subflowStates: Record<string, AgentState> = {};
    toolCallIdMap: Record<string, z.infer<typeof ToolCallPart>> = {};
    pendingToolCalls: Record<string, true> = {};
    pendingToolPermissionRequests: Record<string, z.infer<typeof ToolPermissionRequestEvent>> = {};
    pendingAskHumanRequests: Record<string, z.infer<typeof AskHumanRequestEvent>> = {};
    allowedToolCallIds: Record<string, true> = {};
    deniedToolCallIds: Record<string, true> = {};

    constructor(agentName: string, runId?: string) {
        this.agentName = agentName;
        this.runId = runId || runIdGenerator.next();
        this.logger = new RunLogger(this.runId);
        if (!runId) {
            this.logger.log({
                type: "start",
                runId: this.runId,
                agentName: this.agentName,
                subflow: [],
            });
        }
    }

    getPendingPermissions(): z.infer<typeof ToolPermissionRequestEvent>[] {
        const response: z.infer<typeof ToolPermissionRequestEvent>[] = [];
        for (const [id, subflowState] of Object.entries(this.subflowStates)) {
            for (const perm of subflowState.getPendingPermissions()) {
                response.push({
                    ...perm,
                    subflow: [id, ...perm.subflow],
                });
            }
        }
        for (const perm of Object.values(this.pendingToolPermissionRequests)) {
            response.push({
                ...perm,
                subflow: [],
            });
        }
        return response;
    }

    getPendingAskHumans(): z.infer<typeof AskHumanRequestEvent>[] {
        const response: z.infer<typeof AskHumanRequestEvent>[] = [];
        for (const [id, subflowState] of Object.entries(this.subflowStates)) {
            for (const ask of subflowState.getPendingAskHumans()) {
                response.push({
                    ...ask,
                    subflow: [id, ...ask.subflow],
                });
            }
        }
        for (const ask of Object.values(this.pendingAskHumanRequests)) {
            response.push({
                ...ask,
                subflow: [],
            });
        }
        return response;
    }

    finalResponse(): string {
        if (!this.lastAssistantMsg) {
            return '';
        }
        if (typeof this.lastAssistantMsg.content === "string") {
            return this.lastAssistantMsg.content;
        }
        return this.lastAssistantMsg.content.reduce((acc, part) => {
            if (part.type === "text") {
                return acc + part.text;
            }
            return acc;
        }, "");
    }

    ingest(event: z.infer<typeof RunEvent>) {
        if (event.subflow.length > 0) {
            const { subflow, ...rest } = event;
            this.subflowStates[subflow[0]].ingest({
                ...rest,
                subflow: subflow.slice(1),
            });
            return;
        }
        switch (event.type) {
            case "message":
                this.messages.push(event.message);
                if (event.message.content instanceof Array) {
                    for (const part of event.message.content) {
                        if (part.type === "tool-call") {
                            this.toolCallIdMap[part.toolCallId] = part;
                            this.pendingToolCalls[part.toolCallId] = true;
                        }
                    }
                }
                if (event.message.role === "tool") {
                    const message = event.message as z.infer<typeof ToolMessage>;
                    delete this.pendingToolCalls[message.toolCallId];
                }
                if (event.message.role === "assistant") {
                    this.lastAssistantMsg = event.message;
                }
                break;
            case "spawn-subflow":
                this.subflowStates[event.toolCallId] = new AgentState(event.agentName);
                break;
            case "tool-permission-request":
                this.pendingToolPermissionRequests[event.toolCall.toolCallId] = event;
                break;
            case "tool-permission-response":
                switch (event.response) {
                    case "approve":
                        this.allowedToolCallIds[event.toolCallId] = true;
                        break;
                    case "deny":
                        this.deniedToolCallIds[event.toolCallId] = true;
                        break;
                }
                delete this.pendingToolPermissionRequests[event.toolCallId];
                break;
            case "ask-human-request":
                this.pendingAskHumanRequests[event.toolCallId] = event;
                break;
            case "ask-human-response":
                // console.error('im here', this.agentName, this.runId, event.subflow);
                const ogEvent = this.pendingAskHumanRequests[event.toolCallId];
                this.messages.push({
                    role: "tool",
                    content: JSON.stringify({
                        userResponse: event.response,
                    }),
                    toolCallId: ogEvent.toolCallId,
                    toolName: this.toolCallIdMap[ogEvent.toolCallId]!.toolName,
                });
                delete this.pendingAskHumanRequests[ogEvent.toolCallId];
                break;
        }
    }

    ingestAndLog(event: z.infer<typeof RunEvent>) {
        this.ingest(event);
        this.logger!.log(event);
    }

    *ingestAndLogAndYield(event: z.infer<typeof RunEvent>): Generator<z.infer<typeof RunEvent>, void, unknown> {
        this.ingestAndLog(event);
        yield event;
    }
}

export async function* streamAgent(state: AgentState): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
    // get model config
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
        throw new Error("Model config not found");
    }

    // set up agent
    const agent = await loadAgent(state.agentName);

    // set up tools
    const tools = await buildTools(agent);

    // set up provider + model
    const provider = await getProvider(agent.provider);
    const model = provider.languageModel(agent.model || modelConfig.defaults.model);
    let loopCounter = 0;

    while (true) {
        // console.error(`loop counter: ${loopCounter++}`)
        // if last response is from assistant and text, so exit
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage
            && lastMessage.role === "assistant"
            && (typeof lastMessage.content === "string"
                || !lastMessage.content.some(part => part.type === "tool-call")
            )
        ) {
            // console.error("Nothing to do, exiting (a.)")
            return;
        }

        // execute any pending tool calls
        for (const toolCallId of Object.keys(state.pendingToolCalls)) {
            const toolCall = state.toolCallIdMap[toolCallId];

            // if ask-human, skip
            if (toolCall.toolName === "ask-human") {
                continue;
            }

            // if tool has been denied, deny
            if (state.deniedToolCallIds[toolCallId])  {
                yield* state.ingestAndLogAndYield({
                    type: "message",
                    message: {
                        role: "tool",
                        content: "Unable to execute this tool: Permission was denied.",
                        toolCallId: toolCallId,
                        toolName: toolCall.toolName,
                    },
                    subflow: [],
                });
                continue;
            }

            // if permission is pending on this tool call, allow execution
            if (state.pendingToolPermissionRequests[toolCallId]) {
                continue;
            }

            // execute approved tool
            yield* state.ingestAndLogAndYield({
                type: "tool-invocation",
                toolName: toolCall.toolName,
                input: JSON.stringify(toolCall.arguments),
                subflow: [],
            });
            let result: any = null;
            if (agent.tools![toolCall.toolName].type === "agent") {
                let subflowState = state.subflowStates[toolCallId];
                for await (const event of streamAgent(subflowState)) {
                    yield* state.ingestAndLogAndYield({
                        ...event,
                        subflow: [toolCallId, ...event.subflow],
                    });
                }
                if (!subflowState.getPendingAskHumans().length && !subflowState.getPendingPermissions().length) {
                    result = subflowState.finalResponse();
                }
            } else {
                result = await execTool(agent.tools![toolCall.toolName], toolCall.arguments);
            }
            if (result) {
                const resultMsg: z.infer<typeof ToolMessage> = {
                    role: "tool",
                    content: JSON.stringify(result),
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                };
                yield* state.ingestAndLogAndYield({
                    type: "tool-result",
                    toolName: toolCall.toolName,
                    result: result,
                    subflow: [],
                });
                yield* state.ingestAndLogAndYield({
                    type: "message",
                    message: resultMsg,
                    subflow: [],
                });
            }
        }

        // if pending state, exit
        if (state.getPendingAskHumans().length || state.getPendingPermissions().length) {
            // console.error("pending asks or permissions, exiting (b.)")
            return;
        }

        // if current message state isn't runnable, exit
        if (state.messages.length === 0 || state.messages[state.messages.length - 1].role === "assistant") {
            // console.error("current message state isn't runnable, exiting (c.)")
            return;
        }

        // run one LLM turn.
        // stream agent response and build message
        const messageBuilder = new StreamStepMessageBuilder();
        for await (const event of streamLlm(
            model,
            state.messages,
            agent.instructions,
            tools,
        )) {
            messageBuilder.ingest(event);
            yield* state.ingestAndLogAndYield({
                type: "llm-stream-event",
                event: event,
                subflow: [],
            });
        }

        // build and emit final message from agent response
        const message = messageBuilder.get();
        yield* state.ingestAndLogAndYield({
            type: "message",
            message,
            subflow: [],
        });

        // if there were any ask-human calls, emit those events
        if (message.content instanceof Array) {
            for (const part of message.content) {
                if (part.type === "tool-call") {
                    const underlyingTool = agent.tools![part.toolName];
                    if (underlyingTool.type === "builtin" && underlyingTool.name === "ask-human") {
                        yield* state.ingestAndLogAndYield({
                            type: "ask-human-request",
                            toolCallId: part.toolCallId,
                            query: part.arguments.question,
                            subflow: [],
                        });
                    }
                    if (underlyingTool.type === "builtin" && underlyingTool.name === "executeCommand") {
                        // if command is blocked, then seek permission
                        if (isBlocked(part.arguments.command)) {
                            yield *state.ingestAndLogAndYield({
                                type: "tool-permission-request",
                                toolCall: part,
                                subflow: [],
                            });
                        }
                    }
                    if (underlyingTool.type === "agent" && underlyingTool.name) {
                        yield* state.ingestAndLogAndYield({
                            type: "spawn-subflow",
                            agentName: underlyingTool.name,
                            toolCallId: part.toolCallId,
                            subflow: [],
                        });
                        yield* state.ingestAndLogAndYield({
                            type: "message",
                            message: {
                                role: "user",
                                content: part.arguments.message,
                            },
                            subflow: [part.toolCallId],
                        });
                    }
                }
            }
        }
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
