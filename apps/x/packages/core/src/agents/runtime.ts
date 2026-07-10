import { jsonSchema } from "ai";
import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import { AssistantContentPart, AssistantMessage, MessageList, ProviderOptions, ToolCallPart, ToolMessage, UserMessageContext } from "@x/shared/dist/message.js";
import { LanguageModel, stepCountIs, streamText, tool, Tool, ToolSet } from "ai";
import { z } from "zod";
import { LlmStepStreamEvent } from "@x/shared/dist/llm-step-events.js";
import { execTool } from "../application/lib/exec-tool.js";
import { TOOL_ADDITIONS_KEY } from "../application/lib/tool-additions.js";
import { AskHumanRequestEvent, RunEvent, ToolPermissionRequestEvent } from "@x/shared/dist/runs.js";
import { BuiltinTools } from "../application/lib/builtin-tools.js";
import { hasWorkspaceContext, loadAgent } from "./registry.js";
import { composeSystemInstructions } from "./compose-instructions.js";
import { convertFromMessages } from "./message-encoding.js";
import { getToolPermissionMetadata } from "./permission-metadata.js";
import { loadWorkspaceContext } from "./workspace-context.js";
import { extractCommandNames } from "../application/lib/command-executor.js";
import { type FileAccessGrant } from "../config/security.js";
import { notifyIfEnabled } from "../application/notification/notifier.js";
import { IModelConfigRepo } from "../models/repo.js";
import { createLanguageModel } from "../models/models.js";
import { chatActivity } from "../application/lib/chat-activity.js";
import { resolveProviderConfig } from "../models/defaults.js";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { IBus } from "../application/lib/bus.js";
import { IMessageQueue, type MiddlePaneContext } from "../application/lib/message-queue.js";
import { IRunsRepo } from "../runs/repo.js";
import { IRunsLock } from "../runs/lock.js";
import { IAbortRegistry } from "../turns/abort-registry.js";
import { PrefixLogger } from "@x/shared";
import { captureLlmUsage } from "../analytics/usage.js";
import { enterUseCase, withUseCase, type UseCase } from "../analytics/use_case.js";
import { classifyToolPermissions, type AutoPermissionCandidate } from "../security/auto-permission-classifier.js";

function formatCurrentDateTime(now: Date): string {
    return now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });
}

function toUserMessageContextMiddlePane(middlePaneContext: MiddlePaneContext | null): z.infer<typeof UserMessageContext>['middlePane'] {
    if (!middlePaneContext) {
        return { kind: 'empty' };
    }
    if (middlePaneContext.kind === 'note') {
        return {
            kind: 'note',
            path: middlePaneContext.path,
            content: middlePaneContext.content,
        };
    }
    return {
        kind: 'browser',
        url: middlePaneContext.url,
        title: middlePaneContext.title,
    };
}

function buildUserMessageContext({
    agentName,
    middlePaneContext,
}: {
    agentName: string | null | undefined;
    middlePaneContext: MiddlePaneContext | null;
}): z.infer<typeof UserMessageContext> {
    return {
        currentDateTime: formatCurrentDateTime(new Date()),
        ...(hasWorkspaceContext(agentName)
            ? { middlePane: toUserMessageContextMiddlePane(middlePaneContext) }
            : {}),
    };
}


export interface IAgentRuntime {
    trigger(runId: string): Promise<void>;
}

export class AgentRuntime implements IAgentRuntime {
    private runsRepo: IRunsRepo;
    private idGenerator: IMonotonicallyIncreasingIdGenerator;
    private bus: IBus;
    private messageQueue: IMessageQueue;
    private modelConfigRepo: IModelConfigRepo;
    private runsLock: IRunsLock;
    private abortRegistry: IAbortRegistry;

    constructor({
        runsRepo,
        idGenerator,
        bus,
        messageQueue,
        modelConfigRepo,
        runsLock,
        abortRegistry,
    }: {
        runsRepo: IRunsRepo;
        idGenerator: IMonotonicallyIncreasingIdGenerator;
        bus: IBus;
        messageQueue: IMessageQueue;
        modelConfigRepo: IModelConfigRepo;
        runsLock: IRunsLock;
        abortRegistry: IAbortRegistry;
    }) {
        this.runsRepo = runsRepo;
        this.idGenerator = idGenerator;
        this.bus = bus;
        this.messageQueue = messageQueue;
        this.modelConfigRepo = modelConfigRepo;
        this.runsLock = runsLock;
        this.abortRegistry = abortRegistry;
    }

