import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { getToolPermissionMetadata } from "../../assembly/permission-metadata.js";
import type { BuiltinToolPermission } from "../../tools/types.js";
import { RealPermissionChecker } from "./real-permission-checker.js";

type MetadataFn = typeof getToolPermissionMetadata;
type MetadataCall = {
    toolCall: Parameters<MetadataFn>[0];
    attachment: Parameters<MetadataFn>[1];
};
type Policy = z.infer<typeof BuiltinToolPermission>;

function makeChecker(
    result: Awaited<ReturnType<MetadataFn>> | Error,
    policies: Record<string, Policy> = { executeCommand: "command-allowlist" },
) {
    const calls: MetadataCall[] = [];
    const checker = new RealPermissionChecker({
        getMetadata: (async (toolCall, attachment) => {
            calls.push({ toolCall, attachment });
            if (result instanceof Error) {
                throw result;
            }
            return result;
        }) as MetadataFn,
        getPolicy: (name) => policies[name],
    });
    return { checker, calls };
}

const input = {
    turnId: "turn-1",
    toolCallId: "tc-1",
    toolId: "builtin:executeCommand",
    toolName: "executeCommand",
    input: { command: "rm -rf /" },
};

describe("RealPermissionChecker", () => {
    it("gates builtins through getToolPermissionMetadata with empty session grants", async () => {
        const metadata = { kind: "command" as const, commandNames: ["rm"] };
        const { checker, calls } = makeChecker(metadata);
        const result = await checker.check(input);
        expect(result).toEqual({ required: true, request: metadata });
        expect(calls[0].toolCall).toMatchObject({
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "executeCommand",
            arguments: { command: "rm -rf /" },
        });
        expect(calls[0].attachment).toEqual({
            type: "builtin",
            name: "executeCommand",
        });
    });

    it("returns not-required when metadata is null", async () => {
        const { checker } = makeChecker(null);
        expect(await checker.check(input)).toEqual({ required: false });
    });

    it("allows builtins declared permission none without consulting metadata", async () => {
        const { checker, calls } = makeChecker(new Error("must not be called"), {
            "web-search": "none",
        });
        expect(
            await checker.check({
                ...input,
                toolId: "builtin:web-search",
                toolName: "web-search",
                input: { query: "hi" },
            }),
        ).toEqual({ required: false });
        expect(calls).toHaveLength(0);
    });

    it("always gates prompt-policy builtins with a generic request", async () => {
        const { checker } = makeChecker(new Error("must not be called"), {
            addMcpServer: "prompt",
        });
        expect(
            await checker.check({
                ...input,
                toolId: "builtin:addMcpServer",
                toolName: "addMcpServer",
                input: { name: "kb" },
            }),
        ).toEqual({
            required: true,
            request: {
                kind: "tool",
                toolId: "builtin:addMcpServer",
                toolName: "addMcpServer",
            },
        });
    });

    it("gates composio-execute with a toolkit/tool request", async () => {
        const { checker } = makeChecker(new Error("must not be called"), {
            "composio-execute-tool": "composio-execute",
        });
        expect(
            await checker.check({
                ...input,
                toolId: "builtin:composio-execute-tool",
                toolName: "composio-execute-tool",
                input: {
                    toolkitSlug: "gmail",
                    toolSlug: "GMAIL_SEND_EMAIL",
                    arguments: { to: "a@b.c" },
                },
            }),
        ).toEqual({
            required: true,
            request: {
                kind: "composio",
                toolkitSlug: "gmail",
                toolSlug: "GMAIL_SEND_EMAIL",
            },
        });
    });

    it("gates composio-execute with malformed input via the generic request", async () => {
        const { checker } = makeChecker(new Error("must not be called"), {
            "composio-execute-tool": "composio-execute",
        });
        expect(
            await checker.check({
                ...input,
                toolId: "builtin:composio-execute-tool",
                toolName: "composio-execute-tool",
                input: { nonsense: true },
            }),
        ).toEqual({
            required: true,
            request: {
                kind: "tool",
                toolId: "builtin:composio-execute-tool",
                toolName: "composio-execute-tool",
            },
        });
    });

    it("gates executeMcpTool with a server/tool request", async () => {
        const { checker } = makeChecker(new Error("must not be called"), {
            executeMcpTool: "mcp-execute",
        });
        expect(
            await checker.check({
                ...input,
                toolId: "builtin:executeMcpTool",
                toolName: "executeMcpTool",
                input: { serverName: "kb", toolName: "search", arguments: {} },
            }),
        ).toEqual({
            required: true,
            request: { kind: "mcp", serverName: "kb", toolName: "search" },
        });
    });

    it("gates mcp:* attachments on user agents", async () => {
        const { checker, calls } = makeChecker(new Error("must not be called"));
        expect(
            await checker.check({
                ...input,
                toolId: "mcp:kb:search",
                toolName: "search",
            }),
        ).toEqual({
            required: true,
            request: { kind: "mcp", serverName: "kb", toolName: "search" },
        });
        expect(calls).toHaveLength(0);
    });

    it("fails closed for undeclared builtins and unknown toolId families", async () => {
        const { checker } = makeChecker(new Error("must not be called"), {});
        expect(
            await checker.check({
                ...input,
                toolId: "builtin:brand-new-tool",
                toolName: "brand-new-tool",
            }),
        ).toEqual({
            required: true,
            request: {
                kind: "tool",
                toolId: "builtin:brand-new-tool",
                toolName: "brand-new-tool",
            },
        });
        expect(
            await checker.check({
                ...input,
                toolId: "future:whatever",
                toolName: "whatever",
            }),
        ).toEqual({
            required: true,
            request: {
                kind: "tool",
                toolId: "future:whatever",
                toolName: "whatever",
            },
        });
    });

    it("propagates metadata errors so the loop fails closed", async () => {
        const { checker } = makeChecker(new Error("policy exploded"));
        await expect(checker.check(input)).rejects.toThrowError("policy exploded");
    });
});
