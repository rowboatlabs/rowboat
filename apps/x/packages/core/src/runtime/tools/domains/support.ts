// Shared support for the builtin-tools domain modules: the catalog schema
// and the helpers/input-schemas the tool entries use. Extracted verbatim
// from the historical monolith.

import { z, ZodType } from "zod";
import * as path from "path";
import * as os from "os";
import container from "../../../di/container.js";
import { BackgroundTaskSchema, TriggersSchema } from "@x/shared/dist/background-task.js";
import type { CodeRunEvent as CodeRunEventType } from "@x/shared/dist/code-mode.js";
import type { ICodeProjectsRepo } from "../../../code-mode/projects/repo.js";
import * as gitService from "../../../code-mode/git/service.js";

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

// Turn a user-supplied directory into a registered code project id. Reuses the
// same idempotent registry the Code-section picker writes to (add() validates the
// dir exists & is a directory, and dedupes by resolved path). Returns a soft
// `warning` — not an error — when the repo isn't yet worktree-ready, so the task
// still gets created and the copilot can tell the user what to fix.
export function expandHome(p: string): string {
    const t = p.trim();
    if (t === '~') return os.homedir();
    if (t.startsWith('~/') || t.startsWith(`~${path.sep}`)) return path.join(os.homedir(), t.slice(2));
    return t;
}

// Shrink a code-run timeline for durable storage: consecutive same-role message
// chunks merge into one event. Display-lossless — the timeline renderer
// concatenates consecutive messages anyway (CodingRunTimeline) — and typically
// collapses the ~90% of a run's events that are per-token text deltas.
// Everything else (tool calls/updates, plans, permissions) is kept verbatim in
// order: updates are id-keyed transitions and must not be merged.
export function coalesceCodeRunEvents(events: CodeRunEventType[]): CodeRunEventType[] {
    const out: CodeRunEventType[] = [];
    for (const event of events) {
        const last = out[out.length - 1];
        if (
            event.type === 'message' && last?.type === 'message' && last.role === event.role
        ) {
            out[out.length - 1] = { ...last, text: last.text + event.text };
        } else {
            out.push(event);
        }
    }
    return out;
}

export async function resolveCodeProject(dirPath: string): Promise<
    { ok: true; projectId: string; path: string; warning?: string } | { ok: false; error: string }
> {
    const abs = path.resolve(expandHome(dirPath));
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
// Parser libraries are loaded dynamically inside parseFile.execute()
// to avoid pulling pdfjs-dist's DOM polyfills into the main bundle.
// Import paths are computed so esbuild cannot statically resolve them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const _importDynamic = new Function('mod', 'return import(mod)') as (mod: string) => Promise<any>;

export const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(), // (input, ctx?) => Promise<any>
        output: z.promise(z.any()),
    }),
    isAvailable: z.custom<() => Promise<boolean>>().optional(),
}));

export const LLMPARSE_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
};
