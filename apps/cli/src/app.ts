import { AgentState, streamAgent } from "./application/lib/agent.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs";
import path from "path";
import { WorkDir } from "./application/config/config.js";
import { RunEvent } from "./application/entities/run-events.js";
import { createInterface, Interface } from "node:readline/promises";
import { ToolCallPart } from "./application/entities/message.js";
import { z } from "zod";

export async function app(opts: {
    agent: string;
    runId?: string;
    input?: string;
    noInteractive?: boolean;
}) {
    const renderer = new StreamRenderer();
    const state = new AgentState(opts.agent);

    // load existing and assemble state if required
    let runId = opts.runId;
    if (runId) {
        console.error("loading run", runId);
        let stream: fs.ReadStream | null = null;
        let rl: Interface | null = null;
        try {
            const logFile = path.join(WorkDir, "runs", `${runId}.jsonl`);
            stream = fs.createReadStream(logFile, { encoding: "utf8" });
            rl = createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                if (line.trim() === "") {
                    continue;
                }
                const parsed = JSON.parse(line);
                const event = RunEvent.parse(parsed);
                state.ingest(event);
            }
        } finally {
            stream?.close();
        }
    }

    let rl: Interface | null = null;
    if (!opts.noInteractive) {
        rl = createInterface({ input, output });
    }

    try {
        while (true) {
            // ask for pending tool permissions
            for (const perm of Object.values(state.getPendingPermissions())) {
                const response = await getToolCallPermission(perm.toolCall, rl!);
                state.ingestAndLog({
                    type: "tool-permission-response",
                    response,
                    toolCallId: perm.toolCall.toolCallId,
                    subflow: perm.subflow,
                });
            }

            // ask for pending human input
            for (const ask of Object.values(state.getPendingAskHumans())) {
                const response = await getAskHumanResponse(ask.query, rl!);
                state.ingestAndLog({
                    type: "ask-human-response",
                    response,
                    toolCallId: ask.toolCallId,
                    subflow: ask.subflow,
                });
            }

            // run one turn
            for await (const event of streamAgent(state)) {
                renderer.render(event);
                if (event?.type === "error") {
                    process.exitCode = 1;
                }
            }

            // if nothing pending, get user input
            if (state.getPendingPermissions().length === 0 && state.getPendingAskHumans().length === 0) {
                const response = await getUserInput(rl!);
                state.ingestAndLog({
                    type: "message",
                    message: {
                        role: "user",
                        content: response,
                    },
                    subflow: [],
                });
            }
        }
    } finally {
        rl?.close();
    }
}

async function getToolCallPermission(
    call: z.infer<typeof ToolCallPart>,
    rl: Interface,
): Promise<"approve" | "deny"> {
    const question = `Do you want to allow running the following tool: ${call.toolName}?:
    
    Tool name: ${call.toolName}
    Tool arguments: ${JSON.stringify(call.arguments)}

    Choices: y/n/a/d:
    - y: approve
    - n: deny
    `;
    const input = await rl.question(question);
    if (input.toLowerCase() === "y") return "approve";
    if (input.toLowerCase() === "n") return "deny";
    return "deny";
}

async function getAskHumanResponse(
    query: string,
    rl: Interface,
): Promise<string> {
    const input = await rl.question(`The agent is asking for your help with the following query:
    
    Question: ${query}

    Please respond to the question.
    `);
    return input;
}

async function getUserInput(
    rl: Interface,
): Promise<string> {
    const input = await rl.question("You: ");
    if (["quit", "exit", "q"].includes(input.toLowerCase().trim())) {
        console.error("Bye!");
        process.exit(0);
    }
    return input;
}