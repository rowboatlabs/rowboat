import type { z } from "zod";
import {
    type InlineAgentRequest,
    type ResolvedAgent,
    SPAWN_AGENT_TOOL_NAME,
    type ToolDescriptor,
    inlineAgentId,
} from "@x/shared/dist/turns.js";
import { ResolvedAgent as ResolvedAgentSchema } from "@x/shared/dist/turns.js";
import { BuiltinTools } from "../../application/lib/builtin-tools.js";
import { getDefaultModelAndProvider } from "../../models/defaults.js";
import { builtinToolDescriptor } from "./builtin-descriptors.js";

// Default tool profile for inline agents that omit `tools`: every builtin
// except the ones that make no sense headlessly or in a child. Mirrors the
// background-task agent's exclusions (no interactive approval surface) plus
// the task/session launchers — an ephemeral child should do its own work,
// not schedule more — and the shared visible surfaces: a headless child
// navigating the UI the user is looking at, or parallel children fighting
// over the one embedded browser pane, is broken behavior, not just noise.
// All remain available via an explicit `tools` selection.
const DEFAULT_PROFILE_EXCLUDED = new Set([
    "executeCommand", // headless: no interactive approval
    "code_agent_run", // headless: needs interactive permission UI
    "launch-code-task",
    "run-background-task-agent",
    "create-background-task",
    "patch-background-task",
    "run-live-note-agent",
    "app-navigation", // shared surface: drives the UI the user is watching
    "browser-control", // shared surface: the single embedded browser pane
    SPAWN_AGENT_TOOL_NAME,
]);

export interface InlineAgentResolverDeps {
    builtins?: typeof BuiltinTools;
    defaultModel?: () => Promise<{ model: string; provider: string }>;
}

// Materializes an inline (spawned) agent definition into the same immutable
// ResolvedAgent snapshot a stored agent gets. Deliberately knows nothing
// about loadAgent, composition overrides, or copilot context — an inline
// agent is exactly its persisted spec.
export class InlineAgentResolver {
    private readonly builtins: typeof BuiltinTools;
    private readonly defaultModel: () => Promise<{ model: string; provider: string }>;

    constructor(deps: InlineAgentResolverDeps = {}) {
        this.builtins = deps.builtins ?? BuiltinTools;
        this.defaultModel = deps.defaultModel ?? getDefaultModelAndProvider;
    }

    async resolve(
        requested: z.infer<typeof InlineAgentRequest>,
    ): Promise<z.infer<typeof ResolvedAgent>> {
        const spec = requested.inline;

        let model = spec.model;
        if (!model) {
            const fallback = await this.defaultModel();
            model = { provider: fallback.provider, model: fallback.model };
        }

        const names =
            spec.tools ??
            Object.keys(this.builtins).filter(
                (name) => !DEFAULT_PROFILE_EXCLUDED.has(name),
            );

        const tools: Array<z.infer<typeof ToolDescriptor>> = [];
        for (const name of names) {
            // Depth is capped at 1: a child never spawns, even when its spec
            // naively asks for the tool. Stripped rather than rejected so a
            // model that includes it out of habit still gets a working agent.
            if (name === SPAWN_AGENT_TOOL_NAME) {
                continue;
            }
            const builtin = this.builtins[name];
            if (!builtin) {
                // A typo'd explicit selection should fail the spawn loudly
                // (createTurn rejects; the spawn tool reports it), not run a
                // silently under-tooled agent.
                throw new Error(
                    `inline agent requested unknown builtin tool: ${name}`,
                );
            }
            if (builtin.isAvailable && !(await builtin.isAvailable())) {
                continue;
            }
            tools.push(builtinToolDescriptor(name, builtin));
        }

        return ResolvedAgentSchema.parse({
            agentId: inlineAgentId(spec.name),
            systemPrompt: spec.instructions,
            model,
            tools,
        });
    }
}
