import { loadWorkflow } from "./utils.js";
import { randomId } from "./random-id.js";
import { MessageList, AssistantMessage, AssistantContentPart, Message, ToolMessage } from "../entities/message.js";
import { LlmStepStreamEvent } from "../entities/llm-step-event.js";
import { AgentNode } from "./agent.js";
import { z } from "zod";
import path from "path";
import { WorkDir } from "../config/config.js";
import fs from "fs";
import { FunctionsRegistry } from "../registry/functions.js";
import { WorkflowStreamEvent } from "../entities/workflow-event.js";
import { execTool } from "./exec-tool.js";

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
        this.logFile = path.join(WorkDir, "runs", `${workflowId}`, `${runId}.jsonl`);
        this.fileHandle = fs.createWriteStream(this.logFile, {
            flags: "a",
            encoding: "utf8",
        });
    }

    log(message: z.infer<typeof Message>) {
        this.fileHandle.write(JSON.stringify(message) + "\n");
    }

    close() {
        this.fileHandle.close();
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

export async function* executeWorkflow(id: string, input: string, background: boolean = false): AsyncGenerator<z.infer<typeof WorkflowStreamEvent>, void, unknown> {
    try {
        const workflow = loadWorkflow(id);
        const runId = await randomId();

        yield {
            type: "workflow-start",
            workflowId: id,
            workflow: workflow,
            background: background,
        };

        const logger = new RunLogger(id, runId);

        const messages: z.infer<typeof MessageList> = [{
            role: "user",
            content: input ?? ""
        }];

        try {
            let stepIndex = 0;

            while (true) {
                const step = workflow.steps[stepIndex];
                const node = step.type === "agent" ? new AgentNode(step.id, background) : loadFunction(step.id);
                const messageBuilder = new StreamStepMessageBuilder();
                for await (const event of node.execute(messages)) {
                    // console.log("       - event", JSON.stringify(event));
                    messageBuilder.ingest(event);
                    yield {
                        type: "workflow-step-stream-event",
                        stepId: step.id,
                        event: event,
                    };
                }
                const msg = messageBuilder.get();
                logger.log(msg);
                messages.push(msg);
                yield {
                    type: "workflow-step-message",
                    stepId: step.id,
                    message: msg,
                };

                // check for tools to execute
                const tools = node.tools();
                let hasToolCalls = false;
                if (msg.content instanceof Array) {
                    for (const part of msg.content) {
                        if (part.type === "tool-call") {
                            hasToolCalls = true;
                            if (!(part.toolName in tools)) {
                                throw new Error(`Tool ${part.toolName} not found`);
                            }
                            yield {
                                type: "workflow-step-tool-invocation",
                                stepId: step.id,
                                toolName: part.toolName,
                                input: part.arguments,
                            }
                            const result = await execTool(tools[part.toolName], part.arguments);
                            const resultMsg: z.infer<typeof ToolMessage> = {
                                role: "tool",
                                content: JSON.stringify(result),
                                toolCallId: part.toolCallId,
                                toolName: part.toolName,
                            };
                            logger.log(resultMsg);
                            messages.push(resultMsg);
                            yield {
                                type: "workflow-step-tool-result",
                                stepId: step.id,
                                toolName: part.toolName,
                                result: result,
                            };
                            yield {
                                type: "workflow-step-message",
                                stepId: step.id,
                                message: resultMsg,
                            };
                        }
                    }
                }

                if (!hasToolCalls) {
                    stepIndex++;
                }
                if (stepIndex >= workflow.steps.length) {
                    break;
                }
            }
        } finally {
            logger.close();
        }

        // console.log('\n\n', JSON.stringify(messages, null, 2));
    } catch (error) {
        yield {
            type: "workflow-error",
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        yield {
            type: "workflow-end",
        };
    }
}