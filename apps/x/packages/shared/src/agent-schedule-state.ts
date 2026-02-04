import z from "zod";

// "triggered" is terminal state for once-schedules (will not run again)
export const AgentScheduleStatus = z.enum(["scheduled", "running", "finished", "failed", "triggered"]);

export const AgentScheduleStateEntry = z.object({
    status: AgentScheduleStatus,
    lastRunAt: z.string().datetime().nullable(),
    nextRunAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
    runCount: z.number().default(0),
});

export const AgentScheduleState = z.object({
    agents: z.record(z.string(), AgentScheduleStateEntry),
});
