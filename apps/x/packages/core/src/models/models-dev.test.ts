import { describe, expect, it } from "vitest";
import { ModelsDevResponse, buildReasoningIndex, lookupReasoningFlag, pickImageModelIds } from "./models-dev.js";

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

// models.dev tags each model with its input/output modalities; the image
// picker's openai/google lists are exactly the entries that output images.
const IMAGE_CATALOG = {
    openai: {
        name: "OpenAI",
        models: {
            "gpt-5.4": { id: "gpt-5.4", tool_call: true, modalities: { input: ["text", "image"], output: ["text"] } },
            "gpt-image-1.5": { id: "gpt-image-1.5", tool_call: false, release_date: "2025-11-25", modalities: { output: ["text", "image"] } },
            "gpt-image-2": { id: "gpt-image-2", tool_call: false, release_date: "2026-04-21", modalities: { output: ["image"] } },
            "gpt-image-1": { id: "gpt-image-1", status: "deprecated", release_date: "2025-04-24", modalities: { output: ["image"] } },
            "no-modalities": { id: "no-modalities" },
        },
    },
    google: {
        name: "Google",
        models: {
            "gemini-3.5-flash": { id: "gemini-3.5-flash", modalities: { output: ["text"] } },
        },
    },
} as never;

describe("image model selection", () => {
    it("keeps only image-output models, newest first, regardless of tool calling", () => {
        // gpt-image-* don't call tools — the chat filter would drop them.
        expect(pickImageModelIds(IMAGE_CATALOG, "openai")).toEqual(["gpt-image-2", "gpt-image-1.5"]);
    });

    it("returns an empty list for a vendor whose models all output text", () => {
        expect(pickImageModelIds(IMAGE_CATALOG, "google")).toEqual([]);
    });

    it("distinguishes 'vendor absent' (null) from 'no image models' ([])", () => {
        const noOpenAI = { google: { name: "Google", models: {} } } as never;
        expect(pickImageModelIds(noOpenAI, "openai")).toBeNull();
    });
});

describe("catalog parse", () => {
    it("plumbs modalities through without dropping anything else", () => {
        const parsed = ModelsDevResponse.parse({
            openai: {
                name: "OpenAI",
                models: { "gpt-image-2": { id: "gpt-image-2", tool_call: false, modalities: { input: ["text"], output: ["image"] } } },
            },
        });
        expect(parsed.openai.models["gpt-image-2"].modalities?.output).toEqual(["image"]);
    });

    it("survives a missing or oddly-shaped modalities block — the model still parses", () => {
        const parsed = ModelsDevResponse.parse({
            openai: {
                name: "OpenAI",
                models: {
                    plain: { id: "plain", tool_call: true },
                    "string-modalities": { id: "string-modalities", tool_call: true, modalities: "text" },
                    "numeric-output": { id: "numeric-output", tool_call: true, modalities: { input: ["text"], output: [1, 2] } },
                    "null-modalities": { id: "null-modalities", tool_call: true, modalities: null },
                },
            },
        });
        // Every model survives; chat lists (which key off tool_call) are untouched.
        expect(Object.keys(parsed.openai.models)).toEqual(["plain", "string-modalities", "numeric-output", "null-modalities"]);
        expect(parsed.openai.models.plain.modalities).toBeUndefined();
        expect(parsed.openai.models["string-modalities"].modalities).toBeUndefined();
        expect(parsed.openai.models["numeric-output"].modalities?.output).toBeUndefined();
        // …and an unreadable modalities block never reads as image-capable.
        expect(pickImageModelIds(parsed as never, "openai")).toEqual([]);
    });
});
