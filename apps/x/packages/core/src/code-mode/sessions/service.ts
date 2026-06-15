import crypto from 'node:crypto';
import path from 'path';
import fs from 'fs/promises';
import z from 'zod';
import { WorkDir } from '../../config/config.js';
import type { CodeSession, CodeSessionMode } from '@x/shared/dist/code-sessions.js';
import type { CodingAgent, ApprovalPolicy } from '@x/shared/dist/code-mode.js';
import { RunEvent, MessageEvent } from '@x/shared/dist/runs.js';
import type { CodeEventStore } from './event-store.js';
import type { IRunsLock } from '../../runs/lock.js';
import type { IBus } from '../../application/lib/bus.js';
import type { IMonotonicallyIncreasingIdGenerator } from '../../application/lib/id-gen.js';
import type { IAbortRegistry } from '../../runs/abort-registry.js';
import type { CodeModeManager } from '../acp/manager.js';
import type { CodePermissionRegistry } from '../acp/permission-registry.js';
import type { ICodeSessionsRepo } from './repo.js';
import type { ICodeProjectsRepo } from '../projects/repo.js';
import { clearStoredSession } from '../acp/session-store.js';
import * as gitService from '../git/service.js';

export interface CreateSessionArgs {
    projectId: string;
    title?: string;
    agent: CodingAgent;
    mode: CodeSessionMode;
    policy: ApprovalPolicy;
    isolation: 'in-repo' | 'worktree';
    // LLM for Rowboat-mode turns; unset falls through to the configured default.
    model?: string;
    provider?: string;
}

export interface SendMessageResult {
    accepted: boolean;
    error?: string;
}

function worktreeRoot(projectId: string, sessionId: string): string {
    return path.join(WorkDir, 'code-mode', 'worktrees', projectId, sessionId);
}

// The per-run work directory the copilot anchors its general context to
// (same file the chat composer writes for regular chats). Keeping it in sync
// with the session cwd means Rowboat-mode turns see the right "# User Work
// Directory" even for tools other than code_agent_run.
async function persistRunWorkDir(runId: string, cwd: string): Promise<void> {
    try {
        const file = path.join(WorkDir, 'config', `workdir-${runId}.json`);
        await fs.writeFile(file, JSON.stringify({ path: cwd }, null, 2));
    } catch {
        // best effort — the session meta still pins cwd for code_agent_run
    }
}

// Drives Code-section sessions. A session is a run (same id) whose JSONL holds
// both modes' history: Rowboat turns are written by the agent runtime; direct
// turns are written here. The direct path talks straight to the ACP engine —
// no copilot LLM in between — but mirrors the runtime's lifecycle contract
// (runs lock, abort registry, processing-start/end, run-stopped) so the rest
// of the app (stop IPC, status tracking, event forwarding) needs no special
// casing.
export class CodeSessionService {
    private readonly codeEventStore: CodeEventStore;
    private readonly runsLock: IRunsLock;
    private readonly codeEventBus: IBus;
    private readonly idGenerator: IMonotonicallyIncreasingIdGenerator;
    private readonly abortRegistry: IAbortRegistry;
    private readonly codeModeManager: CodeModeManager;
    private readonly codePermissionRegistry: CodePermissionRegistry;
    private readonly codeSessionsRepo: ICodeSessionsRepo;
    private readonly codeProjectsRepo: ICodeProjectsRepo;
    // Session ids with a direct prompt currently streaming (the runs lock also
    // guards this, but we keep our own set to give a precise "busy" error).
    private readonly inflight = new Set<string>();

    constructor({
        codeEventStore,
        runsLock,
        codeEventBus,
        idGenerator,
        abortRegistry,
        codeModeManager,
        codePermissionRegistry,
        codeSessionsRepo,
        codeProjectsRepo,
    }: {
        codeEventStore: CodeEventStore;
        runsLock: IRunsLock;
        codeEventBus: IBus;
        idGenerator: IMonotonicallyIncreasingIdGenerator;
        abortRegistry: IAbortRegistry;
        codeModeManager: CodeModeManager;
        codePermissionRegistry: CodePermissionRegistry;
        codeSessionsRepo: ICodeSessionsRepo;
        codeProjectsRepo: ICodeProjectsRepo;
    }) {
        this.codeEventStore = codeEventStore;
        this.runsLock = runsLock;
        this.codeEventBus = codeEventBus;
        this.idGenerator = idGenerator;
        this.abortRegistry = abortRegistry;
        this.codeModeManager = codeModeManager;
        this.codePermissionRegistry = codePermissionRegistry;
        this.codeSessionsRepo = codeSessionsRepo;
        this.codeProjectsRepo = codeProjectsRepo;
    }

