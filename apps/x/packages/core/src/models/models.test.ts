import { afterEach, describe, expect, it, vi } from "vitest";

import { EDENAI_DEFAULT_BASE_URL, listModelsForProvider } from "./models.js";

/**
 * Eden AI's listing contract. The flavor exists for two reasons the generic
 * "openai-compatible" flavor cannot cover: a known default host, and a
 * model list that needs "?view=models" to return routed names instead of
 * one id per provider-pinned endpoint.
 */
describe("listModelsForProvider, edenai", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubModelList(ids: string[]) {
        const fetchMock = vi.fn(
            async (
                input: Parameters<typeof fetch>[0],
                init?: Parameters<typeof fetch>[1],
            ) => {
                void input;
                void init;
                return new Response(
                    JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                );
            },
        );
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("asks for the routed model names and authenticates with the key", async () => {
        const fetchMock = stubModelList(["claude-haiku-5.5", "gemini-4-neon"]);

        const models = await listModelsForProvider({
            flavor: "edenai",
            apiKey: "test-key",
            baseURL: EDENAI_DEFAULT_BASE_URL,
        });

        expect(models).toEqual(["claude-haiku-5.5", "gemini-4-neon"]);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe("https://api.edenai.run/v3/models?view=models");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    });

    it("falls back to the default base URL when the entry carries none", async () => {
        const fetchMock = stubModelList(["claude-haiku-5.5"]);

        await listModelsForProvider({ flavor: "edenai", apiKey: "test-key" });

        expect(fetchMock.mock.calls[0]![0]).toBe("https://api.edenai.run/v3/models?view=models");
    });

    it("does not double the slash when the configured base URL has a trailing one", async () => {
        const fetchMock = stubModelList(["claude-haiku-5.5"]);

        await listModelsForProvider({
            flavor: "edenai",
            apiKey: "test-key",
            baseURL: "https://api.edenai.run/v3/",
        });

        expect(fetchMock.mock.calls[0]![0]).toBe("https://api.edenai.run/v3/models?view=models");
    });
});
