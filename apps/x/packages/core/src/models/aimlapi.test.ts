import { afterEach, describe, expect, it, vi } from "vitest";
import { AIMLAPI_BASE_URL, parseAimlapiChatModelIds } from "./aimlapi.js";
import { listModelsForProvider } from "./models.js";

/**
 * The aimlapi.com flavor's whole reason to exist is reading a catalog that
 * describes every endpoint the account can reach, not just chat. These tests
 * pin the filter, the de-duplication, and — most importantly — the two
 * fail-open rules, because the failure this guards against (a renamed type
 * string emptying the model picker) is silent and has happened before in
 * other clients of this API.
 */

const CHAT = "openai/chat-completions";

/** A catalog body shaped exactly like the live one, in miniature. */
function catalog(entries: Array<Record<string, unknown>>) {
    return { object: "list", data: entries };
}

describe("parseAimlapiChatModelIds", () => {
    it("keeps chat models and drops every other endpoint type", () => {
        const ids = parseAimlapiChatModelIds(catalog([
            { id: "openai/gpt-4.1-mini", type: CHAT },
            { id: "google/veo-3", type: "internal/video-generations/submit" },
            { id: "openai/gpt-image-1", type: "openai/image-generations" },
            { id: "anthropic/claude-sonnet-4.5", type: CHAT },
            { id: "openai/text-embedding-3-large", type: "openai/embeddings" },
            { id: "openai/gpt-5-1-codex", type: "openai/responses/submit" },
        ]));
        expect(ids).toEqual(["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.5"]);
    });

    it("de-duplicates ids served by more than one endpoint", () => {
        // Live today for 91 ids: the same model is published as both a
        // chat-completions and a responses entry. Ids are picker keys.
        const ids = parseAimlapiChatModelIds(catalog([
            { id: "openai/gpt-4.1-mini", type: CHAT },
            { id: "openai/gpt-4.1-mini", type: "openai/responses/submit" },
            { id: "openai/gpt-4.1-mini", type: CHAT },
        ]));
        expect(ids).toEqual(["openai/gpt-4.1-mini"]);
    });

    it("preserves the provider's own ordering and curates nothing", () => {
        const ids = parseAimlapiChatModelIds(catalog([
            { id: "z-last", type: CHAT },
            { id: "a-first", type: CHAT },
            { id: "m-middle", type: CHAT },
        ]));
        expect(ids).toEqual(["z-last", "a-first", "m-middle"]);
    });

    it("keeps entries that carry no type at all", () => {
        const ids = parseAimlapiChatModelIds(catalog([
            { id: "untyped-model" },
            { id: "typed-chat", type: CHAT },
        ]));
        expect(ids).toEqual(["untyped-model", "typed-chat"]);
    });

    it("falls back to the unfiltered list when the type vocabulary changes", () => {
        // The discriminator has been renamed before. A picker showing a
        // longer list is recoverable; one showing nothing looks like an
        // outage and is what this branch exists to prevent.
        const ids = parseAimlapiChatModelIds(catalog([
            { id: "some/model", type: "chat-completion" },
            { id: "other/model", type: "chat-completion" },
        ]));
        expect(ids).toEqual(["some/model", "other/model"]);
    });

    it("returns nothing for a bare array or a missing envelope", () => {
        // The response is { object, data: [...] }, never a bare array —
        // assuming otherwise is how this catalog has broken clients before.
        expect(parseAimlapiChatModelIds([{ id: "x", type: CHAT }])).toEqual([]);
        expect(parseAimlapiChatModelIds({})).toEqual([]);
        expect(parseAimlapiChatModelIds(null)).toEqual([]);
    });

    it("skips entries whose id is missing or not a string", () => {
        const ids = parseAimlapiChatModelIds(catalog([
            { type: CHAT },
            { id: "", type: CHAT },
            { id: 42, type: CHAT },
            { id: "good/model", type: CHAT },
        ]));
        expect(ids).toEqual(["good/model"]);
    });
});

describe("listModelsForProvider (aimlapi)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubFetch(body: unknown) {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => body,
        } as unknown as Response));
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("lists the hosted catalog with the key, and filters it", async () => {
        const fetchMock = stubFetch(catalog([
            { id: "openai/gpt-4.1-mini", type: CHAT },
            { id: "openai/gpt-4.1-mini", type: "openai/responses/submit" },
            { id: "google/veo-3", type: "internal/video-generations/submit" },
        ]));
        const models = await listModelsForProvider({ flavor: "aimlapi", apiKey: "k" });
        expect(models).toEqual(["openai/gpt-4.1-mini"]);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${AIMLAPI_BASE_URL}/models`);
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    });

    it("uses the hosted default when the entry carries no base URL", async () => {
        const fetchMock = stubFetch(catalog([]));
        await listModelsForProvider({ flavor: "aimlapi", apiKey: "k" });
        expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${AIMLAPI_BASE_URL}/models`);
    });

    it("honours an overridden base URL and trims its trailing slash", async () => {
        const fetchMock = stubFetch(catalog([]));
        await listModelsForProvider({ flavor: "aimlapi", apiKey: "k", baseURL: "https://proxy.example/v1/" });
        expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://proxy.example/v1/models");
    });

    it("omits the Authorization header when no key is configured", async () => {
        const fetchMock = stubFetch(catalog([]));
        await listModelsForProvider({ flavor: "aimlapi" });
        const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
        expect(init.headers).not.toHaveProperty("Authorization");
    });
});
