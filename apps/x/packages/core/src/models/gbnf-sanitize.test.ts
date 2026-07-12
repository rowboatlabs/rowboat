import { describe, expect, it, vi } from "vitest";
import {
    translatePcreShorthands,
    sanitizePatternsInPlace,
    sanitizeChatCompletionsBody,
    makeGbnfSafeFetch,
} from "./gbnf-sanitize.js";

describe("translatePcreShorthands", () => {
    it("translates the HH:MM window regex that triggers the LM Studio bug", () => {
        // The exact pattern from live-note TriggerWindowSchema (pre-fix source).
        expect(translatePcreShorthands("^([01]\\d|2[0-3]):[0-5]\\d$"))
            .toBe("^([01][0-9]|2[0-3]):[0-5][0-9]$");
    });

    it("translates each shorthand outside a character class", () => {
        expect(translatePcreShorthands("\\d")).toBe("[0-9]");
        expect(translatePcreShorthands("\\D")).toBe("[^0-9]");
        expect(translatePcreShorthands("\\w")).toBe("[A-Za-z0-9_]");
        expect(translatePcreShorthands("\\W")).toBe("[^A-Za-z0-9_]");
        expect(translatePcreShorthands("\\s")).toBe("[ \\t\\n\\r]");
        expect(translatePcreShorthands("\\S")).toBe("[^ \\t\\n\\r]");
    });

    it("keeps quantifiers and anchors around a translated shorthand", () => {
        expect(translatePcreShorthands("^\\d{2,4}$")).toBe("^[0-9]{2,4}$");
        expect(translatePcreShorthands("\\w+")).toBe("[A-Za-z0-9_]+");
    });

    it("translates shorthands as bare members inside a character class", () => {
        expect(translatePcreShorthands("[\\d.]")).toBe("[0-9.]");
        expect(translatePcreShorthands("[\\w-]")).toBe("[A-Za-z0-9_-]");
        expect(translatePcreShorthands("[\\s]")).toBe("[ \\t\\n\\r]");
        // A negated class that only contains \s is expressible: [^\s] -> [^ \t\n\r]
        expect(translatePcreShorthands("[^\\s]")).toBe("[^ \\t\\n\\r]");
    });

    it("drops the pattern when a negated shorthand appears inside a class", () => {
        // \D/\W/\S have no in-class member form (negation can't nest).
        expect(translatePcreShorthands("[\\D]")).toBeNull();
        expect(translatePcreShorthands("[\\W.]")).toBeNull();
        expect(translatePcreShorthands("[a\\S]")).toBeNull();
    });

    it("drops the pattern for word boundaries, which have no GBNF equivalent", () => {
        expect(translatePcreShorthands("\\bword\\b")).toBeNull();
        expect(translatePcreShorthands("foo\\Bbar")).toBeNull();
    });

    it("drops the pattern for an unbalanced character class", () => {
        expect(translatePcreShorthands("[0-9")).toBeNull();
    });

    it("leaves GBNF-safe escapes untouched", () => {
        expect(translatePcreShorthands("a\\.b")).toBe("a\\.b");
        expect(translatePcreShorthands("line\\nbreak")).toBe("line\\nbreak");
        expect(translatePcreShorthands("a\\\\b")).toBe("a\\\\b");
        // A digit escape followed by a literal dot, mixed.
        expect(translatePcreShorthands("v\\d\\.\\d")).toBe("v[0-9]\\.[0-9]");
    });

    it("returns patterns without shorthands unchanged", () => {
        expect(translatePcreShorthands("^[a-z][a-z0-9-]*$")).toBe("^[a-z][a-z0-9-]*$");
        expect(translatePcreShorthands("(foo|bar)")).toBe("(foo|bar)");
    });
});

describe("sanitizePatternsInPlace", () => {
    it("rewrites a pattern nested deep inside a tool parameters schema", () => {
        const schema = {
            type: "object",
            properties: {
                triggers: {
                    type: "object",
                    properties: {
                        windows: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                                    endTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                                },
                            },
                        },
                    },
                },
            },
        };
        const changes = sanitizePatternsInPlace(schema);
        expect(changes).toBe(2);
        const item = schema.properties.triggers.properties.windows.items.properties;
        expect(item.startTime.pattern).toBe("^([01][0-9]|2[0-3]):[0-5][0-9]$");
        expect(item.endTime.pattern).toBe("^([01][0-9]|2[0-3]):[0-5][0-9]$");
    });

    it("deletes an untranslatable pattern instead of emitting broken grammar", () => {
        const schema: { type: string; pattern?: string } = { type: "string", pattern: "\\bword\\b" };
        const changes = sanitizePatternsInPlace(schema);
        expect(changes).toBe(1);
        expect("pattern" in schema).toBe(false);
    });

    it("does not touch a tool field that is merely named 'pattern'", () => {
        // file-grep exposes an input field called `pattern` — its schema node is
        // an object, not a regex string, and must be left alone.
        const schema = {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Regex pattern to search for" },
            },
        };
        const changes = sanitizePatternsInPlace(schema);
        expect(changes).toBe(0);
        expect(schema.properties.pattern).toEqual({ type: "string", description: "Regex pattern to search for" });
    });

    it("sanitizes a real regex constraint on a field named 'pattern'", () => {
        const schema = {
            type: "object",
            properties: {
                pattern: { type: "string", pattern: "\\d+" },
            },
        };
        const changes = sanitizePatternsInPlace(schema);
        expect(changes).toBe(1);
        expect(schema.properties.pattern.pattern).toBe("[0-9]+");
    });

    it("returns 0 for values that carry no patterns", () => {
        expect(sanitizePatternsInPlace({ type: "object", properties: {} })).toBe(0);
        expect(sanitizePatternsInPlace(null)).toBe(0);
        expect(sanitizePatternsInPlace("string")).toBe(0);
        expect(sanitizePatternsInPlace(42)).toBe(0);
    });
});

