// One home for the error -> human-readable message idiom. The legacy runs
// engine's getErrorDetails also unwrapped RunFailedError's multi-error list;
// live callers run agents through the headless runner, whose HeadlessRunError
// carries the failure detail in .message — so this is the whole contract.
export function getErrorDetails(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
