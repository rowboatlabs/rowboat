import { bus } from "../runs/bus.js";
import { fetchRun } from "../runs/runs.js";

/**
 * Extract the assistant's final text response from a run's log.
 * @param runId 
 * @returns The assistant's final text response or null if not found.
 */
export async function extractAgentResponse(runId: string): Promise<string | null> {
    const run = await fetchRun(runId);
    for (let i = run.log.length - 1; i >= 0; i--) {
        const event = run.log[i];
        if (event.type === 'message' && event.message.role === 'assistant') {
            const content = event.message.content;
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                const text = content
                    .filter((p) => p.type === 'text')
                    .map((p) => 'text' in p ? p.text : '')
                    .join('');
                return text || null;
            }
        }
    }
    return null;
}

/**
 * Wait for a run to complete by listening for run-processing-end event
 */
export async function waitForRunCompletion(runId: string): Promise<void> {
    return new Promise(async (resolve) => {
        const unsubscribe = await bus.subscribe('*', async (event) => {
            if (event.type === 'run-processing-end' && event.runId === runId) {
                unsubscribe();
                resolve();
            }
        });
    });
}