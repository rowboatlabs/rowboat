import z from "zod";

// "triggered" is terminal state for once-schedules (will not run again)
export const AgentScheduleStatus = z.enum(["scheduled", "running", "finished", "failed", "triggered"]);

export const AgentScheduleStateEntry = z.object({
    status: AgentScheduleStatus,
    startedAt: z.string().nullable(), // When current run started (for timeout detection)
    lastRunAt: z.string().nullable(), // ISO 8601 local datetime
    nextRunAt: z.string().nullable(), // ISO 8601 local datetime
    lastError: z.string().nullable(),
    runCount: z.number().default(0),
});

export const AgentScheduleState = z.object({
    agents: z.record(z.string(), AgentScheduleStateEntry),
});
