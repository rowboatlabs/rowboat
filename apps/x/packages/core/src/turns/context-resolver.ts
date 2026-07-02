import type { z } from "zod";
import {
    type ConversationMessage,
    type TurnContext,
    TurnCorruptionError,
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
}

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
}
