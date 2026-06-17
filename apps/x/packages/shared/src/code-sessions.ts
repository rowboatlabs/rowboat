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
    createdAt: z.iso.datetime(),
    lastActivityAt: z.iso.datetime().optional(),
});
export type CodeSession = z.infer<typeof CodeSession>;

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
