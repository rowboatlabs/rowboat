import { afterEach, describe, expect, it, vi } from "vitest";
import {
    makeOllamaThinkFetch,
    resolveThinkValue,
    rewrapOllamaErrorBody,
    sanitizePatternsForGBNF,
} from "./local.js";

describe("resolveThinkValue", () => {
    it("passes effort levels straight through for gpt-oss variants", () => {
        expect(resolveThinkValue("gpt-oss:20b", "low", true)).toBe("low");
        expect(resolveThinkValue("gpt-oss:120b", "high", true)).toBe("high");
        // gpt-oss can't disable thinking, so levels apply even if the
        // capability probe failed.
        expect(resolveThinkValue("gpt-oss:latest", "medium", false)).toBe("medium");
    });

    it("maps effort to a boolean toggle for other thinking models", () => {
        expect(resolveThinkValue("qwen3.5:27b", "low", true)).toBe(false);
        expect(resolveThinkValue("qwen3.5:27b", "medium", true)).toBeUndefined();
        expect(resolveThinkValue("deepseek-r1:8b", "high", true)).toBe(true);
    });

    it("strips think for models without the thinking capability", () => {
        expect(resolveThinkValue("llama3.2:3b", "low", false)).toBeUndefined();
        expect(resolveThinkValue("llama3.2:3b", "high", false)).toBeUndefined();
    });
});

describe("rewrapOllamaErrorBody", () => {
    it("rewraps Ollama's plain-string error shape", () => {
        expect(rewrapOllamaErrorBody('{"error":"model \'x\' not found"}'))
            .toBe('{"error":{"message":"model \'x\' not found"}}');
    });

    it("leaves already-nested errors untouched", () => {
        expect(rewrapOllamaErrorBody('{"error":{"message":"x"}}')).toBeUndefined();
    });

    it("leaves non-JSON bodies untouched", () => {
        expect(rewrapOllamaErrorBody("<html>bad gateway</html>")).toBeUndefined();
    });

    it("leaves JSON without a string error field untouched", () => {
        expect(rewrapOllamaErrorBody('{"message":"x"}')).toBeUndefined();
        expect(rewrapOllamaErrorBody('{"error":42}')).toBeUndefined();
        expect(rewrapOllamaErrorBody("null")).toBeUndefined();
    });
});

