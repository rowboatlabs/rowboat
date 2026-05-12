import z from 'zod';

// ---------------------------------------------------------------------------
// Live notes
// ---------------------------------------------------------------------------
//
// A live note is a markdown file whose body is kept current by a background
// agent. The user expresses intent via the `live:` block in the note's YAML
// frontmatter:
//
//     ---
//     live:
//       objective: |
//         Keep this note current with major developments in AI coding agents.
//       active: true
//       triggers:
//         cronExpr: "0 * * * *"
//         windows:
//           - { startTime: "09:00", endTime: "12:00" }
//         eventMatchCriteria: |
//           News, tweets, or emails about AI coding agents.
//       model: anthropic/claude-haiku-4.5
//       provider: anthropic
//     ---
//
// A note with no `live:` key is passive. Manual-only is `live:` with no
// `triggers` (or all three trigger fields absent).
// ---------------------------------------------------------------------------

// Hand-written types — single source of truth. Zod schemas below validate at
// runtime *against* these types via `satisfies`. We don't `z.infer` here
// because the resulting types pass through Zod's generic machinery and can
// resolve to `any` once the dist .d.ts is consumed downstream (project-
// references build, mismatched zod resolution, etc.). Plain types are stable.

export type TriggerWindow = {
    startTime: string;
    endTime: string;
};

export type Triggers = {
    cronExpr?: string;
    windows?: TriggerWindow[];
    eventMatchCriteria?: string;
};

export type LiveNote = {
    objective: string;
    active: boolean;
    triggers?: Triggers;
    model?: string;
    provider?: string;
    lastAttemptAt?: string;
    lastRunAt?: string;
    lastRunId?: string;
    lastRunSummary?: string;
    lastRunError?: string;
};

const TriggerWindowSchema = z.object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('24h HH:MM, local time. Also the daily cycle anchor — once the agent fires after this time, the window is done for the day.'),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('24h HH:MM, local time. After this, the window is closed for the day.'),
});

export const TriggersSchema = z.object({
    cronExpr: z.string().optional().describe('5-field cron expression (e.g. "0 * * * *"). Always quote when written by hand. Omit to skip cron-driven runs.'),
    windows: z.array(TriggerWindowSchema).optional().describe('A list of daily time-of-day bands. The agent fires once per day per window, anywhere inside the band — useful for "sometime in the morning" rather than an exact clock time. Omit to skip window-driven runs.'),
    eventMatchCriteria: z.string().optional().describe('Natural-language description of which incoming events (emails, calendar changes, etc.) should wake this note. Pass 1 routing uses this to decide candidacy; the agent does Pass 2 on the event payload. Omit to skip event-driven runs.'),
}).describe('When the live-note agent fires. Each field is optional — omit any/all. The whole `triggers` object is also optional; absent (or fully empty) means manual-only.');

export const LiveNoteSchema = z.object({
    objective: z.string().min(1).describe('A persistent intent in the user\'s words — what should this note keep being? E.g. "Keep this note updated with important developments in AI coding agents." The agent re-reads the objective on every run and is responsible for maintaining the entire body to satisfy it.'),
    active: z.boolean().default(true).describe('Set false to pause without deleting.'),
    triggers: TriggersSchema.optional().describe('When the agent fires. Omit for manual-only.'),
    model: z.string().optional().describe('ADVANCED — leave unset. Per-note LLM model override (e.g. "anthropic/claude-sonnet-4.6"). Only set when the user explicitly asked for a specific model for THIS note. The global default already picks a tuned model for live-note runs; overriding usually makes things worse, not better.'),
    provider: z.string().optional().describe('ADVANCED — leave unset. Per-note provider name override (e.g. "openai", "anthropic"). Almost always omitted; the global default flows through correctly.'),
    lastAttemptAt: z.string().optional().describe('Runtime-managed — never write this yourself. Bumped at the start of every agent run; used by the scheduler for backoff so failures do not retry-storm.'),
    lastRunAt: z.string().optional().describe('Runtime-managed — never write this yourself. Bumped only when an agent run *succeeds*; used as the cycle anchor for cron / window triggers and as the freshness timestamp shown in the UI.'),
    lastRunId: z.string().optional().describe('Runtime-managed — never write this yourself. The id of the most recent run (success or failure); used by the live-note:stop handler.'),
    lastRunSummary: z.string().optional().describe('Runtime-managed — never write this yourself. Set on success; not overwritten on failure so the user keeps seeing the last good summary.'),
    lastRunError: z.string().optional().describe('Runtime-managed — never write this yourself. Set on a failed run; cleared on the next successful run.'),
});

// ---------------------------------------------------------------------------
// Knowledge events (live-note event-driven pipeline)
// ---------------------------------------------------------------------------

// Legacy aliases — `KnowledgeEventSchema` / `Pass1OutputSchema` now live in
// `./events.ts` as `RowboatEventSchema` / `Pass1OutputSchema`. These re-exports
// keep older import paths working for one release; remove after nothing imports
// them from here.
export { RowboatEventSchema as KnowledgeEventSchema, Pass1OutputSchema } from './events.js';
export type { RowboatEvent as KnowledgeEvent, Pass1Output } from './events.js';

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

export const LiveNoteTrigger = z.enum(['manual', 'cron', 'window', 'event']);
export type LiveNoteTriggerType = z.infer<typeof LiveNoteTrigger>;

export const LiveNoteAgentStartEvent = z.object({
    type: z.literal('live_note_agent_start'),
    filePath: z.string(),
    trigger: LiveNoteTrigger,
    runId: z.string(),
});

export const LiveNoteAgentCompleteEvent = z.object({
    type: z.literal('live_note_agent_complete'),
    filePath: z.string(),
    runId: z.string(),
    error: z.string().optional(),
    summary: z.string().optional(),
});

export const LiveNoteAgentEvent = z.union([LiveNoteAgentStartEvent, LiveNoteAgentCompleteEvent]);
export type LiveNoteAgentEventType = z.infer<typeof LiveNoteAgentEvent>;
