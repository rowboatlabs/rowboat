import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import { Message, ToolCallPart } from "@x/shared/dist/message.js";
import type { AutoPermissionDecision } from "../security/auto-permission-classifier.js";
import { AgentLoopTurn } from "../agent-loop/types.js";
import type { getToolPermissionMetadata } from "../security/permission-metadata.js";
import { AgentTools } from "./agent-tools.js";
import { RealPermissionGate, type SessionGrants } from "./real-permission-gate.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const builtin = (name: string): z.infer<typeof ToolAttachment> => ({ type: "builtin", name });

function agentToolsFor(tools: Record<string, z.infer<typeof ToolAttachment>>): AgentTools {
    const agent: z.infer<typeof Agent> = { name: "test-agent", instructions: "", tools };
    return new AgentTools(async () => agent);
}

function call(toolName: string, args: Record<string, unknown> = {}): z.infer<typeof ToolCallPart> {
    return { type: "tool-call", toolCallId: `tc-${toolName}`, toolName, arguments: args };
}

function turn(overrides: Partial<z.infer<typeof AgentLoopTurn>> = {}): z.infer<typeof AgentLoopTurn> {
    const now = "2026-06-14T00:00:00Z";
    return {
        id: "turn-1",
        agentId: "test-agent",
        provider: null,
        model: null,
        permissionMode: "auto",
        useCase: null,
        subUseCase: null,
        sessionId: "sess-1",
        sessionSeq: 1,
        composeContext: null,
        messages: [{ role: "user", content: "do it" } satisfies z.infer<typeof Message>],
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

type MetadataFn = typeof getToolPermissionMetadata;

// ─── check ───────────────────────────────────────────────────────────────────

describe("RealPermissionGate.check", () => {
    it("requires no approval for a tool the agent does not have", async () => {
        const gate = new RealPermissionGate({
            agentTools: agentToolsFor({}),
            getMetadata: (async () => {
                throw new Error("should not be consulted for an unknown tool");
            }) as unknown as MetadataFn,
        });
        expect(await gate.check(call("nope"), turn())).toEqual({ required: false });
    });

    it("returns the metadata as the request when approval is required", async () => {
        const request = { kind: "command", commandNames: ["rm"] };
        const gate = new RealPermissionGate({
            agentTools: agentToolsFor({ executeCommand: builtin("executeCommand") }),
            getMetadata: (async () => request) as unknown as MetadataFn,
        });
        expect(await gate.check(call("executeCommand"), turn())).toEqual({
            required: true,
            request,
        });
    });

    it("treats null metadata as no approval needed", async () => {
        const gate = new RealPermissionGate({
            agentTools: agentToolsFor({ "file-readText": builtin("file-readText") }),
            getMetadata: (async () => null) as unknown as MetadataFn,
        });
        expect(await gate.check(call("file-readText"), turn())).toEqual({ required: false });
    });

    it("consults session grants and passes them with the resolved attachment", async () => {
        const seen: { attachment: unknown; commands: Set<string>; grants: unknown }[] = [];
        const sessionGrants: SessionGrants = {
            commands: async (sessionId) =>
                sessionId === "sess-1" ? new Set(["ls"]) : new Set(),
            fileAccess: async (sessionId) =>
                sessionId === "sess-1" ? [{ operation: "read", pathPrefix: "/tmp" }] : [],
        };
        const gate = new RealPermissionGate({
            agentTools: agentToolsFor({ executeCommand: builtin("executeCommand") }),
            sessionGrants,
            getMetadata: (async (_tc, attachment, commands, grants) => {
                seen.push({ attachment, commands, grants });
                return null;
            }) as unknown as MetadataFn,
        });

        await gate.check(call("executeCommand"), turn());
        expect(seen).toHaveLength(1);
        expect(seen[0].attachment).toMatchObject({ type: "builtin", name: "executeCommand" });
        expect(seen[0].commands).toEqual(new Set(["ls"]));
        expect(seen[0].grants).toEqual([{ operation: "read", pathPrefix: "/tmp" }]);
    });
});

// ─── classify ──────────────────────────────────────────────────────────────

describe("RealPermissionGate.classify", () => {
    const request = { kind: "command" as const, commandNames: ["rm"] };

    function gateWithClassifier(decisions: AutoPermissionDecision[], spy?: (input: unknown) => void) {
        return new RealPermissionGate({
            agentTools: agentToolsFor({ executeCommand: builtin("executeCommand") }),
            classifier: async (input) => {
                spy?.(input);
                return decisions;
            },
        });
    }

    it("maps an allow decision to granted", async () => {
        const gate = gateWithClassifier([
            { toolCallId: "tc-executeCommand", decision: "allow", reason: "safe" },
        ]);
        expect(await gate.classify(call("executeCommand"), request, turn())).toEqual({
            decision: "granted",
            reason: "safe",
        });
    });

    it("maps a deny decision to denied", async () => {
        const gate = gateWithClassifier([
            { toolCallId: "tc-executeCommand", decision: "deny", reason: "destructive" },
        ]);
        expect(await gate.classify(call("executeCommand"), request, turn())).toEqual({
            decision: "denied",
            reason: "destructive",
        });
    });

    it("abstains when the classifier returns no decision for the call", async () => {
        const gate = gateWithClassifier([]);
        const result = await gate.classify(call("executeCommand"), request, turn());
        expect(result.decision).toBe("abstained");
    });

    it("passes the parsed permission, run id, agent, and converted messages to the classifier", async () => {
        let input: { runId: string; agentName: string | null; messages: unknown[]; candidates: { permission: unknown }[] } | undefined;
        const gate = gateWithClassifier(
            [{ toolCallId: "tc-executeCommand", decision: "allow", reason: "ok" }],
            (i) => { input = i as typeof input; },
        );
        await gate.classify(call("executeCommand"), request, turn());
        expect(input?.runId).toBe("turn-1");
        expect(input?.agentName).toBe("test-agent");
        expect(input?.messages.length).toBeGreaterThan(0);
        expect(input?.candidates[0].permission).toEqual(request);
    });
});
