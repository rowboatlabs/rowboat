import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { createRun, createMessage } from '../runs/runs.js';
import { bus } from '../runs/bus.js';
import {
    loadConfig,
    loadState,
    shouldRunAgent,
    setLastRunTime,
    getAgentConfig,
    loadUserConfig,
    getUserConfigPath,
} from './config.js';
import { PREBUILT_AGENTS } from './types.js';

// Service configuration
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute which agents need to run
const PREBUILT_DIR = path.join(WorkDir, 'pre-built');

/**
 * Wait for a run to complete by listening for run-processing-end event
 */
async function waitForRunCompletion(runId: string): Promise<void> {
    return new Promise(async (resolve) => {
        const unsubscribe = await bus.subscribe('*', async (event) => {
            if (event.type === 'run-processing-end' && event.runId === runId) {
                unsubscribe();
                resolve();
            }
        });
    });
}

/**
 * Run a pre-built agent by name
 */
async function runAgent(agentName: string): Promise<void> {
    console.log(`[PreBuilt] Running agent: ${agentName}`);

    // Check for user config
    const userConfig = loadUserConfig();
    if (!userConfig) {
        console.log(`[PreBuilt] Skipping ${agentName}: No user config found. Create ${getUserConfigPath()}`);
        return;
    }

    // Ensure pre-built directory exists
    if (!fs.existsSync(PREBUILT_DIR)) {
        fs.mkdirSync(PREBUILT_DIR, { recursive: true });
    }

    try {
        // Create a run for the agent
        // The agent file is expected to be in the agents directory with the same name
        const run = await createRun({
            agentId: agentName,
        });

        // Build trigger message with user context
        const message = `Run your scheduled task.

**Current time:** ${new Date().toISOString()}

**User context:**
- Name: ${userConfig.name}
- Email: ${userConfig.email}
- Domain: ${userConfig.domain}

Process new items and use the user context above to identify yourself when drafting responses.`;

        await createMessage(run.id, message);

        // Wait for completion
        await waitForRunCompletion(run.id);

        // Update last run time
        setLastRunTime(agentName, new Date());

        console.log(`[PreBuilt] Agent ${agentName} completed successfully`);
    } catch (error) {
        console.error(`[PreBuilt] Error running agent ${agentName}:`, error);
        // Still update last run time to prevent rapid retries on persistent errors
        setLastRunTime(agentName, new Date());
    }
}

/**
 * Check all agents and run those that are due
 */
async function checkAndRunAgents(): Promise<void> {
    const config = loadConfig();

    for (const agentName of PREBUILT_AGENTS) {
        try {
            if (shouldRunAgent(agentName)) {
                await runAgent(agentName);
            }
        } catch (error) {
            console.error(`[PreBuilt] Error checking/running agent ${agentName}:`, error);
        }
    }
}

/**
 * Log the current configuration status
 */
function logStatus(): void {
    const config = loadConfig();
    const enabledAgents = PREBUILT_AGENTS.filter(name => config.agents[name]?.enabled);

    if (enabledAgents.length === 0) {
        console.log('[PreBuilt] No agents enabled. Enable agents in config/prebuilt.json');
    } else {
        console.log(`[PreBuilt] Enabled agents: ${enabledAgents.join(', ')}`);
        for (const name of enabledAgents) {
            const agentConfig = getAgentConfig(name);
            console.log(`[PreBuilt]   - ${name}: runs every ${agentConfig.intervalMs / 1000}s`);
        }
    }
}

/**
 * Main entry point - runs as a service checking and running pre-built agents
 */
export async function init(): Promise<void> {
    console.log('[PreBuilt] Starting Pre-Built Agent Runner Service...');
    console.log(`[PreBuilt] Available agents: ${PREBUILT_AGENTS.join(', ')}`);
    console.log(`[PreBuilt] Will check for due agents every ${CHECK_INTERVAL_MS / 1000} seconds`);

    logStatus();

    // Initial run
    await checkAndRunAgents();

    // Set up periodic checking
    while (true) {
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));

        try {
            await checkAndRunAgents();
        } catch (error) {
            console.error('[PreBuilt] Error in main loop:', error);
        }
    }
}

/**
 * Manually trigger an agent run (useful for testing)
 */
export async function triggerAgent(agentName: string): Promise<void> {
    if (!PREBUILT_AGENTS.includes(agentName as any)) {
        throw new Error(`Unknown agent: ${agentName}. Available: ${PREBUILT_AGENTS.join(', ')}`);
    }
    await runAgent(agentName);
}

/**
 * Get status of all pre-built agents
 */
export function getStatus(): Record<string, { enabled: boolean; intervalMs: number; lastRun: string | null }> {
    const config = loadConfig();
    const state = loadState();
    const status: Record<string, { enabled: boolean; intervalMs: number; lastRun: string | null }> = {};

    for (const agentName of PREBUILT_AGENTS) {
        const agentConfig = config.agents[agentName] || { enabled: false, intervalMs: 5 * 60 * 1000 };
        status[agentName] = {
            enabled: agentConfig.enabled,
            intervalMs: agentConfig.intervalMs,
            lastRun: state.lastRunTimes[agentName] || null,
        };
    }

    return status;
}
