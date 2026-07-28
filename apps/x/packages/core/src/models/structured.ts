import {
    generateObject,
    NoObjectGeneratedError,
    type LanguageModel,
    type LanguageModelUsage,
} from "ai";
import type { z } from "zod";
import { PrefixLogger } from "@x/shared";

const log = new PrefixLogger("StructuredOutput");

const NO_JSON = Symbol("no-json");

export interface GenerateObjectSafeOptions<T> {
    model: LanguageModel;
    system?: string;
    prompt: string;
    schema: z.ZodType<T>;
    /**
     * Retry once with a reinforced JSON-only instruction when the first
     * attempt produces unparseable output. Local/small models miss strict
     * schema output far more often than frontier models, so callers that may
     * run on a local model should enable this.
     */
    retry?: boolean;
}

export interface GenerateObjectSafeResult<T> {
    object: T;
    usage?: LanguageModelUsage;
}

/**
 * generateObject with degradation paths for models that can't reliably emit
 * strict JSON: (1) salvage a schema-valid JSON value out of the raw response
 * text (small models wrap JSON in prose, fences, or <think> blocks), then
 * (2) optionally retry once with a reinforced instruction. Throws the
 * original error when nothing works, so callers' failure handling is
 * unchanged.
 */
export async function generateObjectSafe<T>(
    options: GenerateObjectSafeOptions<T>,
): Promise<GenerateObjectSafeResult<T>> {
    try {
        const result = await generateObject({
            model: options.model,
            ...(options.system ? { instructions: options.system } : {}),
            prompt: options.prompt,
            schema: options.schema,
        });
        return { object: result.object, usage: result.usage };
    } catch (error) {
        const salvaged = salvage(error, options.schema);
        if (salvaged) {
            log.log("salvaged schema-valid JSON from a malformed response");
            return salvaged;
        }
        if (!options.retry) {
            throw error;
        }
        log.log(
            `first attempt failed (${error instanceof Error ? error.message : String(error)}); retrying with reinforced JSON instruction`,
        );
        try {
            const system = [
                options.system ?? "",
                "Return ONLY a single valid JSON value that matches the requested schema. No prose, no markdown fences, no explanations.",
            ].join("\n\n").trim();
            const result = await generateObject({
                model: options.model,
                instructions: system,
                prompt: options.prompt,
                schema: options.schema,
            });
            return { object: result.object, usage: result.usage };
        } catch (retryError) {
            const retrySalvaged = salvage(retryError, options.schema);
            if (retrySalvaged) {
                log.log("salvaged schema-valid JSON from the retry response");
                return retrySalvaged;
            }
            throw error;
        }
    }
}

function salvage<T>(
    error: unknown,
    schema: z.ZodType<T>,
): GenerateObjectSafeResult<T> | null {
    if (!NoObjectGeneratedError.isInstance(error) || typeof error.text !== "string") {
        return null;
    }
    const candidate = extractJson(error.text);
    if (candidate === NO_JSON) {
        return null;
    }
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
        return null;
    }
    return { object: parsed.data, usage: error.usage };
}

// Pull a JSON value out of chatty model output: drop <think> blocks, prefer
// fenced content, then fall back to the widest parseable {...}/[...] span.
function extractJson(raw: string): unknown {
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
        text = fence[1].trim();
    }
    try {
        return JSON.parse(text);
    } catch {
        // fall through to span scan
    }
    const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
    if (starts.length === 0) {
        return NO_JSON;
    }
    const start = Math.min(...starts);
    for (let end = text.length; end > start; end--) {
        const tail = text[end - 1];
        if (tail !== "}" && tail !== "]") {
            continue;
        }
        try {
            return JSON.parse(text.slice(start, end));
        } catch {
            // keep shrinking
        }
    }
    return NO_JSON;
}