    async create(args: CreateSessionArgs): Promise<CodeSession> {
        const project = await this.codeProjectsRepo.get(args.projectId);
        if (!project) throw new Error(`Unknown project: ${args.projectId}`);

        const title = args.title?.trim() || `${project.name} session`;

        // Direct mode owns its id outright (code-mode's own event store/bus).
        // Rowboat mode is driven by the copilot on the new sessions runtime, so
        // the session must exist there — create it and adopt its id, so the
        // renderer can sessions:sendMessage against this same id.
        let sessionId: string;
        if (args.mode === 'rowboat') {
            const { getAgentRuntime } = await import('../../agent-runtime/index.js');
            const { sessions } = await getAgentRuntime();
            const created = await sessions.createSession({ agentId: 'copilot', title });
            sessionId = created.id;
        } else {
            sessionId = crypto.randomUUID();
        }

        let cwd = project.path;
        let worktree: CodeSession['worktree'];
        if (args.isolation === 'worktree') {
            const info = await gitService.repoInfo(project.path);
            if (!info.isGitRepo || !info.hasCommits) {
                throw new Error('Worktree isolation needs a git repository with at least one commit.');
            }
            const branch = `rowboat/${sessionId}`;
            const wtPath = worktreeRoot(project.id, sessionId);
            await gitService.worktreeAdd(project.path, wtPath, branch);
            worktree = { path: wtPath, branch, baseBranch: info.branch };
            cwd = wtPath;
        }

        const session: CodeSession = {
            id: sessionId,
            projectId: project.id,
            title,
            agent: args.agent,
            mode: args.mode,
            policy: args.policy,
            cwd,
            ...(worktree ? { worktree } : {}),
            createdAt: new Date().toISOString(),
        };
        await this.codeSessionsRepo.save(session);
        await persistRunWorkDir(sessionId, cwd);
        return session;
    }

