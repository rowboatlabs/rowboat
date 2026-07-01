import { jsonSchema, ModelMessage } from "ai";
import fs from "fs";
import path from "path";
import { WorkDir } from "../config/config.js";
import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import { AssistantContentPart, AssistantMessage, Message, MessageList, ProviderOptions, ToolCallPart, ToolMessage, UserMessageContext } from "@x/shared/dist/message.js";
import { LanguageModel, stepCountIs, streamText, tool, Tool, ToolSet } from "ai";
import { z } from "zod";
import { LlmStepStreamEvent } from "@x/shared/dist/llm-step-events.js";
import { execTool } from "../application/lib/exec-tool.js";
import { AskHumanRequestEvent, RunEvent, ToolPermissionMetadata, ToolPermissionRequestEvent } from "@x/shared/dist/runs.js";
import { BuiltinTools } from "../application/lib/builtin-tools.js";
import { buildCopilotAgent } from "../application/assistant/agent.js";
import { buildLiveNoteAgent } from "../knowledge/live-note/agent.js";
import { buildBackgroundTaskAgent } from "../background-tasks/agent.js";
import { isBlocked, extractCommandNames } from "../application/lib/command-executor.js";
import { getFileAccessAllowList, type FileAccessGrant, type FileAccessOperation } from "../config/security.js";
import { resolveFilePathForPermission } from "../filesystem/files.js";
import container from "../di/container.js";
import { notifyIfEnabled } from "../application/notification/notifier.js";
import { IModelConfigRepo } from "../models/repo.js";
import { createProvider } from "../models/models.js";
import { resolveProviderConfig } from "../models/defaults.js";
import { IAgentsRepo } from "./repo.js";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { IBus } from "../application/lib/bus.js";
import { IMessageQueue, type MiddlePaneContext } from "../application/lib/message-queue.js";
import { IRunsRepo } from "../runs/repo.js";
import { IRunsLock } from "../runs/lock.js";
import { IAbortRegistry } from "../runs/abort-registry.js";
import { PrefixLogger } from "@x/shared";
import { parse } from "yaml";
import { captureLlmUsage } from "../analytics/usage.js";
import { enterUseCase, withUseCase, type UseCase } from "../analytics/use_case.js";
import { getRaw as getNoteCreationRaw } from "../knowledge/note_creation.js";
import { getRaw as getLabelingAgentRaw } from "../knowledge/labeling_agent.js";
import { getRaw as getNoteTaggingAgentRaw } from "../knowledge/note_tagging_agent.js";
import { getRaw as getInlineTaskAgentRaw } from "../knowledge/inline_task_agent.js";
import { getRaw as getAgentNotesAgentRaw } from "../knowledge/agent_notes_agent.js";
import { classifyToolPermissions, type AutoPermissionCandidate } from "../security/auto-permission-classifier.js";

const AGENT_NOTES_DIR = path.join(WorkDir, 'knowledge', 'Agent Notes');

// Work directory is scoped per run (per chat). Each run gets its own sidecar
// config file so setting it in one chat does not leak into others.
function workDirConfigFile(runId: string): string {
    return path.join(WorkDir, 'config', `workdir-${runId}.json`);
}

type ToolPermissionMetadataValue = z.infer<typeof ToolPermissionMetadata>;

function isPathInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function fileGrantCoversPath(grant: FileAccessGrant, operation: FileAccessOperation, resolvedPath: string): boolean {
    return grant.operation === operation && isPathInside(path.resolve(grant.pathPrefix), path.resolve(resolvedPath));
}

function commonPathPrefix(paths: string[]): string {
    if (!paths.length) return path.resolve(WorkDir);
    const split = paths.map(p => path.resolve(p).split(path.sep).filter(Boolean));
    const first = split[0];
    const common: string[] = [];
    for (let i = 0; i < first.length; i++) {
        if (split.every(parts => parts[i] === first[i])) {
            common.push(first[i]);
        } else {
            break;
        }
    }
    const prefix = `${path.sep}${common.join(path.sep)}`;
    return prefix === path.sep ? prefix : path.resolve(prefix);
}

function grantPrefixForTool(toolName: string, resolvedPaths: string[]): string {
    if (toolName === 'file-list' || toolName === 'file-glob' || toolName === 'file-grep' || toolName === 'file-mkdir') {
        return commonPathPrefix(resolvedPaths);
    }
    const parentPaths = resolvedPaths.map(p => path.dirname(p));
    return commonPathPrefix(parentPaths);
}

