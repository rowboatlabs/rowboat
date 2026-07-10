import { captureLlmUsage } from "../../../analytics/usage.js";
import { getCurrentUseCase } from "../../../analytics/use_case.js";
import type { IUsageReporter, ModelUsageReport } from "../usage-reporter.js";

// Reports each completed model call as the same `llm_usage` PostHog event
// the old run loop emitted. The use case comes from the AsyncLocalStorage
// context the caller established (headless runners wrap startHeadlessAgent
// in withUseCase); UI-driven session turns have no context and default to
// copilot_chat — matching the old createRun default.
export class RealUsageReporter implements IUsageReporter {
    reportModelUsage(report: ModelUsageReport): void {
        const context = getCurrentUseCase();
        captureLlmUsage({
            useCase: context?.useCase ?? "copilot_chat",
            ...(context?.subUseCase ? { subUseCase: context.subUseCase } : {}),
            agentName: report.agentId,
            model: report.model.model,
            provider: report.model.provider,
            usage: report.usage,
        });
    }
}
