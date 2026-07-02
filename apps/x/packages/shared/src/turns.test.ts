import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
    type JsonValue,
    ModelCallCompleted,
    ModelCallFailed,
    ModelCallRequested,
    ModelStepEvent,
    MODEL_CALL_LIMIT_ERROR_CODE,
    ToolDescriptor,
    ToolInvocationRequested,
    ToolPermissionClassificationFailed,
    ToolPermissionClassified,
    ToolPermissionRequired,
    ToolPermissionResolved,
    ToolProgress,
    ToolResult,
    TurnCancelled,
    TurnCompleted,
    TurnCorruptionError,
    TurnCreated,
    TurnEvent,
    TurnFailed,
    TurnSuspended,
    deriveTurnStatus,
    outstandingAsyncTools,
    outstandingPermissions,
    reduceTurn,
    turnTranscript,
} from "./turns.js";

type TEvent = z.infer<typeof TurnEvent>;

const TURN_ID = "2026-07-02T10-00-00Z-0000001-000";
const PREV_TURN_ID = "2026-07-02T09-00-00Z-0000001-000";
const TS = "2026-07-02T10:00:00Z";

const echoTool: z.infer<typeof ToolDescriptor> = {
    toolId: "tool.echo",
    name: "echo",
    description: "Echo tool",
    inputSchema: {},
    execution: "sync",
    requiresHuman: false,
};

const fetchTool: z.infer<typeof ToolDescriptor> = {
    toolId: "tool.fetch",
    name: "fetch",
    description: "Async fetch tool",
    inputSchema: {},
    execution: "async",
    requiresHuman: false,
};

function user(text: string) {
    return { role: "user" as const, content: text };
}

function assistantText(text: string) {
    return { role: "assistant" as const, content: text };
}

function toolCallPart(id: string, name: string, args: JsonValue = {}) {
    return {
        type: "tool-call" as const,
        toolCallId: id,
        toolName: name,
        arguments: args,
    };
}

function assistantCalls(...parts: Array<ReturnType<typeof toolCallPart>>) {
    return { role: "assistant" as const, content: parts };
}

function toolMsg(id: string, name: string, content = "ok") {
    return { role: "tool" as const, content, toolCallId: id, toolName: name };
}

function created(
    overrides: Partial<z.infer<typeof TurnCreated>> = {},
): z.infer<typeof TurnCreated> {
    return {
        type: "turn_created",
        schemaVersion: 1,
        turnId: TURN_ID,
        ts: TS,
        sessionId: null,
        agent: {
            requested: { agentId: "copilot" },
            resolved: {
                agentId: "copilot",
                systemPrompt: "SYS",
                model: { provider: "openai", model: "gpt-test" },
                tools: [echoTool, fetchTool],
            },
        },
        context: [],
        input: user("hello"),
        config: {
            autoPermission: false,
            humanAvailable: true,
            maxModelCalls: 20,
        },
        ...overrides,
    };
}

function requested(
    index: number,
    messages: z.infer<typeof ModelCallRequested>["request"]["messages"],
    requestOverrides: Partial<z.infer<typeof ModelCallRequested>["request"]> = {},
): z.infer<typeof ModelCallRequested> {
    return {
        type: "model_call_requested",
        turnId: TURN_ID,
        ts: TS,
        modelCallIndex: index,
        request: {
            systemPrompt: "SYS",
            messages,
            tools: [echoTool, fetchTool],
            parameters: {},
            ...requestOverrides,
        },
    };
}

function completed(
    index: number,
    message: z.infer<typeof ModelCallCompleted>["message"],
    usage: z.infer<typeof ModelCallCompleted>["usage"] = {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
    },
): z.infer<typeof ModelCallCompleted> {
    return {
        type: "model_call_completed",
        turnId: TURN_ID,
        ts: TS,
        modelCallIndex: index,
        message,
        finishReason: "stop",
        usage,
    };
}

function callFailed(
    index: number,
    error = "provider exploded",
): z.infer<typeof ModelCallFailed> {
    return {
        type: "model_call_failed",
        turnId: TURN_ID,
        ts: TS,
        modelCallIndex: index,
        error,
    };
}

