import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NoObjectGeneratedError } from "ai";
import type { LanguageModel } from "ai";
import { generateObjectSafe } from "./structured.js";

const Schema = z.object({ ids: z.array(z.string()) });

// A minimal LanguageModelV2 double whose doGenerate returns the given texts
// in sequence. generateObject parses the text against the schema itself, so
// malformed text surfaces as NoObjectGeneratedError — exactly the local-model
// failure mode generateObjectSafe exists to absorb.
function fakeModel(responses: string[]): LanguageModel {
    let call = 0;
    return {
        specificationVersion: "v2",
        provider: "fake",
        modelId: "fake-model",
        supportedUrls: {},
        doGenerate: async () => {
            const text = responses[Math.min(call++, responses.length - 1)];
            return {
                content: [{ type: "text" as const, text }],
                finishReason: "stop" as const,
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                warnings: [],
            };
        },
        doStream: async () => {
            throw new Error("not used");
        },
    } as unknown as LanguageModel;
}

describe("generateObjectSafe", () => {
    it("passes through a clean structured response", async () => {
        const result = await generateObjectSafe({
            model: fakeModel(['{"ids":["a","b"]}']),
            prompt: "p",
            schema: Schema,
        });
        expect(result.object).toEqual({ ids: ["a", "b"] });
        expect(result.usage?.totalTokens).toBe(2);
    });

    it("salvages JSON wrapped in prose and think blocks", async () => {
        const result = await generateObjectSafe({
            model: fakeModel([
                '<think>hmm {"ids":["x"]} maybe</think>Sure! Here you go:\n```json\n{"ids":["note-1","note-2"]}\n```\nLet me know!',
            ]),
            prompt: "p",
            schema: Schema,
        });
        expect(result.object).toEqual({ ids: ["note-1", "note-2"] });
    });

    it("retries once with a reinforced instruction when enabled", async () => {
        const result = await generateObjectSafe({
            model: fakeModel(["I cannot answer in JSON, sorry!", '{"ids":[]}']),
            prompt: "p",
            schema: Schema,
            retry: true,
        });
        expect(result.object).toEqual({ ids: [] });
    });

    it("throws the original error when salvage and retry both fail", async () => {
        await expect(
            generateObjectSafe({
                model: fakeModel(["not json at all"]),
                prompt: "p",
                schema: Schema,
                retry: true,
            }),
        ).rejects.toSatisfy((error: unknown) => NoObjectGeneratedError.isInstance(error));
    });

    it("does not retry when retry is disabled", async () => {
        await expect(
            generateObjectSafe({
                model: fakeModel(["nope", '{"ids":[]}']),
                prompt: "p",
                schema: Schema,
            }),
        ).rejects.toSatisfy((error: unknown) => NoObjectGeneratedError.isInstance(error));
    });
});
