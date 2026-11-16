import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getToolkit: vi.fn(), listAuthConfigs: vi.fn(), createAuthConfig: vi.fn(), linkConnectedAccount: vi.fn(), getConnectedAccount: vi.fn(),
    isConnected: vi.fn(), saveAccount: vi.fn(), updateAccountStatus: vi.fn(), publish: vi.fn(), openExternalUrl: vi.fn(), close: vi.fn(), invalidate: vi.fn(),
    openLoopback: vi.fn(), triggerGmailSync: vi.fn(), triggerCalendarSync: vi.fn(),
}));
vi.mock("./client.js", () => ({ getToolkit: mocks.getToolkit, listAuthConfigs: mocks.listAuthConfigs, createAuthConfig: mocks.createAuthConfig, linkConnectedAccount: mocks.linkConnectedAccount, getConnectedAccount: mocks.getConnectedAccount }));
vi.mock("./repo.js", () => ({ composioAccountsRepo: { isConnected: mocks.isConnected, saveAccount: mocks.saveAccount, updateAccountStatus: mocks.updateAccountStatus } }));
vi.mock("../auth/url-opener.js", () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock("../auth/connector-events.js", () => ({ composioConnectBus: { publish: mocks.publish } }));
vi.mock("../auth/loopback-server.js", () => ({ openLoopback: mocks.openLoopback }));
vi.mock("../runtime/assembly/copilot/instructions.js", () => ({ invalidateCopilotInstructionsCache: mocks.invalidate }));
vi.mock("../knowledge/sync_gmail.js", () => ({ triggerSync: mocks.triggerGmailSync }));
vi.mock("../knowledge/sync_calendar.js", () => ({ triggerSync: mocks.triggerCalendarSync }));
import { initiateConnection } from "./flows.js";

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.isConnected.mockReturnValue(false);
    mocks.getToolkit.mockResolvedValue({ composio_managed_auth_schemes: ["OAUTH2"] });
    mocks.listAuthConfigs.mockResolvedValue({ items: [{ id: "ac_1", auth_scheme: "OAUTH2", is_composio_managed: true }] });
    mocks.linkConnectedAccount.mockResolvedValue({ link_token: "lt_secret", connected_account_id: "ca_1", redirect_url: "https://connect.composio.dev/link", expires_at: "2026-11-11T12:10:00Z" });
    mocks.openLoopback.mockResolvedValue({ close: mocks.close });
    mocks.getConnectedAccount.mockResolvedValue({ status: "ACTIVE" });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function completeCallback() {
    const callback = mocks.openLoopback.mock.calls.at(-1)![1] as () => Promise<void>;
    await callback();
}
describe("Composio OAuth flow", () => {
    it("uses redirect_url and connected_account_id through callback completion", async () => {
        const result = await initiateConnection("gmail");
        expect(mocks.linkConnectedAccount).toHaveBeenCalledWith({ auth_config_id: "ac_1", user_id: "rowboat-user", callback_url: "http://localhost:8081/oauth/callback" });
        expect(result).toEqual({ success: true, redirectUrl: "https://connect.composio.dev/link", connectedAccountId: "ca_1" });
        expect(mocks.openExternalUrl).toHaveBeenCalledWith(result.redirectUrl);
        expect(mocks.saveAccount).toHaveBeenCalledWith(expect.objectContaining({ id: "ca_1", authConfigId: "ac_1", status: "INITIATED" }));
        await completeCallback();
        expect(mocks.getConnectedAccount).toHaveBeenCalledWith("ca_1");
        expect(mocks.publish).toHaveBeenCalledWith({ toolkitSlug: "gmail", success: true });
        expect(mocks.triggerGmailSync).toHaveBeenCalled();
        expect(mocks.close).toHaveBeenCalled();
    });
    it("creates a missing managed auth config before generating the link", async () => {
        mocks.listAuthConfigs.mockResolvedValueOnce({ items: [] });
        mocks.createAuthConfig.mockResolvedValueOnce({ auth_config: { id: "ac_new" } });
        await initiateConnection("googlecalendar");
        expect(mocks.linkConnectedAccount).toHaveBeenCalledWith(expect.objectContaining({ auth_config_id: "ac_new" }));
        await completeCallback();
        expect(mocks.triggerCalendarSync).toHaveBeenCalled();
    });
    it("skips links for connected services", async () => {
        mocks.isConnected.mockReturnValue(true);
        expect(await initiateConnection("gmail")).toEqual({ success: true });
        expect(mocks.linkConnectedAccount).not.toHaveBeenCalled();
    });
    it("reports link failure without saving an account or opening the browser", async () => {
        mocks.linkConnectedAccount.mockRejectedValueOnce(new Error("Composio unavailable"));
        expect(await initiateConnection("gmail")).toEqual({ success: false, error: "Composio unavailable" });
        expect(mocks.saveAccount).not.toHaveBeenCalled();
        expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    });
    it("reports a revoked account after callback", async () => {
        mocks.getConnectedAccount.mockResolvedValueOnce({ status: "REVOKED" });
        await initiateConnection("gmail");
        await completeCallback();
        expect(mocks.publish).toHaveBeenCalledWith({ toolkitSlug: "gmail", success: false, error: "Connection status: REVOKED" });
        expect(mocks.triggerGmailSync).not.toHaveBeenCalled();
    });
});
