import z from "zod";

// Cron schedule - runs at exact times defined by cron expression.
// Examples:
//   - Every 5 minutes: "*/5 * * * *"
//   - Everyday at 8am: "0 8 * * *"
//   - Every Monday at 9am: "0 9 * * 1"
export const CronSchedule = z.object({
    type: z.literal("cron"),
    expression: z.string(),
});

// Window schedule - runs once during a time window.
// The agent will run once at a random time within the specified window.
// Examples:
//   - Daily between 8am and 10am: cron="0 0 * * *", startTime="08:00", endTime="10:00"
//   - Weekly on Monday between 9am-12pm: cron="0 0 * * 1", startTime="09:00", endTime="12:00"
export const WindowSchedule = z.object({
    type: z.literal("window"),
    cron: z.string(), // Base frequency cron expression
    startTime: z.string(), // "HH:MM" format
    endTime: z.string(), // "HH:MM" format
});

// Once schedule - runs exactly once at a specific time, then never again.
// Examples:
//   - Run once at specific datetime: runAt="2024-02-05T10:30:00"
export const OnceSchedule = z.object({
    type: z.literal("once"),
    runAt: z.string(), // ISO 8601 datetime (local time, e.g., "2024-02-05T10:30:00")
});

export const ScheduleDefinition = z.union([CronSchedule, WindowSchedule, OnceSchedule]);

export const AgentScheduleEntry = z.object({
    schedule: ScheduleDefinition,
    enabled: z.boolean().optional().default(true),
    startingMessage: z.string().optional(), // Message sent to agent when run starts (defaults to "go")
    description: z.string().optional(), // Brief description of what the agent does (for UI display)
});

export const AgentScheduleConfig = z.object({
    agents: z.record(z.string(), AgentScheduleEntry),
});
