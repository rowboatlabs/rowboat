import type { z } from "zod";
import type { AgentLoopTurn } from "@x/shared/dist/agent-turn.js";
import { getAgentRuntime } from "./index.js";

type Turn = z.infer<typeof AgentLoopTurn>;

// Headless agent runs (live-note, background-task, knowledge pipelines,
// scheduled agents) are one-shot: a single user message → a single agent
// response. They are NOT conversations, so each maps to one standalone turn
// (sessionId null) rather than a session. The durable memory is the agent's
// own state file (note / task / config), never a copy-forward transcript — so
// turns stay isolated and never grow unbounded.
//
// Headless has no human to approve tool calls, so runs use auto permission
// mode: the classifier decides. (Manual mode would block forever waiting on a
// UI prompt that no one can answer.)

export interface HeadlessRun {
    agentId: string;
    // Already-rendered prompt for this run (trigger block + objective + state).
    message: string;
    model?: string | null;
    provider?: string | null;
    // Analytics attribution for this run's LLM usage (PostHog `llm_usage`).
    useCase: string;
    subUseCase?: string;
    // Called with the turn id the instant the turn is created (before it runs),
    // so callers can record it / publish a "start" event.
    onStart?: (turnId: string) => void | Promise<void>;
}

export interface HeadlessResult {
    turnId: string;
    turn: Turn;
    // Final assistant text, or null on error / no assistant message.
    summary: string | null;
    // Terminal turn error message, or null on success.
    error: string | null;
}

// Run a headless agent to completion as a single standalone turn.
export async function runHeadlessAgent(run: HeadlessRun): Promise<HeadlessResult> {
    const { agentLoop } = await getAgentRuntime();
    const handle = await agentLoop.createTurn({
        agentId: run.agentId,
        permissionMode: "auto",
        useCase: run.useCase,
        ...(run.subUseCase ? { subUseCase: run.subUseCase } : {}),
        ...(run.provider ? { provider: run.provider } : {}),
        ...(run.model ? { model: run.model } : {}),
        messages: [{ role: "user", content: run.message }],
    });
    if (run.onStart) await run.onStart(handle.id);
    const turn = await handle.result;
    const error = turn.error?.message ?? null;
    return {
        turnId: handle.id,
        turn,
        summary: error ? null : finalAssistantText(turn),
        error,
    };
}

// The last assistant message's text content, trimmed; null if there is none.
export function finalAssistantText(turn: Turn): string | null {
    for (let i = turn.messages.length - 1; i >= 0; i--) {
        const message = turn.messages[i];
        if (message.role !== "assistant") continue;
        const text = typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part) => part.type === "text")
                .map((part) => (part as { text: string }).text)
                .join("");
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    return null;
}

// Paths touched by tool calls of the given tool names in a completed turn.
// Used by the knowledge pipelines that previously watched the run bus for
// file-editText / file-writeText invocations — the new bus carries only tool
// call ids, so paths are read from the turn's tool-call parts instead.
export function editedPaths(turn: Turn, toolNames: readonly string[]): string[] {
    const paths = new Set<string>();
    for (const message of turn.messages) {
        if (message.role !== "assistant" || typeof message.content === "string") continue;
        for (const part of message.content) {
            if (part.type !== "tool-call" || !toolNames.includes(part.toolName)) continue;
            const path = (part.arguments as { path?: unknown } | undefined)?.path;
            if (typeof path === "string") paths.add(path);
        }
    }
    return [...paths];
}
