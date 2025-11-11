import { loadWorkflow } from "./utils.js";
import { MessageList, AssistantMessage, AssistantContentPart, Message, ToolMessage, ToolCallPart } from "../entities/message.js";
import { LlmStepStreamEvent } from "../entities/llm-step-event.js";
import { AgentNode } from "./agent.js";
import { z } from "zod";
import path from "path";
import { WorkDir } from "../config/config.js";
import fs from "fs";
import { createInterface, Interface } from "node:readline/promises";
import { FunctionsRegistry } from "../registry/functions.js";
import { RunEvent } from "../entities/workflow-event.js";
import { execAskHumanTool, execTool } from "./exec-tool.js";
import { AgentTool } from "../entities/agent.js";
import { runIdGenerator } from "./run-id-gen.js";
import { Workflow } from "../entities/workflow.js";

const MappedToolCall = z.object({
    toolCall: ToolCallPart,
    agentTool: AgentTool,
});

const State = z.object({
    stepIndex: z.number(),
    messages: MessageList,
    workflow: Workflow.nullable(),
    pendingToolCallId: z.string().nullable(),
});

class StateBuilder {
    private state: z.infer<typeof State> = {
        stepIndex: 0,
        messages: [],
        workflow: null,
        pendingToolCallId: null,
    };

