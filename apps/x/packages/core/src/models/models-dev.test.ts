import { describe, expect, it } from "vitest";
import { buildReasoningIndex, lookupReasoningFlag } from "./models-dev.js";

// Mirrors the real-world shapes that broke the join: models.dev spells
// versions with dashes ("claude-opus-4-8") while the gateway serves
// OpenRouter-style dotted ids ("anthropic/claude-opus-4.8") and bare
// unprefixed OpenAI ids ("gpt-5.4").
const CATALOG = {
    openai: {
        name: "OpenAI",
        models: {
            "gpt-5.4": { id: "gpt-5.4", reasoning: true },
            "gpt-4.1": { id: "gpt-4.1", reasoning: false },
        },
    },
    anthropic: {
        name: "Anthropic",
        models: {
            "claude-opus-4-8": { id: "claude-opus-4-8", reasoning: true },
            "claude-haiku-4-5": { id: "claude-haiku-4-5", reasoning: false },
        },
    },
    google: {
        name: "Google",
        models: {
            "gemini-3.5-flash": { id: "gemini-3.5-flash", reasoning: true },
        },
    },
} as never;

describe("reasoning capability index", () => {
    const index = buildReasoningIndex(CATALOG);

    it("joins dotted gateway ids against dashed catalog ids", () => {
        expect(lookupReasoningFlag(index, "rowboat", "anthropic/claude-opus-4.8")).toBe(true);
        expect(lookupReasoningFlag(index, "rowboat", "anthropic/claude-haiku-4.5")).toBe(false);
    });

    it("matches bare unprefixed ids on gateway flavors", () => {
        expect(lookupReasoningFlag(index, "rowboat", "gpt-5.4")).toBe(true);
        expect(lookupReasoningFlag(index, "rowboat", "gpt-4.1")).toBe(false);
    });

    it("matches strict flavors by their own namespace", () => {
        expect(lookupReasoningFlag(index, "anthropic", "claude-opus-4-8")).toBe(true);
        expect(lookupReasoningFlag(index, "openai", "gpt-5.4")).toBe(true);
        expect(lookupReasoningFlag(index, "google", "gemini-3.5-flash")).toBe(true);
    });

    it("returns undefined for unknown models and unknown vendors", () => {
        expect(lookupReasoningFlag(index, "rowboat", "mistralai/mistral-large")).toBeUndefined();
        expect(lookupReasoningFlag(index, "rowboat", "some-local-model")).toBeUndefined();
        expect(lookupReasoningFlag(index, "openai", "gpt-99")).toBeUndefined();
    });

    it("drops bare ids that are ambiguous across vendors", () => {
        const clashing = {
            openai: { name: "OpenAI", models: { shared: { id: "shared", reasoning: true } } },
            anthropic: { name: "Anthropic", models: { shared: { id: "shared", reasoning: false } } },
            google: { name: "Google", models: {} },
        } as never;
        const clashIndex = buildReasoningIndex(clashing);
        expect(lookupReasoningFlag(clashIndex, "rowboat", "shared")).toBeUndefined();
        // Vendor-qualified lookups still work.
        expect(lookupReasoningFlag(clashIndex, "rowboat", "openai/shared")).toBe(true);
        expect(lookupReasoningFlag(clashIndex, "anthropic", "shared")).toBe(false);
    });
});
