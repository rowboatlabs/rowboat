// Error formatting shared across the knowledge pipelines. The run-based
// helpers that once lived here (waitForRunCompletion / extractAgentResponse)
// were retired with the old agent runtime; headless callers now await a turn
// via `agent-runtime/headless.ts` instead.

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
