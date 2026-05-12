import z from 'zod';
import { TriggersSchema, type Triggers, type TriggerWindow } from './live-note.js';

// ---------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------
//
// A bg-task is a persistent agent set up to fire on a schedule and/or in
// response to incoming events. Each task owns a folder under
// `$WorkDir/bg-tasks/<slug>/`:
//
//   bg-tasks/<slug>/
//   ├── task.yaml      # plain YAML: BackgroundTask shape
//   ├── index.md       # agent-owned body — the user-visible artifact
//   └── runs/          # one <runId>.jsonl per run (written by agent runtime)
//
// The agent picks between OUTPUT mode (rewrite index.md with the latest state)
// and ACTION mode (perform a side-effect, append a journal entry) based on
// the verbs in `instructions` each run. No mode field on the task.
// ---------------------------------------------------------------------------

// Re-export triggers so callers don't need a second import.
export { TriggersSchema, type Triggers, type TriggerWindow };

export type BackgroundTask = {
    name: string;
    instructions: string;
    active: boolean;
    triggers?: Triggers;
    model?: string;
    provider?: string;
    createdAt: string;
    // Runtime-managed — never hand-write. Mirrors live-note's flat-field
    // pattern: `lastAttemptAt` is bumped at every run start (backoff anchor),
    // `lastRunAt` / `lastRunSummary` only on successful completion, `lastRunError`
    // only on failure (cleared on next success). This keeps the "last good run"
    // visible even while a new run is in-flight or failing.
    lastAttemptAt?: string;
    lastRunId?: string;
    lastRunAt?: string;
    lastRunSummary?: string;
    lastRunError?: string;
};

export type BackgroundTaskSummary = {
    slug: string;
    name: string;
    instructions: string;
    active: boolean;
    triggers?: Triggers;
    createdAt: string;
    lastAttemptAt?: string;
    lastRunId?: string;
    lastRunAt?: string;
    lastRunSummary?: string;
    lastRunError?: string;
};

export const BackgroundTaskSchema = z.object({
    name: z.string().min(1).describe('User-facing display name.'),
    instructions: z.string().min(1).describe('A persistent instruction in the user\'s words — what should this task keep doing? E.g. "Summarize my unread emails every morning into a brief digest." The agent re-reads instructions on every run and decides whether to rewrite index.md (OUTPUT mode) or perform a side-effect and journal it (ACTION mode) based on the verbs.'),
    active: z.boolean().default(true).describe('Set false to pause without deleting.'),
    triggers: TriggersSchema.optional().describe('When the agent fires. Omit for manual-only.'),
    model: z.string().optional().describe('ADVANCED — leave unset. Per-task model override.'),
    provider: z.string().optional().describe('ADVANCED — leave unset. Per-task provider name override.'),
    createdAt: z.string().describe('ISO timestamp set once at create-time.'),
    lastAttemptAt: z.string().optional().describe('Runtime-managed — never write this yourself. Bumped at the start of every agent run; used by the scheduler for backoff so failures do not retry-storm.'),
    lastRunId: z.string().optional().describe('Runtime-managed — never write this yourself. The id of the most recent run (success or failure); used by the bg-task:stop handler.'),
    lastRunAt: z.string().optional().describe('Runtime-managed — never write this yourself. Bumped only when an agent run *succeeds*; used as the cycle anchor for cron / window triggers and as the freshness timestamp shown in the UI.'),
    lastRunSummary: z.string().optional().describe('Runtime-managed — never write this yourself. Set on success; not overwritten on failure so the user keeps seeing the last good summary.'),
    lastRunError: z.string().optional().describe('Runtime-managed — never write this yourself. Set on a failed run; cleared on the next successful run.'),
});

export const BackgroundTaskSummarySchema = z.object({
    slug: z.string(),
    name: z.string(),
    instructions: z.string(),
    active: z.boolean(),
    triggers: TriggersSchema.optional(),
    createdAt: z.string(),
    lastAttemptAt: z.string().optional(),
    lastRunId: z.string().optional(),
    lastRunAt: z.string().optional(),
    lastRunSummary: z.string().optional(),
    lastRunError: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

export const BackgroundTaskTrigger = z.enum(['manual', 'cron', 'window', 'event']);
export type BackgroundTaskTriggerType = z.infer<typeof BackgroundTaskTrigger>;

export const BackgroundTaskAgentStartEvent = z.object({
    type: z.literal('background_task_agent_start'),
    slug: z.string(),
    trigger: BackgroundTaskTrigger,
    runId: z.string(),
});

export const BackgroundTaskAgentCompleteEvent = z.object({
    type: z.literal('background_task_agent_complete'),
    slug: z.string(),
    runId: z.string(),
    error: z.string().optional(),
    summary: z.string().optional(),
});

export const BackgroundTaskAgentEvent = z.union([BackgroundTaskAgentStartEvent, BackgroundTaskAgentCompleteEvent]);
export type BackgroundTaskAgentEventType = z.infer<typeof BackgroundTaskAgentEvent>;
