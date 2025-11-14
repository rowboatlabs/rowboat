import { MessageList, AssistantMessage, AssistantContentPart, Message, ToolMessage, ToolCallPart } from "../entities/message.js";
import { LlmStepStreamEvent } from "../entities/llm-step-events.js";
import { z } from "zod";
import path from "path";
import { WorkDir } from "../config/config.js";
import fs from "fs";
import { createInterface, Interface } from "node:readline/promises";
import { RunEvent } from "../entities/run-events.js";
import { Agent, ToolAttachment } from "../entities/agent.js";
import { runIdGenerator } from "./run-id-gen.js";

export const MappedToolCall = z.object({
    toolCall: ToolCallPart,
    agentTool: ToolAttachment,
});

const State = z.object({
    messages: MessageList,
    agent: Agent.nullable(),
    pendingToolCallId: z.string().nullable(),
});

export class StateBuilder {
    private state: z.infer<typeof State> = {
        messages: [],
        agent: null,
        pendingToolCallId: null,
    };

    ingest(event: z.infer<typeof RunEvent>) {
        switch (event.type) {
            case "start":
                this.state.agent = event.agent;
                break;
            case "message":
                this.state.messages.push(event.message);
                this.state.pendingToolCallId = null;
                break;
            case "pause-for-human-input":
                this.state.pendingToolCallId = event.toolCallId;
                break;
        }
    }

    get(): z.infer<typeof State> {
        return this.state;
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

export class LogAndYield {
    private logger: RunLogger

    constructor(logger: RunLogger) {
        this.logger = logger;
    }

    async *logAndYield(event: z.infer<typeof RunEvent>): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
        const ev = {
            ...event,
            ts: new Date().toISOString(),
        }
        this.logger.log(ev);
        yield ev;
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

export async function* executeAgent(id: string, input: string, interactive: boolean = true, asTool: boolean = false): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
    const runId = runIdGenerator.next();
    // yield* runFromState({
    //     id,
    //     runId,
    //     state: {
    //         messages: [{
    //             role: "user",
    //             content: input,
    //         }],
    //         agent: null,
    //         pendingToolCallId: null,
    //     },
    //     interactive,
    //     asTool,
    // });
}

export async function* resumeRun(runId: string, input: string, interactive: boolean = false): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
    // read a run.jsonl file line by line and build state
    const builder = new StateBuilder();
    let rl: Interface | null = null;
    let stream: fs.ReadStream | null = null;
    try {
        const logFile = path.join(WorkDir, "runs", `${runId}.jsonl`);
        stream = fs.createReadStream(logFile, { encoding: "utf8" });
        rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
            if (line.trim() === "") {
                continue;
            }
            // console.error('processing line', line);
            const parsed = JSON.parse(line);
            // console.error('parsed');
            const event = RunEvent.parse(parsed);
            // console.error('zod parsed');
            builder.ingest(event);
        }
    } catch (error) {
        // console.error("Failed to resume workflow:", error);
        // yield {
        //     type: "error",
        //     error: error instanceof Error ? error.message : String(error),
        // };
    } finally {
        rl?.close();
        stream?.close();
    }

    const { agent, messages, pendingToolCallId } = builder.get();
    if (!agent) {
        throw new Error(`Agent not found for run ${runId}`);
    }
    if (!pendingToolCallId) {
        throw new Error(`No pending tool call found for run ${runId}`);
    }

    // yield* runFromState({
    //     id: agent.name,
    //     runId,
    //     state: {
    //         messages,
    //         agent,
    //         pendingToolCallId,
    //     },
    //     interactive,
    //     asTool: false,
    // });
}

// async function* runFromState(opts: {
//     id: string;
//     runId: string;
//     state: z.infer<typeof State>;
//     interactive: boolean;
//     asTool: boolean;
// }) {
//     const { id, runId, state, interactive, asTool } = opts;
//     let messages = [...state.messages];
//     let agent = state.agent;

//     const logger = new RunLogger(runId);
//     const ly = new LogAndYield(logger);

//     try {
//         if (!agent) {
//             agent = await loadAgent(id);

//             yield* ly.logAndYield({
//                 type: "start",
//                 runId,
//                 agentId: id,
//                 agent,
//                 interactive,
//             });
//         }
//         while (true) {
//             yield* ly.logAndYield({
//                 type: "step-start",
//             });



//             // build and emit final message from agent response
//             const msg = messageBuilder.get();
//             messages.push(msg);
//             yield* ly.logAndYield({
//                 type: "message",
//                 message: msg,
//             });

//             // handle tool calls
//             const tools = node.tools();
//             const mappedToolCalls: z.infer<typeof MappedToolCall>[] = [];
//             let msgToolCallParts: z.infer<typeof ToolCallPart>[] = [];
//             if (msg.content instanceof Array) {
//                 msgToolCallParts = msg.content.filter(part => part.type === "tool-call");
//             }
//             const hasToolCalls = msgToolCallParts.length > 0;

//             // validate and map tool calls
//             for (const part of msgToolCallParts) {
//                 const agentTool = tools[part.toolName];
//                 if (!agentTool) {
//                     throw new Error(`Tool ${part.toolName} not found`);
//                 }
//                 mappedToolCalls.push({
//                     toolCall: part,
//                     agentTool: agentTool,
//                 });
//             }

//             for (const call of mappedToolCalls) {
//                 const { agentTool, toolCall } = call;
//                 yield* ly.logAndYield({
//                     type: "tool-invocation",
//                     toolName: toolCall.toolName,
//                     input: JSON.stringify(toolCall.arguments),
//                 });
//                 const result = await execTool(agentTool, toolCall.arguments);
//                 const resultMsg: z.infer<typeof ToolMessage> = {
//                     role: "tool",
//                     content: JSON.stringify(result),
//                     toolCallId: toolCall.toolCallId,
//                     toolName: toolCall.toolName,
//                 };
//                 messages.push(resultMsg);
//                 yield* ly.logAndYield({
//                     type: "tool-result",
//                     toolName: toolCall.toolName,
//                     result: result,
//                 });
//                 yield* ly.logAndYield({
//                     type: "message",
//                     message: resultMsg,
//                 });
//             }

//             yield* ly.logAndYield({
//                 type: "step-end",
//             });

//             // if the agent response had tool calls, replay this agent
//             if (hasToolCalls) {
//                 continue;
//             }

//             // otherwise, break
//             break;
//         }
//         // console.log('\n\n', JSON.stringify(messages, null, 2));
//     } catch (error) {
//         yield* ly.logAndYield({
//             type: "error",
//             error: error instanceof Error ? error.message : String(error),
//         });
//     } finally {
//         logger.close();
//     }
// }