function stepEvent(
    index: number,
    event: z.infer<typeof ModelStepEvent>["event"] = {
        type: "text_end",
        text: "chunk",
    },
): z.infer<typeof ModelStepEvent> {
    return {
        type: "model_step_event",
        turnId: TURN_ID,
        ts: TS,
        modelCallIndex: index,
        event,
    };
}

function permRequired(
    id: string,
    name: string,
    checkerError?: string,
): z.infer<typeof ToolPermissionRequired> {
    return {
        type: "tool_permission_required",
        turnId: TURN_ID,
        ts: TS,
        toolCallId: id,
        toolName: name,
        request: { tool: name },
        ...(checkerError === undefined ? {} : { checkerError }),
    };
}

function permClassified(
    id: string,
    decision: z.infer<typeof ToolPermissionClassified>["decision"],
): z.infer<typeof ToolPermissionClassified> {
    return {
        type: "tool_permission_classified",
        turnId: TURN_ID,
        ts: TS,
        toolCallId: id,
        decision,
        reason: "because",
    };
}

function permClassificationFailed(
    ids: string[],
): z.infer<typeof ToolPermissionClassificationFailed> {
    return {
        type: "tool_permission_classification_failed",
        turnId: TURN_ID,
        ts: TS,
        toolCallIds: ids,
        error: "classifier timed out",
    };
}

function permResolved(
    id: string,
    decision: z.infer<typeof ToolPermissionResolved>["decision"],
    source: z.infer<typeof ToolPermissionResolved>["source"] = "human",
): z.infer<typeof ToolPermissionResolved> {
    return {
        type: "tool_permission_resolved",
        turnId: TURN_ID,
        ts: TS,
        toolCallId: id,
        decision,
        source,
    };
}

function invocation(
    id: string,
    tool: z.infer<typeof ToolDescriptor> = echoTool,
    overrides: Partial<z.infer<typeof ToolInvocationRequested>> = {},
): z.infer<typeof ToolInvocationRequested> {
    return {
        type: "tool_invocation_requested",
        turnId: TURN_ID,
        ts: TS,
        toolCallId: id,
        toolId: tool.toolId,
        toolName: tool.name,
        execution: tool.execution,
        input: {},
        ...overrides,
    };
}

function progress(
    id: string,
    source: z.infer<typeof ToolProgress>["source"] = "sync",
): z.infer<typeof ToolProgress> {
    return {
        type: "tool_progress",
        turnId: TURN_ID,
        ts: TS,
        toolCallId: id,
        source,
        progress: { pct: 50 },
    };
}

function result(
    id: string,
    name: string,
    source: z.infer<typeof ToolResult>["source"] = "sync",
    output: JsonValue = "ok",
    isError = false,
): z.infer<typeof ToolResult> {
    return {
        type: "tool_result",
        turnId: TURN_ID,
        ts: TS,
        toolCallId: id,
        toolName: name,
        source,
        result: { output, isError },
    };
}

function suspendedEv(
    perms: Array<{ id: string; name: string }>,
    asyncs: Array<{ id: string; tool: z.infer<typeof ToolDescriptor> }>,
): z.infer<typeof TurnSuspended> {
    return {
        type: "turn_suspended",
        turnId: TURN_ID,
        ts: TS,
        pendingPermissions: perms.map((p) => ({
            toolCallId: p.id,
            toolName: p.name,
            request: { tool: p.name },
        })),
        pendingAsyncTools: asyncs.map((a) => ({
            toolCallId: a.id,
            toolId: a.tool.toolId,
            toolName: a.tool.name,
            input: {},
        })),
        usage: {},
    };
}

function turnCompletedEv(
    output: z.infer<typeof TurnCompleted>["output"] = assistantText("done"),
): z.infer<typeof TurnCompleted> {
    return {
        type: "turn_completed",
        turnId: TURN_ID,
        ts: TS,
        output,
        finishReason: "stop",
        usage: {},
    };
}