function filePermissionTargets(toolName: string, args: Record<string, unknown>): { operation: FileAccessOperation; paths: string[] } | null {
    const pathArg = typeof args.path === 'string' ? args.path : undefined;
    switch (toolName) {
        case 'file-readText':
        case 'parseFile':
        case 'LLMParse':
        case 'file-exists':
        case 'file-stat':
            return pathArg ? { operation: 'read', paths: [pathArg] } : null;
        case 'file-list':
            return pathArg ? { operation: 'list', paths: [pathArg || '.'] } : null;
        case 'file-glob':
            return { operation: 'search', paths: [typeof args.cwd === 'string' && args.cwd ? args.cwd : '.'] };
        case 'file-grep':
            return { operation: 'search', paths: [typeof args.searchPath === 'string' && args.searchPath ? args.searchPath : '.'] };
        case 'file-writeText':
        case 'file-editText':
        case 'file-mkdir':
            return pathArg ? { operation: 'write', paths: [pathArg] } : null;
        case 'file-copy':
        case 'file-rename': {
            const from = typeof args.from === 'string' ? args.from : undefined;
            const to = typeof args.to === 'string' ? args.to : undefined;
            return from && to ? { operation: 'write', paths: [from, to] } : null;
        }
        case 'file-remove':
            return pathArg ? { operation: 'delete', paths: [pathArg] } : null;
        default:
            return null;
    }
}

async function getToolPermissionMetadata(
    toolCall: z.infer<typeof ToolCallPart>,
    underlyingTool: z.infer<typeof ToolAttachment>,
    sessionAllowedCommands: Set<string>,
    sessionAllowedFileAccess: FileAccessGrant[],
): Promise<ToolPermissionMetadataValue | null> {
    if (underlyingTool.type !== 'builtin') {
        return null;
    }

    if (underlyingTool.name === 'executeCommand') {
        const args = toolCall.arguments;
        if (!args || typeof args !== 'object' || !('command' in args)) {
            return null;
        }
        const command = String((args as { command: unknown }).command);
        if (!isBlocked(command, sessionAllowedCommands)) {
            return null;
        }
        return {
            kind: 'command',
            commandNames: extractCommandNames(command),
        };
    }

    const args = toolCall.arguments && typeof toolCall.arguments === 'object'
        ? toolCall.arguments as Record<string, unknown>
        : {};
    const targets = filePermissionTargets(underlyingTool.name, args);
    if (!targets) {
        return null;
    }

    const resolvedTargets = await Promise.all(targets.paths.map(p => resolveFilePathForPermission(p)));
    const outsideWorkspacePaths = resolvedTargets
        .filter(target => !target.isInsideWorkspace)
        .map(target => target.canonicalPath);
    if (!outsideWorkspacePaths.length) {
        return null;
    }

    const persistentGrants = getFileAccessAllowList();
    const allGrants = [...persistentGrants, ...sessionAllowedFileAccess];
    const uncovered = outsideWorkspacePaths.filter(resolvedPath =>
        !allGrants.some(grant => fileGrantCoversPath(grant, targets.operation, resolvedPath))
    );
    if (!uncovered.length) {
        return null;
    }

    return {
        kind: 'file',
        operation: targets.operation,
        paths: uncovered,
        pathPrefix: grantPrefixForTool(underlyingTool.name, uncovered),
    };
}

function loadUserWorkDir(runId: string): string | null {
    try {
        const file = workDirConfigFile(runId);
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as { path?: unknown };
        const value = typeof parsed.path === 'string' ? parsed.path.trim() : '';
        return value || null;
    } catch {
        return null;
    }
}

