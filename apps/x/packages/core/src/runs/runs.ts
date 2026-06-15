import z from "zod";
import container from "../di/container.js";
import { CreateRunOptions, Run } from "@x/shared/dist/runs.js";
import { IRunsRepo } from "./repo.js";
import { IBus } from "../application/lib/bus.js";
import { loadAgent } from "../agents/runtime.js";
import { getDefaultModelAndProvider } from "../models/defaults.js";

// The generic run event-log helpers that survive the retirement of the old LLM
// agent runtime. The message/permission/stop helpers that drove the LLM loop
// (createMessage → agentRuntime.trigger, authorizePermission, replyToHumanInput,
// stop) are gone with it; chat + headless run on the new sessions/turn runtime.
// What remains is the minimal surface code-mode uses to mint and read a session's
// append-only event log: createRun (id + start event) and fetchRun.

export async function createRun(opts: z.infer<typeof CreateRunOptions>): Promise<z.infer<typeof Run>> {
    const repo = container.resolve<IRunsRepo>('runsRepo');
    const bus = container.resolve<IBus>('bus');

    // Resolve model+provider once at creation: opts > agent declaration > defaults.
    // Both fields are plain strings (provider is a name, looked up at runtime).
    // Use `||` (not `??`) so an empty-string override — what an LLM tool call
    // sometimes synthesizes for "I'm not setting this" — falls through to the
    // next link in the chain instead of being treated as a real value.
    const agent = await loadAgent(opts.agentId);
    const defaults = await getDefaultModelAndProvider();
    const model = opts.model || agent.model || defaults.model;
    const provider = opts.provider || agent.provider || defaults.provider;
    const useCase = opts.useCase ?? "copilot_chat";

    const run = await repo.create({
        agentId: opts.agentId,
        model,
        provider,
        permissionMode: opts.permissionMode ?? "manual",
        useCase,
        ...(opts.subUseCase ? { subUseCase: opts.subUseCase } : {}),
    });
    await bus.publish(run.log[0]);
    return run;
}

export async function fetchRun(runId: string): Promise<z.infer<typeof Run>> {
    const repo = container.resolve<IRunsRepo>('runsRepo');
    return repo.fetch(runId);
}
