import { z } from "zod";
import { ToolCallPart } from "@x/shared/dist/message.js";
import type { ToolDefinition } from "../agent-loop/types.js";
import type { ToolRunContext, ToolRunner, ToolRunResult } from "../agent-loop/tool-runner.js";
import { execTool, type ToolContext } from "../application/lib/exec-tool.js";
import { IAbortRegistry, InMemoryAbortRegistry } from "../runs/abort-registry.js";
import { AgentTools, ASK_HUMAN_TOOL } from "./agent-tools.js";

type ExecTool = typeof execTool;

// Real ToolRunner: bridges the agent loop to the existing execTool dispatcher
// (builtins + MCP). The loop owns the lifecycle (start fact, ToolMessage,
// dispatched fact); this only resolves the attachment and runs it.
export class RealToolRunner implements ToolRunner {
    private agentTools: AgentTools;
    private abortRegistry: IAbortRegistry;
    private execTool: ExecTool;

    constructor(deps: {
        agentTools: AgentTools;
        abortRegistry?: IAbortRegistry;
        execTool?: ExecTool;
    }) {
        this.agentTools = deps.agentTools;
        this.abortRegistry = deps.abortRegistry ?? new InMemoryAbortRegistry();
        this.execTool = deps.execTool ?? execTool;
    }

    definitions(agentId: string | null): Promise<ToolDefinition[]> {
        return this.agentTools.definitions(agentId);
    }

    async run(
        toolCall: z.infer<typeof ToolCallPart>,
        ctx: ToolRunContext,
    ): Promise<ToolRunResult> {
        const attachment = await this.agentTools.attachment(ctx.agentId, toolCall.toolName);
        if (!attachment) {
            // The model named a tool this agent doesn't have — conversational
            // error, not a turn error: the loop turns it into a ToolMessage.
            return { type: "error", value: `Unknown tool: ${toolCall.toolName}` };
        }
        if (attachment.type === "agent") {
            throw new Error(`agent-as-tool is not supported: ${toolCall.toolName}`);
        }
        // ask-human never executes — it is delegated and answered out of band.
        if (attachment.type === "builtin" && attachment.name === ASK_HUMAN_TOOL) {
            return { type: "pending" };
        }

        // The signal is the primary kill path (executeCommandAbortable tears
        // down its process tree off it). The registry is the secondary
        // force-kill the old runtime used; wire it to the same signal so both
        // mechanisms fire. createForRun/cleanup bracket this single call.
        this.abortRegistry.createForRun(ctx.turnId);
        const onAbort = () => this.abortRegistry.abort(ctx.turnId);
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        try {
            const toolContext: ToolContext = {
                runId: ctx.turnId,
                toolCallId: toolCall.toolCallId,
                signal: ctx.signal,
                abortRegistry: this.abortRegistry,
                publish: (event) => {
                    if (event.type === "tool-output-stream") {
                        ctx.emit({
                            type: "tool-output",
                            toolCallId: event.toolCallId,
                            chunk: event.output,
                        });
                    }
                    // Other run events (code-run-*) are deferred — the channel
                    // exists; deeper plumbing lands with code_agent_run.
                    return Promise.resolve();
                },
                codeMode: ctx.codeMode,
            };
            // A thrown error propagates: the loop catches it (re-checking abort)
            // and records it as an error ToolMessage, never a turn error.
            const value = await this.execTool(attachment, asArgs(toolCall.arguments), toolContext);
            return { type: "result", value: value === undefined ? null : value };
        } finally {
            ctx.signal.removeEventListener("abort", onAbort);
            this.abortRegistry.cleanup(ctx.turnId);
        }
    }
}

function asArgs(args: unknown): Record<string, unknown> {
    return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}