function turnFailedEv(
    error = "it broke",
    code?: string,
): z.infer<typeof TurnFailed> {
    return {
        type: "turn_failed",
        turnId: TURN_ID,
        ts: TS,
        error,
        ...(code === undefined ? {} : { code }),
        usage: {},
    };
}

function turnCancelledEv(reason?: string): z.infer<typeof TurnCancelled> {
    return {
        type: "turn_cancelled",
        turnId: TURN_ID,
        ts: TS,
        ...(reason === undefined ? {} : { reason }),
        usage: {},
    };
}

// A complete happy-path sequence with one sync tool round trip.
function syncToolSequence(): TEvent[] {
    const call0 = assistantCalls(toolCallPart("tc1", "echo"));
    return [
        created(),
        requested(0, [user("hello")]),
        completed(0, call0),
        permRequired("tc1", "echo"),
        permResolved("tc1", "allow"),
        invocation("tc1"),
        result("tc1", "echo"),
        requested(1, [user("hello"), call0, toolMsg("tc1", "echo")]),
        completed(1, assistantText("done")),
        turnCompletedEv(),
    ];
}

function expectCorruption(events: TEvent[], match: string | RegExp): void {
    expect(() => reduceTurn(events)).toThrowError(TurnCorruptionError);
    expect(() => reduceTurn(events)).toThrowError(match);
}

describe("schemas", () => {
    it("every builder output round-trips through the TurnEvent schema", () => {
        for (const event of syncToolSequence()) {
            expect(TurnEvent.parse(event)).toEqual(event);
        }
    });

    it("rejects system-role messages in inline context", () => {
        const bad = created({
            context: [
                { role: "system", content: "sneaky" },
            ] as unknown as z.infer<typeof TurnCreated>["context"],
        });
        expect(() => TurnCreated.parse(bad)).toThrowError();
    });
});

describe("plain completion", () => {
    it("reduces a created-only log to an idle empty state", () => {
        const state = reduceTurn([created()]);
        expect(state.definition.turnId).toBe(TURN_ID);
        expect(state.modelCalls).toEqual([]);
        expect(state.toolCalls).toEqual([]);
        expect(state.terminal).toBeUndefined();
        expect(deriveTurnStatus(state)).toBe("idle");
    });

    it("reduces a plain model response to a completed turn", () => {
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            stepEvent(0),
            completed(0, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(state.modelCalls).toHaveLength(1);
        expect(state.modelCalls[0].response).toEqual(assistantText("done"));
        expect(state.modelCalls[0].finishReason).toBe("stop");
        expect(state.modelCalls[0].stepEvents).toHaveLength(1);
        expect(state.terminal?.type).toBe("turn_completed");
        expect(deriveTurnStatus(state)).toBe("completed");
    });

    it("aggregates usage across model calls", () => {
        const state = reduceTurn(syncToolSequence());
        expect(state.usage).toEqual({
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
        });
    });

    it("leaves usage fields undefined when never reported", () => {
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, assistantText("a"), { inputTokens: 5 }),
        ]);
        expect(state.usage).toEqual({ inputTokens: 5 });
        expect(state.usage.cachedInputTokens).toBeUndefined();
    });
});

