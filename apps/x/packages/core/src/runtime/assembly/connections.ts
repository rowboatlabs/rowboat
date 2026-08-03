// Connection-state checks shared by skill availability (catalog visibility)
// and copilot prompt composition (connection-specific blocks). One source of
// truth per fact — the "is Slack connected" rule must never fork between the
// catalog and the prompt. Repos resolve lazily so this module adds no static
// DI edge; any failure reads as "not connected" (the historical default).
import { lazyResolve } from "../../di/lazy-resolve.js";

export async function isComposioAvailable(): Promise<boolean> {
    try {
        const { isConfigured } = await import("../../composio/client.js");
        return await isConfigured();
    } catch {
        return false;
    }
}

export async function isCodeModeAvailable(): Promise<boolean> {
    try {
        const repo = await lazyResolve<import("../../code-mode/repo.js").ICodeModeConfigRepo>("codeModeConfigRepo");
        return (await repo.getConfig()).enabled;
    } catch {
        return false;
    }
}

export async function isSlackAvailable(): Promise<boolean> {
    try {
        const repo = await lazyResolve<import("../../slack/repo.js").ISlackConfigRepo>("slackConfigRepo");
        const config = await repo.getConfig();
        return config.enabled && config.workspaces.length > 0;
    } catch {
        return false;
    }
}

// The email fact lives with the email code — knowledge/email/active-provider.ts
// is the single source of "which mailbox is connected" (also consumed by the
// email dispatcher and the main-process OAuth handler). Re-exported here so
// assembly keeps one import home for connection facts.
export { getActiveEmailProviderId } from "../../knowledge/email/active-provider.js";
