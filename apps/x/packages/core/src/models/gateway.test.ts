import { afterEach, describe, expect, it, vi } from "vitest";
import { withUseCase } from "../analytics/use_case.js";

vi.mock("../auth/tokens.js", () => ({
    getAccessToken: async () => "access-token",
}));

import { authedFetch, listGatewayImageModels } from "./gateway.js";

describe("Rowboat gateway request attribution", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends the complete turn-scoped analytics context", async () => {
        const fetchMock = vi.fn(
            async (
                input: Parameters<typeof fetch>[0],
                init?: Parameters<typeof fetch>[1],
            ) => {
                void input;
                void init;
                return new Response(null, { status: 200 });
            },
        );
        vi.stubGlobal("fetch", fetchMock);

        await withUseCase(
            {
                useCase: "background_task_agent",
                subUseCase: "cron",
                agentName: "background-task-agent",
            },
            () => authedFetch("https://api.example.test/v1/llm/chat/completions"),
        );

        const [, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init?.headers);
        expect(Object.fromEntries(headers.entries())).toMatchObject({
            authorization: "Bearer access-token",
            "x-rowboat-use-case": "background_task_agent",
            "x-rowboat-sub-use-case": "cron",
            "x-rowboat-agent-name": "background-task-agent",
        });
    });
});

describe("listGatewayImageModels", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("hits the image-filtered allowlist with the bearer token and keeps only image-output ids", async () => {
        const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            void input;
            void init;
            return Response.json({
                data: [
                    { id: "google/gemini-2.5-flash-image", architecture: { output_modalities: ["image", "text"] } },
                    // Server-filtered entries without the field are trusted.
                    { id: "bytedance-seed/seedream-4.5" },
                    // Defensive: a text-only entry or a malformed one is dropped.
                    { id: "openai/gpt-5.4", architecture: { output_modalities: ["text"] } },
                    { name: "no-id" },
                    null,
                ],
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(listGatewayImageModels()).resolves.toEqual([
            "google/gemini-2.5-flash-image",
            "bytedance-seed/seedream-4.5",
        ]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/v1\/llm\/models\?output_modalities=image$/);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
    });

    it("yields an empty list for an unexpected body shape, but throws on a failed request", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: "nope" })));
        await expect(listGatewayImageModels()).resolves.toEqual([]);

        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
        await expect(listGatewayImageModels()).rejects.toThrow(/503/);
    });
});
