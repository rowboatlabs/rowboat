import type { z } from "zod";
import {
    type ConversationMessage,
    type JsonValue,
    type ToolDescriptor,
    type TurnState,
    requestMessagesFor,
} from "@x/shared/dist/turns.js";
import type { IContextResolver } from "./context-resolver.js";

// The exact provider payload for one model call, rebuilt deterministically
// from durable state (turn-runtime-design.md §8.3):
//   - systemPrompt and tools come from the resolved agent snapshot (their
//     single canonical copy in turn_created),
//   - messages are the cross-turn prefix plus every request's reference list
//     resolved against the turn's own events, encoded to wire form.
// This is the SAME code path the loop sends through, so the debug view and
// the transmitted bytes cannot diverge.
export interface ComposedModelRequest {
    systemPrompt: string;
    messages: JsonValue[];
    tools: Array<z.infer<typeof ToolDescriptor>>;
    parameters: Record<string, JsonValue>;
}

export function composeModelRequest(
    state: TurnState,
    modelCallIndex: number,
    // The materialized cross-turn prefix (contextResolver output). Ignored
    // for inline-context turns, whose context rides the {context} ref.
    resolvedPrefix: Array<z.infer<typeof ConversationMessage>>,
    encode: (messages: Array<z.infer<typeof ConversationMessage>>) => JsonValue[],
): ComposedModelRequest {
    const call = state.modelCalls[modelCallIndex];
    if (!call) {
        throw new Error(`no model call at index ${modelCallIndex}`);
    }
    const prefix = Array.isArray(state.definition.context) ? [] : resolvedPrefix;
    const structural = [...prefix];
    for (let index = 0; index <= modelCallIndex; index++) {
        structural.push(...requestMessagesFor(state, index));
    }
    return {
        systemPrompt: state.definition.agent.resolved.systemPrompt,
        messages: encode(structural),
        tools: state.definition.agent.resolved.tools,
        parameters: call.request.parameters,
    };
}

// Debug/materialization convenience: compose from durable state alone,
// resolving the cross-turn prefix through the context resolver.
export async function materializeModelRequest(
    state: TurnState,
    modelCallIndex: number,
    contextResolver: IContextResolver,
    encode: (messages: Array<z.infer<typeof ConversationMessage>>) => JsonValue[],
): Promise<ComposedModelRequest> {
    const prefix = await contextResolver.resolve(state.definition.context);
    return composeModelRequest(state, modelCallIndex, prefix, encode);
}
