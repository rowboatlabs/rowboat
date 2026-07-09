import { describe, expect, it, vi } from "vitest";
import type { SessionIndexEntry } from "@x/shared/dist/sessions.js";
import type { TurnStreamEvent } from "@x/shared/dist/turns.js";
import { TurnEventHub } from "../turns/event-hub.js";
import { TurnInputError } from "../turns/api.js";
import type { ISessions } from "../sessions/api.js";
import { ChannelBridge, type ModelChoice } from "./bridge.js";

const SENDER = "test:1";

function entry(overrides: Partial<SessionIndexEntry>): SessionIndexEntry {
    return {
        sessionId: "s1",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
        turnCount: 1,
        latestTurnStatus: "completed",
        ...overrides,
    };
}

function completedEvent(turnId: string, text: string): TurnStreamEvent {
    return {
        type: "turn_completed",
        turnId,
        ts: "2026-07-01T00:00:00Z",
        output: { role: "assistant", content: text },
        finishReason: "stop",
        usage: {},
    } as unknown as TurnStreamEvent;
}

function askEvent(turnId: string, question: string, options?: string[]): TurnStreamEvent {
    return {
        type: "turn_suspended",
        turnId,
        ts: "2026-07-01T00:00:00Z",
        pendingPermissions: [],
        pendingAsyncTools: [
            {
                toolCallId: "call_1",
                toolId: "builtin:ask-human",
                toolName: "ask-human",
                input: { question, ...(options ? { options } : {}) },
            },
        ],
        usage: {},
    } as unknown as TurnStreamEvent;
}

interface Harness {
    bridge: ChannelBridge;
    bus: TurnEventHub;
    replies: string[];
    reply: (text: string) => Promise<void>;
    sessions: {
        createSession: ReturnType<typeof vi.fn>;
        sendMessage: ReturnType<typeof vi.fn>;
        respondToAskHuman: ReturnType<typeof vi.fn>;
        stopTurn: ReturnType<typeof vi.fn>;
        getTurn: ReturnType<typeof vi.fn>;
        listSessions: ReturnType<typeof vi.fn>;
    };
    listModels: ReturnType<typeof vi.fn>;
    publish: (turnId: string, event: TurnStreamEvent) => void;
}

const MODELS: ModelChoice[] = [
    { provider: "anthropic", model: "claude-fable-5", label: "Fable 5 — Anthropic" },
    { provider: "anthropic", model: "claude-sonnet-5", label: "Sonnet 5 — Anthropic" },
    { provider: "openai", model: "gpt-5", label: "GPT-5 — OpenAI" },
];

function harness(entries: SessionIndexEntry[] = []): Harness {
    const bus = new TurnEventHub();
    const publish = (turnId: string, event: TurnStreamEvent) =>
        bus.publish({ turnId, sessionId: "s1", event });
    const sessions = {
        createSession: vi.fn(async () => "s1"),
        sendMessage: vi.fn(async () => ({ turnId: "t1" })),
        respondToAskHuman: vi.fn(async () => undefined),
        stopTurn: vi.fn(async () => undefined),
        getTurn: vi.fn(async () => ({ turnId: "t1", events: [] })),
        listSessions: vi.fn(() => entries),
    };
    const listModels = vi.fn(async () => MODELS);
    const bridge = new ChannelBridge({
        sessions: sessions as unknown as ISessions,
        turnEventBus: bus,
        listModels,
    });
    const replies: string[] = [];
    const reply = async (text: string) => {
        replies.push(text);
    };
    return { bridge, bus, replies, reply, sessions, listModels, publish };
}

// Settle the turn as soon as sendMessage is called: the watcher subscribes
// before sendMessage, so a synchronous publish lands in its buffer — the
// exact race the buffering exists for.
function settleOnSend(h: Harness, event: TurnStreamEvent, turnId = "t1"): void {
    h.sessions.sendMessage.mockImplementation(async () => {
        h.publish(turnId, event);
        return { turnId };
    });
}

describe("ChannelBridge commands", () => {
    it("replies with help text", async () => {
        const h = harness();
        await h.bridge.handleInbound(SENDER, "help", h.reply);
        expect(h.replies).toHaveLength(1);
        expect(h.replies[0]).toContain("Rowboat commands");
    });

    it("lists recent sessions newest-first and resumes by index", async () => {
        const h = harness([
            entry({ sessionId: "old", title: "Old chat", updatedAt: "2026-07-01T00:00:00Z" }),
            entry({ sessionId: "new", title: "New chat", updatedAt: "2026-07-02T00:00:00Z" }),
        ]);
        await h.bridge.handleInbound(SENDER, "list", h.reply);
        expect(h.replies[0]).toContain("1. New chat");
        expect(h.replies[0]).toContain("2. Old chat");

        await h.bridge.handleInbound(SENDER, "resume 2", h.reply);
        expect(h.replies[1]).toContain('Resumed "Old chat"');

        settleOnSend(h, completedEvent("t1", "done"));
        await h.bridge.handleInbound(SENDER, "hello again", h.reply);
        expect(h.sessions.sendMessage).toHaveBeenCalledWith(
            "old",
            expect.objectContaining({ content: "hello again" }),
            expect.objectContaining({ autoPermission: true }),
        );
    });

    it("rejects resume with an out-of-range index", async () => {
        const h = harness([entry({ sessionId: "s1", title: "Only chat" })]);
        await h.bridge.handleInbound(SENDER, "resume 5", h.reply);
        expect(h.replies[0]).toContain("No chat #5");
    });
});

