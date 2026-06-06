export function unwrapAiError(error: Error): string {
    return (error as any).errors?.[0]?.data?.message ?? error.message;
}
