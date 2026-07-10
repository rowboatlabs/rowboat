import { describe, expect, it } from "vitest";
import type { getToolPermissionMetadata } from "../../legacy/engine.js";
import { RealPermissionChecker } from "./real-permission-checker.js";

type MetadataFn = typeof getToolPermissionMetadata;
type MetadataCall = {
    toolCall: Parameters<MetadataFn>[0];
    attachment: Parameters<MetadataFn>[1];
};

function makeChecker(result: Awaited<ReturnType<MetadataFn>> | Error) {
    const calls: MetadataCall[] = [];
    const checker = new RealPermissionChecker({
        getMetadata: (async (toolCall, attachment) => {
            calls.push({ toolCall, attachment });
            if (result instanceof Error) {
                throw result;
            }
            return result;
        }) as MetadataFn,
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

    it("never gates non-builtin tools", async () => {
        const { checker, calls } = makeChecker(new Error("must not be called"));
        expect(
            await checker.check({
                ...input,
                toolId: "mcp:kb:search",
                toolName: "search",
            }),
        ).toEqual({ required: false });
        expect(calls).toHaveLength(0);
    });

    it("propagates metadata errors so the loop fails closed", async () => {
        const { checker } = makeChecker(new Error("policy exploded"));
        await expect(checker.check(input)).rejects.toThrowError("policy exploded");
    });
});
