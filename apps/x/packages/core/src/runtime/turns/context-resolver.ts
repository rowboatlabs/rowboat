import type { z } from "zod";
import {
    type ConversationMessage,
    type ResolvedAgent,
    type ResolvedAgentSnapshot,
    type TurnContext,
    TurnCorruptionError,
    isInheritedSnapshot,
    reduceTurn,
    turnTranscript,
} from "@x/shared/dist/turns.js";
import type { ITurnRepo } from "./repo.js";

// Materializes a turn's context (turn-runtime-design.md §6.6). Inline
// contexts pass through; references resolve to the referenced turn's full
// transcript by walking the chain down to its inline base. Resolution always
// reads durable state, so normal execution and crash recovery share one
// path. A missing or corrupt referenced turn is an infrastructure error.
export interface IContextResolver {
    resolve(
        context: z.infer<typeof TurnContext>,
    ): Promise<Array<z.infer<typeof ConversationMessage>>>;
    // Materializes an inherited agent snapshot by walking inheritedFrom to
    // the nearest concrete snapshot (same discipline as context references:
    // deterministic, from durable state, cycle-checked).
    resolveAgent(
        resolved: z.infer<typeof ResolvedAgentSnapshot>,
    ): Promise<z.infer<typeof ResolvedAgent>>;
}

// NOTE: app code must not construct this directly — use createContextResolver
// (context-elision.ts), which wraps it in the eliding decorator. A raw
// instance silently transmits full historic tool results, frames, and note
// snapshots. Direct construction is for tests of the raw resolution only.
export class TurnRepoContextResolver implements IContextResolver {
    private readonly turnRepo: ITurnRepo;

    constructor({ turnRepo }: { turnRepo: ITurnRepo }) {
        this.turnRepo = turnRepo;
    }

    async resolve(
        context: z.infer<typeof TurnContext>,
    ): Promise<Array<z.infer<typeof ConversationMessage>>> {
        // Walk the reference chain back to the inline base, then concatenate
        // transcripts oldest-first. Iterative to bound stack depth; a visited
        // set catches cyclic (corrupt) chains.
        const segments: Array<Array<z.infer<typeof ConversationMessage>>> = [];
        const visited = new Set<string>();
        let current = context;
        while (!Array.isArray(current)) {
            const turnId = current.previousTurnId;
            if (visited.has(turnId)) {
                throw new TurnCorruptionError(
                    `cyclic context reference chain at turn ${turnId}`,
                );
            }
            visited.add(turnId);
            const events = await this.turnRepo.read(turnId);
            const state = reduceTurn(events);
            segments.push(turnTranscript(state));
            current = state.definition.context;
        }
        segments.push(current);
        segments.reverse();
        return segments.flat();
    }

    async resolveAgent(
        resolved: z.infer<typeof ResolvedAgentSnapshot>,
    ): Promise<z.infer<typeof ResolvedAgent>> {
        if (!isInheritedSnapshot(resolved)) {
            return resolved;
        }
        const visited = new Set<string>();
        let current: z.infer<typeof ResolvedAgentSnapshot> = resolved;
        while (isInheritedSnapshot(current)) {
            const turnId = current.inheritedFrom;
            if (visited.has(turnId)) {
                throw new TurnCorruptionError(
                    `cyclic agent snapshot inheritance at turn ${turnId}`,
                );
            }
            visited.add(turnId);
            const events = await this.turnRepo.read(turnId);
            current = reduceTurn(events).definition.agent.resolved;
        }
        // Only the heavy fields inherit; the turn's own concrete identity
        // (agentId, model — a mid-session model switch) always wins.
        return { ...current, agentId: resolved.agentId, model: resolved.model };
    }
}