describe("tool execution", () => {
    it("extracts tool calls with order, batch index, and descriptor identity", () => {
        const call0 = assistantCalls(
            toolCallPart("tc1", "echo", { text: "a" }),
            toolCallPart("a1", "fetch", { url: "u" }),
        );
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
        ]);
        expect(state.toolCalls).toHaveLength(2);
        expect(state.toolCalls[0]).toMatchObject({
            toolCallId: "tc1",
            toolName: "echo",
            toolId: "tool.echo",
            execution: "sync",
            modelCallIndex: 0,
            order: 0,
            input: { text: "a" },
        });
        expect(state.toolCalls[1]).toMatchObject({
            toolCallId: "a1",
            execution: "async",
            order: 1,
        });
    });

    it("leaves identity undefined for tools missing from the agent snapshot", () => {
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, assistantCalls(toolCallPart("x1", "unknown-tool"))),
            result("x1", "unknown-tool", "runtime", "No such tool", true),
        ]);
        expect(state.toolCalls[0].toolId).toBeUndefined();
        expect(state.toolCalls[0].execution).toBeUndefined();
        expect(state.toolCalls[0].result?.result.isError).toBe(true);
    });

    it("reduces a full sync tool round trip", () => {
        const state = reduceTurn(syncToolSequence());
        const tc = state.toolCalls[0];
        expect(tc.permission?.required).toBeDefined();
        expect(tc.permission?.resolved?.decision).toBe("allow");
        expect(tc.invocation).toBeDefined();
        expect(tc.result?.source).toBe("sync");
        expect(state.terminal?.type).toBe("turn_completed");
    });

    it("records classifier provenance separately from the effective decision", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created({ config: { autoPermission: true, humanAvailable: true, maxModelCalls: 20 } }),
            requested(0, [user("hello")]),
            completed(0, call0),
            permRequired("tc1", "echo"),
            permClassified("tc1", "allow"),
            permResolved("tc1", "allow", "classifier"),
            invocation("tc1"),
            result("tc1", "echo"),
        ]);
        const permission = state.toolCalls[0].permission;
        expect(permission?.classification?.decision).toBe("allow");
        expect(permission?.resolved?.source).toBe("classifier");
    });

    it("accepts classification failure as audit and continues to human resolution", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            permRequired("tc1", "echo"),
            permClassificationFailed(["tc1"]),
            permResolved("tc1", "deny", "human"),
            result("tc1", "echo", "runtime", "Permission denied", true),
        ]);
        expect(state.toolCalls[0].permission?.classificationFailed).toBe(true);
        expect(state.toolCalls[0].result?.result.isError).toBe(true);
    });

    it("accumulates tool progress", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            invocation("tc1"),
            progress("tc1"),
            progress("tc1"),
            result("tc1", "echo"),
        ]);
        expect(state.toolCalls[0].progress).toHaveLength(2);
    });

    it("accepts denial results without invocation (runtime source)", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            permRequired("tc1", "echo"),
            permResolved("tc1", "deny"),
            result("tc1", "echo", "runtime", "Permission denied", true),
        ]);
        expect(state.toolCalls[0].invocation).toBeUndefined();
        expect(state.toolCalls[0].result?.source).toBe("runtime");
    });
});

