import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Composio through the account's api only when that api serves it (Baarali,
// 2026-10-02): Baarali's says `composio: false`, and then a signed-in app
// with no key of its own is simply not configured — never a call that 404s.

process.env.ROWBOAT_WORKDIR = mkdtempSync(path.join(tmpdir(), "composio-test-"));

const state = { signedIn: true, composio: false };
vi.mock("../account/account.js", () => ({ isSignedIn: async () => state.signedIn }));
vi.mock("../auth/tokens.js", () => ({ getAccessToken: async () => "account-token" }));
vi.mock("../config/remote-config.js", () => ({ getRemoteConfig: async () => ({ composio: state.composio }) }));

beforeEach(() => {
    delete process.env.COMPOSIO_API_KEY;
});
afterEach(() => vi.unstubAllGlobals());

function capture() {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), headers: init.headers as Record<string, string> });
        return new Response(JSON.stringify({ items: [], next_cursor: null, total_pages: 1, current_page: 1, total_items: 0 }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }));
    return calls;
}

describe("where Composio is reached", () => {
    it("is not configured when the api does not serve it and the user has no key", async () => {
        const { isConfigured } = await import("./client.js");
        state.composio = false;
        expect(await isConfigured()).toBe(false);
    });

    it("goes straight to Composio with the user's own key when the api does not serve it", async () => {
        const { isConfigured, listToolkits } = await import("./client.js");
        state.composio = false;
        process.env.COMPOSIO_API_KEY = "own-key";
        expect(await isConfigured()).toBe(true);
        const calls = capture();
        await listToolkits().catch(() => undefined);
        expect(calls[0]!.url).toMatch(/^https:\/\/backend\.composio\.dev\/api\/v3\/toolkits/);
        expect(calls[0]!.headers["x-api-key"]).toBe("own-key");
    });

    it("goes through the account's api when it serves Composio", async () => {
        const { isConfigured, listToolkits } = await import("./client.js");
        state.composio = true;
        expect(await isConfigured()).toBe(true);
        const calls = capture();
        await listToolkits().catch(() => undefined);
        expect(calls[0]!.url).toContain("/v1/composio/toolkits");
        expect(calls[0]!.headers.Authorization).toBe("Bearer account-token");
    });
});
