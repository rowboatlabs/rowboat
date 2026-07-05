import type { z } from "zod";
import type { AssistantMessage } from "@x/shared/dist/message.js";
import type {
    ConversationMessage,
    DurableLlmStepStreamEvent,
    JsonValue,
    ModelDescriptor,
    ToolDescriptor,
    TurnUsage,
} from "@x/shared/dist/turns.js";

// One stream() call performs exactly one model step; the turn loop drives
// multi-step behavior. The stream yields normalized events and must end with
// exactly one "completed" event, or throw (a throw is a model failure; an
// abort-triggered throw is cancellation).
export type LlmStreamEvent =
    | { type: "text_delta"; delta: string }
    | { type: "reasoning_delta"; delta: string }
    | { type: "step_event"; event: z.infer<typeof DurableLlmStepStreamEvent> }
    | {
          type: "completed";
          message: z.infer<typeof AssistantMessage>;
          finishReason: string;
          usage: z.infer<typeof TurnUsage>;
          providerMetadata?: JsonValue;
      };

export interface ModelStreamRequest {
    systemPrompt: string;
    // Provider wire-form messages: the output of encodeMessages. The loop
    // builds these through the shared request composer, so what is sent is
    // exactly what composeModelRequest reproduces from the durable log.
    messages: JsonValue[];
    tools: Array<z.infer<typeof ToolDescriptor>>;
    parameters: Record<string, JsonValue>;
    signal: AbortSignal;
    // Scheduling class for local-model queueing: interactive turns (a human
    // is watching) preempt queued headless/background work. Defaults to
    // "interactive" so an unset priority never slows a user down.
    priority?: "interactive" | "background";
}

export interface ResolvedModel {
    descriptor: z.infer<typeof ModelDescriptor>;
    // Deterministic per-message structural -> wire conversion (e.g. weaving
    // userMessageContext into the user text, tool-result enveloping).
    encodeMessages(
        messages: Array<z.infer<typeof ConversationMessage>>,
    ): JsonValue[];
    stream(request: ModelStreamRequest): AsyncIterable<LlmStreamEvent>;
}

// Resolves the persisted model descriptor to a live model during advanceTurn.
// A rejection is an infrastructure error: the execution is rejected and the
// turn is left unchanged.
export interface IModelRegistry {
    resolve(descriptor: z.infer<typeof ModelDescriptor>): Promise<ResolvedModel>;
}
