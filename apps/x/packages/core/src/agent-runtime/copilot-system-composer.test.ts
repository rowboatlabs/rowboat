import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "@x/shared/dist/agent.js";
import { AgentLoopTurn } from "../agent-loop/types.js";
import { AgentTools } from "./agent-tools.js";
import { CopilotSystemComposer } from "./copilot-system-composer.js";

function turn(overrides: Partial<z.infer<typeof AgentLoopTurn>> = {}): z.infer<typeof AgentLoopTurn> {
    const now = "2026-06-14T00:00:00Z";
    return {
        id: "turn-1",
        agentId: "my-agent", // non-copilot → agent-notes/workdir disk reads are skipped
        provider: null,
        model: null,
        permissionMode: "manual",
        useCase: null,
        subUseCase: null,
        sessionId: "sess-1",
        sessionSeq: 1,
        composeContext: null,
        messages: [{ role: "user", content: "hi" }],
        permissionRequests: [],
        permissionDecisions: [],
        startedTools: [],
        dispatchedTools: [],
        modelUsage: [],
        error: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function composerFor(instructions: string): CopilotSystemComposer {
    const agent: z.infer<typeof Agent> = { name: "my-agent", instructions, tools: {} };
    return new CopilotSystemComposer(new AgentTools(async () => agent));
}

describe("CopilotSystemComposer", () => {
    it("returns null for an agent-less turn", async () => {
        const composer = composerFor("be helpful");
        expect(await composer.system(turn({ agentId: null }))).toBeNull();
    });

    it("always includes the agent instructions and the hidden-user-context explainer", async () => {
        const composer = composerFor("YOU ARE A TEST AGENT");
        const system = await composer.system(turn());
        expect(system).toContain("YOU ARE A TEST AGENT");
        expect(system).toContain("# Hidden User Context");
    });

    it("omits voice / search / code-mode blocks when no compose context is set", async () => {
        const composer = composerFor("be helpful");
        const system = (await composer.system(turn())) ?? "";
        expect(system).not.toContain("# Voice Input");
        expect(system).not.toContain("# Voice Output");
        expect(system).not.toContain("# Search");
        expect(system).not.toContain("# Code Mode");
    });

    it("injects each block when its compose flag is set", async () => {
        const composer = composerFor("be helpful");
        const system = (await composer.system(turn({
            composeContext: {
                voiceInput: true,
                voiceOutput: "summary",
                searchEnabled: true,
                codeMode: "claude",
            },
        }))) ?? "";
        expect(system).toContain("# Voice Input");
        expect(system).toContain("# Voice Output (MANDATORY");
        expect(system).toContain("# Search");
        expect(system).toContain("# Code Mode (Active) — Agent: Claude Code");
    });

    it("uses the full read-aloud block for voiceOutput=full", async () => {
        const composer = composerFor("be helpful");
        const system = (await composer.system(turn({ composeContext: { voiceOutput: "full" } }))) ?? "";
        expect(system).toContain("# Voice Output — Full Read-Aloud");
    });
});
