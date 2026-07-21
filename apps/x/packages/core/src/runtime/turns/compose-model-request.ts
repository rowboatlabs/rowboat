import type { z } from "zod";
import {
    type ConversationMessage,
    type JsonValue,
    type ResolvedAgent,
    type ToolDescriptor,
    type TurnState,
    effectiveTools,
    requestMessagesFor,
} from "@x/shared/dist/turns.js";
import type { IContextResolver } from "./context-resolver.js";

// The exact provider payload for one model call, rebuilt deterministically
// from durable state (turn-runtime-design.md §8.3):
//   - systemPrompt and base tools come from the resolved agent snapshot
//     (their single canonical copy in turn_created); tools_extended events
//     add descriptors for the calls requested after them,
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
    // The materialized agent snapshot (contextResolver.resolveAgent output —
    // inherited snapshots must be resolved before composing).
    agent: z.infer<typeof ResolvedAgent>,
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
        systemPrompt: agent.systemPrompt,
        messages: encode(structural),
        // The snapshot's base tools plus any durable mid-turn extensions
        // recorded before this call (tools_extended events).
        tools: effectiveTools(state, modelCallIndex, agent.tools),
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
    const agent = await contextResolver.resolveAgent(
        state.definition.agent.resolved,
    );
    return composeModelRequest(state, modelCallIndex, prefix, agent, encode);
}
