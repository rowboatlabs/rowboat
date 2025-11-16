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
import { MessageList } from "./application/entities/message.js";
import { z } from "zod";
import { CopilotAgent } from "./application/assistant/agent.js";

export async function app(opts: {
    agent: string;
    runId?: string;
    input?: string;
    noInteractive?: boolean;
}) {
    let inputCount = 0;
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
                        break;
                }
            }
        } finally {
            stream?.close();
        }
    }

    // add user input
    if (opts.input) {
        messages.push({
            role: "user",
            content: opts.input,
        });
        inputCount++;
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
                inputCount++;
                messages.push({
                    role: "user",
                    content: userInput,
                });
            }
            for await (const event of streamAgentTurn({
                agent,
                messages,
            })) {
                logger.log(event);
                renderer.render(event);
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