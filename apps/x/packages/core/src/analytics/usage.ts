import { capture } from './posthog.js';
import type { UseCase } from './use_case.js';

// Shape compatible with ai-sdk v5 `LanguageModelUsage`.
// All fields are optional because providers report subsets.
export interface LlmUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface CaptureLlmUsageArgs {
  useCase: UseCase;
  subUseCase?: string;
  agentName?: string;
  model: string;
  provider: string;
  usage: LlmUsageInput | undefined;
}

export function captureLlmUsage(args: CaptureLlmUsageArgs): void {
  // Fire-and-forget: callers pass the provider INSTANCE id (ModelRef
  // .provider); analytics reports the FLAVOR — ids may one day be
  // user-named, and charts must not fracture when "openai-work" appears.
  // Today ids equal flavor keys, so the fallback is lossless.
  void (async () => {
    let provider = args.provider;
    try {
      const { flavorForProviderId } = await import('./model-providers.js');
      provider = await flavorForProviderId(args.provider);
    } catch { /* keep the raw value */ }
    const usage = args.usage ?? {};
    const properties: Record<string, unknown> = {
      use_case: args.useCase,
      model: args.model,
      provider,
      input_tokens: usage.inputTokens ?? 0,
      output_tokens: usage.outputTokens ?? 0,
      total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    };
    if (args.subUseCase) properties.sub_use_case = args.subUseCase;
    if (args.agentName) properties.agent_name = args.agentName;
    if (usage.cachedInputTokens != null) properties.cached_input_tokens = usage.cachedInputTokens;
    if (usage.reasoningTokens != null) properties.reasoning_tokens = usage.reasoningTokens;
    capture('llm_usage', properties);
  })();
}
