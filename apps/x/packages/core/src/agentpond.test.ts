import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

it("keeps AgentPond tracing disabled without a Files SDK provider", async () => {
    vi.stubEnv("FILES_SDK_PROVIDER", "");
    const { agentPondTelemetry } = await import("./agentpond.js");

    expect(agentPondTelemetry).toBeUndefined();
});
