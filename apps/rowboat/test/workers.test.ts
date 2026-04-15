import test from "node:test";
import assert from "node:assert/strict";

import { QuotaExceededError } from "../src/entities/errors/common";
import { JobsWorker } from "../src/application/workers/jobs.worker";
import { JobRulesWorker } from "../src/application/workers/job-rules.worker";

const isoNow = "2026-01-01T00:00:00.000Z";

function userMessage(content: string) {
    return { role: "user" as const, content };
}

function createJob(id: string) {
    return {
        id,
        reason: { type: "scheduled_job_rule" as const, ruleId: "rule-1" },
        projectId: "proj-1",
        input: { messages: [userMessage("hello")] },
        workerId: null,
        lastWorkerId: null,
        status: "pending" as const,
        createdAt: isoNow,
    };
}

async function waitFor(condition: () => boolean, timeoutMs: number = 100): Promise<void> {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("Timed out waiting for async worker state");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test("JobsWorker processes subscription-delivered jobs end to end", async () => {
    const updates: Array<{ id: string; data: unknown }> = [];
    const released: string[] = [];
    const conversations: unknown[] = [];
    const runInputs: unknown[] = [];
    let subscriptionHandler: ((message: string) => void) | null = null;

    const worker = new JobsWorker({
        jobsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => null,
            poll: async () => null,
            lock: async (id: string) => createJob(id),
            update: async (id: string, data: any) => {
                updates.push({ id, data });
                return { ...createJob(id), ...data };
            },
            release: async (id: string) => {
                released.push(id);
            },
            list: async () => ({ items: [], nextCursor: null }),
            deleteByProjectId: async () => {},
        },
        projectsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => ({
                id: "proj-1",
                name: "Project",
                createdAt: isoNow,
                createdByUserId: "user-1",
                secret: "secret",
                draftWorkflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                liveWorkflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
            }),
            countCreatedProjects: async () => 0,
            listProjects: async () => ({ items: [], nextCursor: null }),
            addComposioConnectedAccount: async () => { throw new Error("unused"); },
            deleteComposioConnectedAccount: async () => false,
            addCustomMcpServer: async () => { throw new Error("unused"); },
            deleteCustomMcpServer: async () => false,
            updateSecret: async () => { throw new Error("unused"); },
            updateWebhookUrl: async () => { throw new Error("unused"); },
            updateName: async () => { throw new Error("unused"); },
            updateDraftWorkflow: async () => { throw new Error("unused"); },
            updateLiveWorkflow: async () => { throw new Error("unused"); },
            delete: async () => false,
        },
        createConversationUseCase: {
            execute: async (input: unknown) => {
                conversations.push(input);
                return {
                    id: "conv-1",
                    projectId: "proj-1",
                    workflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                    reason: { type: "job", jobId: "job-1" },
                    isLiveWorkflow: true,
                    createdAt: isoNow,
                };
            },
        },
        runConversationTurnUseCase: {
            execute: async function* (input: unknown) {
                runInputs.push(input);
                yield {
                    type: "done" as const,
                    conversationId: "conv-1",
                    turn: {
                        id: "turn-1",
                        reason: { type: "job" as const, jobId: "job-1" },
                        input: { messages: [userMessage("hello")] },
                        output: [{ role: "assistant" as const, content: "done", agentName: null, responseType: "external" as const }],
                        createdAt: isoNow,
                    },
                };
            },
        },
        pubSubService: {
            publish: async () => {},
            subscribe: async (_channel: string, handler: (message: string) => void) => {
                subscriptionHandler = handler;
                return { unsubscribe: async () => {} };
            },
        },
        usageQuotaPolicy: {
            assertAndConsumeProjectAction: async () => {},
            assertAndConsumeRunJobAction: async () => {},
        },
    });

    await worker.run();
    if (!subscriptionHandler) {
        throw new Error("subscription handler was not registered");
    }
    const handler = subscriptionHandler as (message: string) => void;
    handler("job-1");
    await waitFor(() => updates.length === 1 && runInputs.length === 1 && released.length === 1);
    await worker.stop();

    assert.deepEqual(conversations, [{
        caller: "job_worker",
        projectId: "proj-1",
        reason: { type: "job", jobId: "job-1" },
        isLiveWorkflow: true,
    }]);
    assert.equal(runInputs.length, 1);
    assert.equal((runInputs[0] as any).caller, "job_worker");
    assert.equal((runInputs[0] as any).conversationId, "conv-1");
    assert.deepEqual((runInputs[0] as any).reason, { type: "job", jobId: "job-1" });
    assert.deepEqual((runInputs[0] as any).input, { messages: [userMessage("hello")] });
    assert.deepEqual(updates, [{
        id: "job-1",
        data: {
            status: "completed",
            output: {
                conversationId: "conv-1",
                turnId: "turn-1",
            },
        },
    }]);
    assert.deepEqual(released, ["job-1"]);
});