describe("ChannelBridge model selection", () => {
    it("lists models and applies a by-index selection to later turns", async () => {
        const h = harness();
        await h.bridge.handleInbound(SENDER, "model", h.reply);
        expect(h.replies[0]).toContain("1. Fable 5 — Anthropic");
        expect(h.replies[0]).toContain("app default");

        await h.bridge.handleInbound(SENDER, "model 3", h.reply);
        expect(h.replies[1]).toContain("GPT-5");

        settleOnSend(h, completedEvent("t1", "done"));
        await h.bridge.handleInbound(SENDER, "hello", h.reply);
        expect(h.sessions.sendMessage).toHaveBeenCalledWith(
            "s1",
            expect.anything(),
            expect.objectContaining({
                agent: {
                    agentId: "copilot",
                    overrides: { model: { provider: "openai", model: "gpt-5" } },
                },
            }),
        );
    });

    it("selects by unique name match and resets on 'model default'", async () => {
        const h = harness();
        await h.bridge.handleInbound(SENDER, "model fable", h.reply);
        expect(h.replies[0]).toContain("Fable 5");

        settleOnSend(h, completedEvent("t1", "done"));
        await h.bridge.handleInbound(SENDER, "hi", h.reply);
        expect(h.sessions.sendMessage).toHaveBeenCalledWith(
            "s1",
            expect.anything(),
            expect.objectContaining({
                agent: expect.objectContaining({
                    overrides: { model: { provider: "anthropic", model: "claude-fable-5" } },
                }),
            }),
        );

        await h.bridge.handleInbound(SENDER, "model default", h.reply);
        settleOnSend(h, completedEvent("t2", "done"), "t2");
        await h.bridge.handleInbound(SENDER, "hi again", h.reply);
        expect(h.sessions.sendMessage).toHaveBeenLastCalledWith(
            "s1",
            expect.anything(),
            expect.objectContaining({ agent: { agentId: "copilot" } }),
        );
    });

    it("asks for disambiguation on an ambiguous name and rejects unknown ones", async () => {
        const h = harness();
        await h.bridge.handleInbound(SENDER, "model claude", h.reply);
        expect(h.replies[0]).toContain("matches 2 models");

        await h.bridge.handleInbound(SENDER, "model llama", h.reply);
        expect(h.replies[1]).toContain('No model matching "llama"');
    });
});

describe("ChannelBridge message flow", () => {
    it("creates a session, acks, and delivers the completed text", async () => {
        const h = harness();
        settleOnSend(h, completedEvent("t1", "The answer is 42."));
        await h.bridge.handleInbound(SENDER, "what is the answer?", h.reply);
        expect(h.sessions.createSession).toHaveBeenCalledOnce();
        expect(h.replies[0]).toContain("Working on it");
        expect(h.replies[1]).toBe("The answer is 42.");
    });

    it("delivers a failed turn as an error reply", async () => {
        const h = harness();
        settleOnSend(h, {
            type: "turn_failed",
            turnId: "t1",
            ts: "2026-07-01T00:00:00Z",
            error: "model exploded",
            usage: {},
        } as unknown as TurnStreamEvent);
        await h.bridge.handleInbound(SENDER, "do a thing", h.reply);
        expect(h.replies[1]).toContain("model exploded");
    });

    it("relays the ask-human question text and options, then routes the answer", async () => {
        const h = harness();
        settleOnSend(h, askEvent("t1", "Which lane?", ["fast", "slow"]));
        await h.bridge.handleInbound(SENDER, "start task", h.reply);
        expect(h.replies[1]).toContain("Which lane?");
        expect(h.replies[1]).toContain("1. fast");

        // The answer resolves the ask; the turn then completes.
        h.sessions.respondToAskHuman.mockImplementation(async () => {
            h.publish("t1", completedEvent("t1", "Took the fast lane."));
        });
        await h.bridge.handleInbound(SENDER, "fast", h.reply);
        expect(h.sessions.respondToAskHuman).toHaveBeenCalledWith("t1", "call_1", "fast");
        expect(h.replies[3]).toBe("Took the fast lane.");
    });

    it("falls back to a normal message when the ask was already answered elsewhere", async () => {
        const h = harness();
        settleOnSend(h, askEvent("t1", "Which lane?"));
        await h.bridge.handleInbound(SENDER, "start task", h.reply);

        h.sessions.respondToAskHuman.mockRejectedValue(
            new TurnInputError("no pending async tool call call_1"),
        );
        settleOnSend(h, completedEvent("t2", "Handled as a new message."), "t2");
        await h.bridge.handleInbound(SENDER, "actually do this instead", h.reply);
        expect(h.sessions.sendMessage).toHaveBeenLastCalledWith(
            "s1",
            expect.objectContaining({ content: "actually do this instead" }),
            expect.anything(),
        );
        expect(h.replies.at(-1)).toBe("Handled as a new message.");
    });

    it("reports busy while a turn is in flight", async () => {
        const h = harness();
        let releaseTurn!: () => void;
        h.sessions.sendMessage.mockImplementation(async () => {
            releaseTurn = () => h.publish("t1", completedEvent("t1", "finally"));
            return { turnId: "t1" };
        });
        const first = h.bridge.handleInbound(SENDER, "slow task", h.reply);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await h.bridge.handleInbound(SENDER, "impatient follow-up", h.reply);
        expect(h.replies.some((r) => r.includes("Still working"))).toBe(true);
        releaseTurn();
        await first;
        expect(h.replies.at(-1)).toBe("finally");
    });
});
