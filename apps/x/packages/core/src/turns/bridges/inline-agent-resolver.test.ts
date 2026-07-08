import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BuiltinTools } from "../../application/lib/builtin-tools.js";
import { InlineAgentResolver } from "./inline-agent-resolver.js";

const fakeBuiltins = {
    "web-search": {
        description: "Search the web",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => null,
    },
    "file-readText": {
        description: "Read a file",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => null,
    },
    "flaky-tool": {
        description: "Sometimes available",
        inputSchema: z.object({}),
        execute: async () => null,
        isAvailable: async () => false,
    },
    "spawn-agent": {
        description: "Spawn",
        inputSchema: z.object({}),
        execute: async () => null,
    },
    executeCommand: {
        description: "Run a command",
        inputSchema: z.object({ command: z.string() }),
        execute: async () => null,
    },
} as unknown as typeof BuiltinTools;

function makeResolver() {
    return new InlineAgentResolver({
        builtins: fakeBuiltins,
        defaultModel: async () => ({ model: "m-default", provider: "p-default" }),
    });
}

describe("InlineAgentResolver", () => {
    it("materializes the spec verbatim: inline agentId, instructions as prompt, spec model", async () => {
        const resolved = await makeResolver().resolve({
            inline: {
                name: "researcher",
                instructions: "You research things.",
                model: { provider: "p1", model: "m1" },
                tools: ["web-search"],
            },
        });
        expect(resolved.agentId).toBe("inline:researcher");
        expect(resolved.systemPrompt).toBe("You research things.");
        expect(resolved.model).toEqual({ provider: "p1", model: "m1" });
        expect(resolved.tools).toEqual([
            expect.objectContaining({
                toolId: "builtin:web-search",
                name: "web-search",
                execution: "sync",
                requiresHuman: false,
            }),
        ]);
    });

    it("falls back to the app-default model when the spec has none", async () => {
        const resolved = await makeResolver().resolve({
            inline: { name: "a", instructions: "x", tools: [] },
        });
        expect(resolved.model).toEqual({ provider: "p-default", model: "m-default" });
    });

    it("rejects unknown builtin names loudly", async () => {
        await expect(
            makeResolver().resolve({
                inline: { name: "a", instructions: "x", tools: ["nope"] },
            }),
        ).rejects.toThrowError(/unknown builtin tool: nope/);
    });

    it("strips spawn-agent (depth cap) and skips unavailable tools", async () => {
        const resolved = await makeResolver().resolve({
            inline: {
                name: "a",
                instructions: "x",
                tools: ["spawn-agent", "flaky-tool", "file-readText"],
            },
        });
        expect(resolved.tools.map((t) => t.name)).toEqual(["file-readText"]);
    });

    it("default profile is the catalog minus the headless/child exclusions", async () => {
        const resolved = await makeResolver().resolve({
            inline: { name: "a", instructions: "x" },
        });
        const names = resolved.tools.map((t) => t.name);
        expect(names).toEqual(["web-search", "file-readText"]);
        // Excluded by policy, not by absence:
        expect(names).not.toContain("executeCommand");
        expect(names).not.toContain("spawn-agent");
    });
});