describe("context references", () => {
    it("accepts a referenced context with matching contextRef on requests", () => {
        const state = reduceTurn([
            created({ context: { previousTurnId: PREV_TURN_ID } }),
            requested(0, [user("hello")], {
                contextRef: { previousTurnId: PREV_TURN_ID },
            }),
            completed(0, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(deriveTurnStatus(state)).toBe("completed");
    });

    it("rejects a request missing the contextRef when context is a reference", () => {
        expectCorruption(
            [
                created({ context: { previousTurnId: PREV_TURN_ID } }),
                requested(0, [user("hello")]),
            ],
            /contextRef inconsistent/,
        );
    });

    it("rejects a request whose contextRef targets the wrong turn", () => {
        expectCorruption(
            [
                created({ context: { previousTurnId: PREV_TURN_ID } }),
                requested(0, [user("hello")], {
                    contextRef: { previousTurnId: "some-other-turn" },
                }),
            ],
            /contextRef inconsistent/,
        );
    });

    it("rejects a contextRef when the turn context is inline", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")], {
                    contextRef: { previousTurnId: PREV_TURN_ID },
                }),
            ],
            /contextRef but turn context is inline/,
        );
    });

    it("ignores tool messages inside an inline context prefix when checking order", () => {
        const context = [
            user("earlier"),
            assistantCalls(toolCallPart("old1", "echo")),
            toolMsg("old1", "echo"),
        ];
        const state = reduceTurn([
            created({ context }),
            requested(0, [...context, user("hello")]),
            completed(0, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(deriveTurnStatus(state)).toBe("completed");
    });
});

describe("suspension", () => {
    it("accepts a snapshot matching pending permissions and async tools", () => {
        const call0 = assistantCalls(
            toolCallPart("tc1", "echo"),
            toolCallPart("a1", "fetch"),
        );
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            permRequired("tc1", "echo"),
            invocation("a1", fetchTool),
            suspendedEv([{ id: "tc1", name: "echo" }], [{ id: "a1", tool: fetchTool }]),
        ]);
        expect(state.suspension?.pendingPermissions).toHaveLength(1);
        expect(state.suspension?.pendingAsyncTools).toHaveLength(1);
        expect(deriveTurnStatus(state)).toBe("suspended");
    });

    it("replaces the snapshot as inputs arrive, one at a time", () => {
        const call0 = assistantCalls(
            toolCallPart("tc1", "echo"),
            toolCallPart("a1", "fetch"),
        );
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            permRequired("tc1", "echo"),
            invocation("a1", fetchTool),
            suspendedEv([{ id: "tc1", name: "echo" }], [{ id: "a1", tool: fetchTool }]),
            result("a1", "fetch", "async", { data: 1 }),
            suspendedEv([{ id: "tc1", name: "echo" }], []),
        ]);
        expect(state.suspension?.pendingAsyncTools).toHaveLength(0);
        expect(outstandingPermissions(state)).toHaveLength(1);
        expect(outstandingAsyncTools(state)).toHaveLength(0);
    });

    it("supports async results arriving in any order before the next model call", () => {
        const call0 = assistantCalls(
            toolCallPart("a1", "fetch"),
            toolCallPart("a2", "fetch"),
        );
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            invocation("a1", fetchTool),
            invocation("a2", fetchTool),
            suspendedEv([], [{ id: "a1", tool: fetchTool }, { id: "a2", tool: fetchTool }]),
            result("a2", "fetch", "async", "second"),
            suspendedEv([], [{ id: "a1", tool: fetchTool }]),
            result("a1", "fetch", "async", "first"),
            requested(1, [
                user("hello"),
                call0,
                toolMsg("a1", "fetch", "first"),
                toolMsg("a2", "fetch", "second"),
            ]),
            completed(1, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(deriveTurnStatus(state)).toBe("completed");
    });

    it("rejects a snapshot claiming already-resolved work", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permRequired("tc1", "echo"),
                permResolved("tc1", "allow"),
                invocation("tc1"),
                result("tc1", "echo"),
                suspendedEv([{ id: "tc1", name: "echo" }], []),
            ],
            /suspension without pending external work/,
        );
    });

    it("rejects a snapshot omitting pending work", () => {
        const call0 = assistantCalls(
            toolCallPart("tc1", "echo"),
            toolCallPart("a1", "fetch"),
        );
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permRequired("tc1", "echo"),
                invocation("a1", fetchTool),
                suspendedEv([{ id: "tc1", name: "echo" }], []),
            ],
            /suspension snapshot inconsistent/,
        );
    });

    it("rejects suspension while a model call is unsettled", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                suspendedEv([{ id: "tc1", name: "echo" }], []),
            ],
            /suspension while a model call is unsettled/,
        );
    });
});

