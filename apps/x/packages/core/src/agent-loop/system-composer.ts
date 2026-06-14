import { z } from "zod";
import type { AgentLoopTurn } from "./types.js";

// Produces the system prompt for a turn's model call. Environment, not turn
// state — composed fresh each call from the agent's config + the turn's compose
// context (symmetric with ToolRunner.definitions). The real implementation
// (bridging the agent prompt assembly) is integration-phase work.
export interface SystemComposer {
    system(turn: z.infer<typeof AgentLoopTurn>): Promise<string | null>;
}

// Default: no system prompt. Keeps the loop usable without a composer (tests,
// agent-less turns).
export class NullSystemComposer implements SystemComposer {
    async system(): Promise<string | null> {
        return null;
    }
}
