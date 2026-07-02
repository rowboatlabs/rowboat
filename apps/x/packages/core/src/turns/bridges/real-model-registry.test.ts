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
        messages: [{ role: "user", content: "hello" }],
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

        // The invoker received the system prompt, converted messages, and tools.
        expect(capture[0].system).toBe("SYS");
        expect(capture[0].messages[0]).toMatchObject({ role: "user" });
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
