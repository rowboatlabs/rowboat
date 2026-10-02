import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL = "https://control.test/v1/spaces/token";

async function load() {
    vi.resetModules();
    return import("./spaces-exchange.js");
}

function serve(...tokens: string[]) {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: tokens.shift(), expires_in: 900 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-02T06:00:00Z") }));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("a cloud instance's Spaces token", () => {
    it("is traded with the instance token, once while it lasts", async () => {
        const fetch = serve("jwt-1");
        const { exchangeForSpaces } = await load();
        const [a, b] = await Promise.all([exchangeForSpaces(URL, "inst"), exchangeForSpaces(URL, "inst")]);
        expect([a, b]).toEqual(["jwt-1", "jwt-1"]);
        vi.advanceTimersByTime(13 * 60 * 1000);
        expect(await exchangeForSpaces(URL, "inst")).toBe("jwt-1");
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(URL, { method: "POST", headers: { authorization: "Bearer inst" } });
    });

    it("is traded again a minute before it ends, or when Spaces refused it", async () => {
        serve("jwt-1", "jwt-2", "jwt-3");
        const { exchangeForSpaces } = await load();
        await exchangeForSpaces(URL, "inst");
        vi.advanceTimersByTime(14 * 60 * 1000 + 1);
        expect(await exchangeForSpaces(URL, "inst")).toBe("jwt-2");
        expect(await exchangeForSpaces(URL, "inst", { forceRefresh: true })).toBe("jwt-3");
    });

    it("says why when the trade fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
        const { exchangeForSpaces } = await load();
        await expect(exchangeForSpaces(URL, "inst")).rejects.toThrow("returned 404");
    });
});
