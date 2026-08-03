import { captureLlmUsage } from "../../../analytics/usage.js";
import type { IUsageReporter, ModelUsageReport } from "../usage-reporter.js";

export interface RealUsageReporterDependencies {
    capture?: typeof captureLlmUsage;
}

// Reports each completed model call from the attribution persisted on its
// turn. It deliberately does not consult ambient async context: resumes and
// external-input advances must report exactly what turn_created recorded.
export class RealUsageReporter implements IUsageReporter {
    private readonly capture: typeof captureLlmUsage;

    constructor(deps: RealUsageReporterDependencies = {}) {
        this.capture = deps.capture ?? captureLlmUsage;
    }

    reportModelUsage(report: ModelUsageReport): void {
        this.capture({
            useCase: report.analytics.useCase,
            ...(report.analytics.subUseCase
                ? { subUseCase: report.analytics.subUseCase }
                : {}),
            agentName: report.agentId,
            model: report.model.model,
            provider: report.model.provider,
            usage: report.usage,
        });
    }
}
