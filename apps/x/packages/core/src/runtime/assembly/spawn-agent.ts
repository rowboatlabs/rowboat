import { z } from "zod";
import {
    DEFAULT_MAX_MODEL_CALLS,
    type JsonValue,
    type ModelDescriptor,
    type RequestedAgent,
    type ToolResultData,
    isInlineAgentRequest,
    reduceTurn,
} from "@x/shared/dist/turns.js";

// The spawn-agent tool: runs a sub-agent as a standalone headless child turn
// and returns its final answer. The input schema and description live here
// (imported by the BuiltinTools catalog entry); execution resolves runtime
// services lazily so this module stays import-cycle-free.

export const SpawnAgentInput = z.object({
    task: z
        .string()
        .describe(
            "The task for the sub-agent. It starts with NO other context — include everything it needs (facts, constraints, expected output format).",
        ),
    agent_id: z
        .string()
        .optional()
        .describe(
            "Run a stored agent by id. Mutually exclusive with `instructions`.",
        ),
    name: z
        .string()
        .optional()
        .describe("Short display name for an inline agent (e.g. 'researcher')."),
    instructions: z
        .string()
        .optional()
        .describe(
            "System instructions for an agent constructed on the fly. Mutually exclusive with `agent_id`. Optional: omitting both `agent_id` and `instructions` spawns a general-purpose worker driven by `task` alone.",
        ),
    model: z
        .string()
        .optional()
        .describe("Model id for the sub-agent; defaults to the current model."),
    provider: z
        .string()
        .optional()
        .describe("Provider for `model`; defaults to the current provider."),
    tools: z
        .array(z.string())
        .optional()
        .describe(
            "Builtin tool names for an inline agent. Omit for the default headless profile (files, web, search, knowledge).",
        ),
    max_model_calls: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
            "Model-call budget for the sub-agent. Defaults to the configured global limit, which is also the cap — higher values are clamped to it.",
        ),
    reasoning_effort: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe(
            "Optional reasoning-effort override for the sub-agent turn. Omit for auto/provider default. Use `low` for routine extraction or summarization, `medium` for multi-step synthesis, and `high` only when the child task truly needs deeper reasoning.",
        ),
});

export const SPAWN_AGENT_DESCRIPTION =
    "Launch a sub-agent that works on a task in its own isolated, headless turn and returns its final answer. " +
    "Use it deliberately for independent, heavy, or parallelizable work; avoid spawning for quick single-step lookups. " +
    "Issue several spawn-agent calls in ONE response only when the subtasks are genuinely independent and worth running in parallel. " +
    "Provide either `agent_id` (a stored agent) or `instructions` (construct a specialist on the fly, optionally with `name` and `tools`). " +
    "Optionally set `reasoning_effort` for the child turn; leave it unset for auto/provider default, and reserve `high` for tasks that clearly need deeper reasoning. " +
    "The sub-agent cannot ask the user questions and cannot spawn further sub-agents; give it a complete, self-contained task.";

export interface SpawnedAgentCallbacks {
    parentTurnId: string;
    signal: AbortSignal;
    // Invoked as soon as the child turn exists — the caller records the
    // durable parent→child link before the child settles.
    onChildStarted?: (info: {
        childTurnId: string;
        agentName: string;
        task: string;
    }) => Promise<void>;
    // Test seam; production resolves these from the DI container.
    services?: {
        turnRuntime: import("../turns/api.js").ITurnRuntime;
        headlessRunner: import("./headless.js").IHeadlessAgentRunner;
        // Default and cap for the child's model-call budget; production
        // reads the user's global limit setting.
        globalMaxModelCalls?: number;
    };
}

