import { z } from "zod";
import {
    RunEvent,
    StartEvent,
    type UseCase,
} from "@x/shared/dist/runs.js";
import type {
    AssistantMessage,
    UserMessage,
} from "@x/shared/dist/message.js";
import {
    assistantRef,
    reduceTurn,
    toolResultRef,
    TurnEvent,
    type ModelDescriptor,
} from "@x/shared/dist/turns.js";
import { reduceSession, SessionEvent } from "@x/shared/dist/sessions.js";

// One-time conversion of a legacy `run.jsonl` log into the new event-sourced
// turn/session runtime. Pure and I/O-free so it is exhaustively testable
// against real fixtures; the runner (migrate.ts) owns the filesystem side.
//
// Mapping (decided in planning):
//   - A run is one whole conversation. Turn boundaries are user messages.
//   - copilot_chat runs  -> one session + one turn per user message.
//   - every other run    -> a single standalone turn (sessionId: null) whose
//                           turnId is the ORIGINAL runId, so the live-note /
//                           background-task history views (which store that id
//                           and already fetch turn-first via sessions:getTurn)
//                           resolve it with no code change.
//   - code_session runs are skipped by the runner; nothing to migrate there.
//
// The synthesized turn log is validated against reduceTurn before it is
// returned; anything the reducer would reject throws and the runner quarantines
// the run instead of writing a corrupt turn.

type RunEventT = z.infer<typeof RunEvent>;
type StartT = z.infer<typeof StartEvent>;
type TurnEventT = z.infer<typeof TurnEvent>;
type SessionEventT = z.infer<typeof SessionEvent>;
type UserMessageT = z.infer<typeof UserMessage>;
type AssistantMessageT = z.infer<typeof AssistantMessage>;
type ModelDescriptorT = z.infer<typeof ModelDescriptor>;

export interface ConvertedTurn {
    turnId: string;
    events: TurnEventT[];
}

export interface ConvertedSession {
    sessionId: string;
    events: SessionEventT[];
}

export interface ConvertResult {
    session?: ConvertedSession;
    turns: ConvertedTurn[];
    /** True for copilot_chat runs (session + turns); false for standalone. */
    isSession: boolean;
}

export class RunConversionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RunConversionError";
    }
}

// A tool-call part lifted off an assistant message, with everything the run
// recorded about how it resolved.
interface ToolCallPlan {
    toolCallId: string;
    toolName: string;
    input: unknown;
    // Permission provenance from the legacy run, if any.
    autoDecision?: { decision: "allow" | "deny"; reason: string; request: unknown };
    manualRequest?: { request: unknown };
    manualResponse?: { decision: "allow" | "deny" };
    // Execution outcome from the legacy run, if any.
    result?: { output: unknown; isError: boolean };
    // Tool-role message content for this call (denial text fallback).
    toolMessage?: string;
}

interface ModelCallPlan {
    message: AssistantMessageT;
    toolCalls: ToolCallPlan[];
}

interface TurnPlan {
    input: UserMessageT;
    ts: string;
    modelCalls: ModelCallPlan[];
}

function isToolCallResultObject(value: unknown): value is { success?: boolean } {
    return typeof value === "object" && value !== null;
}

function inferIsError(result: unknown): boolean {
    if (isToolCallResultObject(result)) {
        if (result.success === false) return true;
        if ("error" in result && (result as { error?: unknown }).error) return true;
    }
    return false;
}

function modelDescriptor(start: StartT): ModelDescriptorT {
    // The new ModelDescriptor keeps provider as the name and model as the full
    // id (no "/" split) — same convention the live agent resolver writes.
    return { provider: start.provider, model: start.model };
}

function titleFrom(input: UserMessageT): string | undefined {
    const content = input.content;
    let text: string | undefined;
    if (typeof content === "string") {
        text = content;
    } else if (Array.isArray(content)) {
        const firstText = content.find(
            (p): p is { type: "text"; text: string } => p.type === "text",
        );
        text = firstText?.text;
    }
    if (!text) return undefined;
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) return undefined;
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