function loadAgentNotesContext(): string | null {
    const sections: string[] = [];

    const userFile = path.join(AGENT_NOTES_DIR, 'user.md');
    const prefsFile = path.join(AGENT_NOTES_DIR, 'preferences.md');

    try {
        if (fs.existsSync(userFile)) {
            const content = fs.readFileSync(userFile, 'utf-8').trim();
            if (content) {
                sections.push(`## About the User\nThese are notes you took about the user in previous chats.\n\n${content}`);
            }
        }
    } catch { /* ignore */ }

    try {
        if (fs.existsSync(prefsFile)) {
            const content = fs.readFileSync(prefsFile, 'utf-8').trim();
            if (content) {
                sections.push(`## User Preferences\nThese are notes you took on their general preferences.\n\n${content}`);
            }
        }
    } catch { /* ignore */ }

    // List other Agent Notes files for on-demand access
    const otherFiles: string[] = [];
    const skipFiles = new Set(['user.md', 'preferences.md', 'inbox.md']);
    try {
        if (fs.existsSync(AGENT_NOTES_DIR)) {
            function listMdFiles(dir: string, prefix: string) {
                for (const entry of fs.readdirSync(dir)) {
                    const fullPath = path.join(dir, entry);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        listMdFiles(fullPath, `${prefix}${entry}/`);
                    } else if (entry.endsWith('.md') && !skipFiles.has(`${prefix}${entry}`)) {
                        otherFiles.push(`${prefix}${entry}`);
                    }
                }
            }
            listMdFiles(AGENT_NOTES_DIR, '');
        }
    } catch { /* ignore */ }

    if (otherFiles.length > 0) {
        sections.push(`## More Specific Preferences\nFor more specific preferences, you can read these files using file-readText. Only read them when relevant to the current task.\n\n${otherFiles.map(f => `- knowledge/Agent Notes/${f}`).join('\n')}`);
    }

    if (sections.length === 0) return null;
    return `# Agent Memory\n\n${sections.join('\n\n')}`;
}

function isCopilotLikeAgent(agentName: string | null | undefined): boolean {
    return agentName === 'copilot' || agentName === 'rowboatx';
}

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
        ...(isCopilotLikeAgent(agentName)
            ? { middlePane: toUserMessageContextMiddlePane(middlePaneContext) }
            : {}),
    };
}

function formatUserMessageContextForLlm(userMessageContext: z.infer<typeof UserMessageContext>): string {
    const sections: string[] = [];

    if (userMessageContext.currentDateTime) {
        sections.push(`Current date and time: ${userMessageContext.currentDateTime}`);
    }

    if (userMessageContext.middlePane) {
        if (userMessageContext.middlePane.kind === 'empty') {
            sections.push(`Middle pane:\nState: empty`);
        } else if (userMessageContext.middlePane.kind === 'note') {
            sections.push(`Middle pane:\nState: note\nPath: ${userMessageContext.middlePane.path}\n\nContent:\n\`\`\`\n${userMessageContext.middlePane.content}\n\`\`\``);
        } else {
            sections.push(`Middle pane:\nState: browser\nURL: ${userMessageContext.middlePane.url}\nTitle: ${userMessageContext.middlePane.title}`);
        }
    }

    if (sections.length === 0) {
        return '';
    }

    return `# User Context
${sections.join('\n\n')}

# User Message
`;
}

const USER_CONTEXT_SYSTEM_INSTRUCTIONS = `# Hidden User Context
User messages may include a hidden "# User Context" section before "# User Message". Treat it as runtime metadata captured when that specific user message was sent. The actual user-authored text starts under "# User Message".

Use "Current date and time" for temporal reasoning.

If Middle pane context is present, it reflects what the user had open at the time of that specific message and overrides earlier middle-pane references. If the conversation history references a different note or browser page, the user had since closed or navigated away from it. Do not treat earlier context as current.

If Middle pane state is empty, the user was not looking at any relevant note or web page at that point. Answer the user's message on its own merits.

If Middle pane state is note, the supplied path and content are available so you can reference the note when relevant. The user may or may not be talking about this note. Do NOT assume every message is about it. Only reference or act on this note when the user's message clearly relates to it, such as "this note", "what I'm looking at", "here", "above", "below", or questions whose subject is plainly the note's content. For unrelated questions, ignore this note entirely and answer normally. Do not mention that you can see this note unless it is relevant to the answer.

If Middle pane state is browser, only the URL and page title are supplied; the page content itself is NOT included. If you need the page content to answer, use the browser tools available to you to read the page. The user may or may not be talking about this page. Only reference or act on this page when the user's message clearly relates to it, such as "this page", "this article", "what I'm looking at", "this site", or "summarize this". For unrelated questions, ignore this page entirely and answer normally. Do not mention that you can see the browser unless it is relevant to the answer.`;

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