describe("recovery-shaped histories", () => {
    it("accepts an interrupted model call closed and re-issued (§23 fix)", () => {
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            callFailed(0, "interrupted by process restart"),
            requested(1, [user("hello")]),
            completed(1, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(state.modelCalls[0].error).toMatch(/interrupted/);
        expect(state.modelCalls[1].response).toEqual(assistantText("done"));
        expect(deriveTurnStatus(state)).toBe("completed");
    });

    it("re-issued model calls count against maxModelCalls", () => {
        expectCorruption(
            [
                created({
                    config: { autoPermission: false, humanAvailable: true, maxModelCalls: 1 },
                }),
                requested(0, [user("hello")]),
                callFailed(0, "interrupted"),
                requested(1, [user("hello")]),
            ],
            /exceeds maxModelCalls/,
        );
    });

    it("accepts an interrupted sync tool closed with an indeterminate runtime result, turn continuing (§23 fix)", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            invocation("tc1"),
            result(
                "tc1",
                "echo",
                "runtime",
                "Tool execution was interrupted; its outcome is unknown and it was not retried.",
                true,
            ),
            requested(1, [user("hello"), call0, toolMsg("tc1", "echo", "…")]),
            completed(1, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(state.toolCalls[0].result?.source).toBe("runtime");
        expect(state.terminal?.type).toBe("turn_completed");
    });

    it("accepts cancellation with synthetic runtime results for unresolved calls", () => {
        const call0 = assistantCalls(toolCallPart("a1", "fetch"));
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            invocation("a1", fetchTool),
            suspendedEv([], [{ id: "a1", tool: fetchTool }]),
            result("a1", "fetch", "runtime", "Cancelled", true),
            turnCancelledEv("user stop"),
        ]);
        expect(state.terminal?.type).toBe("turn_cancelled");
        expect(deriveTurnStatus(state)).toBe("cancelled");
    });

    it("accepts a live model failure closing the turn", () => {
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            callFailed(0),
            turnFailedEv("provider exploded"),
        ]);
        expect(deriveTurnStatus(state)).toBe("failed");
    });

    it("accepts model-call-limit exhaustion with a machine-readable code", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created({
                config: { autoPermission: false, humanAvailable: true, maxModelCalls: 1 },
            }),
            requested(0, [user("hello")]),
            completed(0, call0),
            invocation("tc1"),
            result("tc1", "echo"),
            turnFailedEv("model call limit reached", MODEL_CALL_LIMIT_ERROR_CODE),
        ]);
        expect(state.terminal?.type).toBe("turn_failed");
        expect(
            state.terminal?.type === "turn_failed" ? state.terminal.code : undefined,
        ).toBe(MODEL_CALL_LIMIT_ERROR_CODE);
    });
});

