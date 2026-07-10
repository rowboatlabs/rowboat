import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import type { LlmStreamEvent, ModelStreamRequest } from "../model-registry.js";
import { RealModelRegistry, type StreamTextInvoker } from "./real-model-registry.js";

type InvokerOptions = Parameters<StreamTextInvoker>[0];

function makeRegistry(parts: Array<Record<string, unknown>>, capture: InvokerOptions[]) {
    const fakeModel = { modelId: "gpt-test" } as unknown as LanguageModel;
    return new RealModelRegistry({
        resolveProvider: async () => ({ flavor: "openai" }),
        createProviderImpl: (() => ({
            languageModel: () => fakeModel,
        })) as never,
        invoke: (options) => {
            capture.push(options);
            return {
                fullStream: (async function* () {
                    yield* parts;
                })(),
            };
        },
    });
}

function request(overrides: Partial<ModelStreamRequest> = {}): ModelStreamRequest {
    return {
        systemPrompt: "SYS",
        messages: [{ role: "user", content: "hello" }] as ModelStreamRequest["messages"],
        tools: [
            {
                toolId: "builtin:echo",
                name: "echo",
                description: "Echo",
                inputSchema: { type: "object", properties: {} },
                execution: "sync",
                requiresHuman: false,
            },
        ],
        parameters: {},
        signal: new AbortController().signal,
        ...overrides,
    };
}

async function collect(registry: RealModelRegistry, req: ModelStreamRequest) {
    const model = await registry.resolve({ provider: "openai", model: "gpt-test" });
    const events: LlmStreamEvent[] = [];
    for await (const event of model.stream(req)) {
        events.push(event);
    }
    return events;
}

