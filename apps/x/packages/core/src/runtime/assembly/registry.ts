import type { z } from "zod";
import { Agent } from "@x/shared/dist/agent.js";
import { parseFrontmatter } from "../../application/lib/parse-frontmatter.js";
import { buildCopilotAgent } from "./copilot/agent.js";
import { buildBackgroundTaskAgent } from "../../background-tasks/agent.js";
import { buildLiveNoteAgent } from "../../knowledge/live-note/agent.js";
import { getRaw as getNoteCreationRaw } from "../../knowledge/note_creation.js";
import { getRaw as getNoteCurationRaw } from "../../knowledge/note_curation.js";
import { getRaw as getLabelingAgentRaw } from "../../knowledge/labeling_agent.js";
import { getRaw as getNoteTaggingAgentRaw } from "../../knowledge/note_tagging_agent.js";
import { getRaw as getInlineTaskAgentRaw } from "../../knowledge/inline_task_agent.js";
import { getRaw as getAgentNotesAgentRaw } from "../../knowledge/agent_notes_agent.js";
import { lazyResolve } from "../../di/lazy-resolve.js";
import type { IAgentsRepo } from "./repo.js";

// The registry of built-in agents: one table instead of the historical
// if (id === ...) ladder. An entry owns its builder. Traits (which replace
// stringly-typed id comparisons scattered across the assembly layer) live in
// traits.ts — a leaf module, because this file's builders transitively reach
// di/container and upstream trait readers would cycle. Re-exported here so
// assembly-level consumers keep one import.

export {
    carriesSkillsForward,
    hasWorkspaceContext,
    type AgentTraits,
} from "./traits.js";

interface BuiltinAgentDefinition {
    build: () => Promise<z.infer<typeof Agent>> | z.infer<typeof Agent>;
}

// Prompt-file agents: instructions ship as a raw string whose optional YAML
// frontmatter carries agent config (tools, model). Parsing goes through the
// same parseFrontmatter helper FSAgentsRepo uses for user agents, so builtin
// and user-defined agents can never drift on the same file format.
export function agentFromRaw(id: string, raw: string): z.infer<typeof Agent> {
    const { frontmatter, content } = parseFrontmatter(raw);
    if (frontmatter === null) {
        return { name: id, instructions: raw };
    }
    const parsed = Agent.omit({ name: true, instructions: true }).parse(frontmatter);
    return { name: id, ...parsed, instructions: content };
}

function promptFileAgent(id: string, getRaw: () => string): BuiltinAgentDefinition {
    return { build: () => agentFromRaw(id, getRaw()) };
}

// "rowboatx" is a legacy alias for the copilot: both ids share one
// definition object.
const COPILOT: BuiltinAgentDefinition = {
    build: buildCopilotAgent,
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

export async function loadAgent(id: string): Promise<z.infer<typeof Agent>> {
    // Object.hasOwn: a plain lookup would traverse Object.prototype, so a
    // user agent named "constructor"/"toString" would hit an inherited
    // function instead of falling through to the repo.
    const builtin = Object.hasOwn(builtinAgents, id)
        ? builtinAgents[id]
        : undefined;
    if (builtin) {
        return builtin.build();
    }
    // User-defined agents (lazyResolve: no static DI edge from this module).
    const repo = await lazyResolve<IAgentsRepo>("agentsRepo");
    return repo.fetch(id);
}
