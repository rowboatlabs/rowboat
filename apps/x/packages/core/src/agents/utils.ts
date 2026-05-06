import { bus } from "../runs/bus.js";
import { fetchRun } from "../runs/runs.js";

type RunRecord = Awaited<ReturnType<typeof fetchRun>>;

function extractRunErrors(run: RunRecord): string[] {
    return run.log.flatMap((event) => event.type === "error" ? [event.error] : []);
}

export class RunFailedError extends Error {
    readonly runId: string;
    readonly errors: string[];

    constructor(runId: string, errors: string[]) {
        const firstError = errors.find(Boolean) ?? null;
        super(firstError ? `Run ${runId} failed: ${firstError}` : `Run ${runId} failed`);
        this.name = "RunFailedError";
        this.runId = runId;
        this.errors = errors;
    }
}

export function getErrorDetails(error: unknown): string {
    if (error instanceof RunFailedError) {
        return error.errors.join("\n\n");
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

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
export async function waitForRunCompletion(
    runId: string,
    opts: { throwOnError?: boolean } = {},
): Promise<RunRecord> {
    return new Promise((resolve, reject) => {
        void (async () => {
            const unsubscribe = await bus.subscribe('*', async (event) => {
                if (event.type === 'run-processing-end' && event.runId === runId) {
                    unsubscribe();
                    try {
                        const run = await fetchRun(runId);
                        const errors = extractRunErrors(run);
                        if (opts.throwOnError && errors.length > 0) {
                            reject(new RunFailedError(runId, errors));
                            return;
                        }
                        resolve(run);
                    } catch (error) {
                        reject(error);
                    }
                }
            });
        })().catch(reject);
    });
}