describe("makeOllamaThinkFetch", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubFetch(capabilities: string[]) {
        const calls: Array<{ url: string; body: unknown }> = [];
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
            if (url.endsWith("/api/show")) {
                return new Response(JSON.stringify({ capabilities }), { status: 200 });
            }
            return new Response("{}", { status: 200 });
        }));
        return calls;
    }

    it("rewrites think on /api/chat for gpt-oss", async () => {
        const calls = stubFetch(["completion", "tools", "thinking"]);
        const wrapped = makeOllamaThinkFetch("low");
        await wrapped("http://localhost:11434/api/chat", {
            method: "POST",
            body: JSON.stringify({ model: "gpt-oss:20b", think: false, messages: [] }),
        });
        const chat = calls.find((c) => c.url.endsWith("/api/chat"));
        expect((chat?.body as { think?: unknown }).think).toBe("low");
    });

    it("strips think for non-thinking models", async () => {
        const calls = stubFetch(["completion", "tools"]);
        const wrapped = makeOllamaThinkFetch("high");
        await wrapped("http://localhost:11434/api/chat", {
            method: "POST",
            body: JSON.stringify({ model: "llama3.2:3b", think: false, messages: [] }),
        });
        const chat = calls.find((c) => c.url.endsWith("/api/chat"));
        expect(chat?.body as Record<string, unknown>).not.toHaveProperty("think");
    });

    it("probes /api/show once per model and leaves other endpoints untouched", async () => {
        const calls = stubFetch(["completion", "thinking"]);
        const wrapped = makeOllamaThinkFetch("high");
        const chatBody = JSON.stringify({ model: "qwen3.5:27b", think: false, messages: [] });
        await wrapped("http://localhost:11434/api/chat", { method: "POST", body: chatBody });
        await wrapped("http://localhost:11434/api/chat", { method: "POST", body: chatBody });
        await wrapped("http://localhost:11434/api/tags", { method: "GET" });
        expect(calls.filter((c) => c.url.endsWith("/api/show")).length).toBe(1);
        const chats = calls.filter((c) => c.url.endsWith("/api/chat"));
        expect(chats).toHaveLength(2);
        for (const chat of chats) {
            expect((chat.body as { think?: unknown }).think).toBe(true);
        }
        // Non-chat request passed through with no body rewrite.
        expect(calls.some((c) => c.url.endsWith("/api/tags"))).toBe(true);
    });

    it("rewraps plain-string error bodies on failed responses, keeping the status", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith("/api/show")) {
                return new Response(JSON.stringify({ capabilities: ["completion"] }), { status: 200 });
            }
            return new Response(JSON.stringify({ error: "boom" }), { status: 400, statusText: "Bad Request" });
        }));
        const wrapped = makeOllamaThinkFetch("low");
        const res = await wrapped("http://localhost:11434/api/chat", {
            method: "POST",
            body: JSON.stringify({ model: "llama3.2:3b", think: false, messages: [] }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { message: "boom" } });
    });

    it("returns successful responses untouched", async () => {
        stubFetch(["completion"]);
        const wrapped = makeOllamaThinkFetch("low");
        const res = await wrapped("http://localhost:11434/api/chat", {
            method: "POST",
            body: JSON.stringify({ model: "llama3.2:3b", messages: [] }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({});
    });
});

describe("sanitizePatternsForGBNF", () => {
    it("replaces \\d with [0-9]", () => {
        const schema = { type: "object", properties: { time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" } },
        });
    });

    it("replaces \\D with [^0-9]", () => {
        const schema = { type: "object", properties: { name: { type: "string", pattern: "^\\D+$" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { name: { type: "string", pattern: "^[^0-9]+$" } },
        });
    });

    it("replaces \\w with [A-Za-z0-9_]", () => {
        const schema = { type: "object", properties: { id: { type: "string", pattern: "^\\w+$" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { id: { type: "string", pattern: "^[A-Za-z0-9_]+$" } },
        });
    });

    it("replaces \\W with [^A-Za-z0-9_]", () => {
        const schema = { type: "object", properties: { slug: { type: "string", pattern: "^\\W+$" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { slug: { type: "string", pattern: "^[^A-Za-z0-9_]+$" } },
        });
    });

    it("replaces \\s with [ \\t\\n\\r]", () => {
        const schema = { type: "object", properties: { text: { type: "string", pattern: "^\\s+$" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { text: { type: "string", pattern: "^[ \\t\\n\\r]+$" } },
        });
    });

    it("replaces \\S with [^ \\t\\n\\r]", () => {
        const schema = { type: "object", properties: { text: { type: "string", pattern: "^\\S+$" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { text: { type: "string", pattern: "^[^ \\t\\n\\r]+$" } },
        });
    });

    it("removes \\b (word boundary)", () => {
        const schema = { type: "object", properties: { word: { type: "string", pattern: "\\btest\\b" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { word: { type: "string", pattern: "test" } },
        });
    });

    it("removes \\B (non-word boundary)", () => {
        const schema = { type: "object", properties: { word: { type: "string", pattern: "\\Btest\\B" } } };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: { word: { type: "string", pattern: "test" } },
        });
    });

    it("handles nested objects and arrays", () => {
        const schema = {
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: { type: "string", pattern: "^\\d+$" },
                },
                nested: {
                    type: "object",
                    properties: { time: { type: "string", pattern: "^\\d{2}:\\d{2}$" } },
                },
            },
        };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: { type: "string", pattern: "^[0-9]+$" },
                },
                nested: {
                    type: "object",
                    properties: { time: { type: "string", pattern: "^[0-9]{2}:[0-9]{2}$" } },
                },
            },
        });
    });

    it("leaves non-pattern properties unchanged", () => {
        const schema = {
            type: "object",
            properties: {
                name: { type: "string", minLength: 1 },
                time: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
            },
        };
        const sanitized = sanitizePatternsForGBNF(schema);
        expect(sanitized).toEqual({
            type: "object",
            properties: {
                name: { type: "string", minLength: 1 },
                time: { type: "string", pattern: "^[0-9]{2}:[0-9]{2}$" },
            },
        });
    });

    it("handles null and primitive values", () => {
        expect(sanitizePatternsForGBNF(null)).toBeNull();
        expect(sanitizePatternsForGBNF("string")).toBe("string");
        expect(sanitizePatternsForGBNF(123)).toBe(123);
        expect(sanitizePatternsForGBNF(true)).toBe(true);
    });

    it("handles empty objects and arrays", () => {
        expect(sanitizePatternsForGBNF({})).toEqual({});
        expect(sanitizePatternsForGBNF([])).toEqual([]);
    });
});