export async function mapAgentTool(t: z.infer<typeof ToolAttachment>): Promise<Tool> {
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

export class RunLogger {
    private logFile: string;
    private fileHandle: fs.WriteStream;

    ensureRunsDir() {
        const runsDir = path.join(WorkDir, "runs");
        if (!fs.existsSync(runsDir)) {
            fs.mkdirSync(runsDir, { recursive: true });
        }
    }

    constructor(runId: string) {
        this.ensureRunsDir();
        this.logFile = path.join(WorkDir, "runs", `${runId}.jsonl`);
        this.fileHandle = fs.createWriteStream(this.logFile, {
            flags: "a",
            encoding: "utf8",
        });
    }

    log(event: z.infer<typeof RunEvent>) {
        if (event.type !== "llm-stream-event") {
            this.fileHandle.write(JSON.stringify(event) + "\n");
        }
    }

    close() {
        this.fileHandle.close();
    }
}

export class StreamStepMessageBuilder {
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

export async function loadAgent(id: string): Promise<z.infer<typeof Agent>> {
    if (id === "copilot" || id === "rowboatx") {
        return buildCopilotAgent();
    }

    if (id === "live-note-agent") {
        return buildLiveNoteAgent();
    }

    if (id === "background-task-agent") {
        return buildBackgroundTaskAgent();
    }

    if (id === 'note_creation') {
        const raw = getNoteCreationRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: raw,
        };

        // Parse frontmatter if present
        if (raw.startsWith("---")) {
            const end = raw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = raw.slice(3, end).trim();
                const content = raw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'labeling_agent') {
        const labelingAgentRaw = getLabelingAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: labelingAgentRaw,
        };

        if (labelingAgentRaw.startsWith("---")) {
            const end = labelingAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = labelingAgentRaw.slice(3, end).trim();
                const content = labelingAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'note_tagging_agent') {
        const noteTaggingAgentRaw = getNoteTaggingAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: noteTaggingAgentRaw,
        };

        if (noteTaggingAgentRaw.startsWith("---")) {
            const end = noteTaggingAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = noteTaggingAgentRaw.slice(3, end).trim();
                const content = noteTaggingAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'inline_task_agent') {
        const inlineTaskAgentRaw = getInlineTaskAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: inlineTaskAgentRaw,
        };

        if (inlineTaskAgentRaw.startsWith("---")) {
            const end = inlineTaskAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = inlineTaskAgentRaw.slice(3, end).trim();
                const content = inlineTaskAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    if (id === 'agent_notes_agent') {
        const agentNotesAgentRaw = getAgentNotesAgentRaw();
        let agent: z.infer<typeof Agent> = {
            name: id,
            instructions: agentNotesAgentRaw,
        };

        if (agentNotesAgentRaw.startsWith("---")) {
            const end = agentNotesAgentRaw.indexOf("\n---", 3);
            if (end !== -1) {
                const fm = agentNotesAgentRaw.slice(3, end).trim();
                const content = agentNotesAgentRaw.slice(end + 4).trim();
                const yaml = parse(fm);
                const parsed = Agent.omit({ name: true, instructions: true }).parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    const repo = container.resolve<IAgentsRepo>('agentsRepo');
    return await repo.fetch(id);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function convertFromMessages(messages: z.infer<typeof Message>[]): ModelMessage[] {
    const result: ModelMessage[] = [];
    for (const msg of messages) {
        const { providerOptions } = msg;
        switch (msg.role) {
            case "assistant":
                if (typeof msg.content === 'string') {
                    result.push({
                        role: "assistant",
                        content: msg.content,
                        providerOptions,
                    });
                } else {
                    result.push({
                        role: "assistant",
                        content: msg.content.map(part => {
                            switch (part.type) {
                                case 'text':
                                    return part;
                                case 'reasoning':
                                    return part;
                                case 'tool-call':
                                    return {
                                        type: 'tool-call',
                                        toolCallId: part.toolCallId,
                                        toolName: part.toolName,
                                        input: part.arguments,
                                        providerOptions: part.providerOptions,
                                    };
                            }
                        }),
                        providerOptions,
                    });
                }
                break;
            case "system":
                result.push({
                    role: "system",
                    content: msg.content,
                    providerOptions,
                });
                break;
            case "user": {
                const userMessageContextPrefix = msg.userMessageContext ? formatUserMessageContextForLlm(msg.userMessageContext) : '';
                if (typeof msg.content === 'string') {
                    // Legacy string — pass through unchanged
                    result.push({
                        role: "user",
                        content: `${userMessageContextPrefix}${msg.content}`,
                        providerOptions,
                    });
                } else {
                    // New content parts array — collapse to text for LLM
                    const textSegments: string[] = userMessageContextPrefix ? [userMessageContextPrefix] : [];
                    const attachmentLines: string[] = [];

                    for (const part of msg.content) {
                        if (part.type === "attachment") {
                            const sizeStr = part.size ? `, ${formatBytes(part.size)}` : '';
                            const lineStr = part.lineNumber ? ` (line ${part.lineNumber})` : '';
                            attachmentLines.push(`- ${part.filename} (${part.mimeType}${sizeStr}) at ${part.path}${lineStr}`);
                        } else {
                            textSegments.push(part.text);
                        }
                    }

                    if (attachmentLines.length > 0) {
                        if (userMessageContextPrefix) {
                            textSegments.push("User has attached the following files:", ...attachmentLines, "");
                        } else {
                            textSegments.unshift("User has attached the following files:", ...attachmentLines, "");
                        }
                    }

                    result.push({
                        role: "user",
                        content: textSegments.join("\n"),
                        providerOptions,
                    });
                }
                break;
            }
            case "tool":
                result.push({
                    role: "tool",
                    content: [
                        {
                            type: "tool-result",
                            toolCallId: msg.toolCallId,
                            toolName: msg.toolName,
                            output: {
                                type: "text",
                                value: msg.content,
                            },
                        },
                    ],
                    providerOptions,
                });
                break;
        }
    }
    // doing this because: https://github.com/OpenRouterTeam/ai-sdk-provider/issues/262
    return JSON.parse(JSON.stringify(result));
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
    const provider = createProvider(providerConfig);
    const model = provider.languageModel(modelId);
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
        let instructionsWithDateTime = `${agent.instructions}\n\n${USER_CONTEXT_SYSTEM_INSTRUCTIONS}`;
        // Inject Agent Notes context for copilot
        if (state.agentName === 'copilot' || state.agentName === 'rowboatx') {
            const agentNotesContext = loadAgentNotesContext();
            if (agentNotesContext) {
                instructionsWithDateTime += `\n\n${agentNotesContext}`;
            }
            const userWorkDir = loadUserWorkDir(runId);
            if (userWorkDir) {
                loopLogger.log('injecting user work directory', userWorkDir);
                instructionsWithDateTime += `\n\n# User Work Directory
The user has chosen the following directory as their current **work directory**:

\`${userWorkDir}\`

Treat this as the **default location** for file operations whenever the user refers to files generically:
- "list the files", "show me what's in here", "what's the latest report" — list or look in the work directory.
- "save this", "export it", "write that to a file" — write the output into the work directory unless the user names another location.
- "open the file I was just working on", "the doc from earlier" — assume the work directory first.

Use absolute paths rooted at this directory with the \`file-*\` tools. For example, list with \`file-list({ path: "${userWorkDir}" })\`, read text with \`file-readText\`, and write text with \`file-writeText\`. For PDFs, Office docs, images, scanned docs, and other non-text files, use \`parseFile\` or \`LLMParse\` with the absolute path; you do NOT need to copy the file into the workspace first.

**Exceptions — these ALWAYS take precedence over the work directory default:**
1. **Knowledge base questions.** If the user asks about anything in the knowledge graph (notes, people, organizations, projects, topics) or paths starting with \`knowledge/\`, use file tools against \`knowledge/\` as documented above. Do NOT redirect those into the work directory.
2. **Explicit paths.** If the user names a different directory or gives an absolute/relative path (e.g. "in ~/Downloads", "from /tmp/foo", "the Desktop"), honor that path exactly and ignore the work-directory default for that request.
3. **Workspace-specific operations.** Anything that obviously belongs in the Rowboat workspace (config files, MCP servers, agent schedules, etc.) stays in the workspace, not the work directory.

Do not announce the work directory unless it's relevant. Just use it.`;
            }
        }
        if (voiceInput) {
            loopLogger.log('voice input enabled, injecting voice input prompt');
            instructionsWithDateTime += `\n\n# Voice Input\nThe user's message was transcribed from speech. Be aware that:\n- There may be transcription errors. Silently correct obvious ones (e.g. homophones, misheard words). If an error is genuinely ambiguous, briefly mention your interpretation (e.g. "I'm assuming you meant X").\n- Spoken messages are often long-winded. The user may ramble, repeat themselves, or correct something they said earlier in the same message. Focus on their final intent, not every word verbatim.`;
        }
        if (voiceOutput === 'summary') {
            loopLogger.log('voice output enabled (summary mode), injecting voice output prompt');
            instructionsWithDateTime += `\n\n# Voice Output (MANDATORY — READ THIS FIRST)\nThe user has voice output enabled. THIS IS YOUR #1 PRIORITY: you MUST start your response with <voice></voice> tags. If your response does not begin with <voice> tags, the user will hear nothing — which is a broken experience. NEVER skip this.\n\nRules:\n1. YOUR VERY FIRST OUTPUT MUST BE A <voice> TAG. No exceptions. Do not start with markdown, headings, or any other text. The literal first characters of your response must be "<voice>".\n2. Place ALL <voice> tags at the BEGINNING of your response, before any detailed content. Do NOT intersperse <voice> tags throughout the response.\n3. Wrap EACH spoken sentence in its own separate <voice> tag so it can be spoken incrementally. Do NOT wrap everything in a single <voice> block.\n4. Use voice as a TL;DR and navigation aid — do NOT read the entire response aloud.\n5. After all <voice> tags, you may include detailed written content (markdown, tables, code, etc.) that will be shown visually but not spoken.\n\n## Examples\n\nExample 1 — User asks: "what happened in my meeting with Alex yesterday?"\n\n<voice>Your meeting with Alex covered three main things: the Q2 roadmap timeline, hiring for the backend role, and the client demo next week.</voice>\n<voice>I've pulled out the key details and action items below — the demo prep notes are at the end.</voice>\n\n## Meeting with Alex — March 11\n### Roadmap\n- Agreed to push Q2 launch to April 15...\n(detailed written content continues)\n\nExample 2 — User asks: "summarize my emails"\n\n<voice>You have five new emails since this morning.</voice>\n<voice>Two are from your team — Jordan sent the RFC you requested and Taylor flagged a contract issue.</voice>\n<voice>There's also a warm intro from a VC partner connecting you with someone at a prospective customer.</voice>\n<voice>I've drafted responses for three of them. The details and drafts are below.</voice>\n\n(email blocks, tables, and detailed content follow)\n\nExample 3 — User asks: "what's on my calendar today?"\n\n<voice>You've got a pretty packed day — seven meetings starting with standup at 9.</voice>\n<voice>The big ones are your investor call at 11, lunch with a partner from your lead VC at 12:30, and a customer call at 4.</voice>\n<voice>Your only free block for deep work is 2:30 to 4.</voice>\n\n(calendar block with full event details follows)\n\nExample 4 — User asks: "draft an email to Sam with our metrics"\n\n<voice>Done — I've drafted the email to Sam with your latest WAU and churn numbers.</voice>\n<voice>Take a look at the draft below and send it when you're ready.</voice>\n\n(email block with draft follows)\n\nREMEMBER: If you do not start with <voice> tags, the user hears silence. Always speak first, then write.`;
        } else if (voiceOutput === 'full') {
            loopLogger.log('voice output enabled (full mode), injecting voice output prompt');
            instructionsWithDateTime += `\n\n# Voice Output — Full Read-Aloud (MANDATORY — READ THIS FIRST)\nThe user wants your ENTIRE response spoken aloud. THIS IS YOUR #1 PRIORITY: every single sentence must be wrapped in <voice></voice> tags. If you write anything outside <voice> tags, the user will not hear it — which is a broken experience. NEVER skip this.\n\nRules:\n1. YOUR VERY FIRST OUTPUT MUST BE A <voice> TAG. No exceptions. The literal first characters of your response must be "<voice>".\n2. Wrap EACH sentence in its own separate <voice> tag so it can be spoken incrementally.\n3. Write your response in a natural, conversational style suitable for listening — no markdown headings, bullet points, or formatting symbols. Use plain spoken language.\n4. Structure the content as if you are speaking to the user directly. Use transitions like "first", "also", "one more thing" instead of visual formatting.\n5. EVERY sentence MUST be inside a <voice> tag. Do not leave ANY content outside <voice> tags. If it's not in a <voice> tag, the user cannot hear it.\n\n## Examples\n\nExample 1 — User asks: "what happened in my meeting with Alex yesterday?"\n\n<voice>Your meeting with Alex covered three main things.</voice>\n<voice>First, you discussed the Q2 roadmap timeline and agreed to push the launch to April.</voice>\n<voice>Second, you talked about hiring for the backend role — Alex will send over two candidates by Friday.</voice>\n<voice>And lastly, the client demo is next week on Thursday at 2pm, and you're handling the intro slides.</voice>\n\nExample 2 — User asks: "summarize my emails"\n\n<voice>You've got five new emails since this morning.</voice>\n<voice>Two are from your team — Jordan sent the RFC you asked for, and Taylor flagged a contract issue that needs your sign-off.</voice>\n<voice>There's a warm intro from a VC partner connecting you with an engineering lead at a potential customer.</voice>\n<voice>And someone from a prospective client wants to confirm your API tier before your call this afternoon.</voice>\n<voice>I've drafted replies for three of them — the metrics update, the intro, and the API question.</voice>\n<voice>The only one I left for you is Taylor's contract redline, since that needs your judgment on the liability cap.</voice>\n\nExample 3 — User asks: "what's on my calendar today?"\n\n<voice>You've got a packed day — seven meetings starting with standup at 9.</voice>\n<voice>The highlights are your investor call at 11, lunch with a VC partner at 12:30, and a customer call at 4.</voice>\n<voice>Your only open block for deep work is 2:30 to 4, so plan accordingly.</voice>\n<voice>Oh, and your 1-on-1 with your co-founder is at 5:30 — that's a walking meeting.</voice>\n\nExample 4 — User asks: "how are our metrics looking?"\n\n<voice>Metrics are looking strong this week.</voice>\n<voice>You hit 2,573 weekly active users, which is up 12% week over week.</voice>\n<voice>That means you've crossed the 2,500 milestone — worth calling out in your next investor update.</voice>\n<voice>Churn is down to 4.1%, improving month over month.</voice>\n<voice>The trailing 8-week compound growth rate is about 10%.</voice>\n\nREMEMBER: Start with <voice> immediately. No preamble, no markdown before it. Speak first.`;
        }
        if (searchEnabled) {
            loopLogger.log('search enabled, injecting search prompt');
            instructionsWithDateTime += `\n\n# Search\nThe user has requested a search. Use the web-search tool to answer their query.`;
        }
        if (codeMode) {
            loopLogger.log('code mode enabled, injecting coding-agent context', codeMode);
            const agentDisplay = codeMode === 'claude' ? 'Claude Code' : 'Codex';
            instructionsWithDateTime += `\n\n# Code Mode (Active) — Agent: ${agentDisplay}
The user has turned on **code mode** and the composer chip is set to **${agentDisplay}** (\`${codeMode}\`). For EVERY coding task this turn, use **${agentDisplay}**, and narrate that agent ("Using ${agentDisplay} to …").

The chip is the single source of truth for which agent runs:
- Do NOT carry over a different agent from earlier in this thread — even if a previous run used the other agent, use **${agentDisplay}** now.
- Do NOT switch agents based on an in-chat text request ("use codex", "switch to claude"). The agent only changes when the user toggles the chip; if they ask in chat, tell them to toggle the chip.

**How to run coding work — call the \`code_agent_run\` tool** with:
- \`agent\`: \`${codeMode}\` (always — match the chip).
- \`cwd\`: ${codeCwd ? `\`${codeCwd}\` (always — this coding session is pinned to that directory; never use another path)` : `the absolute project/working directory (resolve it per the code-with-agents skill — a path the user named, the "# User Work Directory" block, or ask once)`}.
- \`prompt\`: a clear, self-contained coding instruction.

The tool runs the agent on-device and streams its tool calls, file diffs, and plan into the chat; any action needing approval surfaces as an inline permission card, so you do NOT pre-confirm with an in-chat "reply yes". This chat keeps ONE persistent agent session, so follow-up coding requests automatically resume with full context — just call \`code_agent_run\` again. Do NOT shell out to \`acpx\` or \`executeCommand\` for coding, and do NOT fall back to your own file tools.

If the user's message is clearly NOT a coding request (small talk, an unrelated question), answer directly without invoking the coding agent. Code mode signals readiness, not that every message must route through the agent.`;
        }
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
export const MappedToolCall = z.object({
    toolCall: ToolCallPart,
    agentTool: ToolAttachment,
});
