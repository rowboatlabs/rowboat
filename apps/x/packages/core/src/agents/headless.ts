import type { z } from "zod";
import type { AssistantMessage } from "@x/shared/dist/message.js";
import {
    type RequestedAgent,
    reduceTurn,
    type TurnState,
} from "@x/shared/dist/turns.js";
import type { ITurnRuntime, TurnOutcome } from "../turns/api.js";
import type { IDefaultModelResolver } from "../models/default-model-resolver.js";

// Drop-in replacement for the old headless runs pattern
// (createRun → createMessage → waitForRunCompletion → extractAgentResponse):
// one standalone turn per invocation (sessionId null, automatic permissions,
// no human). HeadlessAgentRunner.start returns the turn id immediately (callers
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
    agentId?: string;
    // Full agent request, used verbatim when set (inline agents, composition
    // overrides). Takes precedence over agentId/model/provider.
    agent?: z.infer<typeof RequestedAgent>;
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

export interface HeadlessAgentRunnerDependencies {
    turnRuntime: ITurnRuntime;
    defaultModelResolver: IDefaultModelResolver;
}

export interface IHeadlessAgentRunner {
    start(options: HeadlessAgentOptions): Promise<HeadlessAgentHandle>;
    run(
        options: HeadlessAgentOptions,
    ): Promise<HeadlessAgentResult & { turnId: string }>;
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

export class HeadlessAgentRunner implements IHeadlessAgentRunner {
    private readonly turnRuntime: ITurnRuntime;
    private readonly defaultModelResolver: IDefaultModelResolver;

    constructor({
        turnRuntime,
        defaultModelResolver,
    }: HeadlessAgentRunnerDependencies) {
        this.turnRuntime = turnRuntime;
        this.defaultModelResolver = defaultModelResolver;
    }

    async start(options: HeadlessAgentOptions): Promise<HeadlessAgentHandle> {
        let agent = options.agent;
        if (!agent) {
            if (!options.agentId) {
                throw new Error("headless agent needs an agentId or an agent request");
            }
            let modelOverride: { provider: string; model: string } | undefined;
            if (options.model && options.provider) {
                modelOverride = { provider: options.provider, model: options.model };
            } else if (options.model || options.provider) {
                const defaults = await this.defaultModelResolver.resolve();
                modelOverride = {
                    provider: options.provider ?? defaults.provider,
                    model: options.model ?? defaults.model,
                };
            }
            agent = {
                agentId: options.agentId,
                ...(modelOverride ? { overrides: { model: modelOverride } } : {}),
            };
        }

        const turnId = await this.turnRuntime.createTurn({
            agent,
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

        const execution = this.turnRuntime.advanceTurn(turnId, undefined, {
            signal: options.signal,
        });
        const done = execution.outcome.then(async (outcome) => {
            const state = reduceTurn(
                (await this.turnRuntime.getTurn(turnId)).events,
            );
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

    async run(
        options: HeadlessAgentOptions,
    ): Promise<HeadlessAgentResult & { turnId: string }> {
        const handle = await this.start(options);
        const result = await handle.done;
        return { turnId: handle.turnId, ...result };
    }
}
