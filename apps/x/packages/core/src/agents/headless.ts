import type { z } from "zod";
import type { AssistantMessage } from "@x/shared/dist/message.js";
import {
    reduceTurn,
    type TurnState,
} from "@x/shared/dist/turns.js";
import container from "../di/container.js";
import { getDefaultModelAndProvider } from "../models/defaults.js";
import type { ITurnRuntime, TurnOutcome } from "../turns/api.js";

// Drop-in replacement for the old headless runs pattern
// (createRun → createMessage → waitForRunCompletion → extractAgentResponse):
// one standalone turn per invocation (sessionId null, automatic permissions,
// no human). startHeadlessAgent returns the turn id immediately (callers
// record it in pointer files / bus events before completion); `done` settles
// with the outcome, the reduced turn state, and the final assistant text.

export class HeadlessRunError extends Error {
    constructor(
        message: string,
        readonly turnId: string,
        readonly outcome: TurnOutcome,
    ) {
        super(message);
        this.name = "HeadlessRunError";
    }
}

export interface HeadlessAgentOptions {
    agentId: string;
    message: string;
    // Model id; when set without provider, the app-default provider applies.
    model?: string;
    provider?: string;
    maxModelCalls?: number;
    signal?: AbortSignal;
    // Old waitForRunCompletion({ throwOnError: true }) semantics: `done`
    // rejects with HeadlessRunError unless the turn completes.
    throwOnError?: boolean;
}

export interface HeadlessAgentResult {
    outcome: TurnOutcome;
    state: TurnState;
    // Last assistant text in the transcript (old extractAgentResponse).
    summary: string | null;
}

export interface HeadlessAgentHandle {
    turnId: string;
    done: Promise<HeadlessAgentResult>;
}

export function assistantText(
    message: z.infer<typeof AssistantMessage>,
): string | null {
    const content = message.content;
    if (typeof content === "string") {
        return content || null;
    }
    const text = content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    return text || null;
}

export function lastAssistantText(state: TurnState): string | null {
    for (let i = state.modelCalls.length - 1; i >= 0; i--) {
        const response = state.modelCalls[i].response;
        if (response) {
            const text = assistantText(response);
            if (text) {
                return text;
            }
        }
    }
    return null;
}

// Paths passed to the given file tools across the turn — replaces the old
// pattern of subscribing to the run bus for tool-invocation events. Only
// actually-invoked calls count (denied/unknown calls never ran).
export function toolInputPaths(
    state: TurnState,
    toolNames: string[],
): Set<string> {
    const paths = new Set<string>();
    for (const toolCall of state.toolCalls) {
        if (!toolNames.includes(toolCall.toolName) || !toolCall.invocation) {
            continue;
        }
        const input = toolCall.input as { path?: unknown } | null | undefined;
        if (input && typeof input === "object" && typeof input.path === "string") {
            paths.add(input.path);
        }
    }
    return paths;
}

export async function startHeadlessAgent(
    options: HeadlessAgentOptions,
    // Injectable for tests; defaults to the app container's runtime.
    turnRuntime: ITurnRuntime = container.resolve<ITurnRuntime>("turnRuntime"),
): Promise<HeadlessAgentHandle> {
    let modelOverride: { provider: string; model: string } | undefined;
    if (options.model || options.provider) {
        const defaults = await getDefaultModelAndProvider();
        modelOverride = {
            provider: options.provider ?? defaults.provider,
            model: options.model ?? defaults.model,
        };
    }

    const turnId = await turnRuntime.createTurn({
        agent: {
            agentId: options.agentId,
            ...(modelOverride ? { overrides: { model: modelOverride } } : {}),
        },
        sessionId: null,
        context: [],
        input: { role: "user", content: options.message },
        config: {
            autoPermission: true,
            humanAvailable: false,
            ...(options.maxModelCalls === undefined
                ? {}
                : { maxModelCalls: options.maxModelCalls }),
        },
    });

    const execution = turnRuntime.advanceTurn(turnId, undefined, {
        signal: options.signal,
    });
    const done = execution.outcome.then(async (outcome) => {
        const state = reduceTurn((await turnRuntime.getTurn(turnId)).events);
        if (options.throwOnError && outcome.status !== "completed") {
            throw new HeadlessRunError(
                outcome.status === "failed"
                    ? outcome.error
                    : `turn ${outcome.status}`,
                turnId,
                outcome,
            );
        }
        return { outcome, state, summary: lastAssistantText(state) };
    });
    // The handle may be used fire-and-forget; rejections surface when awaited.
    done.catch(() => undefined);
    return { turnId, done };
}

export async function runHeadlessAgent(
    options: HeadlessAgentOptions,
    turnRuntime?: ITurnRuntime,
): Promise<HeadlessAgentResult & { turnId: string }> {
    const handle = await startHeadlessAgent(options, turnRuntime);
    const result = await handle.done;
    return { turnId: handle.turnId, ...result };
}
