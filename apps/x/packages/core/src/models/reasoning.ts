import type { z } from "zod";
import type { ReasoningEffort } from "@x/shared/dist/models.js";
import type { JsonValue } from "@x/shared/dist/turns.js";

export type ReasoningEffortLevel = z.infer<typeof ReasoningEffort>;

export interface ReasoningRequestOptions {
    providerOptions: Record<string, Record<string, JsonValue>>;
    // Anthropic requires max_tokens to exceed the thinking budget; when the
    // mapping enables a budget it also supplies this floor. The bridge sends
    // max(caller value, floor) so an explicit caller value is never lowered.
    minOutputTokens?: number;
}

// Token budgets for providers that express effort as a thinking budget.
// Values follow the levels other assistants converged on (~8k balanced,
// ~16k thorough); "low" means thinking off where the provider allows it.
const ANTHROPIC_BUDGET = { medium: 8192, high: 16384 } as const;
const GEMINI_25_BUDGET = { low: 2048, medium: 8192, high: 16384 } as const;
const ANTHROPIC_OUTPUT_HEADROOM = 4096;

export function parseReasoningEffort(value: unknown): ReasoningEffortLevel | undefined {
    return value === "low" || value === "medium" || value === "high"
        ? value
        : undefined;
}

/**
 * Map the canonical reasoning effort to provider-specific request options.
 * Transport-only, like prompt caching: persisted turn events carry only the
 * canonical value; this translation happens at invoke time.
 *
 * Returns undefined when nothing should be sent — unsupported flavor, model
 * not known to reason, or a level the model family cannot express. Unknown
 * capability fails closed for strict flavors (OpenAI/Anthropic/Google reject
 * reasoning parameters on non-reasoning models); OpenRouter-shaped flavors
 * (openrouter, rowboat) are forgiving — OpenRouter drops the field for
 * models that cannot reason — so they map unless the model is known-false.
 *
 * Ollama is deliberately absent: its `think` parameter is applied by the
 * provider-level fetch rewrite (models/local.ts), and openai-compatible
 * endpoints have no safe universal parameter.
 */
export function mapReasoningEffort(
    flavor: string,
    modelId: string,
    effort: ReasoningEffortLevel,
    supportsReasoning: boolean | undefined,
): ReasoningRequestOptions | undefined {
    switch (flavor) {
        case "openai": {
            if (supportsReasoning !== true) return undefined;
            return { providerOptions: { openai: { reasoningEffort: effort } } };
        }
        case "anthropic": {
            if (supportsReasoning !== true) return undefined;
            if (effort === "low") {
                return { providerOptions: { anthropic: { thinking: { type: "disabled" } } } };
            }
            const budgetTokens = ANTHROPIC_BUDGET[effort];
            return {
                providerOptions: {
                    anthropic: { thinking: { type: "enabled", budgetTokens } },
                },
                minOutputTokens: budgetTokens + ANTHROPIC_OUTPUT_HEADROOM,
            };
        }
        case "google": {
            if (supportsReasoning !== true) return undefined;
            const id = modelId.toLowerCase();
            if (id.includes("gemini-3")) {
                // Gemini 3 Pro exposes only low/high thinking levels; its
                // default is already deep, so "medium" sends nothing.
                if (id.includes("pro") && effort === "medium") return undefined;
                return {
                    providerOptions: {
                        google: { thinkingConfig: { thinkingLevel: effort } },
                    },
                };
            }
            if (id.includes("gemini-2.5")) {
                return {
                    providerOptions: {
                        google: {
                            thinkingConfig: { thinkingBudget: GEMINI_25_BUDGET[effort] },
                        },
                    },
                };
            }
            // Unknown Gemini generation: don't guess a dialect.
            return undefined;
        }
        case "openrouter":
        case "rowboat": {
            if (supportsReasoning === false) return undefined;
            return { providerOptions: { openrouter: { reasoning: { effort } } } };
        }
        default:
            return undefined;
    }
}
