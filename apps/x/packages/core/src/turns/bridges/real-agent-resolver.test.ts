import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Agent } from "@x/shared/dist/agent.js";
import { composeSystemInstructions } from "../../agents/runtime.js";
import type { BuiltinTools } from "../../application/lib/builtin-tools.js";
import { RealAgentResolver } from "./real-agent-resolver.js";

const DEFAULTS = async () => ({ model: "gpt-default", provider: "openai" });

function makeAgent(
    overrides: Partial<z.infer<typeof Agent>> = {},
): z.infer<typeof Agent> {
    return {
        name: "copilot",
        instructions: "You are Copilot.",
        tools: {},
        ...overrides,
    };
}

// A minimal fake builtin catalog (the real one is heavy and irrelevant here).
const fakeBuiltins = {
    "file-list": {
        description: "List files",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => null,
    },
    "web-search": {
        description: "Search the web",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => null,
        isAvailable: async () => false,
    },
} as unknown as typeof BuiltinTools;

function makeResolver(agent: z.infer<typeof Agent>, deps: Partial<ConstructorParameters<typeof RealAgentResolver>[0]> = {}) {
    return new RealAgentResolver({
        load: async () => agent,
        builtins: fakeBuiltins,
        defaultModel: DEFAULTS,
        loadNotes: () => null,
        loadWorkDir: () => null,
        ...deps,
    });
}

describe("RealAgentResolver", () => {
    it("applies model precedence: override > agent config > app default", async () => {
        const withNothing = makeResolver(makeAgent());
        expect((await withNothing.resolve({ agentId: "copilot" })).model).toEqual({
            provider: "openai",
            model: "gpt-default",
        });

        const withAgentModel = makeResolver(
            makeAgent({ provider: "anthropic", model: "claude-x" }),
        );
        expect(
            (await withAgentModel.resolve({ agentId: "copilot" })).model,
        ).toEqual({ provider: "anthropic", model: "claude-x" });

        expect(
            (
                await withAgentModel.resolve({
                    agentId: "copilot",
                    overrides: { model: { provider: "google", model: "gemini-x" } },
                })
            ).model,
        ).toEqual({ provider: "google", model: "gemini-x" });
    });

    it("maps builtins to descriptors with JSON schemas, filtering unavailable ones", async () => {
        const resolver = makeResolver(
            makeAgent({
                tools: {
                    "file-list": { type: "builtin", name: "file-list" },
                    "web-search": { type: "builtin", name: "web-search" }, // unavailable
                    ghost: { type: "builtin", name: "ghost" }, // not in catalog
                },
            }),
        );
        const resolved = await resolver.resolve({ agentId: "copilot" });
        expect(resolved.tools).toHaveLength(1);
        expect(resolved.tools[0]).toMatchObject({
            toolId: "builtin:file-list",
            name: "file-list",
            description: "List files",
            execution: "sync",
            requiresHuman: false,
        });
        expect(resolved.tools[0].inputSchema).toMatchObject({
            type: "object",
            properties: { path: { type: "string" } },
        });
    });

    it("passes MCP schemas through and skips agent-as-tool attachments", async () => {
        const resolver = makeResolver(
            makeAgent({
                tools: {
                    lookup: {
                        type: "mcp",
                        name: "lookup",
                        description: "Look things up",
                        inputSchema: { type: "object", properties: { q: { type: "string" } } },
                        mcpServerName: "kb",
                    },
                    subflow: { type: "agent", name: "researcher" },
                },
            }),
        );
        const resolved = await resolver.resolve({ agentId: "copilot" });
        expect(resolved.tools).toHaveLength(1);
        expect(resolved.tools[0]).toMatchObject({
            toolId: "mcp:kb:lookup",
            name: "lookup",
            description: "Look things up",
            execution: "sync",
        });
    });

    it("maps ask-human to an async human-dependent descriptor", async () => {
        const resolver = makeResolver(
            makeAgent({
                tools: { "ask-human": { type: "builtin", name: "ask-human" } },
            }),
        );
        const resolved = await resolver.resolve({ agentId: "copilot" });
        expect(resolved.tools[0]).toMatchObject({
            toolId: "builtin:ask-human",
            execution: "async",
            requiresHuman: true,
        });
    });

    it("composes the system prompt byte-identically to the shared composer", async () => {
        const resolver = makeResolver(makeAgent(), {
            loadNotes: () => "# Agent Notes\nremember X",
            loadWorkDir: (id) => (id === "sess-1" ? "/Users/me/work" : null),
        });
        const resolved = await resolver.resolve({
            agentId: "copilot",
            overrides: {
                composition: {
                    workDirId: "sess-1",
                    searchEnabled: true,
                    codeMode: "claude",
                },
            },
        });
        expect(resolved.systemPrompt).toBe(
            composeSystemInstructions({
                instructions: "You are Copilot.",
                agentNotesContext: "# Agent Notes\nremember X",
                userWorkDir: "/Users/me/work",
                voiceInput: false,
                voiceOutput: null,
                searchEnabled: true,
                codeMode: "claude",
                codeCwd: null,
            }),
        );
    });

    it("is prompt-stable: identical composition yields identical bytes; unknown keys are ignored", async () => {
        const resolver = makeResolver(makeAgent());
        const a = await resolver.resolve({ agentId: "copilot" });
        const b = await resolver.resolve({
            agentId: "copilot",
            overrides: { composition: { someUnknownKey: 42 } },
        });
        expect(b.systemPrompt).toBe(a.systemPrompt);
    });

    it("does not load notes/work-dir for non-copilot agents", async () => {
        let notesLoaded = 0;
        const resolver = makeResolver(makeAgent({ name: "background-task-agent" }), {
            loadNotes: () => {
                notesLoaded += 1;
                return "notes";
            },
        });
        await resolver.resolve({ agentId: "background-task-agent" });
        expect(notesLoaded).toBe(0);
    });

    it("rejects when the agent cannot be loaded, creating nothing", async () => {
        const resolver = new RealAgentResolver({
            load: async () => {
                throw new Error("no such agent");
            },
            builtins: fakeBuiltins,
            defaultModel: DEFAULTS,
        });
        await expect(resolver.resolve({ agentId: "ghost" })).rejects.toThrowError(
            "no such agent",
        );
    });
});