test("JobsWorker marks quota-exceeded jobs as failed with a user-facing error", async () => {
    const updates: Array<{ id: string; data: unknown }> = [];
    const released: string[] = [];

    const worker = new JobsWorker({
        jobsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => null,
            poll: async () => null,
            lock: async (id: string) => createJob(id),
            update: async (id: string, data: any) => {
                updates.push({ id, data });
                return { ...createJob(id), ...data };
            },
            release: async (id: string) => {
                released.push(id);
            },
            list: async () => ({ items: [], nextCursor: null }),
            deleteByProjectId: async () => {},
        },
        projectsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => ({
                id: "proj-1",
                name: "Project",
                createdAt: isoNow,
                createdByUserId: "user-1",
                secret: "secret",
                draftWorkflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                liveWorkflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
            }),
            countCreatedProjects: async () => 0,
            listProjects: async () => ({ items: [], nextCursor: null }),
            addComposioConnectedAccount: async () => { throw new Error("unused"); },
            deleteComposioConnectedAccount: async () => false,
            addCustomMcpServer: async () => { throw new Error("unused"); },
            deleteCustomMcpServer: async () => false,
            updateSecret: async () => { throw new Error("unused"); },
            updateWebhookUrl: async () => { throw new Error("unused"); },
            updateName: async () => { throw new Error("unused"); },
            updateDraftWorkflow: async () => { throw new Error("unused"); },
            updateLiveWorkflow: async () => { throw new Error("unused"); },
            delete: async () => false,
        },
        createConversationUseCase: {
            execute: async () => { throw new Error("should not create conversation"); },
        },
        runConversationTurnUseCase: {
            execute: async function* () {
                yield* [] as Array<{ type: "error"; error: string }>;
                throw new Error("should not run");
            },
        },
        pubSubService: {
            publish: async () => {},
            subscribe: async () => ({ unsubscribe: async () => {} }),
        },
        usageQuotaPolicy: {
            assertAndConsumeProjectAction: async () => {},
            assertAndConsumeRunJobAction: async () => {
                throw new QuotaExceededError("No credits left");
            },
        },
    });

    await (worker as any).processJob(createJob("job-2"));

    assert.deepEqual(updates, [{
        id: "job-2",
        data: {
            status: "failed",
            output: {
                error: "No credits left",
            },
        },
    }]);
    assert.deepEqual(released, ["job-2"]);
});

