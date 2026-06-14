import { z } from "zod";
import { CodeMode, ToolCallPart } from "@x/shared/dist/message.js";
import type { ToolDefinition, TurnEvent } from "./types.js";

export type ToolRunResult =
    | { type: "result"; value: unknown }    // → ToolMessage
    | { type: "error"; value: unknown }     // → ToolMessage (model sees it; NOT a turn error)
    | { type: "pending" };                  // → DispatchedTool; result arrives via setToolResult

export type ToolRunContext = {
    turnId: string;
    // The turn's agent — the runner resolves the tool name to that agent's
    // attachment (builtin vs MCP) to know how to execute it. null = no agent.
    agentId: string | null;
    // The turn's code-mode chip (null = off). The code_agent_run tool honors
    // this over the model's argument so toggling the chip switches agents.
    codeMode: z.infer<typeof CodeMode> | null;
    signal: AbortSignal;
    // Forward a live event onto the turn's stream while the tool runs (e.g. a
    // `tool-output` chunk). Best-effort and never persisted — drop it and the
    // tool still produces the same final result. This is the new home of the
    // old runtime's `ctx.publish`.
    emit: (event: TurnEvent) => void;
};

// Executes tool calls. The real implementation (bridging exec-tool.ts / MCP)
// is integration-phase work; v1 uses fakes in tests.
export interface ToolRunner {
    // Tool definitions advertised to the model for a given agent. Environment,
    // not turn state: resume works because the loop reconstructs them from the
    // same (immutable) agent config. agentId is null for an agent-less turn.
    definitions(agentId: string | null): Promise<ToolDefinition[]>;
    run(toolCall: z.infer<typeof ToolCallPart>, ctx: ToolRunContext): Promise<ToolRunResult>;
}
