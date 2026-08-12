import { describe, expect, it, vi } from "vitest";
import type { CaptureLlmUsageArgs } from "../../../analytics/usage.js";
import { RealUsageReporter } from "./real-usage-reporter.js";

describe("RealUsageReporter", () => {
    it("reports the durable turn attribution without consulting ambient context", () => {
        const capture = vi.fn<(args: CaptureLlmUsageArgs) => void>();
        const reporter = new RealUsageReporter({ capture });

        reporter.reportModelUsage({
            agentId: "live-note-agent",
            analytics: {
                useCase: "live_note_agent",
                subUseCase: "cron",
            },
            model: {
                provider: "rowboat",
                model: "google/gemini-3.5-flash",
            },
            usage: {
                inputTokens: 12,
                outputTokens: 4,
                totalTokens: 16,
            },
        });

        expect(capture).toHaveBeenCalledWith({
            useCase: "live_note_agent",
            subUseCase: "cron",
            agentName: "live-note-agent",
            provider: "rowboat",
            model: "google/gemini-3.5-flash",
            usage: {
                inputTokens: 12,
                outputTokens: 4,
                totalTokens: 16,
            },
        });
    });
});