// Runs one spawned child to completion. Never throws for task-level problems
// (bad input, unknown agent/tool, child failure) — those come back as
// isError results so the parent model can react conversationally.
export async function runSpawnedAgent(
    rawInput: unknown,
    opts: SpawnedAgentCallbacks,
): Promise<z.infer<typeof ToolResultData>> {
    const parsed = SpawnAgentInput.safeParse(rawInput);
    if (!parsed.success) {
        return spawnError(`invalid input: ${parsed.error.message}`);
    }
    const input = parsed.data;
    if (input.agent_id && input.instructions) {
        return spawnError(
            "provide at most one of `agent_id` or `instructions`",
        );
    }

    // Lazy: this module is imported by the BuiltinTools catalog, which the
    // DI container's bridges import at startup.
    const { turnRuntime, headlessRunner, globalMaxModelCalls } =
        opts.services ?? (await resolveServices());

    let parentModel: z.infer<typeof ModelDescriptor> | undefined;
    try {
        const parent = reduceTurn(
            (await turnRuntime.getTurn(opts.parentTurnId)).events,
        );
        const parentAgent = parent.definition.agent;
        // Defense in depth for the depth-1 cap: resolvers already strip the
        // spawn tool from children, but a child that somehow holds it must
        // still not recurse.
        if (hasSubagentFlag(parentAgent.requested)) {
            return spawnError("sub-agents cannot spawn further sub-agents");
        }
        parentModel = parentAgent.resolved.model;
    } catch {
        // Parent unreadable (legacy runs path): fall back to app defaults.
        parentModel = undefined;
    }

    // Model precedence: explicit per-spawn args > the user's configured
    // subagent override (taskModels.subagent) > the parent turn's model.
    const subagentOverride = input.model ? null : await readSubagentOverride();
    const model: z.infer<typeof ModelDescriptor> | undefined = input.model
        ? {
              provider: input.provider ?? parentModel?.provider ?? "",
              model: input.model,
          }
        : subagentOverride ?? parentModel;
    if (model && !model.provider) {
        return spawnError(
            "`model` was set but no provider could be determined; pass `provider` too",
        );
    }

    const agentName = input.agent_id ?? input.name ?? "subagent";
    const agent: z.infer<typeof RequestedAgent> = input.agent_id
        ? {
              agentId: input.agent_id,
              overrides: {
                  ...(model ? { model } : {}),
                  composition: { subagent: true },
              },
          }
        : {
              inline: {
                  name: agentName,
                  // The task alone is usually a complete spec — models
                  // routinely omit `instructions` for ad-hoc workers, and
                  // rejecting that just costs a correction round-trip.
                  instructions:
                      input.instructions ?? defaultWorkerInstructions(agentName),
                  ...(model ? { model } : {}),
                  ...(input.tools ? { tools: input.tools } : {}),
              },
          };

    // The user's global limit is both the default and the cap: a parent can
    // grant a child less budget than the setting allows, never more.
    const spawnCap = globalMaxModelCalls ?? DEFAULT_MAX_MODEL_CALLS;
    const maxModelCalls = Math.min(
        input.max_model_calls ?? spawnCap,
        spawnCap,
    );

    let handle: Awaited<ReturnType<typeof headlessRunner.start>>;
    try {
        handle = await headlessRunner.start({
            agent,
            message: input.task,
            maxModelCalls,
            ...(input.reasoning_effort === undefined
                ? {}
                : { reasoningEffort: input.reasoning_effort }),
            signal: opts.signal,
        });
    } catch (error) {
        // Resolution failures (unknown agent id, unknown tool name) reject
        // createTurn before any turn file exists.
        return spawnError(errorText(error));
    }

    await opts.onChildStarted?.({
        childTurnId: handle.turnId,
        agentName,
        task: input.task,
    });

    const result = await handle.done;
    const base = {
        childTurnId: handle.turnId,
        agent: agentName,
        modelCalls: result.state.modelCalls.length,
        usage: result.outcome.usage as JsonValue,
    };
    if (result.outcome.status === "completed") {
        return {
            output: {
                status: "completed",
                result: result.summary ?? "",
                ...base,
            },
            isError: false,
        };
    }
    return {
        output: {
            status: result.outcome.status,
            error:
                result.outcome.status === "failed"
                    ? result.outcome.error
                    : `sub-agent turn was ${result.outcome.status}`,
            // A partial answer is often still useful to the parent.
            ...(result.summary ? { partialResult: result.summary } : {}),
            ...base,
        },
        isError: true,
    };
}

// Lazy for the same import-cycle reason as resolveServices; best-effort —
// an unreadable config means "no override", never a failed spawn.
async function readSubagentOverride(): Promise<
    z.infer<typeof ModelDescriptor> | null
> {
    try {
        const { getSubagentModelOverride } = await import(
            "../../models/defaults.js"
        );
        return await getSubagentModelOverride();
    } catch {
        return null;
    }
}

async function resolveServices(): Promise<
    NonNullable<SpawnedAgentCallbacks["services"]>
> {
    const { lazyResolve } = await import("../../di/lazy-resolve.js");
    const { loadTurnLimitsSettings } = await import(
        "../../config/turn_limits.js"
    );
    return {
        turnRuntime:
            await lazyResolve<import("../turns/api.js").ITurnRuntime>(
                "turnRuntime",
            ),
        headlessRunner: await lazyResolve<
            import("./headless.js").IHeadlessAgentRunner
        >("headlessAgentRunner"),
        globalMaxModelCalls: (await loadTurnLimitsSettings()).maxModelCalls,
    };
}

function spawnError(message: string): z.infer<typeof ToolResultData> {
    return { output: `spawn-agent: ${message}`, isError: true };
}

function defaultWorkerInstructions(name: string): string {
    return (
        `You are ${name}, a sub-agent spawned to complete a single task. ` +
        "You run headlessly: no user is available to clarify or approve, and your final message is your only output. " +
        "Work autonomously with the tools you have, then end with a complete, self-contained answer to the task."
    );
}

// True for any child-shaped parent: inline agents only exist as spawned
// children, and by-id children carry the subagent composition flag.
function hasSubagentFlag(
    requested: z.infer<typeof RequestedAgent>,
): boolean {
    if (isInlineAgentRequest(requested)) {
        return true;
    }
    const composition = requested.overrides?.composition;
    return (
        typeof composition === "object" &&
        composition !== null &&
        !Array.isArray(composition) &&
        composition.subagent === true
    );
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
