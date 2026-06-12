import { z } from "zod";
import { ToolCallPart } from "@x/shared/dist/message.js";
import type { ToolDefinition } from "./types.js";

export type ToolRunResult =
    | { type: "result"; value: unknown }    // → ToolMessage
    | { type: "error"; value: unknown }     // → ToolMessage (model sees it; NOT a turn error)
    | { type: "pending" };                  // → DispatchedTool; result arrives via setToolResult

export type ToolRunContext = {
    turnId: string;
    signal: AbortSignal;
};

// Executes tool calls. The real implementation (bridging exec-tool.ts / MCP)
// is integration-phase work; v1 uses fakes in tests.
export interface ToolRunner {
    // Tool definitions advertised to the model. Environment, not turn state:
    // resume works because the loop is reconstructed with the same runner.
    definitions(): ToolDefinition[];
    run(toolCall: z.infer<typeof ToolCallPart>, ctx: ToolRunContext): Promise<ToolRunResult>;
}