describe("RealModelRegistry", () => {
    it("normalizes one streamText step into deltas, step events, and a completed message", async () => {
        const capture: InvokerOptions[] = [];
        const registry = makeRegistry(
            [
                { type: "start" },
                { type: "text-start" },
                { type: "text-delta", text: "Hel" },
                { type: "text-delta", text: "lo" },
                { type: "text-end" },
                { type: "tool-call", toolCallId: "tc1", toolName: "echo", input: { x: 1 } },
                {
                    type: "finish-step",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
                    providerMetadata: { openai: { cached: true } },
                },
            ],
            capture,
        );
        const events = await collect(registry, request());

        expect(events.map((e) => e.type)).toEqual([
            "step_event", // text_start
            "text_delta",
            "text_delta",
            "step_event", // text_end
            "step_event", // tool_call
            "step_event", // finish_step
            "completed",
        ]);
        expect(events[3]).toEqual({
            type: "step_event",
            event: { type: "text_end", text: "Hello" },
        });
        const completed = events[events.length - 1];
        expect(completed).toMatchObject({
            type: "completed",
            finishReason: "tool-calls",
            usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
            providerMetadata: { openai: { cached: true } },
            message: {
                role: "assistant",
                content: [
                    { type: "text", text: "Hello" },
                    {
                        type: "tool-call",
                        toolCallId: "tc1",
                        toolName: "echo",
                        arguments: { x: 1 },
                    },
                ],
            },
        });

        // The invoker received the system prompt, the pre-encoded messages
        // verbatim (encoding is the composer's job), and the wrapped tools.
        expect(capture[0].system).toBe("SYS");
        expect(capture[0].messages).toEqual([{ role: "user", content: "hello" }]);
        expect(Object.keys(capture[0].tools)).toEqual(["echo"]);
    });

    it("accumulates reasoning separately and emits reasoning deltas", async () => {
        const registry = makeRegistry(
            [
                { type: "reasoning-start" },
                { type: "reasoning-delta", text: "thinking…" },
                { type: "reasoning-end" },
                { type: "text-start" },
                { type: "text-delta", text: "done" },
                { type: "text-end" },
                { type: "finish-step", finishReason: "stop", usage: {} },
            ],
            [],
        );
        const events = await collect(registry, request());
        expect(events.filter((e) => e.type === "reasoning_delta")).toHaveLength(1);
        const completed = events[events.length - 1];
        expect(
            completed.type === "completed" ? completed.message.content : undefined,
        ).toEqual([
            { type: "reasoning", text: "thinking…" },
            { type: "text", text: "done" },
        ]);
    });

    it("captures block-level provider metadata opaquely onto parts (Anthropic-style signatures)", async () => {
        // Anthropic delivers the thinking signature on a reasoning-delta with
        // an EMPTY text delta, and redacted thinking as metadata on
        // reasoning-start. Both must land on the right reasoning part, and
        // distinct blocks must stay distinct parts.
        const registry = makeRegistry(
            [
                { type: "reasoning-start" },
                { type: "reasoning-delta", text: "let me think" },
                { type: "reasoning-delta", text: "", providerMetadata: { anthropic: { signature: "sig-1" } } },
                { type: "reasoning-end" },
                {
                    type: "reasoning-start",
                    providerMetadata: { anthropic: { redactedData: "opaque-blob" } },
                },
                { type: "reasoning-end" },
                { type: "text-start" },
                { type: "text-delta", text: "answer" },
                { type: "text-end" },
                { type: "finish-step", finishReason: "stop", usage: {} },
            ],
            [],
        );
        const events = await collect(registry, request());
        const completed = events[events.length - 1];
        expect(
            completed.type === "completed" ? completed.message.content : undefined,
        ).toEqual([
            {
                type: "reasoning",
                text: "let me think",
                providerOptions: { anthropic: { signature: "sig-1" } },
            },
            {
                type: "reasoning",
                text: "",
                providerOptions: { anthropic: { redactedData: "opaque-blob" } },
            },
            { type: "text", text: "answer" },
        ]);
    });

    it("captures metadata on text and tool-call parts (Gemini-style thoughtSignatures)", async () => {
        const registry = makeRegistry(
            [
                { type: "text-start" },
                { type: "text-delta", text: "calling a tool" },
                { type: "text-end", providerMetadata: { google: { thoughtSignature: "ts-text" } } },
                {
                    type: "tool-call",
                    toolCallId: "tc1",
                    toolName: "echo",
                    input: { x: 1 },
                    providerMetadata: { google: { thoughtSignature: "ts-call" } },
                },
                { type: "finish-step", finishReason: "tool-calls", usage: {} },
            ],
            [],
        );
        const events = await collect(registry, request());
        const completed = events[events.length - 1];
        expect(
            completed.type === "completed" ? completed.message.content : undefined,
        ).toEqual([
            {
                type: "text",
                text: "calling a tool",
                providerOptions: { google: { thoughtSignature: "ts-text" } },
            },
            {
                type: "tool-call",
                toolCallId: "tc1",
                toolName: "echo",
                arguments: { x: 1 },
                providerOptions: { google: { thoughtSignature: "ts-call" } },
            },
        ]);
    });

    it("merges metadata from multiple events of one block, later fields winning", async () => {
        const registry = makeRegistry(
            [
                { type: "reasoning-start", providerMetadata: { openai: { itemId: "r-1" } } },
                { type: "reasoning-delta", text: "…" },
                {
                    type: "reasoning-end",
                    providerMetadata: { openai: { itemId: "r-1", reasoningEncryptedContent: "enc" } },
                },
                { type: "finish-step", finishReason: "stop", usage: {} },
            ],
            [],
        );
        const events = await collect(registry, request());
        const completed = events[events.length - 1];
        expect(
            completed.type === "completed" ? completed.message.content : undefined,
        ).toEqual([
            {
                type: "reasoning",
                text: "…",
                providerOptions: { openai: { itemId: "r-1", reasoningEncryptedContent: "enc" } },
            },
        ]);
    });

    it("drops empty blocks that carry no metadata", async () => {
        const registry = makeRegistry(
            [
                { type: "reasoning-start" },
                { type: "reasoning-end" },
                { type: "text-start" },
                { type: "text-delta", text: "hi" },
                { type: "text-end" },
                { type: "finish-step", finishReason: "stop", usage: {} },
            ],
            [],
        );
        const events = await collect(registry, request());
        const completed = events[events.length - 1];
        expect(
            completed.type === "completed" ? completed.message.content : undefined,
        ).toEqual([{ type: "text", text: "hi" }]);
    });

    it("round-trips part-level providerOptions through encodeMessages", async () => {
        const registry = makeRegistry([], []);
        const model = await registry.resolve({ provider: "openai", model: "gpt-test" });
        const encoded = model.encodeMessages([
            {
                role: "assistant",
                content: [
                    {
                        type: "reasoning",
                        text: "thought",
                        providerOptions: { anthropic: { signature: "sig-1" } },
                    },
                    {
                        type: "tool-call",
                        toolCallId: "tc1",
                        toolName: "echo",
                        arguments: { x: 1 },
                        providerOptions: { google: { thoughtSignature: "ts-call" } },
                    },
                ],
            },
        ] as never) as Array<{ role: string; content: Array<Record<string, unknown>> }>;

        expect(encoded[0].content[0]).toMatchObject({
            type: "reasoning",
            text: "thought",
            providerOptions: { anthropic: { signature: "sig-1" } },
        });
        expect(encoded[0].content[1]).toMatchObject({
            type: "tool-call",
            toolCallId: "tc1",
            input: { x: 1 },
            providerOptions: { google: { thoughtSignature: "ts-call" } },
        });
    });

    it("throws on provider error parts (a model failure, not a completion)", async () => {
        const registry = makeRegistry(
            [{ type: "error", error: new Error("rate limited") }],
            [],
        );
        const model = await registry.resolve({ provider: "openai", model: "gpt-test" });
        await expect(
            (async () => {
                for await (const event of model.stream(request())) {
                    void event;
                }
            })(),
        ).rejects.toThrowError("rate limited");
    });

    it("encodeMessages produces the LLM-facing wire form (context woven, tool results enveloped)", async () => {
        const registry = makeRegistry([], []);
        const model = await registry.resolve({ provider: "openai", model: "gpt-test" });
        const encoded = model.encodeMessages([
            {
                role: "user",
                content: "list my downloads",
                userMessageContext: {
                    currentDateTime: "2026-07-02T10:30:00Z",
                    middlePane: { kind: "empty" },
                },
            },
            { role: "tool", content: "[…files…]", toolCallId: "tc1", toolName: "file-list" },
        ]) as Array<{ role: string; content: unknown }>;

        // The user message is the woven wire text, not the internal structure.
        expect(encoded[0].role).toBe("user");
        const userText = String(encoded[0].content);
        expect(userText).toContain("2026-07-02T10:30:00Z");
        expect(userText).toContain("list my downloads");
        expect(userText).not.toContain("userMessageContext");

        // Tool output rides the AI SDK tool-result envelope.
        expect(encoded[1]).toMatchObject({
            role: "tool",
            content: [
                {
                    type: "tool-result",
                    toolCallId: "tc1",
                    output: { type: "text", value: "[…files…]" },
                },
            ],
        });
    });

    it("applies cache breakpoints for Anthropic-family models", async () => {
        const capture: InvokerOptions[] = [];
        const fakeModel = { modelId: "claude-test" } as unknown as LanguageModel;
        const registry = new RealModelRegistry({
            resolveProvider: async () => ({ flavor: "anthropic" }),
            createProviderImpl: (() => ({
                languageModel: () => fakeModel,
            })) as never,
            invoke: (options) => {
                capture.push(options);
                return {
                    fullStream: (async function* () {
                        yield { type: "finish-step", finishReason: "stop", usage: {} };
                    })(),
                };
            },
        });
        const model = await registry.resolve({
            provider: "anthropic",
            model: "claude-test",
        });
        const drained: unknown[] = [];
        for await (const event of model.stream(request())) {
            drained.push(event);
        }
        expect(drained.length).toBeGreaterThan(0);

        const [options] = capture;
        // System prompt rides the message array with a breakpoint; no
        // separate system string is sent.
        expect(options.system).toBeUndefined();
        expect(options.messages[0]).toMatchObject({
            role: "system",
            content: "SYS",
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        });
        expect(options.messages[options.messages.length - 1]).toMatchObject({
            role: "user",
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        });
    });

    it("leaves non-Anthropic requests byte-identical", async () => {
        const capture: InvokerOptions[] = [];
        const registry = makeRegistry(
            [{ type: "finish-step", finishReason: "stop", usage: {} }],
            capture,
        );
        const req = request();
        const originalMessages = JSON.parse(JSON.stringify(req.messages));
        await collect(registry, req);

        const [options] = capture;
        expect(options.system).toBe("SYS");
        expect(options.messages).toEqual(originalMessages);
        expect(JSON.stringify(options.messages)).not.toContain("cacheControl");
    });

    it("stops promptly when the signal aborts mid-stream", async () => {
        const controller = new AbortController();
        const registry = makeRegistry(
            [
                { type: "text-delta", text: "a" },
                { type: "text-delta", text: "b" },
            ],
            [],
        );
        const model = await registry.resolve({ provider: "openai", model: "gpt-test" });
        const seen: string[] = [];
        await expect(
            (async () => {
                for await (const event of model.stream(
                    request({ signal: controller.signal }),
                )) {
                    seen.push(event.type);
                    controller.abort();
                }
            })(),
        ).rejects.toThrowError();
        expect(seen).toEqual(["text_delta"]);
    });
});
