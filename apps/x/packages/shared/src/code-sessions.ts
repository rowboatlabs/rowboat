import z from "zod";
import { CodingAgent, ApprovalPolicy } from "./code-mode.js";

// Shared zod schemas for the Code section: registered projects and coding
// sessions. A coding session is backed by a run (session id == run id); the
// mutable metadata below lives in its own per-session file.

export const CodeProject = z.object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    addedAt: z.iso.datetime(),
});
export type CodeProject = z.infer<typeof CodeProject>;

// Git facts about a project path, used to gate worktree creation in the UI.
export const GitRepoInfo = z.object({
    isGitRepo: z.boolean(),
    branch: z.string().nullable(),
    hasCommits: z.boolean(),
    dirtyCount: z.number(),
});
export type GitRepoInfo = z.infer<typeof GitRepoInfo>;

// 'direct': the user's messages go straight to the ACP coding agent.
// 'rowboat': Rowboat's copilot LLM orchestrates the agent via code_agent_run.
export const CodeSessionMode = z.enum(["direct", "rowboat"]);
export type CodeSessionMode = z.infer<typeof CodeSessionMode>;

// Derived live in the main process from the run event stream; not persisted.
export const CodeSessionStatus = z.enum(["working", "needs-you", "idle"]);
export type CodeSessionStatus = z.infer<typeof CodeSessionStatus>;

export const CodeWorktree = z.object({
    path: z.string(),
    branch: z.string(),
    // Branch the original checkout was on when the worktree was created;
    // merge-back targets whatever the checkout is on at merge time, this is
    // informational.
    baseBranch: z.string().nullable(),
    mergedAt: z.iso.datetime().optional(),
    removedAt: z.iso.datetime().optional(),
});
export type CodeWorktree = z.infer<typeof CodeWorktree>;

export const CodeSession = z.object({
    id: z.string(), // == runId
    projectId: z.string(),
    title: z.string(),
    agent: CodingAgent,
    mode: CodeSessionMode,
    policy: ApprovalPolicy,
    // Where the agent works: the project path, or the worktree path.
    cwd: z.string(),
    worktree: CodeWorktree.optional(),
    // The coding agent's own model + reasoning effort (applied to the ACP engine,
    // not the Rowboat-mode LLM). Values come from CODE_AGENT_MODELS /
    // CODE_AGENT_EFFORTS; unset (or 'default') leaves the engine's own default.
    agentModel: z.string().optional(),
    agentEffort: z.string().optional(),
    createdAt: z.iso.datetime(),
    lastActivityAt: z.iso.datetime().optional(),
});
export type CodeSession = z.infer<typeof CodeSession>;

// Model + effort choices for the ACP coding agents are discovered live from the
// engine (the same list `/model` shows), not hardcoded — so they always reflect
// whatever the provider currently offers. See the `codeMode:listModelOptions`
// IPC and CodeModeManager.listModelOptions. 'default' is a synthetic sentinel
// meaning "don't override the engine default".
//
// Claude exposes model and effort as two independent options; Codex folds the
// reasoning effort into the model id ("gpt-5-codex[high]") and so reports no
// separate effort list. The UI renders whatever each agent advertises.
export const CodeAgentOption = z.object({ value: z.string(), label: z.string() });
export type CodeAgentOption = z.infer<typeof CodeAgentOption>;

export const CodeAgentModelOptions = z.object({
    models: z.array(CodeAgentOption),
    efforts: z.array(CodeAgentOption),
});
export type CodeAgentModelOptions = z.infer<typeof CodeAgentModelOptions>;

export const GitFileState = z.enum(["modified", "added", "deleted", "untracked", "renamed"]);
export type GitFileState = z.infer<typeof GitFileState>;

export const GitStatusFile = z.object({
    path: z.string(),
    state: GitFileState,
    // Null when git can't compute line counts (binary files).
    insertions: z.number().nullable(),
    deletions: z.number().nullable(),
});
export type GitStatusFile = z.infer<typeof GitStatusFile>;