// Group the run log into turns keyed off user-message boundaries, folding the
// interleaved tool / permission events onto the tool-call parts they belong to.
function planTurns(log: RunEventT[], start: StartT): TurnPlan[] {
    const turns: TurnPlan[] = [];
    let current: TurnPlan | undefined;
    // Per-turn lookups keyed by toolCallId, resolved when we emit each call.
    let byId: Map<string, ToolCallPlan> = new Map();

    const ensureToolPlan = (toolCallId: string): ToolCallPlan | undefined =>
        byId.get(toolCallId);

    for (const event of log) {
        switch (event.type) {
            case "message": {
                const msg = event.message;
                if (msg.role === "user") {
                    current = {
                        input: msg,
                        ts: event.ts ?? start.ts ?? new Date(0).toISOString(),
                        modelCalls: [],
                    };
                    byId = new Map();
                    turns.push(current);
                } else if (msg.role === "assistant") {
                    if (!current) break;
                    const toolCalls: ToolCallPlan[] = [];
                    const parts = Array.isArray(msg.content) ? msg.content : [];
                    for (const part of parts) {
                        if (part.type !== "tool-call") continue;
                        const plan: ToolCallPlan = {
                            toolCallId: part.toolCallId,
                            toolName: part.toolName,
                            input: part.arguments,
                        };
                        toolCalls.push(plan);
                        byId.set(part.toolCallId, plan);
                    }
                    current.modelCalls.push({ message: msg, toolCalls });
                } else if (msg.role === "tool") {
                    const plan = current && ensureToolPlan(msg.toolCallId);
                    if (plan) plan.toolMessage = msg.content;
                }
                break;
            }
            case "tool-result": {
                if (!current || !event.toolCallId) break;
                const plan = ensureToolPlan(event.toolCallId);
                if (plan) {
                    plan.result = {
                        output: event.result ?? null,
                        isError: inferIsError(event.result),
                    };
                }
                break;
            }
            case "tool-permission-auto-decision": {
                if (!current) break;
                const plan = ensureToolPlan(event.toolCallId);
                if (plan) {
                    plan.autoDecision = {
                        decision: event.decision,
                        reason: event.reason,
                        request: event.permission ?? event.toolCall,
                    };
                }
                break;
            }
            case "tool-permission-request": {
                if (!current) break;
                const plan = ensureToolPlan(event.toolCall.toolCallId);
                if (plan) {
                    plan.manualRequest = {
                        request: event.permission ?? event.toolCall,
                    };
                }
                break;
            }
            case "tool-permission-response": {
                if (!current) break;
                const plan = ensureToolPlan(event.toolCallId);
                if (plan) {
                    plan.manualResponse = {
                        decision: event.response === "approve" ? "allow" : "deny",
                    };
                }
                break;
            }
            default:
                // start, tool-invocation (input taken from the assistant part),
                // llm-stream-event, run-processing-*, spawn-subflow, ask-human-*,
                // code-* and error events do not contribute to the transcript.
                break;
        }
    }

    return turns;
}

