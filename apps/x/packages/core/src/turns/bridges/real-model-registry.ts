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
    system: string;
    messages: ModelMessage[];
    tools: ToolSet;
    abortSignal: AbortSignal;
}) => { fullStream: AsyncIterable<unknown> };

const defaultInvoker: StreamTextInvoker = (options) =>
    streamText({ ...options, stopWhen: stepCountIs(1) });

export interface RealModelRegistryDeps {
    resolveProvider?: (name: string) => Promise<z.infer<typeof LlmProvider>>;
    createProviderImpl?: typeof createProvider;
    invoke?: StreamTextInvoker;
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

    constructor(deps: RealModelRegistryDeps = {}) {
        this.resolveProvider = deps.resolveProvider ?? resolveProviderConfig;
        this.createProviderImpl = deps.createProviderImpl ?? createProvider;
        this.invoke = deps.invoke ?? defaultInvoker;
    }

    async resolve(
        descriptor: z.infer<typeof ModelDescriptor>,
    ): Promise<ResolvedModel> {
        const providerConfig = await this.resolveProvider(descriptor.provider);
        const provider = this.createProviderImpl(providerConfig);
        const model = provider.languageModel(descriptor.model);
        return {
            descriptor,
            // The structural -> wire conversion the app uses today: weaves
            // userMessageContext into the user text, renders attachments,
            // wraps tool output as tool-result parts. Deterministic and
            // per-message, so composed requests are byte-stable.
            encodeMessages: (messages) =>
                convertFromMessages(messages) as unknown as JsonValue[],
            stream: (request) => this.run(model, request),
        };
    }

    private async *run(
        model: LanguageModel,
        request: ModelStreamRequest,
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

        const result = this.invoke({
            model,
            system: request.systemPrompt,
            messages: request.messages as ModelMessage[],
            tools,
            abortSignal: request.signal,
        });

        const parts: Array<z.infer<typeof AssistantContentPart>> = [];
        let textBuffer = "";
        let reasoningBuffer = "";
        let finishReason = "unknown";
        let usage: z.infer<typeof TurnUsage> = {};
        let providerMetadata: JsonValue | undefined;

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
                case "text-start":
                    textBuffer = "";
                    yield { type: "step_event", event: { type: "text_start" } };
                    break;
                case "text-delta": {
                    const delta = event.text ?? "";
                    textBuffer += delta;
                    const last = parts[parts.length - 1];
                    if (last?.type === "text") {
                        last.text += delta;
                    } else {
                        parts.push({ type: "text", text: delta });
                    }
                    yield { type: "text_delta", delta };
                    break;
                }
                case "text-end":
                    yield {
                        type: "step_event",
                        event: { type: "text_end", text: textBuffer },
                    };
                    break;
                case "reasoning-start":
                    reasoningBuffer = "";
                    yield { type: "step_event", event: { type: "reasoning_start" } };
                    break;
                case "reasoning-delta": {
                    const delta = event.text ?? "";
                    reasoningBuffer += delta;
                    const last = parts[parts.length - 1];
                    if (last?.type === "reasoning") {
                        last.text += delta;
                    } else {
                        parts.push({ type: "reasoning", text: delta });
                    }
                    yield { type: "reasoning_delta", delta };
                    break;
                }
                case "reasoning-end":
                    yield {
                        type: "step_event",
                        event: { type: "reasoning_end", text: reasoningBuffer },
                    };
                    break;
                case "tool-call": {
                    const toolCall = {
                        type: "tool-call" as const,
                        toolCallId: String(event.toolCallId),
                        toolName: String(event.toolName),
                        arguments: event.input,
                    };
                    parts.push(toolCall);
                    yield { type: "step_event", event: { type: "tool_call", toolCall } };
                    break;
                }
                case "finish-step": {
                    finishReason = event.finishReason ?? "unknown";
                    usage = mapUsage(event.usage);
                    providerMetadata = toJsonValue(event.providerMetadata);
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

        yield {
            type: "completed",
            message: {
                role: "assistant",
                content: parts.length > 0 ? parts : "",
            },
            finishReason,
            usage,
            ...(providerMetadata === undefined ? {} : { providerMetadata }),
        };
    }
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