test("JobRulesWorker creates jobs from scheduled and recurring rules and publishes them", async () => {
    const createdJobs: unknown[] = [];
    const published: Array<{ channel: string; message: string }> = [];
    const scheduledUpdates: Array<{ id: string; data: unknown }> = [];
    const scheduledReleases: string[] = [];
    const recurringReleases: string[] = [];

    const worker = new JobRulesWorker({
        scheduledJobRulesRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => null,
            poll: async () => null,
            update: async (id: string, data: unknown) => {
                scheduledUpdates.push({ id, data });
                return {
                    id,
                    projectId: "proj-1",
                    input: { messages: [userMessage("hello")] },
                    nextRunAt: isoNow,
                    workerId: null,
                    lastWorkerId: null,
                    status: "triggered" as const,
                    output: (data as any).output,
                    createdAt: isoNow,
                };
            },
            updateRule: async () => { throw new Error("unused"); },
            release: async (id: string) => {
                scheduledReleases.push(id);
                return {
                    id,
                    projectId: "proj-1",
                    input: { messages: [userMessage("hello")] },
                    nextRunAt: isoNow,
                    workerId: null,
                    lastWorkerId: null,
                    status: "triggered" as const,
                    createdAt: isoNow,
                };
            },
            list: async () => ({ items: [], nextCursor: null }),
            delete: async () => false,
            deleteByProjectId: async () => {},
        },
        recurringJobRulesRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => null,
            poll: async () => null,
            release: async (id: string) => {
                recurringReleases.push(id);
                return {
                    id,
                    projectId: "proj-1",
                    input: { messages: [userMessage("hello")] },
                    cron: "* * * * *",
                    nextRunAt: isoNow,
                    workerId: null,
                    lastWorkerId: null,
                    disabled: false,
                    createdAt: isoNow,
                };
            },
            list: async () => ({ items: [], nextCursor: null }),
            toggle: async () => { throw new Error("unused"); },
            update: async () => { throw new Error("unused"); },
            delete: async () => false,
            deleteByProjectId: async () => {},
        },
        jobsRepository: {
            create: async (data: any) => {
                createdJobs.push(data);
                return {
                    id: `job-${createdJobs.length}`,
                    ...data,
                    workerId: null,
                    lastWorkerId: null,
                    status: "pending" as const,
                    createdAt: isoNow,
                };
            },
            fetch: async () => null,
            poll: async () => null,
            lock: async () => { throw new Error("unused"); },
            update: async () => { throw new Error("unused"); },
            release: async () => {},
            list: async () => ({ items: [], nextCursor: null }),
            deleteByProjectId: async () => {},
        },
        projectsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => null,
            countCreatedProjects: async () => 0,
            listProjects: async () => ({ items: [], nextCursor: null }),
            addComposioConnectedAccount: async () => { throw new Error("unused"); },
            deleteComposioConnectedAccount: async () => false,
            addCustomMcpServer: async () => { throw new Error("unused"); },
            deleteCustomMcpServer: async () => false,
            updateSecret: async () => { throw new Error("unused"); },
            updateWebhookUrl: async () => { throw new Error("unused"); },
            updateName: async () => { throw new Error("unused"); },
            updateDraftWorkflow: async () => { throw new Error("unused"); },
            updateLiveWorkflow: async () => { throw new Error("unused"); },
            delete: async () => false,
        },
        pubSubService: {
            publish: async (channel: string, message: string) => {
                published.push({ channel, message });
            },
            subscribe: async () => ({ unsubscribe: async () => {} }),
        },
    });

    await (worker as any).processScheduledRule({
        id: "scheduled-1",
        projectId: "proj-1",
        input: { messages: [userMessage("scheduled")] },
        nextRunAt: isoNow,
        workerId: null,
        lastWorkerId: null,
        status: "pending",
        createdAt: isoNow,
    });

    await (worker as any).processRecurringRule({
        id: "recurring-1",
        projectId: "proj-1",
        input: { messages: [userMessage("recurring")] },
        cron: "* * * * *",
        nextRunAt: isoNow,
        workerId: null,
        lastWorkerId: null,
        disabled: false,
        createdAt: isoNow,
    });

    assert.deepEqual(createdJobs, [
        {
            reason: { type: "scheduled_job_rule", ruleId: "scheduled-1" },
            projectId: "proj-1",
            input: { messages: [userMessage("scheduled")] },
        },
        {
            reason: { type: "recurring_job_rule", ruleId: "recurring-1" },
            projectId: "proj-1",
            input: { messages: [userMessage("recurring")] },
        },
    ]);
    assert.deepEqual(published, [
        { channel: "new_jobs", message: "job-1" },
        { channel: "new_jobs", message: "job-2" },
    ]);
    assert.deepEqual(scheduledUpdates, [{
        id: "scheduled-1",
        data: {
            output: { jobId: "job-1" },
            status: "triggered",
        },
    }]);
    assert.deepEqual(scheduledReleases, ["scheduled-1"]);
    assert.deepEqual(recurringReleases, ["recurring-1"]);
});
