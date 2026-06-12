import { jsonSchema, stepCountIs, streamText, tool, type ToolSet } from "ai";
import { z } from "zod";
import {
    AssistantContentPart,
    AssistantMessage,
    MessageList,
    ToolCallPart,
} from "@x/shared/dist/message.js";
import { convertFromMessages } from "../agents/runtime.js";
import { createProvider } from "../models/models.js";
import { resolveProviderConfig } from "../models/defaults.js";
import { EventStream } from "./event-stream.js";
import type { ModelStreamEvent, ToolDefinition } from "./types.js";

export type ModelStreamRequest = {
    provider: string | null;
    model: string | null;
    messages: z.infer<typeof MessageList>;
    tools: ToolDefinition[];
    signal: AbortSignal;
};

// Streams one model step. Iterate for deltas, or just await `.result` for the
// final complete AssistantMessage. The loop commits only the complete message;
// deltas are never persisted.
//
// Contract: `.result` is authoritative — it MUST resolve with the complete
// message or reject on failure/abort (the loop distinguishes the two via its
// own AbortSignal). `error` events are observational only; the loop ignores
// them.
export interface ModelAdapter {
    stream(req: ModelStreamRequest): EventStream<ModelStreamEvent, z.infer<typeof AssistantMessage>>;
}

// Thin adapter over the existing provider factory + Vercel AI SDK streamText.
// All retry/failover policy stays out of the agent loop; if a step fails, the
// stream emits an `error` event and the loop records a turn-level error.
export class VercelModelAdapter implements ModelAdapter {
    stream(req: ModelStreamRequest): EventStream<ModelStreamEvent, z.infer<typeof AssistantMessage>> {
        const out = new EventStream<ModelStreamEvent, z.infer<typeof AssistantMessage>>();
        void this.run(req, out).catch((error: unknown) => {
            out.push({ type: "error", error });
            out.fail(error);
        });
        return out;
    }

    private async run(
        req: ModelStreamRequest,
        out: EventStream<ModelStreamEvent, z.infer<typeof AssistantMessage>>,
    ): Promise<void> {
        if (!req.provider || !req.model) {
            throw new Error("Agent loop turn has no provider/model configured");
        }
        const providerConfig = await resolveProviderConfig(req.provider);
        const provider = createProvider(providerConfig);
        const model = provider.languageModel(req.model);

        const tools: ToolSet = {};
        for (const def of req.tools) {
            tools[def.name] = tool({
                ...(def.description ? { description: def.description } : {}),
                inputSchema: jsonSchema(
                    (def.inputSchema ?? { type: "object", properties: {} }) as Parameters<typeof jsonSchema>[0],
                ),
            });
        }

        const result = streamText({
            model,
            messages: convertFromMessages(req.messages),
            tools,
            stopWhen: stepCountIs(1),
            abortSignal: req.signal,
        });

        // Accumulate complete assistant content parts in stream order. Deltas
        // append into the current text/reasoning part; tool calls are discrete.
        const parts: z.infer<typeof AssistantContentPart>[] = [];
        const lastPart = () => parts[parts.length - 1];

        for await (const event of result.fullStream) {
            req.signal.throwIfAborted();
            switch (event.type) {
                case "text-delta": {
                    const last = lastPart();
                    if (last?.type === "text") {
                        last.text += event.text;
                    } else {
                        parts.push({ type: "text", text: event.text });
                    }
                    out.push({ type: "text-delta", delta: event.text });
                    break;
                }
                case "reasoning-delta": {
                    const last = lastPart();
                    if (last?.type === "reasoning") {
                        last.text += event.text;
                    } else {
                        parts.push({ type: "reasoning", text: event.text });
                    }
                    out.push({ type: "reasoning-delta", delta: event.text });
                    break;
                }
                case "tool-call": {
                    const toolCall: z.infer<typeof ToolCallPart> = {
                        type: "tool-call",
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        arguments: event.input,
                    };
                    parts.push(toolCall);
                    out.push({ type: "tool-call", toolCall });
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

        const message: z.infer<typeof AssistantMessage> = {
            role: "assistant",
            content: parts.length > 0 ? parts : "",
        };
        out.push({ type: "finish", message });
        out.end(message);
    }
}

function formatStreamError(error: unknown): string {
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}
