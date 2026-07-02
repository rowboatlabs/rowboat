import type { z } from "zod";
import type {
    JsonValue,
    ToolDescriptor,
    ToolResultData,
} from "@x/shared/dist/turns.js";

export interface ToolExecutionContext {
    signal: AbortSignal;
    // The loop appends a durable tool_progress event before resolving.
    reportProgress(progress: JsonValue): Promise<void>;
}

export interface SyncRuntimeTool {
    descriptor: z.infer<typeof ToolDescriptor> & { execution: "sync" };
    execute(
        input: unknown,
        context: ToolExecutionContext,
    ): Promise<z.infer<typeof ToolResultData>>;
}

// An async tool has no in-process executor. Its invocation is exposed
// externally and its progress/result arrives later through advanceTurn.
export interface AsyncRuntimeTool {
    descriptor: z.infer<typeof ToolDescriptor> & { execution: "async" };
}

export type RuntimeTool = SyncRuntimeTool | AsyncRuntimeTool;

// Resolves persisted tool descriptors to live implementations during
// advanceTurn. A rejection or a descriptor mismatch is an infrastructure
// error: the execution is rejected and the turn is left unchanged.
export interface IToolRegistry {
    resolve(descriptor: z.infer<typeof ToolDescriptor>): Promise<RuntimeTool>;
}