    ingest(event: z.infer<typeof RunEvent>) {
        switch (event.type) {
            case "start":
                this.state.workflow = event.workflow;
                break;
            case "step-start":
                this.state.stepIndex = event.stepIndex;
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

class RunLogger {
    private logFile: string;
    private fileHandle: fs.WriteStream;

    ensureRunsDir(workflowId: string) {
        const runsDir = path.join(WorkDir, "runs", workflowId);
        if (!fs.existsSync(runsDir)) {
            fs.mkdirSync(runsDir, { recursive: true });
        }
    }

    constructor(workflowId: string, runId: string) {
        this.ensureRunsDir(workflowId);
        this.logFile = path.join(WorkDir, "runs", `${runId}.jsonl`);
        this.fileHandle = fs.createWriteStream(this.logFile, {
            flags: "a",
            encoding: "utf8",
        });
    }

    log(event: z.infer<typeof RunEvent>) {
        this.fileHandle.write(JSON.stringify(event) + "\n");
    }

    close() {
        this.fileHandle.close();
    }
}

class LogAndYield {
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

class StreamStepMessageBuilder {
    private parts: z.infer<typeof AssistantContentPart>[] = [];
    private textBuffer: string = "";
    private reasoningBuffer: string = "";

    flushBuffers() {
        if (this.reasoningBuffer) {
            this.parts.push({ type: "reasoning", text: this.reasoningBuffer });
            this.reasoningBuffer = "";
        }
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

function loadFunction(id: string) {
    const func = FunctionsRegistry[id];
    if (!func) {
        throw new Error(`Function ${id} not found`);
    }
    return func;
}

export async function* executeWorkflow(id: string, input: string, interactive: boolean = true): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
    const runId = runIdGenerator.next();
    yield* runFromState({
        id,
        runId,
        state: {
            stepIndex: 0,
            messages: [{
                role: "user",
                content: input,
            }],
            workflow: null,
            pendingToolCallId: null,
        },
        interactive,
    });
}

export async function* resumeWorkflow(runId: string, input: string, interactive: boolean = false): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
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

    const { workflow, messages, stepIndex, pendingToolCallId } = builder.get();
    if (!workflow) {
        throw new Error(`Workflow not found for run ${runId}`);
    }
    if (!pendingToolCallId) {
        throw new Error(`No pending tool call found for run ${runId}`);
    }
    const stepId = workflow.steps[stepIndex].id;

    // append user input as message
    const logger = new RunLogger(workflow.name, runId);
    const ly = new LogAndYield(logger);
    yield *ly.logAndYield({
        type: "resume"
    });

    // append user input as message
    const resultMsg: z.infer<typeof ToolMessage> = {
        role: "tool",
        content: JSON.stringify(input),
        toolCallId: pendingToolCallId,
        toolName: "ask-human",
    };
    messages.push(resultMsg);
    yield* ly.logAndYield({
        type: "tool-result",
        stepId,
        toolName: "ask-human",
        result: input,
    });
    yield* ly.logAndYield({
        type: "message",
        stepId,
        message: resultMsg,
    });

    yield* runFromState({
        id: workflow.name,
        runId,
        state: {
            stepIndex,
            messages,
            workflow,
            pendingToolCallId,
        },
        interactive,
    });
}

async function* runFromState(opts: {
    id: string;
    runId: string;
    state: z.infer<typeof State>;
    interactive: boolean;
}) {
    const { id, runId, state, interactive } = opts;
    let stepIndex = state.stepIndex;
    let messages = [...state.messages];
    let workflow = state.workflow;

    const logger = new RunLogger(id, runId);
    const ly = new LogAndYield(logger);

    try {
        if (!workflow) {
            workflow = loadWorkflow(id);

            yield* ly.logAndYield({
                type: "start",
                runId,
                workflowId: id,
                workflow,
                interactive,
            });
        }

        while (true) {
            const step = workflow.steps[stepIndex];
            const node = step.type === "agent" ? new AgentNode(step.id, interactive) : loadFunction(step.id);

            yield* ly.logAndYield({
                type: "step-start",
                stepIndex,
                stepId: step.id,
                stepType: step.type,
            });

            const messageBuilder = new StreamStepMessageBuilder();

            // stream response from agent
            for await (const event of node.execute(messages)) {
                // console.log("       - event", JSON.stringify(event));
                messageBuilder.ingest(event);
                yield* ly.logAndYield({
                    type: "stream-event",
                    stepId: step.id,
                    event: event,
                });
            }

            // build and emit final message from agent response
            const msg = messageBuilder.get();
            messages.push(msg);
            yield* ly.logAndYield({
                type: "message",
                stepId: step.id,
                message: msg,
            });

            // handle tool calls
            const tools = node.tools();
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
                    agentTool: agentTool,
                });
            }

            // first, exec all tool calls other than ask-human
            for (const call of mappedToolCalls) {
                const { agentTool, toolCall } = call;
                if (agentTool.type === "builtin" && agentTool.name === "ask-human") {
                    continue;
                }
                yield* ly.logAndYield({
                    type: "tool-invocation",
                    stepId: step.id,
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
                    stepId: step.id,
                    toolName: toolCall.toolName,
                    result: result,
                });
                yield* ly.logAndYield({
                    type: "message",
                    stepId: step.id,
                    message: resultMsg,
                });
            }

            // handle ask-tool call execution
            for (const call of mappedToolCalls) {
                const { agentTool, toolCall } = call;
                if (agentTool.type !== "builtin" || agentTool.name !== "ask-human") {
                    continue;
                }
                yield* ly.logAndYield({
                    type: "tool-invocation",
                    stepId: step.id,
                    toolName: toolCall.toolName,
                    input: JSON.stringify(toolCall.arguments),
                });

                // if running in background mode, exit here
                if (!interactive) {
                    yield* ly.logAndYield({
                        type: "pause-for-human-input",
                        toolCallId: toolCall.toolCallId,
                    });
                    return;
                }
                const result = await execAskHumanTool(agentTool, toolCall.arguments.question as string);
                const resultMsg: z.infer<typeof ToolMessage> = {
                    role: "tool",
                    content: JSON.stringify(result),
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                };
                messages.push(resultMsg);
                yield* ly.logAndYield({
                    type: "tool-result",
                    stepId: step.id,
                    toolName: toolCall.toolName,
                    result: result,
                });
                yield* ly.logAndYield({
                    type: "message",
                    stepId: step.id,
                    message: resultMsg,
                });
            }

            yield* ly.logAndYield({
                type: "step-end",
                stepIndex,
            });

            // if the agent response had tool calls, replay this agent
            if (hasToolCalls) {
                continue;
            }

            // otherwise, move to the next step
            stepIndex++;
            if (stepIndex >= workflow.steps.length) {
                yield* ly.logAndYield({
                    type: "end",
                });
                break;
            }
        }
        // console.log('\n\n', JSON.stringify(messages, null, 2));
    } catch (error) {
        yield* ly.logAndYield({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        logger.close();
    }
}