describe("sanitizeChatCompletionsBody", () => {
    const toolBody = (pattern: string) => JSON.stringify({
        model: "qwen",
        messages: [{ role: "user", content: "hi" }],
        tools: [{
            type: "function",
            function: {
                name: "create-background-task",
                parameters: {
                    type: "object",
                    properties: { startTime: { type: "string", pattern } },
                },
            },
        }],
    });

    it("sanitizes a PCRE shorthand in tool parameters", () => {
        const out = sanitizeChatCompletionsBody(toolBody("^([01]\\d|2[0-3]):[0-5]\\d$"));
        const parsed = JSON.parse(out);
        expect(parsed.tools[0].function.parameters.properties.startTime.pattern)
            .toBe("^([01][0-9]|2[0-3]):[0-5][0-9]$");
        // Non-schema fields are preserved.
        expect(parsed.model).toBe("qwen");
        expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
    });

    it("sanitizes a pattern inside a json_schema response_format", () => {
        const body = JSON.stringify({
            model: "qwen",
            messages: [],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "out",
                    schema: { type: "object", properties: { t: { type: "string", pattern: "\\d\\d:\\d\\d" } } },
                },
            },
        });
        const parsed = JSON.parse(sanitizeChatCompletionsBody(body));
        expect(parsed.response_format.json_schema.schema.properties.t.pattern)
            .toBe("[0-9][0-9]:[0-9][0-9]");
    });

    it("returns the body byte-for-byte when it carries no offending pattern", () => {
        const clean = toolBody("^[a-z]+$");
        expect(sanitizeChatCompletionsBody(clean)).toBe(clean);
    });

    it("returns a body with no tools/response_format unchanged", () => {
        const body = JSON.stringify({ model: "qwen", input: "text" });
        expect(sanitizeChatCompletionsBody(body)).toBe(body);
    });

    it("returns non-JSON bodies unchanged", () => {
        expect(sanitizeChatCompletionsBody("not json")).toBe("not json");
        expect(sanitizeChatCompletionsBody("")).toBe("");
    });
});

describe("makeGbnfSafeFetch", () => {
    it("forwards a sanitized body to the underlying fetch when a shorthand is present", async () => {
        const base = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
        const wrapped = makeGbnfSafeFetch(base as unknown as typeof fetch);
        const body = JSON.stringify({
            messages: [],
            tools: [{ type: "function", function: { name: "t", parameters: { type: "object", properties: { x: { type: "string", pattern: "\\d" } } } } }],
        });

        await wrapped("http://localhost:1234/v1/chat/completions", { method: "POST", body });

        expect(base).toHaveBeenCalledTimes(1);
        const sentBody = (base.mock.calls[0][1] as RequestInit).body as string;
        expect(JSON.parse(sentBody).tools[0].function.parameters.properties.x.pattern).toBe("[0-9]");
    });

    it("passes the original init through untouched when nothing needs changing", async () => {
        const base = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
        const wrapped = makeGbnfSafeFetch(base as unknown as typeof fetch);
        const init = { method: "POST", body: JSON.stringify({ messages: [], tools: [] }) };

        await wrapped("http://localhost:1234/v1/chat/completions", init);

        expect(base).toHaveBeenCalledTimes(1);
        // Same init object reference — no clone when there's nothing to rewrite.
        expect(base.mock.calls[0][1]).toBe(init);
    });

    it("passes through requests with a non-string body", async () => {
        const base = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
        const wrapped = makeGbnfSafeFetch(base as unknown as typeof fetch);

        await wrapped("http://localhost:1234/v1/models", { method: "GET" });

        expect(base).toHaveBeenCalledTimes(1);
        expect(base.mock.calls[0][1]).toEqual({ method: "GET" });
    });
});
