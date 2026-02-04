import { CronExpressionParser } from "cron-parser";
import container from "../di/container.js";
import { IAgentScheduleRepo } from "./repo.js";
import { IAgentScheduleStateRepo } from "./state-repo.js";
import { IRunsRepo } from "../runs/repo.js";
import { IAgentRuntime } from "../agents/runtime.js";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { AgentScheduleConfig, AgentScheduleEntry } from "@x/shared/dist/agent-schedule.js";
import { AgentScheduleState, AgentScheduleStateEntry } from "@x/shared/dist/agent-schedule-state.js";
import { MessageEvent } from "@x/shared/dist/runs.js";
import z from "zod";

const DEFAULT_STARTING_MESSAGE = "go";

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Convert a Date to local ISO 8601 string (without Z suffix).
 * Example: "2024-02-05T08:30:00"
 */
function toLocalISOString(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// --- Wake Signal for Immediate Run Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerRun(): void {
    if (wakeResolve) {
        console.log("[AgentRunner] Triggered - waking up immediately");
        wakeResolve();
        wakeResolve = null;
    }
}

function interruptibleSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            wakeResolve = null;
            resolve();
        }, ms);
        wakeResolve = () => {
            clearTimeout(timeout);
            resolve();
        };
    });
}

/**
 * Calculate the next run time for a schedule.
 * Returns ISO datetime string or null if schedule shouldn't run again.
 */
function calculateNextRunAt(
    schedule: z.infer<typeof AgentScheduleEntry>["schedule"]
): string | null {
    const now = new Date();

    switch (schedule.type) {
        case "cron": {
            try {
                const interval = CronExpressionParser.parse(schedule.expression, {
                    currentDate: now,
                });
                return toLocalISOString(interval.next().toDate());
            } catch (error) {
                console.error("[AgentRunner] Invalid cron expression:", schedule.expression, error);
                return null;
            }
        }
        case "window": {
            try {
                // Parse base cron to get the next occurrence date
                const interval = CronExpressionParser.parse(schedule.cron, {
                    currentDate: now,
                });
                const nextDate = interval.next().toDate();

                // Parse start and end times
                const [startHour, startMin] = schedule.startTime.split(":").map(Number);
                const [endHour, endMin] = schedule.endTime.split(":").map(Number);

                // Pick a random time within the window
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                const randomMinutes = startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes));

                nextDate.setHours(Math.floor(randomMinutes / 60), randomMinutes % 60, 0, 0);
                return toLocalISOString(nextDate);
            } catch (error) {
                console.error("[AgentRunner] Invalid window schedule:", error);
                return null;
            }
        }
        case "once": {
            // Once schedules don't have a "next" run - they're done after first run
            return null;
        }
    }
}

/**
 * Check if an agent should run now based on its schedule and state.
 */
function shouldRunNow(
    entry: z.infer<typeof AgentScheduleEntry>,
    state: z.infer<typeof AgentScheduleStateEntry> | null
): boolean {
    // Don't run if disabled
    if (entry.enabled === false) {
        return false;
    }

    // Don't run if already running
    if (state?.status === "running") {
        return false;
    }

    // Don't run once-schedules that are already triggered
    if (entry.schedule.type === "once" && state?.status === "triggered") {
        return false;
    }

    const now = new Date();

    // For once-schedules without state, check if runAt time has passed
    if (entry.schedule.type === "once") {
        const runAt = new Date(entry.schedule.runAt);
        return now >= runAt;
    }

    // For cron and window schedules, check nextRunAt
    if (!state?.nextRunAt) {
        // No nextRunAt set - needs to be initialized, so run now
        return true;
    }

    const nextRunAt = new Date(state.nextRunAt);
    return now >= nextRunAt;
}

/**
 * Run a single agent.
 */
async function runAgent(
    agentName: string,
    entry: z.infer<typeof AgentScheduleEntry>,
    stateRepo: IAgentScheduleStateRepo,
    runsRepo: IRunsRepo,
    agentRuntime: IAgentRuntime,
    idGenerator: IMonotonicallyIncreasingIdGenerator
): Promise<void> {
    console.log(`[AgentRunner] Starting agent: ${agentName}`);

    const startedAt = toLocalISOString(new Date());

    // Update state to running with startedAt timestamp
    await stateRepo.updateAgentState(agentName, {
        status: "running",
        startedAt: startedAt,
    });

    try {
        // Create a new run
        const run = await runsRepo.create({ agentId: agentName });
        console.log(`[AgentRunner] Created run ${run.id} for agent ${agentName}`);

        // Add the starting message as a user message
        const startingMessage = entry.startingMessage ?? DEFAULT_STARTING_MESSAGE;
        const messageEvent: z.infer<typeof MessageEvent> = {
            runId: run.id,
            type: "message",
            messageId: await idGenerator.next(),
            message: {
                role: "user",
                content: startingMessage,
            },
            subflow: [],
        };
        await runsRepo.appendEvents(run.id, [messageEvent]);
        console.log(`[AgentRunner] Sent starting message to agent ${agentName}: "${startingMessage}"`);

        // Trigger the run
        await agentRuntime.trigger(run.id);

        // Calculate next run time
        const nextRunAt = calculateNextRunAt(entry.schedule);

        // Update state to finished (clear startedAt)
        const currentState = await stateRepo.getAgentState(agentName);
        await stateRepo.updateAgentState(agentName, {
            status: entry.schedule.type === "once" ? "triggered" : "finished",
            startedAt: null,
            lastRunAt: toLocalISOString(new Date()),
            nextRunAt: nextRunAt,
            lastError: null,
            runCount: (currentState?.runCount ?? 0) + 1,
        });

        console.log(`[AgentRunner] Finished agent: ${agentName}`);
    } catch (error) {
        console.error(`[AgentRunner] Error running agent ${agentName}:`, error);

        // Calculate next run time even on failure (for retry)
        const nextRunAt = calculateNextRunAt(entry.schedule);

        // Update state to failed (clear startedAt)
        const currentState = await stateRepo.getAgentState(agentName);
        await stateRepo.updateAgentState(agentName, {
            status: "failed",
            startedAt: null,
            lastRunAt: toLocalISOString(new Date()),
            nextRunAt: nextRunAt,
            lastError: error instanceof Error ? error.message : String(error),
            runCount: (currentState?.runCount ?? 0) + 1,
        });
    }
}

