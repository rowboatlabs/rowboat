import { describe, expect, it } from "vitest";
import { applyPromptCaching, isAnthropicModel } from "./prompt-caching.js";

const BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" } } };

function prompt(messageCount = 3) {
    return {
        system: "SYS",
        messages: Array.from({ length: messageCount }, (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `m${i}`,
        })),
    };
}

describe("isAnthropicModel", () => {
    it("matches the direct provider regardless of model id", () => {
        expect(isAnthropicModel("anthropic", "whatever")).toBe(true);
    });

    it("matches aggregator ids by prefix or claude name", () => {
        expect(isAnthropicModel("rowboat", "anthropic/claude-opus-4.8")).toBe(true);
        expect(isAnthropicModel("openrouter", "anthropic/claude-3.5-sonnet")).toBe(true);
        expect(isAnthropicModel("aigateway", "claude-sonnet-5")).toBe(true);
    });

    it("rejects everything else", () => {
        expect(isAnthropicModel("openai", "gpt-test")).toBe(false);
        expect(isAnthropicModel("rowboat", "google/gemini-3.5-flash")).toBe(false);
        expect(isAnthropicModel("ollama", "llama3")).toBe(false);
        expect(isAnthropicModel("openai-compatible", "qwen3")).toBe(false);
    });
});

describe("applyPromptCaching", () => {
    it("returns non-Anthropic prompts unchanged (same references)", () => {
        const input = prompt();
        const output = applyPromptCaching("openai", "gpt-test", input);
        expect(output).toBe(input);
    });

    it("moves the system prompt into a breakpointed system message", () => {
        const { system, messages } = applyPromptCaching("anthropic", "m", prompt());
        expect(system).toBeUndefined();
        expect(messages[0]).toEqual({
            role: "system",
            content: "SYS",
            providerOptions: BREAKPOINT,
        });
    });

    it("marks only the last message; middle messages stay untouched", () => {
        const input = prompt(3);
        const { messages } = applyPromptCaching("anthropic", "m", input);
        // [system, m0, m1, m2]
        expect(messages).toHaveLength(4);
        expect(messages[1]).toBe(input.messages[0]);
        expect(messages[2]).toBe(input.messages[1]);
        expect(messages[3]).toEqual({
            role: "user",
            content: "m2",
            providerOptions: BREAKPOINT,
        });
    });

    it("does not mutate the input prompt", () => {
        const input = prompt(2);
        const snapshot = JSON.parse(JSON.stringify(input));
        applyPromptCaching("anthropic", "m", input);
        expect(input).toEqual(snapshot);
    });

    it("merges with pre-existing providerOptions on the last message", () => {
        const input = {
            system: "SYS",
            messages: [
                {
                    role: "user",
                    content: "hi",
                    providerOptions: { anthropic: { foo: 1 }, openai: { bar: 2 } },
                },
            ],
        };
        const { messages } = applyPromptCaching("anthropic", "m", input);
        expect(messages[1]).toEqual({
            role: "user",
            content: "hi",
            providerOptions: {
                openai: { bar: 2 },
                anthropic: { foo: 1, cacheControl: { type: "ephemeral" } },
            },
        });
    });

    it("is deterministic (same input, same bytes)", () => {
        const a = applyPromptCaching("anthropic", "m", prompt());
        const b = applyPromptCaching("anthropic", "m", prompt());
        expect(a).toEqual(b);
    });
});
