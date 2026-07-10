// Runtime storage inspector. Works on turns AND sessions (auto-detected):
//
//   npm run inspect -- <turnId | sessionId | path/to/*.jsonl> [modelCallIndex] [--full] [--turns]
//
// Turn mode prints, per model call, the EXACT provider payload the loop sent
// — rebuilt from the durable file by the same composer the loop transmits
// through (compose-model-request.ts). This is where the woven wire-form
// messages (user-message context, attachments, tool-result envelopes) are
// visible; the file itself stores only structural facts and references.
//
// Caveat: historic-context elision reads config/context.json at compose
// time, so recomposition is exact only while that config matches what was
// live when the call ran. The header prints the policy in effect NOW.
//
// Session mode prints the session overview (title, turns, statuses, sizes);
// pass --turns to cascade full turn inspection for every turn.
//
// --full prints untruncated system prompts and message contents.
import fs from "node:fs";
import path from "node:path";
import {
    deriveTurnStatus,
    reduceTurn,
    type JsonValue,
    type TurnEvent,
    type TurnState,
} from "@x/shared/dist/turns.js";
import { reduceSession } from "@x/shared/dist/sessions.js";
import type { z } from "zod";
import { convertFromMessages } from "../agents/message-encoding.js";
import { WorkDir } from "../config/config.js";
import { FSSessionRepo } from "../sessions/fs-repo.js";
import { composeModelRequest } from "./compose-model-request.js";
import { createContextResolver, loadElisionPolicy } from "./context-elision.js";
import { FSTurnRepo } from "./fs-repo.js";

const turnRepo = new FSTurnRepo({
    turnsRootDir: path.join(WorkDir, "storage", "turns"),
});
const sessionRepo = new FSSessionRepo({
    sessionsRootDir: path.join(WorkDir, "storage", "sessions"),
});
const resolver = createContextResolver({ turnRepo });
const encode = (messages: Parameters<typeof convertFromMessages>[0]) =>
    convertFromMessages(messages) as unknown as JsonValue[];

function usage(): never {
    console.error(
        "usage: inspect <turnId | sessionId | path/to/*.jsonl> [modelCallIndex] [--full] [--turns]",
    );
    process.exit(1);
}

function clip(text: string, full: boolean, limit = 400): string {
    if (full || text.length <= limit) return text;
    return `${text.slice(0, limit)}… [${text.length} chars total; pass --full]`;
}

function inputPreview(state: TurnState): string {
    const content = state.definition.input.content;
    const text =
        typeof content === "string"
            ? content
            : content
                  .map((part) => (part.type === "text" ? part.text : `<${part.type}>`))
                  .join(" ");
    return text.replace(/\s+/g, " ").slice(0, 60);
}

async function inspectTurn(
    turnId: string,
    events: Array<z.infer<typeof TurnEvent>>,
    onlyIndex: number | undefined,
    full: boolean,
): Promise<void> {
    const state = reduceTurn(events);
    const prefix = await resolver.resolve(state.definition.context);
    const agent = await resolver.resolveAgent(state.definition.agent.resolved);

    const inherited =
        "inheritedFrom" in state.definition.agent.resolved
            ? `  (snapshot inherited from ${state.definition.agent.resolved.inheritedFrom})`
            : "";
    console.log(`turn ${turnId}  status ${deriveTurnStatus(state)}`);
    console.log(
        `agent ${agent.agentId}  model ${agent.model.provider}/${agent.model.model}  calls ${state.modelCalls.length}${inherited}`,
    );
    const policy = loadElisionPolicy();
    console.log(
        `context elision (per config/context.json NOW; transmitted bytes reflect the config live at call time): ` +
            [
                policy.toolResults
                    ? `toolResults>${policy.toolResultThresholdChars}`
                    : "toolResults off",
                policy.images ? "images" : "images off",
                policy.middlePaneContent ? "notes" : "notes off",
            ].join(", "),
    );

    for (const call of state.modelCalls) {
        if (onlyIndex !== undefined && call.index !== onlyIndex) continue;
        const composed = composeModelRequest(state, call.index, prefix, agent, encode);
        console.log(`\n━━ model call ${call.index} ━━ (as sent to the provider)`);
        console.log(
            `system (${composed.systemPrompt.length} chars): ${clip(composed.systemPrompt, full)}`,
        );
        console.log(
            `tools (${composed.tools.length}): ${composed.tools.map((t) => t.name).join(", ")}`,
        );
        console.log(`messages (${composed.messages.length}):`);
        for (const message of composed.messages) {
            const m = message as { role?: string; content?: unknown };
            const content =
                typeof m.content === "string" ? m.content : JSON.stringify(m.content);
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

async function inspectSession(
    sessionId: string,
    full: boolean,
    cascade: boolean,
): Promise<void> {
    const state = reduceSession(await sessionRepo.read(sessionId));
    console.log(`session ${sessionId}`);
    console.log(
        `title "${state.title ?? ""}"  turns ${state.turns.length}  created ${state.createdAt}  updated ${state.updatedAt}`,
    );
    for (const ref of state.turns) {
        try {
            const events = await turnRepo.read(ref.turnId);
            const turnState = reduceTurn(events);
            const bytes = JSON.stringify(events).length;
            console.log(
                `  ${String(ref.sessionSeq).padStart(3)}. ${ref.turnId}  ${deriveTurnStatus(turnState).padEnd(9)} ${turnState.modelCalls.length} calls  ~${Math.round(bytes / 1024)}KB  "${inputPreview(turnState)}"`,
            );
        } catch (error) {
            console.log(
                `  ${String(ref.sessionSeq).padStart(3)}. ${ref.turnId}  UNREADABLE: ${error instanceof Error ? error.message : error}`,
            );
        }
    }
    if (cascade) {
        for (const ref of state.turns) {
            console.log(`\n════════ turn ${ref.sessionSeq} ════════`);
            try {
                await inspectTurn(ref.turnId, await turnRepo.read(ref.turnId), undefined, full);
            } catch (error) {
                console.log(`unreadable: ${error instanceof Error ? error.message : error}`);
            }
        }
    } else {
        console.log(`\n(inspect a turn: npm run inspect -- <turnId>; whole session: --turns)`);
    }
}

async function main(): Promise<void> {
    const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
    const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const full = flags.has("--full");
    const cascade = flags.has("--turns");
    const target = args[0];
    if (!target) usage();
    const onlyIndex = args[1] !== undefined ? Number(args[1]) : undefined;

    const id = target.endsWith(".jsonl") ? path.basename(target, ".jsonl") : target;

    // Direct file path: session files live under storage/sessions.
    if (target.endsWith(".jsonl") && fs.existsSync(target)) {
        if (path.resolve(target).includes(`${path.sep}sessions${path.sep}`)) {
            await inspectSession(id, full, cascade);
            return;
        }
        const events = fs
            .readFileSync(target, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as z.infer<typeof TurnEvent>);
        await inspectTurn(id, events, onlyIndex, full);
        return;
    }

    // Bare id: try turn first, then session.
    try {
        const events = await turnRepo.read(id);
        await inspectTurn(id, events, onlyIndex, full);
    } catch (error) {
        if (!(error instanceof Error) || !/turn not found/.test(error.message)) {
            throw error;
        }
        await inspectSession(id, full, cascade);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