// Resolve a tool call's permission story + terminal result into the ordered
// list of new turn events. Throws (-> quarantine) if the run left the call
// dangling (no result and no denial), which the reducer cannot represent.
function toolEvents(
    turnId: string,
    ts: string,
    plan: ToolCallPlan,
): TurnEventT[] {
    const events: TurnEventT[] = [];
    const hasPermission =
        plan.autoDecision || plan.manualRequest || plan.manualResponse;

    let decision: "allow" | "deny" | undefined;
    if (hasPermission) {
        events.push({
            type: "tool_permission_required",
            turnId,
            ts,
            toolCallId: plan.toolCallId,
            toolName: plan.toolName,
            request: (plan.autoDecision?.request ??
                plan.manualRequest?.request ??
                {}) as unknown,
        } as TurnEventT);
        if (plan.autoDecision) {
            events.push({
                type: "tool_permission_classified",
                turnId,
                ts,
                toolCallId: plan.toolCallId,
                decision: plan.autoDecision.decision,
                reason: plan.autoDecision.reason,
            });
        }
        // A human response is the effective decision; otherwise the classifier's.
        if (plan.manualResponse) {
            decision = plan.manualResponse.decision;
            events.push({
                type: "tool_permission_resolved",
                turnId,
                ts,
                toolCallId: plan.toolCallId,
                decision,
                source: "human",
            });
        } else if (plan.autoDecision) {
            decision = plan.autoDecision.decision;
            events.push({
                type: "tool_permission_resolved",
                turnId,
                ts,
                toolCallId: plan.toolCallId,
                decision,
                source: "classifier",
                reason: plan.autoDecision.reason,
            });
        } else {
            // Only a manual request, never answered — the run ended waiting.
            throw new RunConversionError(
                `tool call ${plan.toolCallId} has an unresolved permission request`,
            );
        }
    }

    if (decision === "deny") {
        const denial =
            plan.toolMessage ?? "Unable to execute this tool: Permission was denied";
        events.push({
            type: "tool_result",
            turnId,
            ts,
            toolCallId: plan.toolCallId,
            toolName: plan.toolName,
            source: "runtime",
            result: { output: denial, isError: true },
        });
        return events;
    }

    // Allowed (explicitly or by absence of a permission gate): the run must have
    // recorded a terminal result, else the call is dangling and unrepresentable.
    if (!plan.result) {
        if (plan.toolMessage !== undefined) {
            // Fall back to the tool-role message when the raw result event is
            // missing (older logs).
            events.push(
                invocationEvent(turnId, ts, plan),
                {
                    type: "tool_result",
                    turnId,
                    ts,
                    toolCallId: plan.toolCallId,
                    toolName: plan.toolName,
                    source: "sync",
                    result: { output: plan.toolMessage, isError: false },
                },
            );
            return events;
        }
        throw new RunConversionError(
            `tool call ${plan.toolCallId} has no terminal result`,
        );
    }

    events.push(invocationEvent(turnId, ts, plan), {
        type: "tool_result",
        turnId,
        ts,
        toolCallId: plan.toolCallId,
        toolName: plan.toolName,
        source: "sync",
        result: {
            output: (plan.result.output ?? null) as unknown,
            isError: plan.result.isError,
        },
    } as TurnEventT);
    return events;
}

function invocationEvent(
    turnId: string,
    ts: string,
    plan: ToolCallPlan,
): TurnEventT {
    return {
        type: "tool_invocation_requested",
        turnId,
        ts,
        toolCallId: plan.toolCallId,
        toolId: plan.toolName,
        toolName: plan.toolName,
        execution: "sync",
        input: (plan.input ?? null) as unknown,
    } as TurnEventT;
}

