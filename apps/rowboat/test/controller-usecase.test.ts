import test from "node:test";
import assert from "node:assert/strict";

import { BadRequestError, NotFoundError } from "../src/entities/errors/common";
import { RunTurnController } from "../src/interface-adapters/controllers/conversations/run-turn.controller";
import { CreateCachedTurnUseCase } from "../src/application/use-cases/conversations/create-cached-turn.use-case";
import { CreateProjectController } from "../src/interface-adapters/controllers/projects/create-project.controller";
import { CreateProjectUseCase } from "../src/application/use-cases/projects/create-project.use-case";

const isoNow = "2026-01-01T00:00:00.000Z";

function createUserMessage(content: string) {
    return { role: "user" as const, content };
}

function createTurn() {
    return {
        id: "turn-1",
        reason: { type: "chat" as const },
        input: { messages: [createUserMessage("hello")], mockTools: undefined },
        output: [{ role: "assistant" as const, content: "hi", agentName: null, responseType: "external" as const }],
        createdAt: isoNow,
    };
}

test("RunTurnController creates a conversation and returns the completed turn", async () => {
    const createdRequests: unknown[] = [];
    const runRequests: unknown[] = [];
    const turn = createTurn();
    const controller = new RunTurnController({
        createConversationUseCase: {
            execute: async (input: unknown) => {
                createdRequests.push(input);
                return {
                    id: "conv-1",
                    projectId: "proj-1",
                    workflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                    reason: { type: "chat" as const },
                    isLiveWorkflow: false,
                    createdAt: isoNow,
                };
            },
        },
        runConversationTurnUseCase: {
            execute: async function* (input: unknown) {
                runRequests.push(input);
                yield { type: "done" as const, conversationId: "conv-1", turn };
            },
        },
    });

    const result = await controller.execute({
        caller: "user",
        userId: "user-1",
        projectId: "proj-1",
        input: { messages: [createUserMessage("hello")] },
        stream: false,
    });

    assert.deepEqual(createdRequests, [{
        caller: "user",
        userId: "user-1",
        apiKey: undefined,
        projectId: "proj-1",
        reason: { type: "chat" },
    }]);
    assert.deepEqual(runRequests, [{
        caller: "user",
        userId: "user-1",
        apiKey: undefined,
        conversationId: "conv-1",
        reason: { type: "chat" },
        input: { messages: [createUserMessage("hello")] },
    }]);
    assert.deepEqual(result, {
        conversationId: "conv-1",
        turn,
    });
});

test("RunTurnController returns a stream without creating a conversation when one is supplied", async () => {
    async function* makeStream() {
        yield { type: "message" as const, data: createUserMessage("hello") };
    }

    const controller = new RunTurnController({
        createConversationUseCase: {
            execute: async () => {
                throw new Error("should not create a conversation");
            },
        },
        runConversationTurnUseCase: {
            execute: () => makeStream(),
        },
    });

    const result = await controller.execute({
        caller: "api",
        apiKey: "key-1",
        projectId: "proj-1",
        conversationId: "conv-existing",
        input: { messages: [createUserMessage("hello")] },
        stream: true,
    });

    assert.equal(result.conversationId, "conv-existing");
    assert.ok("stream" in result);
});

test("CreateCachedTurnUseCase rejects missing conversations", async () => {
    const useCase = new CreateCachedTurnUseCase({
        cacheService: {
            get: async () => null,
            set: async () => {},
            delete: async () => false,
        },
        conversationsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => null,
            list: async () => ({ items: [], nextCursor: null }),
            addTurn: async () => { throw new Error("unused"); },
            deleteByProjectId: async () => {},
        },
        usageQuotaPolicy: {
            assertAndConsumeProjectAction: async () => {},
            assertAndConsumeRunJobAction: async () => {},
        },
        projectActionAuthorizationPolicy: {
            authorize: async () => {},
        },
    });

    await assert.rejects(
        () => useCase.execute({
            caller: "user",
            userId: "user-1",
            conversationId: "missing",
            input: { messages: [createUserMessage("hello")] },
        }),
        NotFoundError,
    );
});

