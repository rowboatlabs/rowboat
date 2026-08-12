import type { z } from "zod";
import type { TurnAnalytics } from "@x/shared/dist/analytics.js";
import type { ModelDescriptor, TurnUsage } from "@x/shared/dist/turns.js";

// Analytics seam for the turn loop: invoked once per completed model call,
// after the durable model_call_completed append. Implementations must never
// throw into the loop and must not block it (fire-and-forget).
export interface ModelUsageReport {
    agentId: string;
    analytics: TurnAnalytics;
    model: z.infer<typeof ModelDescriptor>;
    usage: z.infer<typeof TurnUsage>;
}

export interface IUsageReporter {
    reportModelUsage(report: ModelUsageReport): void;
}

export class NoopUsageReporter implements IUsageReporter {
    reportModelUsage(): void {}
}
