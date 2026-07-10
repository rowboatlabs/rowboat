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

export async function isGoogleConnected(): Promise<boolean> {
    try {
        const repo = await lazyResolve<import("../../auth/repo.js").IOAuthRepo>("oauthRepo");
        const connection = await repo.read("google");
        return !!connection.tokens;
    } catch {
        return false;
    }
}
