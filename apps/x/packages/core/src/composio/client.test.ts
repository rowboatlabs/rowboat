import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signedIn: vi.fn(), token: vi.fn(), fetch: vi.fn() }));
vi.mock("../config/config.js", () => ({ WorkDir: "/private/tmp/rowboat-composio-client-test-unused" }));
vi.mock("../config/env.js", () => ({ API_URL: "https://rowboat.example" }));
vi.mock("../account/account.js", () => ({ isSignedIn: mocks.signedIn }));
vi.mock("../auth/tokens.js", () => ({ getAccessToken: mocks.token }));
import { executeAction, getConnectedAccount, linkConnectedAccount, searchTools } from "./client.js";

const link = { link_token: "lt_secret", redirect_url: "https://connect.composio.dev/link", connected_account_id: "ca_1", expires_at: "2026-11-11T12:10:00Z" };
function outbound() {
    const [url, options] = mocks.fetch.mock.calls[0] as [URL, RequestInit];
    return { url, options, body: options.body ? JSON.parse(String(options.body)) : undefined };
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("COMPOSIO_API_KEY", "personal-key");
    mocks.signedIn.mockResolvedValue(false);
    mocks.token.mockResolvedValue("user-jwt");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Composio HTTP client", () => {
    it.each([false, true])("uses the /link contract when signedIn=%s", async signedIn => {
        mocks.signedIn.mockResolvedValue(signedIn);
        mocks.fetch.mockResolvedValueOnce(Response.json(link));
        const body = { auth_config_id: "ac_1", user_id: "rowboat-user", callback_url: "http://localhost:8081/oauth/callback" };
        expect(await linkConnectedAccount(body)).toEqual(link);
        expect(outbound().url.href).toBe(signedIn ? "https://rowboat.example/v1/composio/connected_accounts/link" : "https://backend.composio.dev/api/v3.1/connected_accounts/link");
        expect(outbound().body).toEqual(body);
        expect(outbound().options.headers).toEqual(signedIn ? { Authorization: "Bearer user-jwt", "Content-Type": "application/json" } : { "x-api-key": "personal-key", "Content-Type": "application/json" });
    });
    it("discovers latest schemas across multiple toolkits with an omitted terminal cursor", async () => {
        mocks.fetch.mockResolvedValueOnce(Response.json({ items: [{ slug: "GMAIL_SEND_EMAIL", name: "Send", description: "Send mail", toolkit: { slug: "gmail", name: "Gmail", logo: "logo" }, input_parameters: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] } }], current_page: 1, total_pages: 1, total_items: 1 }));
        const result = await searchTools("send", ["gmail", "slack"]);
        expect(outbound().url.searchParams.get("toolkit_versions")).toBe("latest");
        expect(outbound().url.searchParams.get("toolkit_slug")).toBe("gmail,slack");
        expect(result.items[0].inputParameters.required).toEqual(["subject"]);
    });
    it.each([true, false])("preserves tool-level successful=%s results and explicit versions", async successful => {
        const result = { successful, data: {}, error: successful ? null : "Missing permission" };
        mocks.fetch.mockResolvedValueOnce(Response.json(result));
        expect(await executeAction("GMAIL_SEND_EMAIL", { connected_account_id: "ca_1", version: "20261101_00", arguments: {} })).toEqual(result);
        expect(outbound().body.version).toBe("20261101_00");
        expect(outbound().url.pathname).toBe("/api/v3.1/tools/execute/GMAIL_SEND_EMAIL");
    });
    it("accepts REVOKED connections", async () => {
        mocks.fetch.mockResolvedValueOnce(Response.json({ id: "ca_1", status: "REVOKED", toolkit: { slug: "gmail" }, auth_config: { id: "ac_1", is_composio_managed: true, is_disabled: false } }));
        expect((await getConnectedAccount("ca_1")).status).toBe("REVOKED");
    });
    it.each([200, 429])("surfaces structured errors with HTTP status %s without requiring legacy error_code", async status => {
        mocks.fetch.mockResolvedValueOnce(Response.json({ error: { code: 1001, slug: "RateLimit", status: 429, message: "Slow down" } }, { status }));
        await expect(searchTools("send")).rejects.toThrow("Slow down");
    });
});
