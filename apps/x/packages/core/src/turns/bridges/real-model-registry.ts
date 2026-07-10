import {
    jsonSchema,
    stepCountIs,
    streamText,
    tool,
    type LanguageModel,
    type ModelMessage,
    type ToolSet,
} from "ai";
import type { z } from "zod";
import type { LlmProvider } from "@x/shared/dist/models.js";
import type { AssistantContentPart } from "@x/shared/dist/message.js";
import type { JsonValue, ModelDescriptor, TurnUsage } from "@x/shared/dist/turns.js";
import { convertFromMessages } from "../../agents/runtime.js";
import { resolveProviderConfig } from "../../models/defaults.js";
import { createProvider } from "../../models/models.js";
import { isReasoningModel } from "../../models/models-dev.js";
import { applyPromptCaching } from "../../models/prompt-caching.js";
import { applyLocalModelSettings } from "../../models/local.js";
import { mapReasoningEffort, parseReasoningEffort } from "../../models/reasoning.js";
import type {
    IModelRegistry,
    LlmStreamEvent,
    ModelStreamRequest,
    ResolvedModel,
} from "../model-registry.js";

// Injectable seam over streamText so normalization is testable without a
// provider. The bridge always requests exactly one step.
export type StreamTextInvoker = (options: {
    model: LanguageModel;
    // Absent when prompt caching moved the system prompt into messages
    // (Anthropic-family models; see models/prompt-caching.ts).
    system?: string;
    messages: ModelMessage[];
    tools: ToolSet;
    abortSignal: AbortSignal;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    providerOptions?: Record<string, Record<string, JsonValue>>;
}) => { fullStream: AsyncIterable<unknown> };

const defaultInvoker: StreamTextInvoker = (options) =>
    streamText({ ...options, stopWhen: stepCountIs(1) });

export interface RealModelRegistryDeps {
    resolveProvider?: (name: string) => Promise<z.infer<typeof LlmProvider>>;
    createProviderImpl?: typeof createProvider;
    invoke?: StreamTextInvoker;
    // Capability probe for "does this model reason?" (models.dev cache by
    // default). undefined = unknown; the effort mapping fails closed on it.
    reasoningSupport?: (flavor: string, modelId: string) => Promise<boolean | undefined>;
}

// Bridges models.json provider configs to live AI SDK models and normalizes
// one streamText step into LlmStreamEvents. Tools are declared without
// execute: the turn loop harvests tool calls and runs them itself.
export class RealModelRegistry implements IModelRegistry {
    private readonly resolveProvider: (
        name: string,
    ) => Promise<z.infer<typeof LlmProvider>>;
    private readonly createProviderImpl: typeof createProvider;
    private readonly invoke: StreamTextInvoker;
    private readonly reasoningSupport: (
        flavor: string,
        modelId: string,
    ) => Promise<boolean | undefined>;

    constructor(deps: RealModelRegistryDeps = {}) {
        this.resolveProvider = deps.resolveProvider ?? resolveProviderConfig;
        this.createProviderImpl = deps.createProviderImpl ?? createProvider;
        this.invoke = deps.invoke ?? defaultInvoker;
        this.reasoningSupport = deps.reasoningSupport ?? isReasoningModel;
    }

    async resolve(
        descriptor: z.infer<typeof ModelDescriptor>,
    ): Promise<ResolvedModel> {
        const providerConfig = await this.resolveProvider(descriptor.provider);
        const provider = this.createProviderImpl(providerConfig);
        // Local settings (Ollama context window) are applied here.
        const model = applyLocalModelSettings(
            provider.languageModel(descriptor.model),
            providerConfig,
        );
        // Cache-only capability lookup (never blocks a turn on the network);
        // unknown support makes the effort mapping fail closed.
        const supportsReasoning = await this.reasoningSupport(
            providerConfig.flavor,
            descriptor.model,
        ).catch(() => undefined);
        return {
            descriptor,
            // The structural -> wire conversion the app uses today: weaves
            // userMessageContext into the user text, renders attachments,
            // wraps tool output as tool-result parts. Deterministic and
            // per-message, so composed requests are byte-stable.
            encodeMessages: (messages) =>
                convertFromMessages(messages) as unknown as JsonValue[],
            stream: (request) =>
                this.run(
                    model,
                    request,
                    providerConfig.flavor,
                    descriptor.model,
                    supportsReasoning,
                ),
        };
    }

