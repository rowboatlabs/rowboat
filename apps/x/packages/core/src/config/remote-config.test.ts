import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cache is module state: each test loads a fresh copy.
async function load() {
    vi.resetModules();
    return import("./remote-config.js");
}

function serve(...configs: Array<Record<string, unknown>>) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(configs.shift() ?? {}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-02T06:00:00Z") }));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("the api's config", () => {
    it("is asked once while fresh", async () => {
        const fetch = serve({ appUrl: "https://app.test" });
        const { getRemoteConfig } = await load();
        await Promise.all([getRemoteConfig(), getRemoteConfig()]);
        vi.advanceTimersByTime(5 * 60 * 1000);
        await getRemoteConfig();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("is asked again later, so a process that slept sees Spaces turned on", async () => {
        serve({ appUrl: "https://app.test", spacesApexUrl: null }, { appUrl: "https://app.test", spacesApexUrl: "https://spaces.test" });
        const { getRemoteConfig } = await load();
        expect((await getRemoteConfig()).spacesApexUrl).toBeNull();
        vi.advanceTimersByTime(11 * 60 * 1000);
        expect((await getRemoteConfig()).spacesApexUrl).toBe("https://spaces.test");
    });

    it("is asked again right after a failure", async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response("", { status: 502 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ appUrl: "https://app.test" }), { status: 200 }));
        vi.stubGlobal("fetch", fetch);
        const { getRemoteConfig } = await load();
        await expect(getRemoteConfig()).rejects.toThrow("502");
        expect((await getRemoteConfig()).appUrl).toBe("https://app.test");
    });
});