describe("invariants", () => {
    it("rejects an empty log", () => {
        expectCorruption([], /empty/);
    });

    it("rejects a log not starting with turn_created", () => {
        expectCorruption([requested(0, [user("hello")])], /first event must be turn_created/);
    });

    it("rejects duplicate turn_created", () => {
        expectCorruption([created(), created()], /duplicate turn_created/);
    });

    it("rejects mismatched turn ids", () => {
        expectCorruption(
            [created(), { ...requested(0, [user("hello")]), turnId: "other" }],
            /does not match turn/,
        );
    });

    it("rejects unsupported schema versions", () => {
        const bad = {
            ...created(),
            schemaVersion: 2,
        } as unknown as TEvent;
        expectCorruption([bad], /unsupported turn schema version/);
    });

    it("rejects unknown event types", () => {
        const bad = {
            type: "wat",
            turnId: TURN_ID,
            ts: TS,
        } as unknown as TEvent;
        expectCorruption([created(), bad], /unknown turn event type/);
    });

    it("rejects out-of-order model call indices", () => {
        expectCorruption(
            [created(), requested(1, [user("hello")])],
            /out of order/,
        );
    });

    it("rejects a reused model call index", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, assistantText("a")),
                requested(0, [user("hello")]),
            ],
            /out of order/,
        );
    });

    it("rejects concurrent unresolved model requests", () => {
        expectCorruption(
            [created(), requested(0, [user("hello")]), requested(1, [user("hello")])],
            /concurrent unresolved model call requests/,
        );
    });

    it("rejects completion without a matching request", () => {
        expectCorruption(
            [created(), completed(0, assistantText("a"))],
            /without matching request/,
        );
    });

    it("rejects failure without a matching request", () => {
        expectCorruption([created(), callFailed(0)], /without matching request/);
    });

    it("rejects duplicate model call completion", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, assistantText("a")),
                completed(0, assistantText("b")),
            ],
            /duplicate settlement/,
        );
    });

    it("rejects completion after failure of the same call", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                callFailed(0),
                completed(0, assistantText("a")),
            ],
            /duplicate settlement/,
        );
    });

    it("rejects the next model call while tool calls are unresolved", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                requested(1, [user("hello"), call0]),
            ],
            /while tool calls are unresolved/,
        );
    });

    it("rejects a model call past the budget", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created({
                    config: { autoPermission: false, humanAvailable: true, maxModelCalls: 1 },
                }),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo"),
                requested(1, [user("hello"), call0, toolMsg("tc1", "echo")]),
            ],
            /exceeds maxModelCalls/,
        );
    });

    it("rejects duplicate tool call ids within one response", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(
                    0,
                    assistantCalls(toolCallPart("tc1", "echo"), toolCallPart("tc1", "echo")),
                ),
            ],
            /duplicate tool call id/,
        );
    });

    it("rejects duplicate tool call ids across responses", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo"),
                requested(1, [user("hello"), call0, toolMsg("tc1", "echo")]),
                completed(1, assistantCalls(toolCallPart("tc1", "echo"))),
            ],
            /duplicate tool call id/,
        );
    });

    it("rejects tool-result ordering that differs from original call order", () => {
        const call0 = assistantCalls(
            toolCallPart("tc1", "echo"),
            toolCallPart("tc2", "echo"),
        );
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo"),
                invocation("tc2"),
                result("tc2", "echo"),
                requested(1, [
                    user("hello"),
                    call0,
                    toolMsg("tc2", "echo"),
                    toolMsg("tc1", "echo"),
                ]),
            ],
            /tool-result order differs/,
        );
    });

    it("rejects permission records targeting unknown tool calls", () => {
        expectCorruption(
            [created(), requested(0, [user("hello")]), completed(0, assistantText("a")), permRequired("ghost", "echo")],
            /unknown tool call/,
        );
    });

    it("rejects duplicate permission requirements", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permRequired("tc1", "echo"),
                permRequired("tc1", "echo"),
            ],
            /duplicate permission requirement/,
        );
    });

    it("rejects classification without a requirement", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permClassified("tc1", "allow"),
            ],
            /classification without permission requirement/,
        );
    });

    it("rejects resolution without a requirement", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permResolved("tc1", "allow"),
            ],
            /resolution without requirement/,
        );
    });

    it("rejects conflicting effective permission decisions", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permRequired("tc1", "echo"),
                permResolved("tc1", "allow"),
                permResolved("tc1", "deny"),
            ],
            /conflicting permission decisions/,
        );
    });

    it("rejects invocation while permission is pending", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permRequired("tc1", "echo"),
                invocation("tc1"),
            ],
            /invocation without permission allowance/,
        );
    });

    it("rejects invocation of a denied tool call", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                permRequired("tc1", "echo"),
                permResolved("tc1", "deny"),
                invocation("tc1"),
            ],
            /invocation without permission allowance/,
        );
    });

    it("rejects duplicate invocations", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                invocation("tc1"),
            ],
            /duplicate tool invocation/,
        );
    });

    it("rejects invocations whose execution mode contradicts the snapshot", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1", echoTool, { execution: "async" }),
            ],
            /execution mismatch/,
        );
    });

    it("rejects progress without invocation", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [created(), requested(0, [user("hello")]), completed(0, call0), progress("tc1")],
            /progress without invocation/,
        );
    });

    it("rejects progress after a terminal tool result", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo"),
                progress("tc1"),
            ],
            /progress after terminal result/,
        );
    });

    it("rejects duplicate tool results", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo"),
                result("tc1", "echo"),
            ],
            /duplicate tool result/,
        );
    });

    it("rejects sync-sourced results without invocation", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [created(), requested(0, [user("hello")]), completed(0, call0), result("tc1", "echo", "sync")],
            /sync tool result without invocation/,
        );
    });

    it("rejects async results for sync tools", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo", "async"),
            ],
            /result source mismatch/,
        );
    });

    it("rejects step events without a matching open call", () => {
        expectCorruption([created(), stepEvent(0)], /without matching model call request/);
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, assistantText("a")),
                stepEvent(0),
            ],
            /after model call 0 settled/,
        );
    });

    it("rejects completion while tool calls remain unresolved", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [created(), requested(0, [user("hello")]), completed(0, call0), turnCompletedEv()],
            /completion while tool calls lack terminal results/,
        );
    });

    it("rejects completion when the final response has tool calls", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, call0),
                invocation("tc1"),
                result("tc1", "echo"),
                turnCompletedEv(),
            ],
            /final response has tool calls/,
        );
    });

    it("rejects completion without any completed model response", () => {
        expectCorruption([created(), turnCompletedEv()], /without a completed model response/);
    });

    it("rejects terminal failure while tool calls remain unresolved", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        expectCorruption(
            [created(), requested(0, [user("hello")]), completed(0, call0), turnFailedEv()],
            /failure while tool calls lack terminal results/,
        );
    });

    it("rejects terminal events while a model call is unsettled", () => {
        expectCorruption(
            [created(), requested(0, [user("hello")]), turnCancelledEv()],
            /cancellation while a model call is unsettled/,
        );
    });

    it("rejects any event after a terminal event", () => {
        const base = [
            created(),
            requested(0, [user("hello")]),
            completed(0, assistantText("a")),
        ];
        for (const terminal of [turnCompletedEv(), turnFailedEv(), turnCancelledEv()]) {
            expectCorruption(
                [...base, terminal, stepEvent(0)],
                /event after terminal turn event/,
            );
        }
    });

    it("rejects multiple terminal events", () => {
        expectCorruption(
            [
                created(),
                requested(0, [user("hello")]),
                completed(0, assistantText("a")),
                turnCompletedEv(),
                turnFailedEv(),
            ],
            /event after terminal turn event/,
        );
    });
});