    private async *run(
        model: LanguageModel,
        request: ModelStreamRequest,
        flavor: string,
        modelId: string,
        supportsReasoning?: boolean,
    ): AsyncGenerator<LlmStreamEvent, void, void> {
        const tools: ToolSet = {};
        for (const descriptor of request.tools) {
            tools[descriptor.name] = tool({
                ...(descriptor.description
                    ? { description: descriptor.description }
                    : {}),
                inputSchema: jsonSchema(
                    (descriptor.inputSchema ?? {
                        type: "object",
                        properties: {},
                    }) as Parameters<typeof jsonSchema>[0],
                ),
            });
        }

        // Persisted per-call parameters (turn-runtime-design.md §8.3): only
        // the whitelisted generation knobs are forwarded to the provider.
        const params = request.parameters ?? {};

        // Canonical reasoningEffort maps to provider-specific options here,
        // transport-only (like prompt caching) — persisted events carry only
        // the canonical value. Explicit persisted providerOptions win over
        // the mapping; an explicit maxOutputTokens is only ever raised to
        // the thinking-budget floor, never lowered.
        const effort = parseReasoningEffort(params.reasoningEffort);
        const reasoning = effort === undefined
            ? undefined
            : mapReasoningEffort(flavor, modelId, effort, supportsReasoning);

        const callerProviderOptions =
            params.providerOptions && typeof params.providerOptions === "object" && !Array.isArray(params.providerOptions)
                ? params.providerOptions as Record<string, Record<string, JsonValue>>
                : undefined;
        const providerOptions = reasoning === undefined
            ? callerProviderOptions
            : mergeProviderOptions(reasoning.providerOptions, callerProviderOptions);

        const callerMaxOutputTokens =
            typeof params.maxOutputTokens === "number" ? params.maxOutputTokens : undefined;
        const maxOutputTokens =
            reasoning?.minOutputTokens === undefined
                ? callerMaxOutputTokens
                : Math.max(callerMaxOutputTokens ?? 0, reasoning.minOutputTokens);

        const generationParams = {
            ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
            ...(typeof params.topP === "number" ? { topP: params.topP } : {}),
            ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
            ...(providerOptions === undefined ? {} : { providerOptions }),
        };

        const parts: Array<z.infer<typeof AssistantContentPart>> = [];
        // Per-block accumulation: providers attach round-trip metadata to
        // individual content blocks (Anthropic thinking signatures arrive on
        // reasoning-delta, redacted thinking on reasoning-start; Gemini
        // thoughtSignatures on text-end / reasoning-end / tool-call; OpenAI
        // encrypted reasoning on reasoning events). Each -start opens a new
        // part so distinct blocks keep distinct signatures, and metadata from
        // every event of a block is merged onto that part's providerOptions —
        // which is exactly what the AI SDK providers read back when the
        // message is echoed in later steps.
        let currentText: TextContentPart | null = null;
        let currentReasoning: ReasoningContentPart | null = null;
        let textBuffer = "";
        let reasoningBuffer = "";
        let finishReason = "unknown";
        let usage: z.infer<typeof TurnUsage> = {};
        let providerMetadata: JsonValue | undefined;
        // finish-step metadata also rides the assistant message as
        // message-level providerOptions: providers put whole-response
        // round-trip state there (OpenRouter's accumulated reasoning_details
        // with thinking signatures — message-level wins over per-part
        // fragments on read-back), and convertFromMessages echoes it.
        let messageProviderOptions: PartProviderOptions | undefined;

        const tagPart = (
            part: TextContentPart | ReasoningContentPart,
            metadata: unknown,
        ) => {
            const merged = mergeProviderOptions(part.providerOptions, metadata);
            if (merged !== undefined) {
                part.providerOptions = merged;
            }
        };

        // Anthropic-family models get cache_control breakpoints; everything
        // else passes through byte-identical (transport-only, not persisted).
        const prompt = applyPromptCaching(flavor, modelId, {
            system: request.systemPrompt,
            messages: request.messages,
        });

        const result = this.invoke({
            model,
            ...(prompt.system === undefined ? {} : { system: prompt.system }),
            messages: prompt.messages as ModelMessage[],
            tools,
            abortSignal: request.signal,
            ...generationParams,
        });

        for await (const raw of result.fullStream) {
            request.signal.throwIfAborted();
            const event = raw as {
                type: string;
                text?: string;
                toolCallId?: string;
                toolName?: string;
                input?: unknown;
                finishReason?: string;
                usage?: Record<string, number | undefined>;
                providerMetadata?: unknown;
                error?: unknown;
            };
            switch (event.type) {
                case "text-start": {
                    textBuffer = "";
                    currentText = { type: "text", text: "" };
                    tagPart(currentText, event.providerMetadata);
                    parts.push(currentText);
                    yield { type: "step_event", event: { type: "text_start" } };
                    break;
                }
                case "text-delta": {
                    const delta = event.text ?? "";
                    textBuffer += delta;
                    if (currentText === null) {
                        currentText = { type: "text", text: "" };
                        parts.push(currentText);
                    }
                    currentText.text += delta;
                    tagPart(currentText, event.providerMetadata);
                    yield { type: "text_delta", delta };
                    break;
                }
                case "text-end":
                    if (currentText !== null) {
                        tagPart(currentText, event.providerMetadata);
                        currentText = null;
                    }
                    yield {
                        type: "step_event",
                        event: { type: "text_end", text: textBuffer },
                    };
                    break;
                case "reasoning-start": {
                    reasoningBuffer = "";
                    currentReasoning = { type: "reasoning", text: "" };
                    tagPart(currentReasoning, event.providerMetadata);
                    parts.push(currentReasoning);
                    yield { type: "step_event", event: { type: "reasoning_start" } };
                    break;
                }
                case "reasoning-delta": {
                    const delta = event.text ?? "";
                    reasoningBuffer += delta;
                    if (currentReasoning === null) {
                        currentReasoning = { type: "reasoning", text: "" };
                        parts.push(currentReasoning);
                    }
                    currentReasoning.text += delta;
                    tagPart(currentReasoning, event.providerMetadata);
                    yield { type: "reasoning_delta", delta };
                    break;
                }
                case "reasoning-end":
                    if (currentReasoning !== null) {
                        tagPart(currentReasoning, event.providerMetadata);
                        currentReasoning = null;
                    }
                    yield {
                        type: "step_event",
                        event: { type: "reasoning_end", text: reasoningBuffer },
                    };
                    break;
                case "tool-call": {
                    const partOptions = mergeProviderOptions(undefined, event.providerMetadata);
                    const toolCall = {
                        type: "tool-call" as const,
                        toolCallId: String(event.toolCallId),
                        toolName: String(event.toolName),
                        arguments: event.input,
                        ...(partOptions === undefined ? {} : { providerOptions: partOptions }),
                    };
                    parts.push(toolCall);
                    yield { type: "step_event", event: { type: "tool_call", toolCall } };
                    break;
                }
                case "finish-step": {
                    finishReason = event.finishReason ?? "unknown";
                    usage = mapUsage(event.usage);
                    providerMetadata = toJsonValue(event.providerMetadata);
                    messageProviderOptions = mergeProviderOptions(
                        messageProviderOptions,
                        event.providerMetadata,
                    );
                    yield {
                        type: "step_event",
                        event: {
                            type: "finish_step",
                            finishReason,
                            usage,
                            ...(providerMetadata === undefined
                                ? {}
                                : { providerMetadata }),
                        },
                    };
                    break;
                }
                case "error":
                    throw event.error instanceof Error
                        ? event.error
                        : new Error(formatStreamError(event.error));
                default:
                    break;
            }
        }

        // Blocks that ended up with no text and no round-trip metadata carry
        // no information; dropping them matches the pre-block-tracking
        // behavior (parts used to be created lazily on first delta).
        const content = parts.filter(
            (part) =>
                part.type === "tool-call"
                || part.text !== ""
                || part.providerOptions !== undefined,
        );

        yield {
            type: "completed",
            message: {
                role: "assistant",
                content: content.length > 0 ? content : "",
                ...(messageProviderOptions === undefined
                    ? {}
                    : { providerOptions: messageProviderOptions }),
            },
            finishReason,
            usage,
            ...(providerMetadata === undefined ? {} : { providerMetadata }),
        };
    }
}