// Build one reduceTurn-legal turn log from a planned turn.
function buildTurn(
    turnId: string,
    sessionId: string | null,
    previousTurnId: string | null,
    start: StartT,
    plan: TurnPlan,
): ConvertedTurn {
    const ts = plan.ts;
    const model = modelDescriptor(start);
    const events: TurnEventT[] = [];

    events.push({
        type: "turn_created",
        schemaVersion: 1,
        turnId,
        ts,
        sessionId,
        agent: {
            requested: { agentId: start.agentName },
            resolved: {
                agentId: start.agentName,
                systemPrompt: "",
                model,
                tools: [],
            },
        },
        context: previousTurnId ? { previousTurnId } : [],
        input: plan.input,
        config: {
            autoPermission: start.permissionMode === "auto",
            humanAvailable: true,
            maxModelCalls: Math.max(20, plan.modelCalls.length + 5),
        },
    });

    if (plan.modelCalls.length === 0) {
        throw new RunConversionError("turn has no assistant response");
    }
    const last = plan.modelCalls[plan.modelCalls.length - 1];
    if (last.toolCalls.length > 0) {
        // The final response still has open tool calls (interrupted run); the
        // turn cannot be completed cleanly.
        throw new RunConversionError("final model call has unresolved tool calls");
    }

    plan.modelCalls.forEach((call, index) => {
        // Request references: only what is NEW since the previous model call.
        let contextRef: { previousTurnId: string } | undefined;
        let messages: string[];
        if (index === 0) {
            if (previousTurnId) {
                contextRef = { previousTurnId };
                messages = ["input"];
            } else {
                messages = ["input"];
            }
        } else {
            const prev = plan.modelCalls[index - 1];
            messages = [
                assistantRef(index - 1),
                ...prev.toolCalls.map((tc) => toolResultRef(tc.toolCallId)),
            ];
        }
        events.push({
            type: "model_call_requested",
            turnId,
            ts,
            modelCallIndex: index,
            request: {
                ...(contextRef ? { contextRef } : {}),
                messages,
                parameters: {},
            },
        });
        events.push({
            type: "model_call_completed",
            turnId,
            ts,
            modelCallIndex: index,
            message: call.message,
            finishReason: call.toolCalls.length > 0 ? "tool-calls" : "stop",
            usage: {},
        });
        for (const tc of call.toolCalls) {
            events.push(...toolEvents(turnId, ts, tc));
        }
    });

    events.push({
        type: "turn_completed",
        turnId,
        ts,
        output: last.message,
        finishReason: "stop",
        usage: {},
    });

    // The definition of a well-formed migration: the reducer accepts it.
    reduceTurn(events);
    return { turnId, events };
}

// A copilot run's session turns get fresh ids derived from each initiating user
// message id (unique, sortable, date-prefixed — satisfies the repo id regex).
function turnIdFor(runId: string, index: number): string {
    return `${runId}-t${String(index).padStart(3, "0")}`;
}

/**
 * Convert one legacy run log into the new runtime shape. `runId` is the run's
 * id (== the log's start.runId); pass it explicitly so the caller controls id
 * preservation. Throws RunConversionError / TurnCorruptionError on anything the
 * new reducers would reject.
 */
export function convertRun(log: RunEventT[], runId: string): ConvertResult {
    const first = log[0];
    if (!first || first.type !== "start") {
        throw new RunConversionError("run log does not begin with a start event");
    }
    const start = first as StartT;
    const useCase: z.infer<typeof UseCase> | undefined = start.useCase;

    const plans = planTurns(log, start);
    if (plans.length === 0) {
        throw new RunConversionError("run has no user messages");
    }

    if (useCase === "copilot_chat") {
        // Session id reuses the original runId; turns get derived ids.
        const sessionId = runId;
        const turns: ConvertedTurn[] = [];
        const sessionEvents: SessionEventT[] = [];
        const title = titleFrom(plans[0].input);
        sessionEvents.push({
            type: "session_created",
            schemaVersion: 1,
            sessionId,
            ts: plans[0].ts,
            ...(title ? { title } : {}),
        });
        let previousTurnId: string | null = null;
        plans.forEach((plan, i) => {
            const turnId = turnIdFor(runId, i);
            const turn = buildTurn(turnId, sessionId, previousTurnId, start, plan);
            turns.push(turn);
            sessionEvents.push({
                type: "turn_appended",
                sessionId,
                ts: plan.ts,
                turnId,
                sessionSeq: i + 1,
                agentId: start.agentName,
                model: modelDescriptor(start),
            });
            previousTurnId = turnId;
        });
        reduceSession(sessionEvents);
        return {
            session: { sessionId, events: sessionEvents },
            turns,
            isSession: true,
        };
    }

    // Non-copilot: a single standalone turn whose id IS the runId.
    if (plans.length > 1) {
        throw new RunConversionError(
            `non-copilot run has ${plans.length} user messages; expected a single turn`,
        );
    }
    const turn = buildTurn(runId, null, null, start, plans[0]);
    return { turns: [turn], isSession: false };
}
