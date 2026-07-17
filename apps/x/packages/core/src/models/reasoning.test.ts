import { describe, expect, it } from "vitest";
import { mapReasoningEffort, parseReasoningEffort } from "./reasoning.js";

describe("parseReasoningEffort", () => {
    it("accepts only the canonical ladder", () => {
        expect(parseReasoningEffort("low")).toBe("low");
        expect(parseReasoningEffort("medium")).toBe("medium");
        expect(parseReasoningEffort("high")).toBe("high");
        expect(parseReasoningEffort("xhigh")).toBeUndefined();
        expect(parseReasoningEffort(3)).toBeUndefined();
        expect(parseReasoningEffort(undefined)).toBeUndefined();
    });
});

describe("mapReasoningEffort", () => {
    it("maps OpenAI effort directly, gated on known reasoning support", () => {
        expect(mapReasoningEffort("openai", "o4-mini", "high", true)).toEqual({
            providerOptions: { openai: { reasoningEffort: "high" } },
        });
        // Unknown or absent capability fails closed: gpt-4.1 400s on the param.
        expect(mapReasoningEffort("openai", "gpt-4.1", "high", undefined)).toBeUndefined();
        expect(mapReasoningEffort("openai", "gpt-4.1", "high", false)).toBeUndefined();
    });

    it("maps Anthropic to thinking budgets with an output-token floor", () => {
        expect(mapReasoningEffort("anthropic", "claude-x", "low", true)).toEqual({
            providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        });
        expect(mapReasoningEffort("anthropic", "claude-x", "medium", true)).toEqual({
            providerOptions: {
                anthropic: { thinking: { type: "enabled", budgetTokens: 8192 } },
            },
            minOutputTokens: 12288,
        });
        expect(mapReasoningEffort("anthropic", "claude-x", "high", true)).toEqual({
            providerOptions: {
                anthropic: { thinking: { type: "enabled", budgetTokens: 16384 } },
            },
            minOutputTokens: 20480,
        });
        expect(mapReasoningEffort("anthropic", "claude-x", "high", undefined)).toBeUndefined();
    });

    it("maps Gemini 3 to thinking levels, clamping Pro's missing medium", () => {
        expect(mapReasoningEffort("google", "gemini-3.5-flash", "medium", true)).toEqual({
            providerOptions: { google: { thinkingConfig: { thinkingLevel: "medium" } } },
        });
        expect(mapReasoningEffort("google", "gemini-3.5-pro", "medium", true)).toBeUndefined();
        expect(mapReasoningEffort("google", "gemini-3.5-pro", "high", true)).toEqual({
            providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } },
        });
    });

    it("maps Gemini 2.5 to token budgets and skips unknown generations", () => {
        expect(mapReasoningEffort("google", "gemini-2.5-flash", "low", true)).toEqual({
            providerOptions: { google: { thinkingConfig: { thinkingBudget: 2048 } } },
        });
        expect(mapReasoningEffort("google", "gemini-1.5-pro", "high", true)).toBeUndefined();
    });

    it("maps OpenRouter-shaped flavors permissively (OpenRouter drops it for non-reasoning models)", () => {
        expect(mapReasoningEffort("rowboat", "google/gemini-3.5-flash", "high", undefined)).toEqual({
            providerOptions: { openrouter: { reasoning: { effort: "high" } } },
        });
        expect(mapReasoningEffort("openrouter", "openai/o4-mini", "low", true)).toEqual({
            providerOptions: { openrouter: { reasoning: { effort: "low" } } },
        });
        expect(mapReasoningEffort("rowboat", "x/y", "high", false)).toBeUndefined();
    });

    it("maps codex like openai but forgiving on unknown support (models.dev has no codex flavor)", () => {
        expect(mapReasoningEffort("codex", "gpt-5.5", "high", undefined)).toEqual({
            providerOptions: { openai: { reasoningEffort: "high" } },
        });
        expect(mapReasoningEffort("codex", "gpt-5.5", "medium", false)).toBeUndefined();
    });

    it("sends nothing for flavors without a safe parameter", () => {
        expect(mapReasoningEffort("ollama", "gpt-oss", "high", true)).toBeUndefined();
        expect(mapReasoningEffort("openai-compatible", "my-vllm-model", "high", true)).toBeUndefined();
        expect(mapReasoningEffort("aigateway", "openai/o4-mini", "high", true)).toBeUndefined();
    });
});