    async trigger(runId: string): Promise<void> {
        if (!await this.runsLock.lock(runId)) {
            console.log(`unable to acquire lock on run ${runId}`);
            return;
        }
        const signal = this.abortRegistry.createForRun(runId);
        // Legacy runs are user-facing chats: mark activity so background
        // agents can defer (see agents/headless-app.ts runWhenPossible).
        chatActivity.enter();
        try {
            await this.bus.publish({
                runId,
                type: "run-processing-start",
                subflow: [],
            });
            let totalEvents = 0;
            while (true) {
                // Check for abort before each iteration
                if (signal.aborted) {
                    break;
                }

                let eventCount = 0;
                const run = await this.runsRepo.fetch(runId);
                if (!run) {
                    throw new Error(`Run ${runId} not found`);
                }
                const state = new AgentState();
                for (const event of run.log) {
                    state.ingest(event);
                }
                try {
                    for await (const event of streamAgent({
                        state,
                        idGenerator: this.idGenerator,
                        runId,
                        messageQueue: this.messageQueue,
                        modelConfigRepo: this.modelConfigRepo,
                        signal,
                        abortRegistry: this.abortRegistry,
                        bus: this.bus,
                    })) {
                        eventCount++;
                        if (event.type !== "llm-stream-event") {
                            await this.runsRepo.appendEvents(runId, [event]);
                        }
                        await this.bus.publish(event);
                    }
                } catch (error) {
                    if (error instanceof Error && error.name === "AbortError") {
                        // Abort detected — exit cleanly
                        break;
                    }
                    throw error;
                }

                totalEvents += eventCount;
                // if no events, break
                if (!eventCount) {
                    break;
                }
            }

            // Emit run-stopped event if aborted
            if (signal.aborted) {
                const stoppedEvent: z.infer<typeof RunEvent> = {
                    runId,
                    type: "run-stopped",
                    reason: "user-requested",
                    subflow: [],
                };
                await this.runsRepo.appendEvents(runId, [stoppedEvent]);
                await this.bus.publish(stoppedEvent);
            } else if (totalEvents > 0) {
                // The run reached a natural stopping point and actually did
                // something this cycle. Notify "chat completion" — unless it
                // paused on a permission request, which surfaces its own
                // notification (distinguish by inspecting the final state).
                const finalRun = await this.runsRepo.fetch(runId);
                if (finalRun) {
                    const finalState = new AgentState();
                    for (const event of finalRun.log) {
                        finalState.ingest(event);
                    }
                    if (finalState.getPendingPermissions().length === 0) {
                        // This generic completion ping is only for real user
                        // chats (copilot_chat). Skip it for:
                        //  - knowledge_sync: an internal, auto-running agent
                        //    (knowledge-graph generation) that never notifies at
                        //    all and has no user-facing chat to "Open".
                        //  - background_task_agent: a user-configured agent that
                        //    DOES notify, but exclusively through its own
                        //    notify-user path; firing this ping too would
                        //    duplicate that notification.
                        // (The finally block still runs on this early return.)
                        if (
                            finalState.runUseCase === "knowledge_sync" ||
                            finalState.runUseCase === "background_task_agent"
                        ) return;
                        void notifyIfEnabled("chat_completion", {
                            title: "Response ready",
                            message: "Your agent finished responding.",
                            link: `rowboat://open?type=chat&runId=${runId}`,
                            actionLabel: "Open",
                            onlyWhenBackground: true,
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`Run ${runId} failed:`, error);
            const message = error instanceof Error
                ? (error.stack || error.message || error.name)
                : typeof error === "string" ? error : JSON.stringify(error);
            const errorEvent: z.infer<typeof RunEvent> = {
                runId,
                type: "error",
                error: message,
                subflow: [],
            };
            await this.runsRepo.appendEvents(runId, [errorEvent]);
            await this.bus.publish(errorEvent);
        } finally {
            chatActivity.exit();
            this.abortRegistry.cleanup(runId);
            await this.runsLock.release(runId);
            await this.bus.publish({
                runId,
                type: "run-processing-end",
                subflow: [],
            });
        }
    }
}

async function mapAgentTool(t: z.infer<typeof ToolAttachment>): Promise<Tool> {
    switch (t.type) {
        case "mcp":
            return tool({
                name: t.name,
                description: t.description,
                inputSchema: jsonSchema(t.inputSchema),
            });
        case "agent": {
            const agent = await loadAgent(t.name);
            if (!agent) {
                throw new Error(`Agent ${t.name} not found`);
            }
            return tool({
                name: t.name,
                description: agent.description,
                inputSchema: z.object({
                    message: z.string().describe("The message to send to the workflow"),
                }),
            });
        }
        case "builtin": {
            if (t.name === "ask-human") {
                return tool({
                    description: "Ask a human before proceeding. Optionally pass `options` (an array of short button labels) to render the question as a one-click choice; the user's response will be the chosen label verbatim.",
                    inputSchema: z.object({
                        question: z.string().describe("The question to ask the human"),
                        options: z.array(z.string()).optional().describe("Optional short button labels (2-4 recommended). If provided, the user picks one with a single click instead of typing. The response you receive will be the chosen label."),
                    }),
                });
            }
            const match = BuiltinTools[t.name];
            if (!match) {
                throw new Error(`Unknown builtin tool: ${t.name}`);
            }
            return tool({
                description: match.description,
                inputSchema: match.inputSchema,
            });
        }
    }
}


class StreamStepMessageBuilder {
    private parts: z.infer<typeof AssistantContentPart>[] = [];
    private textBuffer: string = "";
    private reasoningBuffer: string = "";
    private providerOptions: z.infer<typeof ProviderOptions> | undefined = undefined;
    private reasoningProviderOptions: z.infer<typeof ProviderOptions> | undefined = undefined;

    flushBuffers() {
        if (this.reasoningBuffer || this.reasoningProviderOptions) {
            this.parts.push({ type: "reasoning", text: this.reasoningBuffer, providerOptions: this.reasoningProviderOptions });
            this.reasoningBuffer = "";
            this.reasoningProviderOptions = undefined;
        }
        if (this.textBuffer) {
            this.parts.push({ type: "text", text: this.textBuffer });
            this.textBuffer = "";
        }
    }

    ingest(event: z.infer<typeof LlmStepStreamEvent>) {
        switch (event.type) {
            case "reasoning-start":
                break;
            case "reasoning-end":
                this.reasoningProviderOptions = event.providerOptions;
                this.flushBuffers();
                break;
            case "text-start":
            case "text-end":
                this.flushBuffers();
                break;
            case "reasoning-delta":
                this.reasoningBuffer += event.delta;
                break;
            case "text-delta":
                this.textBuffer += event.delta;
                break;
            case "tool-call":
                this.parts.push({
                    type: "tool-call",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    arguments: event.input,
                    providerOptions: event.providerOptions,
                });
                break;
            case "finish-step":
                this.providerOptions = event.providerOptions;
                break;
            case "error":
                this.flushBuffers();
                break;
        }
    }

    get(): z.infer<typeof AssistantMessage> {
        this.flushBuffers();
        return {
            role: "assistant",
            content: this.parts,
            providerOptions: this.providerOptions,
        };
    }
}

function formatLlmStreamError(rawError: unknown): string {
    let name: string | undefined;
    let responseBody: string | undefined;
    if (rawError && typeof rawError === "object") {
        const err = rawError as Record<string, unknown>;
        const nested = (err.error && typeof err.error === "object") ? err.error as Record<string, unknown> : null;
        const nameValue = err.name ?? nested?.name;
        const responseBodyValue = err.responseBody ?? nested?.responseBody;
        if (nameValue !== undefined) {
            name = String(nameValue);
        }
        if (responseBodyValue !== undefined) {
            responseBody = String(responseBodyValue);
        }
    } else if (typeof rawError === "string") {
        responseBody = rawError;
    }

    const lines: string[] = [];
    if (name) lines.push(`name: ${name}`);
    if (responseBody) lines.push(`responseBody: ${responseBody}`);
    return lines.length ? lines.join("\n") : "Model stream error";
}

async function buildTools(agent: z.infer<typeof Agent>): Promise<ToolSet> {
    const tools: ToolSet = {};
    for (const [name, tool] of Object.entries(agent.tools ?? {})) {
        try {
            // Skip builtin tools that declare themselves unavailable
            if (tool.type === 'builtin') {
                const builtin = BuiltinTools[tool.name];
                if (builtin?.isAvailable && !(await builtin.isAvailable())) {
                    continue;
                }
            }
            tools[name] = await mapAgentTool(tool);
        } catch (error) {
            console.error(`Error mapping tool ${name}:`, error);
            continue;
        }
    }
    return tools;
}

export class AgentState {
    runId: string | null = null;
    agent: z.infer<typeof Agent> | null = null;
    agentName: string | null = null;
    runModel: string | null = null;
    runProvider: string | null = null;
    permissionMode: "manual" | "auto" = "manual";
    runUseCase: UseCase | null = null;
    runSubUseCase: string | null = null;
    messages: z.infer<typeof MessageList> = [];
    lastAssistantMsg: z.infer<typeof AssistantMessage> | null = null;
    subflowStates: Record<string, AgentState> = {};
    toolCallIdMap: Record<string, z.infer<typeof ToolCallPart>> = {};
    pendingToolCalls: Record<string, true> = {};
    pendingToolPermissionRequests: Record<string, z.infer<typeof ToolPermissionRequestEvent>> = {};
    pendingAskHumanRequests: Record<string, z.infer<typeof AskHumanRequestEvent>> = {};
    allowedToolCallIds: Record<string, true> = {};
    deniedToolCallIds: Record<string, true> = {};
    autoAllowedToolCalls: Record<string, { reason: string }> = {};
    autoDeniedToolCalls: Record<string, { reason: string }> = {};
    sessionAllowedCommands: Set<string> = new Set();
    sessionAllowedFileAccess: FileAccessGrant[] = [];

    getPendingPermissions(): z.infer<typeof ToolPermissionRequestEvent>[] {
        const response: z.infer<typeof ToolPermissionRequestEvent>[] = [];
        for (const [id, subflowState] of Object.entries(this.subflowStates)) {
            for (const perm of subflowState.getPendingPermissions()) {
                response.push({
                    ...perm,
                    subflow: [id, ...perm.subflow],
                });
            }
        }
        for (const perm of Object.values(this.pendingToolPermissionRequests)) {
            response.push({
                ...perm,
                subflow: [],
            });
        }
        return response;
    }

    getPendingAskHumans(): z.infer<typeof AskHumanRequestEvent>[] {
        const response: z.infer<typeof AskHumanRequestEvent>[] = [];
        for (const [id, subflowState] of Object.entries(this.subflowStates)) {
            for (const ask of subflowState.getPendingAskHumans()) {
                response.push({
                    ...ask,
                    subflow: [id, ...ask.subflow],
                });
            }
        }
        for (const ask of Object.values(this.pendingAskHumanRequests)) {
            response.push({
                ...ask,
                subflow: [],
            });
        }
        return response;
    }

    /**
     * Returns tool-result messages for all pending tool calls, marking them as aborted.
     * This is called when a run is stopped so the LLM knows what happened to its tool requests.
     */
    getAbortedToolResults(): z.infer<typeof ToolMessage>[] {
        const results: z.infer<typeof ToolMessage>[] = [];
        for (const toolCallId of Object.keys(this.pendingToolCalls)) {
            const toolCall = this.toolCallIdMap[toolCallId];
            if (toolCall) {
                results.push({
                    role: "tool",
                    content: JSON.stringify({ error: "Tool execution aborted" }),
                    toolCallId,
                    toolName: toolCall.toolName,
                });
            }
        }
        return results;
    }

    /**
     * Clear all pending state (permissions, ask-human, tool calls).
     * Used when a run is stopped.
     */
    clearAllPending(): void {
        this.pendingToolPermissionRequests = {};
        this.pendingAskHumanRequests = {};
        // Recursively clear subflows
        for (const subflow of Object.values(this.subflowStates)) {
            subflow.clearAllPending();
        }
    }

    finalResponse(): string {
        if (!this.lastAssistantMsg) {
            return '';
        }
        if (typeof this.lastAssistantMsg.content === "string") {
            return this.lastAssistantMsg.content;
        }
        return this.lastAssistantMsg.content.reduce((acc, part) => {
            if (part.type === "text") {
                return acc + part.text;
            }
            return acc;
        }, "");
    }

    ingest(event: z.infer<typeof RunEvent>) {
        if (event.subflow.length > 0) {
            const { subflow, ...rest } = event;
            if (!this.subflowStates[subflow[0]]) {
                this.subflowStates[subflow[0]] = new AgentState();
            }
            this.subflowStates[subflow[0]].ingest({
                ...rest,
                subflow: subflow.slice(1),
            });
            return;
        }
        switch (event.type) {
            case "start":
                this.runId = event.runId;
                this.agentName = event.agentName;
                this.runModel = event.model;
                this.runProvider = event.provider;
                this.permissionMode = event.permissionMode ?? "manual";
                this.runUseCase = event.useCase ?? null;
                this.runSubUseCase = event.subUseCase ?? null;
                break;
            case "spawn-subflow":
                // Seed the subflow state with its agent so downstream loadAgent works.
                // Subflows inherit the parent run's model+provider — there's one pair per run.
                if (!this.subflowStates[event.toolCallId]) {
                    this.subflowStates[event.toolCallId] = new AgentState();
                }
                this.subflowStates[event.toolCallId].agentName = event.agentName;
                this.subflowStates[event.toolCallId].runModel = this.runModel;
                this.subflowStates[event.toolCallId].runProvider = this.runProvider;
                this.subflowStates[event.toolCallId].permissionMode = this.permissionMode;
                this.subflowStates[event.toolCallId].runUseCase = this.runUseCase;
                this.subflowStates[event.toolCallId].runSubUseCase = this.runSubUseCase;
                break;
            case "message":
                this.messages.push(event.message);
                if (event.message.content instanceof Array) {
                    for (const part of event.message.content) {
                        if (part.type === "tool-call") {
                            this.toolCallIdMap[part.toolCallId] = part;
                            this.pendingToolCalls[part.toolCallId] = true;
                        }
                    }
                }
                if (event.message.role === "tool") {
                    const message = event.message as z.infer<typeof ToolMessage>;
                    delete this.pendingToolCalls[message.toolCallId];
                }
                if (event.message.role === "assistant") {
                    this.lastAssistantMsg = event.message;
                }
                break;
            case "tool-permission-request":
                this.pendingToolPermissionRequests[event.toolCall.toolCallId] = event;
                break;
            case "tool-permission-response":
                switch (event.response) {
                    case "approve":
                        this.allowedToolCallIds[event.toolCallId] = true;
                        {
                            const permissionRequest = this.pendingToolPermissionRequests[event.toolCallId];
                            if (event.scope === "session" && permissionRequest?.permission?.kind === "file") {
                                this.sessionAllowedFileAccess.push({
                                    operation: permissionRequest.permission.operation,
                                    pathPrefix: permissionRequest.permission.pathPrefix,
                                });
                            }
                        }
                        // For session scope, extract command names and add to session allowlist
                        if (event.scope === "session") {
                            const toolCall = this.toolCallIdMap[event.toolCallId];
                            if (toolCall && typeof toolCall.arguments === 'object' && toolCall.arguments !== null && 'command' in toolCall.arguments) {
                                const names = extractCommandNames(String(toolCall.arguments.command));
                                for (const name of names) {
                                    this.sessionAllowedCommands.add(name);
                                }
                            }
                        }
                        break;
                    case "deny":
                        this.deniedToolCallIds[event.toolCallId] = true;
                        delete this.autoDeniedToolCalls[event.toolCallId];
                        break;
                }
                delete this.pendingToolPermissionRequests[event.toolCallId];
                break;
            case "tool-permission-auto-decision":
                switch (event.decision) {
                    case "allow":
                        this.allowedToolCallIds[event.toolCallId] = true;
                        this.autoAllowedToolCalls[event.toolCallId] = { reason: event.reason };
                        break;
                    case "deny":
                        this.autoDeniedToolCalls[event.toolCallId] = { reason: event.reason };
                        break;
                }
                break;
            case "ask-human-request":
                this.pendingAskHumanRequests[event.toolCallId] = event;
                break;
            case "ask-human-response": {
                // console.error('im here', this.agentName, this.runId, event.subflow);
                const ogEvent = this.pendingAskHumanRequests[event.toolCallId];
                this.messages.push({
                    role: "tool",
                    content: JSON.stringify({
                        userResponse: event.response,
                    }),
                    toolCallId: ogEvent.toolCallId,
                    toolName: this.toolCallIdMap[ogEvent.toolCallId]!.toolName,
                });
                delete this.pendingAskHumanRequests[ogEvent.toolCallId];
                break;
            }
        }
    }
}

export async function* streamAgent({
    state,
    idGenerator,
    runId,
    messageQueue,
    modelConfigRepo,
    signal,
    abortRegistry,
    bus,
}: {
    state: AgentState,
    idGenerator: IMonotonicallyIncreasingIdGenerator;
    runId: string;
    messageQueue: IMessageQueue;
    modelConfigRepo: IModelConfigRepo;
    signal: AbortSignal;
    abortRegistry: IAbortRegistry;
    bus: IBus;
}): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
    const logger = new PrefixLogger(`run-${runId}-${state.agentName}`);

    async function* processEvent(event: z.infer<typeof RunEvent>): AsyncGenerator<z.infer<typeof RunEvent>, void, unknown> {
        state.ingest(event);
        yield event;
    }

    // set up agent
    const agent = await loadAgent(state.agentName!);

    // set up tools
    const tools = await buildTools(agent);

    // model+provider were resolved and frozen on the run at runs:create time.
    // Look up the named provider's current credentials from models.json and
    // instantiate the LLM client. No selection happens here.
    if (!state.runModel || !state.runProvider) {
        throw new Error(`Run ${runId} is missing model/provider on its start event`);
    }
    const modelId = state.runModel;
    const providerConfig = await resolveProviderConfig(state.runProvider);
    const model = createLanguageModel(providerConfig, modelId);
    logger.log(`using model: ${modelId} (provider: ${state.runProvider})`);

    // Install use-case context for tool-internal LLM calls (e.g. parseFile)
    // so they can tag their `llm_usage` events with the parent run's category.
    enterUseCase({
        useCase: state.runUseCase ?? "copilot_chat",
        ...(state.runSubUseCase ? { subUseCase: state.runSubUseCase } : {}),
        ...(state.agentName ? { agentName: state.agentName } : {}),
    });

    let loopCounter = 0;
    let voiceInput = false;
    let voiceOutput: 'summary' | 'full' | null = null;
    let searchEnabled = false;
    let codeMode: 'claude' | 'codex' | null = null;
    let codeCwd: string | null = null;
    let codePolicy: 'ask' | 'auto-approve-reads' | 'yolo' | null = null;
    let middlePaneContext:
        | { kind: 'note'; path: string; content: string }
        | { kind: 'browser'; url: string; title: string }
        | null = null;
    while (true) {
        // Check abort at the top of each iteration
        signal.throwIfAborted();

        loopCounter++;
        const loopLogger = logger.child(`iter-${loopCounter}`);
        loopLogger.log('starting loop iteration');

        // execute any pending tool calls
        for (const toolCallId of Object.keys(state.pendingToolCalls)) {
            const toolCall = state.toolCallIdMap[toolCallId];
            const _logger = loopLogger.child(`tc-${toolCallId}-${toolCall.toolName}`);
            _logger.log('processing');

            // if ask-human, skip
            if (toolCall.toolName === "ask-human") {
                _logger.log('skipping, reason: ask-human');
                continue;
            }

            // if tool has been denied, deny
            if (state.deniedToolCallIds[toolCallId]) {
                _logger.log('returning denied tool message, reason: tool has been denied');
                const autoDenied = state.autoDeniedToolCalls[toolCallId];
                yield* processEvent({
                    runId,
                    messageId: await idGenerator.next(),
                    type: "message",
                    message: {
                        role: "tool",
                        content: autoDenied
                            ? JSON.stringify({
                                success: false,
                                error: `Auto-permission denied: ${autoDenied.reason}`,
                            })
                            : "Unable to execute this tool: Permission was denied.",
                        toolCallId: toolCallId,
                        toolName: toolCall.toolName,
                    },
                    subflow: [],
                });
                continue;
            }

            // if permission is pending on this tool call, skip execution
            if (state.pendingToolPermissionRequests[toolCallId]) {
                _logger.log('skipping, reason: permission is pending');
                continue;
            }

            // execute approved tool
            // Check abort before starting tool execution
            if (signal.aborted) {
                _logger.log('skipping, reason: aborted');
                break;
            }
            _logger.log('executing tool');
            yield* processEvent({
                runId,
                type: "tool-invocation",
                toolCallId,
                toolName: toolCall.toolName,
                input: JSON.stringify(toolCall.arguments ?? {}),
                subflow: [],
            });
            let result: unknown = null;
            try {
                if (agent.tools![toolCall.toolName].type === "agent") {
                    const subflowState = state.subflowStates[toolCallId];
                    for await (const event of streamAgent({
                        state: subflowState,
                        idGenerator,
                        runId,
                    messageQueue,
                    modelConfigRepo,
                    signal,
                    abortRegistry,
                    bus,
                })) {
                        yield* processEvent({
                            ...event,
                            subflow: [toolCallId, ...event.subflow],
                        });
                    }
                    if (!subflowState.getPendingAskHumans().length && !subflowState.getPendingPermissions().length) {
                        result = subflowState.finalResponse();
                    }
            } else {
                result = await execTool(agent.tools![toolCall.toolName], toolCall.arguments, {
                    runId,
                    toolCallId,
                    signal,
                    abortRegistry,
                    publish: (event) => bus.publish(event),
                    codeMode,
                    codeCwd,
                    codePolicy,
                });
            }
            } catch (error) {
                if ((error instanceof Error && error.name === "AbortError") || signal.aborted) {
                    throw error;
                }
                const message = error instanceof Error ? (error.message || error.name) : String(error);
                _logger.log('tool failed', message);
                result = {
                    success: false,
                    error: message,
                    toolName: toolCall.toolName,
                };
            }
            // This legacy loop has no mid-run tool extension; drop the
            // reserved tool-additions key (turns-runtime contract) so tool
            // schemas never leak into the model-visible result text.
            if (
                result !== null &&
                typeof result === "object" &&
                !Array.isArray(result) &&
                TOOL_ADDITIONS_KEY in result
            ) {
                const rest = { ...(result as Record<string, unknown>) };
                delete rest[TOOL_ADDITIONS_KEY];
                result = rest;
            }
            const resultPayload = result === undefined ? null : result;
            const resultMsg: z.infer<typeof ToolMessage> = {
                role: "tool",
                content: JSON.stringify(resultPayload),
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
            };
            yield* processEvent({
                runId,
                type: "tool-result",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result: resultPayload,
                subflow: [],
            });
            yield* processEvent({
                runId,
                messageId: await idGenerator.next(),
                type: "message",
                message: resultMsg,
                subflow: [],
            });
        }

        // if waiting on user permission or ask-human, exit
        if (state.getPendingAskHumans().length || state.getPendingPermissions().length) {
            loopLogger.log('exiting loop, reason: pending asks or permissions');
            return;
        }

        // get any queued user messages
        while (true) {
            const msg = await messageQueue.dequeue(runId);
            if (!msg) {
                break;
            }
            if (msg.voiceInput) {
                voiceInput = true;
            }
            if (msg.searchEnabled) {
                searchEnabled = true;
            }
            // Code mode is per-message: latest message decides whether the assistant
            // should route coding work through the code-with-agents skill / chosen agent.
            codeMode = msg.codeMode ?? null;
            codeCwd = msg.codeCwd ?? null;
            codePolicy = msg.codePolicy ?? null;
            if (msg.voiceOutput) {
                voiceOutput = msg.voiceOutput;
            }
            // Middle pane is NOT sticky — it should reflect the state at the moment of the
            // latest user message. If the user closed the pane between messages, clear it.
            middlePaneContext = msg.middlePaneContext ?? null;
            loopLogger.log('dequeued user message', msg.messageId);
            const userMessageContext = buildUserMessageContext({
                agentName: state.agentName,
                middlePaneContext,
            });
            yield* processEvent({
                runId,
                type: "message",
                messageId: msg.messageId,
                message: {
                    role: "user",
                    content: msg.message,
                    userMessageContext,
                },
                subflow: [],
            });
        }

        // if last response is from assistant and text, exit
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage
            && lastMessage.role === "assistant"
            && (typeof lastMessage.content === "string"
                || !lastMessage.content.some(part => part.type === "tool-call")
            )
        ) {
            loopLogger.log('exiting loop, reason: last message is from assistant and text');
            return;
        }

        // run one LLM turn.
        loopLogger.log('running llm turn');
        // stream agent response and build message
        const messageBuilder = new StreamStepMessageBuilder();
        const workspace = loadWorkspaceContext(state.agentName, runId);
        const instructionsWithDateTime = composeSystemInstructions({
            instructions: agent.instructions,
            agentNotesContext: workspace.agentNotesContext,
            userWorkDir: workspace.userWorkDir,
            voiceInput,
            voiceOutput,
            searchEnabled,
            codeMode,
            codeCwd,
            // The legacy runs engine never composes video/coach modes.
            videoMode: false,
            coachMode: false,
        });
        let streamError: string | null = null;
        for await (const event of streamLlm(
            model,
            state.messages,
            instructionsWithDateTime,
            tools,
            signal,
            {
                useCase: state.runUseCase ?? "copilot_chat",
                ...(state.runSubUseCase ? { subUseCase: state.runSubUseCase } : {}),
                agentName: state.agentName ?? undefined,
                modelId,
                providerName: state.runProvider!,
            },
        )) {
            messageBuilder.ingest(event);
            yield* processEvent({
                runId,
                type: "llm-stream-event",
                event: event,
                subflow: [],
            });
            if (event.type === "error") {
                streamError = event.error;
                yield* processEvent({
                    runId,
                    type: "error",
                    error: streamError,
                    subflow: [],
                });
                break;
            }
        }

        // build and emit final message from agent response
        const message = messageBuilder.get();
        yield* processEvent({
            runId,
            messageId: await idGenerator.next(),
            type: "message",
            message,
            subflow: [],
        });

        if (streamError) {
            return;
        }

        // if there were any ask-human calls, emit those events
        if (message.content instanceof Array) {
            const permissionCandidates: AutoPermissionCandidate[] = [];
            for (const part of message.content) {
                if (part.type === "tool-call") {
                    const underlyingTool = agent.tools![part.toolName];
                    // The model can hallucinate a tool name that isn't declared.
                    // Skip it here instead of dereferencing undefined (which would
                    // crash the whole run); the SDK returns an error tool-result
                    // for the unknown call so the model can self-correct.
                    if (!underlyingTool) {
                        loopLogger.log('model called unknown tool, skipping:', part.toolName);
                        continue;
                    }
                    if (underlyingTool.type === "builtin" && underlyingTool.name === "ask-human") {
                        loopLogger.log('emitting ask-human-request, toolCallId:', part.toolCallId);
                        const rawOptions = (part.arguments as { options?: unknown }).options;
                        const options = Array.isArray(rawOptions)
                            ? rawOptions.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
                            : undefined;
                        yield* processEvent({
                            runId,
                            type: "ask-human-request",
                            toolCallId: part.toolCallId,
                            query: part.arguments.question,
                            ...(options && options.length > 0 ? { options } : {}),
                            subflow: [],
                        });
                    }
                    const permission = await getToolPermissionMetadata(
                        part,
                        underlyingTool,
                        state.sessionAllowedCommands,
                        state.sessionAllowedFileAccess,
                    );
                    if (permission) {
                        permissionCandidates.push({ toolCall: part, permission });
                    }
                    if (underlyingTool.type === "agent" && underlyingTool.name) {
                        loopLogger.log('emitting spawn-subflow, toolCallId:', part.toolCallId);
                        yield* processEvent({
                            runId,
                            type: "spawn-subflow",
                            agentName: underlyingTool.name,
                            toolCallId: part.toolCallId,
                            subflow: [],
                        });
                        yield* processEvent({
                            runId,
                            messageId: await idGenerator.next(),
                            type: "message",
                            message: {
                                role: "user",
                                content: part.arguments.message,
                            },
                            subflow: [part.toolCallId],
                        });
                    }
                }
            }

            if (permissionCandidates.length > 0) {
                // Permission prompts block the run, so they surface even when the
                // app is focused (no onlyWhenBackground gate).
                const notifyPermissionPrompt = (toolCall: typeof permissionCandidates[number]["toolCall"]) => {
                    void notifyIfEnabled("agent_permission", {
                        title: "Permission needed",
                        message: `${agent.name} wants to run "${toolCall.toolName}". Review to continue.`,
                        link: `rowboat://open?type=chat&runId=${runId}`,
                        actionLabel: "Review",
                    });
                };
                if (state.permissionMode === "auto") {
                    let decisionsByToolCallId = new Map<string, { decision: "allow" | "deny"; reason: string }>();
                    try {
                        const decisions = await classifyToolPermissions({
                            runId,
                            agentName: state.agentName,
                            messages: convertFromMessages(state.messages),
                            candidates: permissionCandidates,
                            useCase: state.runUseCase ?? "copilot_chat",
                            subUseCase: state.runSubUseCase,
                        });
                        decisionsByToolCallId = new Map(decisions.map((decision) => [
                            decision.toolCallId,
                            { decision: decision.decision, reason: decision.reason },
                        ]));
                    } catch (error) {
                        loopLogger.log(
                            'auto-permission classifier failed:',
                            error instanceof Error ? error.message : String(error),
                        );
                    }

                    for (const candidate of permissionCandidates) {
                        const decision = decisionsByToolCallId.get(candidate.toolCall.toolCallId);
                        if (!decision) {
                            loopLogger.log('auto-permission missing decision, falling back to prompt:', candidate.toolCall.toolCallId);
                            yield* processEvent({
                                runId,
                                type: "tool-permission-request",
                                toolCall: candidate.toolCall,
                                permission: candidate.permission,
                                subflow: [],
                            });
                            notifyPermissionPrompt(candidate.toolCall);
                            continue;
                        }

                        loopLogger.log(
                            'emitting tool-permission-auto-decision, toolCallId:',
                            candidate.toolCall.toolCallId,
                            'decision:',
                            decision.decision,
                        );
                        yield* processEvent({
                            runId,
                            type: "tool-permission-auto-decision",
                            toolCallId: candidate.toolCall.toolCallId,
                            toolCall: candidate.toolCall,
                            permission: candidate.permission,
                            decision: decision.decision,
                            reason: decision.reason,
                            subflow: [],
                        });
                        if (decision.decision === "deny") {
                            loopLogger.log(
                                'auto-permission denied, falling back to prompt:',
                                candidate.toolCall.toolCallId,
                            );
                            yield* processEvent({
                                runId,
                                type: "tool-permission-request",
                                toolCall: candidate.toolCall,
                                permission: candidate.permission,
                                subflow: [],
                            });
                            notifyPermissionPrompt(candidate.toolCall);
                        }
                    }
                } else {
                    for (const candidate of permissionCandidates) {
                        loopLogger.log('emitting tool-permission-request, toolCallId:', candidate.toolCall.toolCallId);
                        yield* processEvent({
                            runId,
                            type: "tool-permission-request",
                            toolCall: candidate.toolCall,
                            permission: candidate.permission,
                            subflow: [],
                        });
                        notifyPermissionPrompt(candidate.toolCall);
                    }
                }
            }
        }
    }
}

interface StreamLlmAnalytics {
    useCase: UseCase;
    subUseCase?: string;
    agentName?: string;
    modelId: string;
    providerName: string;
}

async function* streamLlm(
    model: LanguageModel,
    messages: z.infer<typeof MessageList>,
    instructions: string,
    tools: ToolSet,
    signal?: AbortSignal,
    analytics?: StreamLlmAnalytics,
): AsyncGenerator<z.infer<typeof LlmStepStreamEvent>, void, unknown> {
    const converted = convertFromMessages(messages);
    console.log(`! SENDING payload to model: `, JSON.stringify(converted))
    const streamResult = analytics
        ? withUseCase({
            useCase: analytics.useCase,
            ...(analytics.subUseCase ? { subUseCase: analytics.subUseCase } : {}),
            ...(analytics.agentName ? { agentName: analytics.agentName } : {}),
        }, () => streamText({
            model,
            messages: converted,
            system: instructions,
            tools,
            stopWhen: stepCountIs(1),
            abortSignal: signal,
        }))
        : streamText({
            model,
            messages: converted,
            system: instructions,
            tools,
            stopWhen: stepCountIs(1),
            abortSignal: signal,
        });
    const { fullStream } = streamResult;
    for await (const event of fullStream) {
        // Check abort on every chunk for responsiveness
        signal?.throwIfAborted();
        console.log("-> \t\tstream event", JSON.stringify(event));
        switch (event.type) {
            case "error":
                yield {
                    type: "error",
                    error: formatLlmStreamError((event as { error?: unknown }).error ?? event),
                };
                return;
            case "reasoning-start":
                yield {
                    type: "reasoning-start",
                    providerOptions: event.providerMetadata,
                };
                break;
            case "reasoning-delta":
                yield {
                    type: "reasoning-delta",
                    delta: event.text,
                    providerOptions: event.providerMetadata,
                };
                break;
            case "reasoning-end":
                yield {
                    type: "reasoning-end",
                    providerOptions: event.providerMetadata,
                };
                break;
            case "text-start":
                yield {
                    type: "text-start",
                    providerOptions: event.providerMetadata,
                };
                break;
            case "text-end":
                yield {
                    type: "text-end",
                    providerOptions: event.providerMetadata,
                };
                break;
            case "text-delta":
                yield {
                    type: "text-delta",
                    delta: event.text,
                    providerOptions: event.providerMetadata,
                };
                break;
            case "tool-call":
                yield {
                    type: "tool-call",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    input: event.input,
                    providerOptions: event.providerMetadata,
                };
                break;
            case "finish-step":
                if (analytics) {
                    captureLlmUsage({
                        useCase: analytics.useCase,
                        ...(analytics.subUseCase ? { subUseCase: analytics.subUseCase } : {}),
                        ...(analytics.agentName ? { agentName: analytics.agentName } : {}),
                        model: analytics.modelId,
                        provider: analytics.providerName,
                        usage: event.usage,
                    });
                }
                yield {
                    type: "finish-step",
                    usage: event.usage,
                    finishReason: event.finishReason,
                    providerOptions: event.providerMetadata,
                };
                break;
            default:
                console.log('unknown stream event:', JSON.stringify(event));
                continue;
        }
    }
}