    async update(sessionId: string, patch: Partial<Pick<CodeSession, 'title' | 'mode' | 'policy' | 'agent'>>): Promise<CodeSession> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (!session) throw new Error(`Unknown session: ${sessionId}`);
        const updated: CodeSession = { ...session, ...patch };
        await this.codeSessionsRepo.save(updated);
        return updated;
    }

    isBusy(sessionId: string): boolean {
        return this.inflight.has(sessionId);
    }

    // Direct drive: send the user's text straight to the session's ACP agent.
    // Returns once the turn fully settles (the renderer streams via runs:events).
    async sendMessage(sessionId: string, text: string): Promise<SendMessageResult> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (!session) return { accepted: false, error: `Unknown session: ${sessionId}` };
        if (this.inflight.has(sessionId)) {
            return { accepted: false, error: 'The agent is still working on the previous message.' };
        }
        // The runs lock is shared with the agent runtime, so a Rowboat-mode turn
        // in flight blocks direct sends (and vice versa) — the run JSONL never
        // interleaves two writers.
        if (!await this.runsLock.lock(sessionId)) {
            return { accepted: false, error: 'The session is busy with a Rowboat-driven turn.' };
        }
        this.inflight.add(sessionId);
        const signal = this.abortRegistry.createForRun(sessionId);
        const turnId = await this.idGenerator.next();
        const toolCallId = `direct-${turnId}`;

        const appendAndPublish = async (event: z.infer<typeof RunEvent>) => {
            await this.codeEventStore.append(sessionId, [event]);
            await this.codeEventBus.publish(event);
        };

        try {
            await this.codeEventBus.publish({ runId: sessionId, type: 'run-processing-start', subflow: [] });

            const userEvent: z.infer<typeof MessageEvent> = {
                runId: sessionId,
                type: 'message',
                messageId: await this.idGenerator.next(),
                message: { role: 'user', content: text },
                subflow: [],
                ts: new Date().toISOString(),
            };
            await appendAndPublish(userEvent);
            await this.touch(session);

            // Stream events live; persist the structural ones (tool calls, plan,
            // resolved permissions). Streaming `message` chunks are NOT persisted —
            // the agent's full text lands as one assistant MessageEvent below, which
            // is also what lets a later Rowboat-mode turn see this conversation.
            let finalText = '';
            const persistQueue: Array<z.infer<typeof RunEvent>> = [];
            const onAbort = () => this.codePermissionRegistry.cancelRun(sessionId);
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });

            let stopReason = 'cancelled';
            try {
                const result = await this.codeModeManager.runPrompt({
                    runId: sessionId,
                    agent: session.agent,
                    cwd: session.cwd,
                    prompt: text,
                    policy: session.policy,
                    signal,
                    suppressReplay: true,
                    onEvent: (event) => {
                        if (event.type === 'message' && event.role === 'agent') finalText += event.text;
                        const streamEvent: z.infer<typeof RunEvent> = {
                            runId: sessionId,
                            type: 'code-run-event',
                            toolCallId,
                            event,
                            subflow: [],
                        };
                        void this.codeEventBus.publish(streamEvent);
                        if (event.type === 'tool_call' || event.type === 'tool_call_update'
                            || event.type === 'plan' || event.type === 'permission') {
                            persistQueue.push({ ...streamEvent, ts: new Date().toISOString() });
                        }
                    },
                    ask: (permAsk) => this.codePermissionRegistry.request(sessionId, (requestId) => {
                        void this.codeEventBus.publish({
                            runId: sessionId,
                            type: 'code-run-permission-request',
                            toolCallId,
                            requestId,
                            ask: permAsk,
                            subflow: [],
                        });
                    }),
                });
                stopReason = result.stopReason;
            } catch (error) {
                if (!signal.aborted) {
                    const message = error instanceof Error ? (error.message || error.name) : String(error);
                    await appendAndPublish({ runId: sessionId, type: 'error', error: message, subflow: [] });
                }
            } finally {
                signal.removeEventListener('abort', onAbort);
            }

            if (persistQueue.length > 0) {
                await this.codeEventStore.append(sessionId, persistQueue);
            }
            if (finalText.trim()) {
                await appendAndPublish({
                    runId: sessionId,
                    type: 'message',
                    messageId: await this.idGenerator.next(),
                    message: { role: 'assistant', content: finalText },
                    subflow: [],
                    ts: new Date().toISOString(),
                });
            }
            if (signal.aborted || stopReason === 'cancelled') {
                await appendAndPublish({
                    runId: sessionId,
                    type: 'run-stopped',
                    reason: 'user-requested',
                    subflow: [],
                });
            }
            await this.touch(session);
            return { accepted: true };
        } finally {
            this.inflight.delete(sessionId);
            this.abortRegistry.cleanup(sessionId);
            await this.runsLock.release(sessionId);
            await this.codeEventBus.publish({ runId: sessionId, type: 'run-processing-end', subflow: [] });
        }
    }

    // Unblocks a stuck permission card immediately; the manager's signal handling
    // (ACP cancel -> grace -> force-kill) actually unwinds the prompt.
    async stop(sessionId: string): Promise<void> {
        this.abortRegistry.abort(sessionId);
        this.codePermissionRegistry.cancelRun(sessionId);
    }

    async mergeBack(sessionId: string): Promise<gitService.MergeBackResult> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (!session?.worktree) {
            return { ok: false, message: 'This session has no isolated worktree to merge.' };
        }
        const project = await this.codeProjectsRepo.get(session.projectId);
        if (!project) {
            return { ok: false, message: 'The session\'s project is no longer registered.' };
        }
        const result = await gitService.mergeBack(project.path, session.worktree.branch);
        if (result.ok) {
            await this.codeSessionsRepo.save({
                ...session,
                worktree: { ...session.worktree, mergedAt: new Date().toISOString() },
            });
        }
        return result;
    }

    async cleanupWorktree(sessionId: string, deleteBranch: boolean): Promise<void> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (!session?.worktree || session.worktree.removedAt) return;
        const project = await this.codeProjectsRepo.get(session.projectId);
        // Drop any live agent connection on the worktree before deleting it.
        this.codeModeManager.dispose(sessionId);
        if (project) {
            await gitService.worktreeRemove(project.path, session.worktree.path, {
                force: true,
                ...(deleteBranch ? { deleteBranch: session.worktree.branch } : {}),
            });
        }
        const nextCwd = project?.path ?? session.cwd;
        await this.codeSessionsRepo.save({
            ...session,
            // The worktree is gone — fall back to working directly in the repo.
            cwd: nextCwd,
            worktree: { ...session.worktree, removedAt: new Date().toISOString() },
        });
        await persistRunWorkDir(sessionId, nextCwd);
    }

    async delete(sessionId: string, opts: { removeWorktree?: boolean; deleteBranch?: boolean } = {}): Promise<void> {
        await this.stop(sessionId);
        this.codeModeManager.dispose(sessionId);
        const session = await this.codeSessionsRepo.get(sessionId);
        if (opts.removeWorktree && session?.worktree && !session.worktree.removedAt) {
            const project = await this.codeProjectsRepo.get(session.projectId);
            if (project) {
                await gitService.worktreeRemove(project.path, session.worktree.path, {
                    force: true,
                    ...(opts.deleteBranch ? { deleteBranch: session.worktree.branch } : {}),
                });
            }
        }
        await clearStoredSession(sessionId);
        await this.codeSessionsRepo.remove(sessionId);
        await this.codeEventStore.delete(sessionId).catch(() => {});
        // Rowboat sessions also have a sessions-runtime row + turns — drop them.
        if (session?.mode === 'rowboat') {
            const { getAgentRuntime } = await import('../../agent-runtime/index.js');
            await getAgentRuntime()
                .then(({ sessions }) => sessions.deleteSession(sessionId))
                .catch(() => {});
        }
        await fs.rm(path.join(WorkDir, 'config', `workdir-${sessionId}.json`), { force: true }).catch(() => {});
    }

    private async touch(session: CodeSession): Promise<void> {
        const current = await this.codeSessionsRepo.get(session.id);
        if (!current) return;
        await this.codeSessionsRepo.save({ ...current, lastActivityAt: new Date().toISOString() });
    }
}
