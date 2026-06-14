import { z } from "zod";
import type { SystemComposer } from "../agent-loop/system-composer.js";
import type { AgentLoopTurn } from "../agent-loop/types.js";
import { buildSystemInstructions } from "../agents/compose/system-prompt.js";
import { AgentTools } from "./agent-tools.js";

// Real SystemComposer: builds the system prompt fresh per model call from the
// turn's agent (instructions) + its compose context (voice / search / code-mode)
// via the shared assembly used by the old runtime. Agent-less turns get no
// system prompt.
export class CopilotSystemComposer implements SystemComposer {
    constructor(private agentTools: AgentTools) {}

    async system(turn: z.infer<typeof AgentLoopTurn>): Promise<string | null> {
        if (turn.agentId === null) return null;
        const agent = await this.agentTools.agent(turn.agentId);
        if (!agent) return null;
        const compose = turn.composeContext;
        return buildSystemInstructions({
            instructions: agent.instructions,
            agentName: turn.agentId,
            // Work directory is scoped per chat → keyed by session.
            workDirId: turn.sessionId,
            voiceInput: compose?.voiceInput,
            voiceOutput: compose?.voiceOutput ?? null,
            searchEnabled: compose?.searchEnabled,
            codeMode: compose?.codeMode ?? null,
        });
    }
}
