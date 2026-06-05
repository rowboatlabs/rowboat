/**
 * Unwrap Vercel AI SDK retry errors to surface the underlying actionable message.
 * AI_RetryError wraps AI_APICallError instances in its errors array — the real
 * quota/rate-limit details are in the innermost error, not the retry wrapper.
 * Zero-import module to avoid circular dependencies.
 */
export function unwrapAiError(error: Error): string {
    if (error.name === "AI_RetryError" && "errors" in error && Array.isArray((error as any).errors)) {
        const innerErrors = (error as any).errors as Error[];
        for (let i = innerErrors.length - 1; i >= 0; i--) {
            const inner = innerErrors[i];
            if (inner.name === "AI_APICallError" || inner.name === "AIServiceError") {
                const data = (inner as any).data;
                if (data?.message) return data.message;
                if (data?.error?.message) return data.error.message;
                if (inner.message) return inner.message;
            }
        }
        if (innerErrors.length > 0 && innerErrors[0]?.message) return innerErrors[0].message;
    }
    return error.message;
}