type TextContentPart = Extract<z.infer<typeof AssistantContentPart>, { type: "text" }>;
type ReasoningContentPart = Extract<z.infer<typeof AssistantContentPart>, { type: "reasoning" }>;
type PartProviderOptions = NonNullable<TextContentPart["providerOptions"]>;

// Round-trip metadata is relayed opaquely: whatever JSON-safe, per-provider
// record a stream event carries is merged onto the part (later events win
// per field within a provider's namespace). The bridge never interprets the
// contents — Anthropic signatures, Gemini thoughtSignatures, and OpenAI
// encrypted reasoning all ride the same channel, and each provider reads
// back only its own keys.
function mergeProviderOptions(
    base: PartProviderOptions | undefined,
    incoming: unknown,
): PartProviderOptions | undefined {
    const sanitized = toJsonValue(incoming);
    if (sanitized === undefined || sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized)) {
        return base;
    }
    let merged: PartProviderOptions | undefined;
    for (const [provider, fields] of Object.entries(sanitized)) {
        if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
            continue;
        }
        merged = merged ?? { ...(base ?? {}) };
        merged[provider] = { ...(merged[provider] ?? {}), ...fields };
    }
    return merged ?? base;
}

function mapUsage(
    usage: Record<string, number | undefined> | undefined,
): z.infer<typeof TurnUsage> {
    const mapped: z.infer<typeof TurnUsage> = {};
    if (!usage) {
        return mapped;
    }
    for (const key of [
        "inputTokens",
        "outputTokens",
        "totalTokens",
        "reasoningTokens",
        "cachedInputTokens",
    ] as const) {
        const value = usage[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            mapped[key] = value;
        }
    }
    return mapped;
}

function toJsonValue(value: unknown): JsonValue | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
        return undefined;
    }
}

function formatStreamError(error: unknown): string {
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}
