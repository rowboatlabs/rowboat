import { describe, expect, it } from "vitest";
import type { classifyToolPermissions } from "../../security/auto-permission-classifier.js";
import { RealPermissionClassifier } from "./real-permission-classifier.js";

type ClassifierFn = typeof classifyToolPermissions;
type ClassifierInput = Parameters<ClassifierFn>[0];

function makeClassifier(
    decisions: Awaited<ReturnType<ClassifierFn>> | Error,
) {
    const calls: ClassifierInput[] = [];
    const classifier = new RealPermissionClassifier({
        classifier: (async (input) => {
            calls.push(input);
            if (decisions instanceof Error) {
                throw decisions;
            }
            return decisions;
        }) as ClassifierFn,
    });
    return { classifier, calls };
}

const batch = {
    turnId: "turn-1",
    messages: [
        { role: "user" as const, content: "list my downloads" },
        { role: "assistant" as const, content: "sure" },
    ],
    requests: [
        {
            toolCallId: "tc-1",
            toolName: "file-list",
            input: { path: "/Users/me/Downloads" },
            request: {
                kind: "file",
                operation: "list",
                paths: ["/Users/me/Downloads"],
                pathPrefix: "/Users/me/Downloads",
            },
        },
    ],
};

describe("RealPermissionClassifier", () => {
    it("adapts the batch into classifyToolPermissions candidates with conversation context", async () => {
        const { classifier, calls } = makeClassifier([
            { toolCallId: "tc-1", decision: "allow", reason: "user asked for it" },
        ]);
        const decisions = await classifier.classify(batch);

        expect(decisions).toEqual([
            { toolCallId: "tc-1", decision: "allow", reason: "user asked for it" },
        ]);
        expect(calls[0].runId).toBe("turn-1");
        expect(calls[0].useCase).toBe("copilot_chat");
        expect(calls[0].messages).toHaveLength(2);
        expect(calls[0].candidates[0]).toMatchObject({
            toolCall: {
                type: "tool-call",
                toolCallId: "tc-1",
                toolName: "file-list",
            },
            permission: { kind: "file", operation: "list" },
        });
    });

    it("returns an empty result for an empty batch without calling the LLM", async () => {
        const { classifier, calls } = makeClassifier(new Error("must not be called"));
        expect(
            await classifier.classify({ ...batch, requests: [] }),
        ).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it("omitted decisions surface as missing entries (loop treats them as defer)", async () => {
        const { classifier } = makeClassifier([]);
        const decisions = await classifier.classify(batch);
        expect(decisions).toEqual([]);
    });

    it("propagates classifier failures (loop normalizes to defer)", async () => {
        const { classifier } = makeClassifier(new Error("llm unavailable"));
        await expect(classifier.classify(batch)).rejects.toThrowError(
            "llm unavailable",
        );
    });

    it("rejects malformed permission metadata via schema parsing", async () => {
        const { classifier } = makeClassifier([]);
        await expect(
            classifier.classify({
                ...batch,
                requests: [{ ...batch.requests[0], request: { kind: "nonsense" } }],
            }),
        ).rejects.toThrowError();
    });
});
