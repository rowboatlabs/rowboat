import z from "zod";
import container from "../di/container.js";
import { IMessageQueue } from "../application/lib/message-queue.js";
import { AskHumanResponseEvent, RunEvent, ToolPermissionResponseEvent } from "../entities/run-events.js";
import { CreateRunOptions, IRunsRepo } from "./repo.js";
import { IAgentRuntime } from "../agents/runtime.js";
import { IBus } from "../application/lib/bus.js";

export const ToolPermissionAuthorizePayload = ToolPermissionResponseEvent.pick({
    subflow: true,
    toolCallId: true,
    response: true,
});

export const AskHumanResponsePayload = AskHumanResponseEvent.pick({
    subflow: true,
    toolCallId: true,
    response: true,
});

export const Run = z.object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    agentId: z.string(),
    log: z.array(RunEvent),
});

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
    const repo = container.resolve<IRunsRepo>('runsRepo');
    const event: z.infer<typeof ToolPermissionResponseEvent> = {
        ...ev,
        runId,
        type: "tool-permission-response",
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

export async function stop(runId: string): Promise<void> {
    throw new Error('Not implemented');
}