/**
 * Check for timed-out agents and mark them as failed.
 */
async function checkForTimeouts(
    state: z.infer<typeof AgentScheduleState>,
    config: z.infer<typeof AgentScheduleConfig>,
    stateRepo: IAgentScheduleStateRepo
): Promise<void> {
    const now = new Date();

    for (const [agentName, agentState] of Object.entries(state.agents)) {
        if (agentState.status === "running" && agentState.startedAt) {
            const startedAt = new Date(agentState.startedAt);
            const elapsed = now.getTime() - startedAt.getTime();

            if (elapsed > TIMEOUT_MS) {
                console.log(`[AgentRunner] Agent ${agentName} timed out after ${Math.round(elapsed / 1000 / 60)} minutes`);

                // Get schedule entry for calculating next run
                const entry = config.agents[agentName];
                const nextRunAt = entry ? calculateNextRunAt(entry.schedule) : null;

                await stateRepo.updateAgentState(agentName, {
                    status: "failed",
                    startedAt: null,
                    lastRunAt: toLocalISOString(now),
                    nextRunAt: nextRunAt,
                    lastError: `Timed out after ${Math.round(elapsed / 1000 / 60)} minutes`,
                    runCount: (agentState.runCount ?? 0) + 1,
                });
            }
        }
    }
}

/**
 * Main polling loop.
 */
async function pollAndRun(): Promise<void> {
    const scheduleRepo = container.resolve<IAgentScheduleRepo>("agentScheduleRepo");
    const stateRepo = container.resolve<IAgentScheduleStateRepo>("agentScheduleStateRepo");
    const runsRepo = container.resolve<IRunsRepo>("runsRepo");
    const agentRuntime = container.resolve<IAgentRuntime>("agentRuntime");
    const idGenerator = container.resolve<IMonotonicallyIncreasingIdGenerator>("idGenerator");

    // Load config and state
    let config: z.infer<typeof AgentScheduleConfig>;
    let state: z.infer<typeof AgentScheduleState>;

    try {
        config = await scheduleRepo.getConfig();
        state = await stateRepo.getState();
    } catch (error) {
        console.error("[AgentRunner] Error loading config/state:", error);
        return;
    }

    // Check for timed-out agents first
    await checkForTimeouts(state, config, stateRepo);

    // Reload state after timeout checks (state may have changed)
    try {
        state = await stateRepo.getState();
    } catch (error) {
        console.error("[AgentRunner] Error reloading state:", error);
        return;
    }

    // Check each agent
    for (const [agentName, entry] of Object.entries(config.agents)) {
        const agentState = state.agents[agentName] ?? null;

        // Initialize state if needed (set nextRunAt for new agents)
        if (!agentState && entry.schedule.type !== "once") {
            const nextRunAt = calculateNextRunAt(entry.schedule);
            if (nextRunAt) {
                await stateRepo.updateAgentState(agentName, {
                    status: "scheduled",
                    startedAt: null,
                    lastRunAt: null,
                    nextRunAt: nextRunAt,
                    lastError: null,
                    runCount: 0,
                });
                console.log(`[AgentRunner] Initialized state for ${agentName}, next run at ${nextRunAt}`);
            }
            continue; // Don't run immediately on first initialization
        }

        if (shouldRunNow(entry, agentState)) {
            // Run agent (don't await - let it run in background)
            runAgent(agentName, entry, stateRepo, runsRepo, agentRuntime, idGenerator).catch((error) => {
                console.error(`[AgentRunner] Unhandled error in runAgent for ${agentName}:`, error);
            });
        }
    }
}

/**
 * Initialize the background agent runner service.
 * Polls every minute to check for agents that need to run.
 */
export async function init(): Promise<void> {
    console.log("[AgentRunner] Starting background agent runner service");

    while (true) {
        try {
            await pollAndRun();
        } catch (error) {
            console.error("[AgentRunner] Error in main loop:", error);
        }

        await interruptibleSleep(POLL_INTERVAL_MS);
    }
}
