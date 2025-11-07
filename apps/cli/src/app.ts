import fs from "fs";
import path from "path";
import { WorkDir, McpServers } from "./application/config/config.js";
import { Workflow } from "./application/entities/workflow.js";
import { FunctionsRegistry } from "./application/registry/functions.js";
import { AgentNode } from "./application/nodes/agent.js";
import { MessageList, AssistantContentPart } from "./application/entities/message.js";
import { z } from "zod";
import { getMcpClient } from "./application/lib/mcp.js";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { StreamEvent } from "./application/entities/stream-event.js";
import { AssistantMessage, Message } from "./application/entities/message.js";
import { randomId } from "./application/lib/random-id.js";

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

    ingest(event: z.infer<typeof StreamEvent>) {
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

function loadWorkflow(id: string) {
    const workflowPath = path.join(WorkDir, "workflows", `${id}.json`);
    const workflow = fs.readFileSync(workflowPath, "utf8");
    return Workflow.parse(JSON.parse(workflow));
}

function loadFunction(id: string) {
    const func = FunctionsRegistry[id];
    if (!func) {
        throw new Error(`Function ${id} not found`);
    }
    return func;
}

// async function callMcpTool(serverName: string, toolName: string, args: Record<string, unknown>) {
//     const server = McpServers.find(server => server.name === serverName);
//     if (!server) {
//         throw new Error(`MCP server ${serverName} not found`);
//     }
//     const client = await getMcpClient(server.url, server.name);
//     const response = await client.callTool({ name: toolName, arguments: args });
//     return response;
// }

async function executeWorkflow(id: string) {
    const workflow = loadWorkflow(id);
    // console.log("got", JSON.stringify(workflow));

    const runId = await randomId();
    const logger = new RunLogger(id, runId);

    const input: z.infer<typeof MessageList> = [{
        role: "user",
        content: "scrape the page coinbase.com, and also gimeme today's date?"
    }];
    const msgs: z.infer<typeof MessageList> = [...input];

    try {
        const renderer = new StreamRenderer();

        for await (const step of workflow.steps) {
            const node = step.type === "agent" ? new AgentNode(step.id) : loadFunction(step.id);
            const messageBuilder = new StreamStepMessageBuilder();
            for await (const event of node.execute(msgs)) {
                // console.log("       - event", JSON.stringify(event));
                messageBuilder.ingest(event);
                renderer.render(event);
            }
            const msg = messageBuilder.get();
            logger.log(msg);
            msgs.push(msg);
        }
    } finally {
        logger.close();
    }

    console.log('\n\n', JSON.stringify(msgs, null, 2));
}

async function streamEventTest() {
    const { fullStream } = streamText({
        model: openai("gpt-5"),
        system: "You are a helpful assistant that reasons about the world. Provide a reason for invoking any tools",
        messages: [{ role: "user", content: "what is the current date and time?" }],
        tools: {
            getDate: {
                description: "Get the current date",
                inputSchema: z.object({
                    format: z.enum(["long", "short"]).default("long"),
                }),
            },
            getTime: {
                description: "Get the current time",
                inputSchema: z.object({
                    format: z.enum(["long", "short"]).default("long"),
                }),
            },
        },
    });

    const renderer = new StreamRenderer();
    for await (const event of fullStream) {
        renderer.render(event as any);
    }
}

// streamEventTest();

executeWorkflow("example_workflow");