describe("derivations", () => {
    it("derives suspended for pending permissions and idle otherwise", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const pending = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            permRequired("tc1", "echo"),
            suspendedEv([{ id: "tc1", name: "echo" }], []),
        ]);
        expect(deriveTurnStatus(pending)).toBe("suspended");

        const idle = reduceTurn([created(), requested(0, [user("hello")]), completed(0, call0)]);
        expect(deriveTurnStatus(idle)).toBe("idle");
    });

    it("builds the turn transcript in source order with serialized results", () => {
        const call0 = assistantCalls(
            toolCallPart("tc1", "echo"),
            toolCallPart("tc2", "echo"),
        );
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
            invocation("tc1"),
            invocation("tc2"),
            result("tc2", "echo", "sync", { n: 2 }),
            result("tc1", "echo", "sync", "plain text"),
            requested(1, [
                user("hello"),
                call0,
                toolMsg("tc1", "echo", "plain text"),
                toolMsg("tc2", "echo", '{"n":2}'),
            ]),
            completed(1, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(turnTranscript(state)).toEqual([
            user("hello"),
            call0,
            { role: "tool", content: "plain text", toolCallId: "tc1", toolName: "echo" },
            { role: "tool", content: '{"n":2}', toolCallId: "tc2", toolName: "echo" },
            assistantText("done"),
        ]);
    });

    it("omits failed model calls from the transcript", () => {
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            callFailed(0, "interrupted"),
            requested(1, [user("hello")]),
            completed(1, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(turnTranscript(state)).toEqual([user("hello"), assistantText("done")]);
    });

    it("transcript excludes the context prefix", () => {
        const state = reduceTurn([
            created({ context: { previousTurnId: PREV_TURN_ID } }),
            requested(0, [user("hello")], {
                contextRef: { previousTurnId: PREV_TURN_ID },
            }),
            completed(0, assistantText("done")),
            turnCompletedEv(),
        ]);
        expect(turnTranscript(state)[0]).toEqual(user("hello"));
        expect(turnTranscript(state)).toHaveLength(2);
    });

    it("transcript throws on unresolved tool calls", () => {
        const call0 = assistantCalls(toolCallPart("tc1", "echo"));
        const state = reduceTurn([
            created(),
            requested(0, [user("hello")]),
            completed(0, call0),
        ]);
        expect(() => turnTranscript(state)).toThrowError(/unresolved/);
    });
});
