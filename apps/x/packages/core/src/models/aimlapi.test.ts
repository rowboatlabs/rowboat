import { afterEach, describe, expect, it, vi } from "vitest";
import { AIMLAPI_BASE_URL, AIMLAPI_PARTNER_ID, aimlapiRequestHeaders, parseAimlapiChatModelIds } from "./aimlapi.js";
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

describe("aimlapiRequestHeaders", () => {
    it("sends the calling app's identity, not the provider's", () => {
        // HTTP-Referer / X-Title are OpenRouter's convention and name the
        // app making the call — Rowboat. Getting this backwards makes the
        // analytics on the other side useless.
        const headers = aimlapiRequestHeaders({});
        expect(headers).toMatchObject({
            "HTTP-Referer": "https://github.com/rowboatlabs/rowboat",
            "X-Title": "Rowboat",
            "X-AIMLAPI-Source": "agent/rowboat",
        });
    });

    it("keeps the partner id well-formed, or absent", () => {
        // A malformed id is dropped by the receiving service without an
        // error, so the request succeeds and the attribution vanishes. This
        // assertion is the only thing that would catch a typo in it.
        expect(AIMLAPI_PARTNER_ID === "" || /^part_[A-Za-z0-9]{1,64}$/.test(AIMLAPI_PARTNER_ID)).toBe(true);
        const headers = aimlapiRequestHeaders({}) ?? {};
        if (AIMLAPI_PARTNER_ID === "") {
            expect(headers).not.toHaveProperty("X-AIMLAPI-Partner-ID");
        } else {
            expect(headers["X-AIMLAPI-Partner-ID"]).toBe(AIMLAPI_PARTNER_ID);
        }
    });

    it("never attaches attribution to another origin", () => {
        // A provider entry can be pointed at a proxy or a compatible peer.
        // Attribution must not ride to someone else's service.
        const own = { "X-Custom": "mine" };
        expect(aimlapiRequestHeaders({ baseURL: "https://proxy.example/v1", headers: own })).toEqual(own);
        expect(aimlapiRequestHeaders({ baseURL: "https://proxy.example/v1" })).toBeUndefined();
        expect(aimlapiRequestHeaders({ baseURL: "not a url" })).toBeUndefined();
    });

    it("still attributes a path override on our own origin", () => {
        expect(aimlapiRequestHeaders({ baseURL: "https://api.aimlapi.com/v2" }))
            .toHaveProperty("X-AIMLAPI-Source", "agent/rowboat");
    });

    it("merges rather than assigns — a user's header wins", () => {
        const headers = aimlapiRequestHeaders({ headers: { "X-Title": "My Fork", "X-Extra": "1" } });
        expect(headers).toMatchObject({ "X-Title": "My Fork", "X-Extra": "1" });
        expect(headers).toHaveProperty("X-AIMLAPI-Source", "agent/rowboat");
    });

    it("builds a fresh object per call and never mutates the shared defaults", () => {
        const first = aimlapiRequestHeaders({}) as Record<string, string>;
        first["X-Title"] = "mutated";
        const second = aimlapiRequestHeaders({}) as Record<string, string>;
        expect(second).not.toBe(first);
        expect(second["X-Title"]).toBe("Rowboat");
    });
});
