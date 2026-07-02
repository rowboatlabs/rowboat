// Turn inspector: prints, per model call, the EXACT provider payload the
// loop sent — rebuilt from the durable file by the same composer the loop
// transmits through (compose-model-request.ts). This is where the woven
// wire-form messages (user-message context, attachments, tool-result
// envelopes) are visible; the file itself stores only structural facts and
// references.
//
// Usage:
//   npm run inspect-turn -- <turnId | path/to/turn.jsonl> [modelCallIndex] [--full]
//
// --full prints the entire system prompt and untruncated message contents.
import fs from "node:fs";
import path from "node:path";
import {
    reduceTurn,
    type JsonValue,
    type TurnEvent,
} from "@x/shared/dist/turns.js";
import type { z } from "zod";
import { convertFromMessages } from "../agents/runtime.js";
import { WorkDir } from "../config/config.js";
import { composeModelRequest } from "./compose-model-request.js";
import { TurnRepoContextResolver } from "./context-resolver.js";
import { FSTurnRepo } from "./fs-repo.js";

function usage(): never {
    console.error(
        "usage: inspect-turn <turnId | path/to/turn.jsonl> [modelCallIndex] [--full]",
    );
    process.exit(1);
}

function clip(text: string, full: boolean, limit = 400): string {
    if (full || text.length <= limit) return text;
    return `${text.slice(0, limit)}… [${text.length} chars total; pass --full]`;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter((a) => a !== "--full");
    const full = process.argv.includes("--full");
    const target = args[0];
    if (!target) usage();
    const onlyIndex = args[1] !== undefined ? Number(args[1]) : undefined;

    const turnsRootDir = path.join(WorkDir, "storage", "turns");
    const repo = new FSTurnRepo({ turnsRootDir });
    const turnId = target.endsWith(".jsonl")
        ? path.basename(target, ".jsonl")
        : target;

    let events: Array<z.infer<typeof TurnEvent>>;
    if (target.endsWith(".jsonl") && fs.existsSync(target)) {
        // Direct path: parse in place (still strict via the reducer below).
        events = fs
            .readFileSync(target, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as z.infer<typeof TurnEvent>);
    } else {
        events = await repo.read(turnId);
    }
    const state = reduceTurn(events);
    const resolver = new TurnRepoContextResolver({ turnRepo: repo });
    const prefix = await resolver.resolve(state.definition.context);
    const encode = (messages: Parameters<typeof convertFromMessages>[0]) =>
        convertFromMessages(messages) as unknown as JsonValue[];

    console.log(`turn ${turnId}`);
    console.log(
        `agent ${state.definition.agent.resolved.agentId}  model ${state.definition.agent.resolved.model.provider}/${state.definition.agent.resolved.model.model}  calls ${state.modelCalls.length}`,
    );

    for (const call of state.modelCalls) {
        if (onlyIndex !== undefined && call.index !== onlyIndex) continue;
        const composed = composeModelRequest(state, call.index, prefix, encode);
        console.log(`\n━━ model call ${call.index} ━━ (as sent to the provider)`);
        console.log(`system (${composed.systemPrompt.length} chars): ${clip(composed.systemPrompt, full)}`);
        console.log(
            `tools (${composed.tools.length}): ${composed.tools.map((t) => t.name).join(", ")}`,
        );
        console.log(`messages (${composed.messages.length}):`);
        for (const message of composed.messages) {
            const m = message as { role?: string; content?: unknown };
            const content =
                typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content);
            console.log(`  [${m.role}] ${clip(content, full)}`);
        }
        if (call.error !== undefined) {
            console.log(`  → failed: ${call.error}`);
        } else if (call.response !== undefined) {
            const response =
                typeof call.response.content === "string"
                    ? call.response.content
                    : JSON.stringify(call.response.content);
            console.log(`  → response (${call.finishReason}): ${clip(response, full)}`);
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
