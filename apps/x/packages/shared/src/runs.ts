import { LlmStepStreamEvent } from "./llm-step-events.js";
import { Message, ToolCallPart } from "./message.js";
import { CodeRunEvent as CodeRunEventSchema, PermissionAsk } from "./code-mode.js";
import z from "zod";

const BaseRunEvent = z.object({
    runId: z.string(),
    ts: z.iso.datetime().optional(),
    subflow: z.array(z.string()),
});

export const RunProcessingStartEvent = BaseRunEvent.extend({
    type: z.literal("run-processing-start"),
});

export const RunProcessingEndEvent = BaseRunEvent.extend({
    type: z.literal("run-processing-end"),
});

export const StartEvent = BaseRunEvent.extend({
    type: z.literal("start"),
    agentName: z.string(),
    model: z.string(),
    provider: z.string(),
    permissionMode: z.enum(["manual", "auto"]).optional(),
    // useCase/subUseCase tag the run for analytics. Optional on read so legacy
    // run files written before these fields existed still parse cleanly.
    useCase: z.enum([
        "copilot_chat",
        "live_note_agent",
        "background_task_agent",
        "meeting_note",
        "knowledge_sync",
        "code_session",
        "app_llm_generate",
        "app_copilot_run",
    ]).optional(),
    subUseCase: z.string().optional(),
});

export const SpawnSubFlowEvent = BaseRunEvent.extend({
    type: z.literal("spawn-subflow"),
    agentName: z.string(),
    toolCallId: z.string(),
});

export const LlmStreamEvent = BaseRunEvent.extend({
    type: z.literal("llm-stream-event"),
    event: LlmStepStreamEvent,
});

export const MessageEvent = BaseRunEvent.extend({
    type: z.literal("message"),
    messageId: z.string(),
    message: Message,
});

export const ToolInvocationEvent = BaseRunEvent.extend({
    type: z.literal("tool-invocation"),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    input: z.string(),
});

export const ToolResultEvent = BaseRunEvent.extend({
    type: z.literal("tool-result"),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    result: z.any(),
});

export const ToolOutputStreamEvent = BaseRunEvent.extend({
    type: z.literal("tool-output-stream"),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.string(),
});

export const AskHumanRequestEvent = BaseRunEvent.extend({
    type: z.literal("ask-human-request"),
    toolCallId: z.string(),
    query: z.string(),
    options: z.array(z.string()).optional(),
});

export const AskHumanResponseEvent = BaseRunEvent.extend({
    type: z.literal("ask-human-response"),
    toolCallId: z.string(),
    response: z.string(),
});

export const ToolPermissionMetadata = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("command"),
        commandNames: z.array(z.string()),
    }),
    z.object({
        kind: z.literal("file"),
        operation: z.enum(["read", "list", "search", "write", "delete"]),
        paths: z.array(z.string()),
        pathPrefix: z.string(),
    }),
]);

export const ToolPermissionRequestEvent = BaseRunEvent.extend({
    type: z.literal("tool-permission-request"),
    toolCall: ToolCallPart,
    permission: ToolPermissionMetadata.optional(),
});

export const ToolPermissionResponseEvent = BaseRunEvent.extend({
    type: z.literal("tool-permission-response"),
    toolCallId: z.string(),
    response: z.enum(["approve", "deny"]),
    scope: z.enum(["once", "session", "always"]).optional(),
});

// A structured item from a code_agent_run coding turn (tool call, diff, plan,
// message chunk, resolved permission). Fire-and-forget — rendered live.
export const CodeRunStreamEvent = BaseRunEvent.extend({
    type: z.literal("code-run-event"),
    toolCallId: z.string(),
    event: CodeRunEventSchema,
});

// The coding agent is asking for permission mid-turn and the run is BLOCKED until
// the user answers via `codeRun:resolvePermission` (keyed by requestId).
export const CodeRunPermissionRequestEvent = BaseRunEvent.extend({
    type: z.literal("code-run-permission-request"),
    toolCallId: z.string(),
    requestId: z.string(),
    ask: PermissionAsk,
});

export const ToolPermissionAutoDecisionEvent = BaseRunEvent.extend({
    type: z.literal("tool-permission-auto-decision"),
    toolCallId: z.string(),
    toolCall: ToolCallPart,
    permission: ToolPermissionMetadata.optional(),
    decision: z.enum(["allow", "deny"]),
    reason: z.string(),
});

export const RunErrorEvent = BaseRunEvent.extend({
    type: z.literal("error"),
    error: z.string(),
});

export const RunStoppedEvent = BaseRunEvent.extend({
    type: z.literal("run-stopped"),
    reason: z.enum(["user-requested", "force-stopped"]).optional(),
});

export const RunEvent = z.union([
    RunProcessingStartEvent,
    RunProcessingEndEvent,
    StartEvent,
    SpawnSubFlowEvent,
    LlmStreamEvent,
    MessageEvent,
    ToolInvocationEvent,
    ToolResultEvent,
    ToolOutputStreamEvent,
    AskHumanRequestEvent,
    AskHumanResponseEvent,
    ToolPermissionRequestEvent,
    ToolPermissionResponseEvent,
    CodeRunStreamEvent,
    CodeRunPermissionRequestEvent,
    ToolPermissionAutoDecisionEvent,
    RunErrorEvent,
    RunStoppedEvent,
]);

export const ToolPermissionAuthorizePayload = ToolPermissionResponseEvent.pick({
    subflow: true,
    toolCallId: true,
    response: true,
    scope: true,
});

export const AskHumanResponsePayload = AskHumanResponseEvent.pick({
    subflow: true,
    toolCallId: true,
    response: true,
});

export const UseCase = z.enum([
    "copilot_chat",
    "live_note_agent",
    "background_task_agent",
    "meeting_note",
    "knowledge_sync",
    "code_session",
    "app_llm_generate",
    "app_copilot_run",
]);

export const Run = z.object({
    id: z.string(),
    title: z.string().optional(),
    createdAt: z.iso.datetime(),
    agentId: z.string(),
    model: z.string(),
    provider: z.string(),
    permissionMode: z.enum(["manual", "auto"]).optional(),
    useCase: UseCase.optional(),
    subUseCase: z.string().optional(),
    log: z.array(RunEvent),
});

export const ListRunsResponse = z.object({
    runs: z.array(Run.pick({
        id: true,
        title: true,
        createdAt: true,
        agentId: true,
        useCase: true,
    }).extend({
        // Last-modified time of the run's log file (mtime), used to order the
        // chat history by recent activity rather than creation time.
        modifiedAt: z.iso.datetime(),
    })),
    nextCursor: z.string().optional(),
});

export const CreateRunOptions = z.object({
    agentId: z.string(),
    model: z.string().optional(),
    provider: z.string().optional(),
    permissionMode: z.enum(["manual", "auto"]).optional(),
    useCase: UseCase.optional(),
    subUseCase: z.string().optional(),
});
