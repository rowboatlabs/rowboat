// Builtin tools: background-tasks domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";

import * as path from "path";
import container from "../../../di/container.js";
import { BackgroundTaskSchema, TriggersSchema } from "@x/shared/dist/background-task.js";
import * as gitService from "../../../code-mode/git/service.js";
import type { ICodeProjectsRepo } from "../../../code-mode/projects/repo.js";
import { expandHomePath } from "../../../filesystem/files.js";

// Inputs for the bg-task builtin tools. Reuse the canonical schema field
// descriptions; only `triggers` gets a tighter contextual override (the
// shared TriggersSchema description is written from the live-note perspective).
export const CreateBackgroundTaskInput = BackgroundTaskSchema.pick({
    name: true,
    instructions: true,
    triggers: true,
    model: true,
    provider: true,
}).extend({
    triggers: TriggersSchema.optional().describe('All three sub-fields (cronExpr, windows, eventMatchCriteria) are independently optional — mix freely. No triggers at all = manual-only (user clicks Run).'),
    projectDir: z.string().optional().describe(
        "Set this ONLY when the user wants the task to WRITE CODE. An absolute path (or ~/…) to a LOCAL GIT REPOSITORY with at least one commit. It turns this into a *coding task*: each run scans the trigger source for actionable items and implements them autonomously in isolated git worktrees off this repo — never touching the user's checkout. Extract the directory from the user's request (e.g. 'use ~/Work/space/test as the work directory'). Omit for ordinary output/action tasks.",
    ),
});

export const PatchBackgroundTaskInput = BackgroundTaskSchema.pick({
    name: true,
    instructions: true,
    active: true,
    triggers: true,
    model: true,
    provider: true,
}).partial().extend({
    slug: z.string().describe('The slug of the task to update (the folder name under bg-tasks/).'),
    triggers: TriggersSchema.optional().describe('Replace the triggers object. To remove all triggers (make manual-only) pass an empty object.'),
    projectDir: z.string().optional().describe("Point an existing task at a code repo (or change which one) to make it a coding task. Absolute path or ~/… to a local git repository with at least one commit. Same rules as on create."),
    clearModel: z.boolean().optional().describe("Reset the task's model/provider override so it falls back to the default. Use this to unstick a bad/rejected model value (do not also pass model)."),
});

export async function resolveCodeProject(dirPath: string): Promise<
    { ok: true; projectId: string; path: string; warning?: string } | { ok: false; error: string }
> {
    const abs = path.resolve(expandHomePath(dirPath));
    const projectsRepo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
    let project: Awaited<ReturnType<ICodeProjectsRepo['add']>>;
    try {
        project = await projectsRepo.add(abs);
    } catch (err) {
        return { ok: false, error: `Could not use '${dirPath}' as a code directory: ${err instanceof Error ? err.message : String(err)}` };
    }
    // Worktree isolation needs a real git repo with at least one commit
    // (codeSessionService.create throws otherwise). Surface it now as a soft
    // warning rather than letting the next run fail silently.
    let warning: string | undefined;
    try {
        const info = await gitService.repoInfo(project.path);
        if (!info.isGitRepo) warning = `${project.path} is not a git repository yet — run \`git init\` and make a commit, or the coding sessions will fail.`;
        else if (!info.hasCommits) warning = `${project.path} has no commits yet — make an initial commit, or the coding sessions will fail.`;
    } catch { /* best effort — worktree creation will surface it later */ }
    return { ok: true, projectId: project.id, path: project.path, ...(warning ? { warning } : {}) };
}



export const backgroundTaskTools: z.infer<typeof BuiltinToolsSchema> = {
    'create-background-task': {
        permission: "none",
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
        permission: "none",
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
        permission: "none",
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
