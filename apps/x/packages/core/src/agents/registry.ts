import type { z } from "zod";
import { parse } from "yaml";
import { Agent } from "@x/shared/dist/agent.js";
import { buildCopilotAgent } from "../application/assistant/agent.js";
import { buildBackgroundTaskAgent } from "../background-tasks/agent.js";
import { buildLiveNoteAgent } from "../knowledge/live-note/agent.js";
import { getRaw as getNoteCreationRaw } from "../knowledge/note_creation.js";
import { getRaw as getNoteCurationRaw } from "../knowledge/note_curation.js";
import { getRaw as getLabelingAgentRaw } from "../knowledge/labeling_agent.js";
import { getRaw as getNoteTaggingAgentRaw } from "../knowledge/note_tagging_agent.js";
import { getRaw as getInlineTaskAgentRaw } from "../knowledge/inline_task_agent.js";
import { getRaw as getAgentNotesAgentRaw } from "../knowledge/agent_notes_agent.js";
import type { IAgentsRepo } from "./repo.js";

// The registry of built-in agents: one table instead of the historical
// if (id === ...) ladder. An entry owns its builder and its traits; traits
// replace stringly-typed id comparisons ("copilot" || "rowboatx") scattered
// across the assembly layer. User-defined agents are the fallthrough,
// fetched from the agents repo.

export interface AgentTraits {
    // Receives workspace context — agent notes and the user work directory —
    // composed into its system prompt.
    workspaceContext?: boolean;
}

interface BuiltinAgentDefinition {
    build: () => Promise<z.infer<typeof Agent>> | z.infer<typeof Agent>;
    traits?: AgentTraits;
}

// Prompt-file agents: instructions ship as a raw string whose optional YAML
// frontmatter carries agent config (tools, model). One loader replaces the
// five copy-pasted parsing blocks the ladder accumulated.
export function agentFromRaw(id: string, raw: string): z.infer<typeof Agent> {
    let agent: z.infer<typeof Agent> = { name: id, instructions: raw };
    if (raw.startsWith("---")) {
        const end = raw.indexOf("\n---", 3);
        if (end !== -1) {
            const frontmatter = raw.slice(3, end).trim();
            const content = raw.slice(end + 4).trim();
            const yaml: unknown = parse(frontmatter);
            const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
            agent = { ...agent, ...parsed, instructions: content };
        }
    }
    return agent;
}

function promptFileAgent(id: string, getRaw: () => string): BuiltinAgentDefinition {
    return { build: () => agentFromRaw(id, getRaw()) };
}

// "rowboatx" is a legacy alias for the copilot: both ids share one
// definition object.
const COPILOT: BuiltinAgentDefinition = {
    build: buildCopilotAgent,
    traits: { workspaceContext: true },
};

const builtinAgents: Record<string, BuiltinAgentDefinition> = {
    copilot: COPILOT,
    rowboatx: COPILOT,
    "live-note-agent": { build: buildLiveNoteAgent },
    "background-task-agent": { build: buildBackgroundTaskAgent },
    note_creation: promptFileAgent("note_creation", getNoteCreationRaw),
    note_curation: promptFileAgent("note_curation", getNoteCurationRaw),
    labeling_agent: promptFileAgent("labeling_agent", getLabelingAgentRaw),
    note_tagging_agent: promptFileAgent("note_tagging_agent", getNoteTaggingAgentRaw),
    inline_task_agent: promptFileAgent("inline_task_agent", getInlineTaskAgentRaw),
    agent_notes_agent: promptFileAgent("agent_notes_agent", getAgentNotesAgentRaw),
};

export function builtinAgentIds(): string[] {
    return Object.keys(builtinAgents);
}

// Trait lookup for assembly decisions. Unknown/user agents have no traits.
export function hasWorkspaceContext(agentId: string | null | undefined): boolean {
    return (
        agentId != null &&
        builtinAgents[agentId]?.traits?.workspaceContext === true
    );
}

export async function loadAgent(id: string): Promise<z.infer<typeof Agent>> {
    const builtin = builtinAgents[id];
    if (builtin) {
        return builtin.build();
    }
    // User-defined agents. The container is imported lazily so this module
    // adds no static edge into the DI graph (mirrors spawn-agent).
    const { default: container } = await import("../di/container.js");
    const repo = container.resolve<IAgentsRepo>("agentsRepo");
    return repo.fetch(id);
}
