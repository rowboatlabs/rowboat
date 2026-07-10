import type { z } from "zod";
import type { RequestedAgent, ResolvedAgent } from "@x/shared/dist/turns.js";

// Absorbs agent assembly: built-in/dynamic agent selection, user-defined
// agent loading, system-prompt augmentation, model precedence
// (override > agent > application default), tool attachment and filtering.
// The result is the immutable execution snapshot persisted in turn_created;
// the resolved system prompt is final byte-for-byte. Resolution failure
// rejects createTurn without creating a turn file.
export interface IAgentResolver {
    resolve(
        agent: z.infer<typeof RequestedAgent>,
    ): Promise<z.infer<typeof ResolvedAgent>>;
}
