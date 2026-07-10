// Builtin tools: background-tasks domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import {
    CreateBackgroundTaskInput,
    PatchBackgroundTaskInput,
    resolveCodeProject,
    BuiltinToolsSchema,
} from "./support.js";


export const backgroundTaskTools: z.infer<typeof BuiltinToolsSchema> = {
    'create-background-task': {
        description: "Create a new background task on disk. This is the tool you call to materialize a bg-task — do NOT try to write `task.yaml` yourself with file-editText, and do NOT search the codebase for IPC channels like `bg-task:create`. The framework slugifies the name and lays out `bg-tasks/<slug>/{task.yaml,index.md,runs/}`. After this returns, immediately call `run-background-task-agent` with the returned slug so the user sees content right away.",
        inputSchema: CreateBackgroundTaskInput,
        execute: async (input: z.infer<typeof CreateBackgroundTaskInput>) => {
            try {
                let projectId: string | undefined;
                let warning: string | undefined;
                if (input.projectDir) {
                    const r = await resolveCodeProject(input.projectDir);
                    if (!r.ok) return { success: false, error: r.error };
                    projectId = r.projectId;
                    warning = r.warning;
                }
                const { createTask } = await import("../../../background-tasks/fileops.js");
                const result = await createTask({
                    name: input.name,
                    instructions: input.instructions,
                    ...(input.triggers ? { triggers: input.triggers } : {}),
                    ...(projectId ? { projectId } : {}),
                    ...(input.model ? { model: input.model } : {}),
                    ...(input.provider ? { provider: input.provider } : {}),
                });
                return { success: true, slug: result.slug, ...(warning ? { warning } : {}) };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    },

    'patch-background-task': {
        description: "Update an existing background task — instructions, triggers, active, or model/provider. Use this when the user's new ask overlaps with an existing task (extend-don't-fork): rewrite the instructions in full to absorb the new ask rather than creating a duplicate sibling task. Look up existing tasks with `file-glob` on `bg-tasks/*/task.yaml` and `file-readText` on the candidates first.",
        inputSchema: PatchBackgroundTaskInput,
        execute: async (input: z.infer<typeof PatchBackgroundTaskInput>) => {
            try {
                const { patchTask } = await import("../../../background-tasks/fileops.js");
                const { slug, projectDir, clearModel, ...partial } = input;
                let warning: string | undefined;
                if (projectDir) {
                    const r = await resolveCodeProject(projectDir);
                    if (!r.ok) return { success: false, error: r.error };
                    (partial as { projectId?: string }).projectId = r.projectId;
                    warning = r.warning;
                }
                const result = await patchTask(slug, partial, clearModel ? ['model', 'provider'] : []);
                return { success: true, task: result, ...(warning ? { warning } : {}) };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    },

    'run-background-task-agent': {
        description: "Manually trigger a background task to run now. Equivalent to the user clicking the Run button in the Background Task detail view. Pass extra `context` to bias what the agent does this run (e.g. a backfill instruction) — does NOT modify the task's persistent instructions.",
        inputSchema: z.object({
            slug: z.string().describe("The slug of the bg-task to run (e.g., 'morning-weather'). The slug is what `bg-task:create` returns."),
            context: z.string().optional().describe(
                "Optional extra context for THIS run only — does not modify the task's instructions. " +
                "Use it for backfills (e.g. 'Backfill from emails received in the last 7 days') " +
                "or focused refreshes (e.g. 'Focus on changes since yesterday'). " +
                "Omit for a plain run."
            ),
        }),
        execute: async ({ slug, context }: { slug: string; context?: string }) => {
            try {
                // Lazy import to break a module-init cycle, mirroring run-live-note-agent.
                const { runBackgroundTask } = await import("../../../background-tasks/runner.js");
                const result = await runBackgroundTask(slug, 'manual', context);
                return {
                    success: !result.error,
                    runId: result.runId,
                    summary: result.summary,
                    error: result.error,
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { success: false, error: msg };
            }
        },
    },
};
