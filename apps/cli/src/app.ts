import { loadAgent, RunLogger, streamAgentTurn } from "./application/lib/agent.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs";
import path from "path";
import { WorkDir } from "./application/config/config.js";
import { RunEvent, RunStartEvent } from "./application/entities/run-events.js";
import { createInterface, Interface } from "node:readline/promises";
import { runIdGenerator } from "./application/lib/run-id-gen.js";
import { Agent } from "./application/entities/agent.js";
import { Message, MessageList, ToolMessage, UserMessage } from "./application/entities/message.js";
import { z } from "zod";
import { CopilotAgent } from "./application/assistant/agent.js";

export async function app(opts: {
    agent: string;
    runId?: string;
    input?: string;
    noInteractive?: boolean;
}) {
    let askHumanEventMarker: z.infer<typeof RunEvent> & { type: "pause-for-human-input" } | null = null;
    const messages: z.infer<typeof MessageList> = [];
    const renderer = new StreamRenderer();

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
                switch (event.type) {
                    case "message":
                        messages.push(event.message);
                        if (askHumanEventMarker
                            && event.message.role === "tool"
                            && event.message.toolCallId === askHumanEventMarker.toolCallId
                        ) {
                            askHumanEventMarker = null;
                        }
                        break;
                    case "pause-for-human-input": {
                        askHumanEventMarker = event;
                        break;
                    }
                }
            }
        } finally {
            stream?.close();
        }
    }

    // create runId if not present
    if (!runId) {
        runId = runIdGenerator.next();
    }
    const logger = new RunLogger(runId);

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

    // emit start event if first time run
    if (!opts.runId) {
        const ev = {
            type: "start",
            runId,
            agent: agent.name,
        } as z.infer<typeof RunStartEvent>;
        logger.log(ev);
        renderer.render(ev);
    }

    // loop between user and agent
    // add user input from cli, if present
    if (opts.input) {
        handleUserInput(opts.input, messages, askHumanEventMarker, renderer, logger);
    }
    let rl: Interface | null = null;
    if (!opts.noInteractive) {
        rl = createInterface({ input, output });
    }
    let firstPass = true;
    try {
        while (true) {
            let askInput = false;
            if (firstPass) {
                if (!opts.input) {
                    askInput = true;
                }
                firstPass = false;
            } else {
                askInput = true;
            }
            if (rl && askInput) {
                const userInput = await rl.question("You: ");
                if (["quit", "exit", "q"].includes(userInput.trim().toLowerCase())) {
                    console.error("Bye!");
                    return;
                }
                handleUserInput(userInput, messages, askHumanEventMarker, renderer, logger);
            }
            for await (const event of streamAgentTurn({
                agent,
                messages,
            })) {
                logger.log(event);
                renderer.render(event);
                if (event.type === "pause-for-human-input") {
                    askHumanEventMarker = event;
                }
                if (event?.type === "error") {
                    process.exitCode = 1;
                }
            }

            if (opts.noInteractive) {
                break;
            }
        }
    } finally {
        logger.close();
        rl?.close();
    }
}

function handleUserInput(
    input: string,
    messages: z.infer<typeof MessageList>,
    askHumanEventMarker: z.infer<typeof RunEvent> & { type: "pause-for-human-input" } | null,
    renderer: StreamRenderer,
    logger: RunLogger,
) {
    // if waiting on human input, send as response
    if (askHumanEventMarker) {
        const message = {
            role: "tool",
            content: JSON.stringify({
                userResponse: input,
            }),
            toolCallId: askHumanEventMarker.toolCallId,
            toolName: "ask-human",
        } as z.infer<typeof ToolMessage>;
        messages.push(message);
        const ev = {
            type: "message",
            message,
        } as z.infer<typeof RunEvent>;
        logger.log(ev);
        renderer.render(ev);
        askHumanEventMarker = null;
    } else {
        const message = {
            role: "user",
            content: input,
        } as z.infer<typeof UserMessage>;
        messages.push(message);
        const ev = {
            type: "message",
            message,
        } as z.infer<typeof RunEvent>;
        logger.log(ev);
    }
}