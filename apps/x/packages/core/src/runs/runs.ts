import z from "zod";
import container from "../di/container.js";
import { IMessageQueue } from "../application/lib/message-queue.js";
import { AskHumanResponseEvent, ToolPermissionRequestEvent, ToolPermissionResponseEvent, CreateRunOptions, Run, ListRunsResponse, ToolPermissionAuthorizePayload, AskHumanResponsePayload } from "@x/shared/dist/runs.js";
import { IRunsRepo } from "./repo.js";
import { IAgentRuntime } from "../agents/runtime.js";
import { IBus } from "../application/lib/bus.js";
import { IAbortRegistry } from "./abort-registry.js";
import { IRunsLock } from "./lock.js";
import { forceCloseAllMcpClients } from "../mcp/mcp.js";
import { extractCommandNames } from "../application/lib/command-executor.js";
import { addToSecurityConfig } from "../config/security.js";

export async function createRun(opts: z.infer<typeof CreateRunOptions>): Promise<z.infer<typeof Run>> {
    const repo = container.resolve<IRunsRepo>('runsRepo');
    const bus = container.resolve<IBus>('bus');
    const run = await repo.create(opts);
    await bus.publish(run.log[0]);
    return run;
}

export async function createMessage(runId: string, message: string): Promise<string> {
    const queue = container.resolve<IMessageQueue>('messageQueue');
    const id = await queue.enqueue(runId, message);
    const runtime = container.resolve<IAgentRuntime>('agentRuntime');
    runtime.trigger(runId);
    return id;
}

export async function authorizePermission(runId: string, ev: z.infer<typeof ToolPermissionAuthorizePayload>): Promise<void> {
    const { scope, ...rest } = ev;

    // For "always" scope, derive command from the run log and persist to security config
    if (rest.response === "approve" && scope === "always") {
        const repo = container.resolve<IRunsRepo>('runsRepo');
        const run = await repo.fetch(runId);
        const permReqEvent = run.log.find(
            (e): e is z.infer<typeof ToolPermissionRequestEvent> =>
                e.type === "tool-permission-request"
                && e.toolCall.toolCallId === rest.toolCallId
                && JSON.stringify(e.subflow) === JSON.stringify(rest.subflow)
        );
        if (permReqEvent && typeof permReqEvent.toolCall.arguments === 'object' && permReqEvent.toolCall.arguments !== null && 'command' in permReqEvent.toolCall.arguments) {
            const commandNames = extractCommandNames(String(permReqEvent.toolCall.arguments.command));
            if (commandNames.length > 0) {
                await addToSecurityConfig(commandNames);
            }
        }
    }

    const repo = container.resolve<IRunsRepo>('runsRepo');
    const event: z.infer<typeof ToolPermissionResponseEvent> = {
        ...rest,
        runId,
        type: "tool-permission-response",
        scope,
    };
    await repo.appendEvents(runId, [event]);
    const runtime = container.resolve<IAgentRuntime>('agentRuntime');
    runtime.trigger(runId);
}

export async function replyToHumanInputRequest(runId: string, ev: z.infer<typeof AskHumanResponsePayload>): Promise<void> {
    const repo = container.resolve<IRunsRepo>('runsRepo');
    const event: z.infer<typeof AskHumanResponseEvent> = {
        ...ev,
        runId,
        type: "ask-human-response",
    };
    await repo.appendEvents(runId, [event]);
    const runtime = container.resolve<IAgentRuntime>('agentRuntime');
    runtime.trigger(runId);
}

export async function stop(runId: string, force: boolean = false): Promise<void> {
    const abortRegistry = container.resolve<IAbortRegistry>('abortRegistry');

    if (force && abortRegistry.isAborted(runId)) {
        // Second click: aggressive cleanup — SIGKILL + force close MCP clients
        console.log(`Force stopping run ${runId}`);
        abortRegistry.forceAbort(runId);
        await forceCloseAllMcpClients();
    } else {
        // First click: graceful — fires AbortSignal + SIGTERM
        console.log(`Gracefully stopping run ${runId}`);
        abortRegistry.abort(runId);
    }
    // Note: The run-stopped event is emitted by AgentRuntime.trigger() when it detects the abort.
    // This avoids duplicate events and ensures proper sequencing.
}

export async function deleteRun(runId: string): Promise<void> {
    const runsLock = container.resolve<IRunsLock>('runsLock');
    if (!await runsLock.lock(runId)) {
        throw new Error(`Cannot delete run ${runId}: run is currently active`);
    }
    try {
        const repo = container.resolve<IRunsRepo>('runsRepo');
        await repo.delete(runId);
    } finally {
        await runsLock.release(runId);
    }
}

export async function fetchRun(runId: string): Promise<z.infer<typeof Run>> {
    const repo = container.resolve<IRunsRepo>('runsRepo');
    return repo.fetch(runId);
}

export async function listRuns(cursor?: string): Promise<z.infer<typeof ListRunsResponse>> {
    const repo = container.resolve<IRunsRepo>('runsRepo');
    return repo.list(cursor);
}