test("CreateCachedTurnUseCase authorizes, consumes quota, and stores the payload", async () => {
    const calls: Record<string, unknown>[] = [];
    const useCase = new CreateCachedTurnUseCase({
        cacheService: {
            get: async () => null,
            set: async (key, value, ttl) => {
                calls.push({ key, value, ttl });
            },
            delete: async () => false,
        },
        conversationsRepository: {
            create: async () => { throw new Error("unused"); },
            fetch: async () => ({
                id: "conv-1",
                projectId: "proj-1",
                workflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                reason: { type: "chat" as const },
                isLiveWorkflow: false,
                createdAt: isoNow,
            }),
            list: async () => ({ items: [], nextCursor: null }),
            addTurn: async () => { throw new Error("unused"); },
            deleteByProjectId: async () => {},
        },
        usageQuotaPolicy: {
            assertAndConsumeProjectAction: async (projectId) => {
                calls.push({ quotaProjectId: projectId });
            },
            assertAndConsumeRunJobAction: async () => {},
        },
        projectActionAuthorizationPolicy: {
            authorize: async (input) => {
                calls.push({ authorization: input });
            },
        },
    });

    const result = await useCase.execute({
        caller: "api",
        apiKey: "api-key",
        conversationId: "conv-1",
        input: { messages: [createUserMessage("hello")], mockTools: { calc: "42" } },
    });

    assert.equal(typeof result.key, "string");
    assert.ok(result.key.length > 0);
    assert.deepEqual(calls[0], {
        authorization: {
            caller: "api",
            userId: undefined,
            apiKey: "api-key",
            projectId: "proj-1",
        },
    });
    assert.deepEqual(calls[1], { quotaProjectId: "proj-1" });
    assert.deepEqual(calls[2], {
        key: `turn-${result.key}`,
        value: JSON.stringify({
            conversationId: "conv-1",
            input: { messages: [createUserMessage("hello")], mockTools: { calc: "42" } },
        }),
        ttl: 600,
    });
});

test("CreateProjectController validates input before delegating", async () => {
    const calls: unknown[] = [];
    const controller = new CreateProjectController({
        createProjectUseCase: {
            execute: async (input: unknown) => {
                calls.push(input);
                return {
                    id: "550e8400-e29b-41d4-a716-446655440000",
                    name: "Assistant 1",
                    createdAt: isoNow,
                    createdByUserId: "user-1",
                    secret: "secret",
                    draftWorkflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                    liveWorkflow: { agents: [], prompts: [], tools: [], pipelines: [], startAgent: "", lastUpdatedAt: isoNow },
                };
            },
        },
    });

    await assert.rejects(
        () => controller.execute({ userId: "user-1" } as any),
        BadRequestError,
    );

    const result = await controller.execute({
        userId: "user-1",
        data: {
            mode: { template: "default" },
        },
    });

    assert.equal(result.name, "Assistant 1");
    assert.deepEqual(calls, [{
        userId: "user-1",
        data: {
            mode: { template: "default" },
        },
    }]);
});

test("CreateProjectUseCase builds a default template project and membership", async () => {
    const createCalls: unknown[] = [];
    const memberCalls: unknown[] = [];
    const quotaCalls: string[] = [];

    const useCase = new CreateProjectUseCase({
        projectsRepository: {
            countCreatedProjects: async () => 0,
            create: async (data: any) => {
                createCalls.push(data);
                return {
                    id: "550e8400-e29b-41d4-a716-446655440000",
                    name: data.name,
                    createdAt: isoNow,
                    createdByUserId: data.createdByUserId,
                    secret: data.secret,
                    draftWorkflow: { ...data.workflow, lastUpdatedAt: isoNow },
                    liveWorkflow: { ...data.workflow, lastUpdatedAt: isoNow },
                };
            },
            fetch: async () => null,
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
        projectMembersRepository: {
            create: async (data) => {
                memberCalls.push(data);
                return {
                    id: "member-1",
                    userId: data.userId,
                    projectId: data.projectId,
                    createdAt: isoNow,
                    lastUpdatedAt: isoNow,
                };
            },
            findByUserId: async () => ({ items: [], nextCursor: null }),
            deleteByProjectId: async () => {},
            exists: async () => true,
        },
        usageQuotaPolicy: {
            assertAndConsumeProjectAction: async (projectId) => {
                quotaCalls.push(projectId);
            },
            assertAndConsumeRunJobAction: async () => {},
        },
    });

    const result = await useCase.execute({
        userId: "user-1",
        data: {
            mode: { template: "default" },
        },
    });

    assert.equal(result.name, "Assistant 1");
    assert.equal(createCalls.length, 1);
    assert.deepEqual(memberCalls, [{
        projectId: "550e8400-e29b-41d4-a716-446655440000",
        userId: "user-1",
    }]);
    assert.deepEqual(quotaCalls, ["550e8400-e29b-41d4-a716-446655440000"]);
    assert.equal((createCalls[0] as any).name, "Assistant 1");
    assert.equal((createCalls[0] as any).createdByUserId, "user-1");
    assert.equal(typeof (createCalls[0] as any).secret, "string");
    assert.equal((createCalls[0] as any).workflow.startAgent, "");
});

test("CreateProjectUseCase rejects invalid workflow JSON", async () => {
    const useCase = new CreateProjectUseCase({
        projectsRepository: {
            countCreatedProjects: async () => 0,
            create: async () => { throw new Error("should not create"); },
            fetch: async () => null,
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
        projectMembersRepository: {
            create: async () => { throw new Error("unused"); },
            findByUserId: async () => ({ items: [], nextCursor: null }),
            deleteByProjectId: async () => {},
            exists: async () => true,
        },
        usageQuotaPolicy: {
            assertAndConsumeProjectAction: async () => {},
            assertAndConsumeRunJobAction: async () => {},
        },
    });

    await assert.rejects(
        () => useCase.execute({
            userId: "user-1",
            data: {
                mode: { workflowJson: "{" },
            },
        }),
        BadRequestError,
    );
});
