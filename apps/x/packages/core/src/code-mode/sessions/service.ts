import path from 'path';
import fs from 'fs/promises';
import { WorkDir } from '../../config/config.js';
import type { CodeSession } from '@x/shared/dist/code-sessions.js';
import type { CodingAgent, ApprovalPolicy } from '@x/shared/dist/code-mode.js';
import type { ISessions } from '../../runtime/sessions/api.js';
import type { ISessionRepo } from '../../runtime/sessions/repo.js';
import type { CodeModeManager } from '../acp/manager.js';
import type { ICodeSessionsRepo } from './repo.js';
import type { ICodeProjectsRepo } from '../projects/repo.js';
import { clearStoredSession } from '../acp/session-store.js';
import * as gitService from '../git/service.js';
import { withFileLock } from '../../knowledge/file-lock.js';
import type { EmitterSessionBus } from '../../runtime/sessions/bus.js';

export interface CreateSessionArgs {
    projectId: string;
    title?: string;
    agent: CodingAgent;
    // Only pass a policy the USER explicitly chose (dialog, rail select).
    // Adoption/dispatch leave it unset — runs then resolve chip → global
    // settings → ask, so the stored field always means "the user chose".
    policy?: ApprovalPolicy;
    isolation: 'in-repo' | 'worktree';
    // The coding agent's own model + reasoning effort (ACP engine); unset leaves
    // the engine default. Re-applied to the ACP session on every turn.
    agentModel?: string;
    agentEffort?: string;
    // In-repo only: pin a working directory inside the project (an adopted
    // run may target a subdirectory). Worktree isolation always works in the
    // worktree root.
    cwd?: string;
}

function worktreeRoot(projectId: string, sessionId: string): string {
    return path.join(WorkDir, 'code-mode', 'worktrees', projectId, sessionId);
}

// The per-chat work directory the copilot anchors its general context to
// (same file the chat composer writes for regular chats, keyed by the
// composition workDirId — the session id). Keeping it in sync with the
// session cwd means turns see the right "# User Work Directory" even for
// tools other than code_agent_run.
async function persistRunWorkDir(sessionId: string, cwd: string): Promise<void> {
    try {
        const file = path.join(WorkDir, 'config', `workdir-${sessionId}.json`);
        await fs.writeFile(file, JSON.stringify({ path: cwd }, null, 2));
    } catch {
        // best effort — the session meta still pins cwd for code_agent_run
    }
}

// Manages Code-section sessions. A code session IS a chat session on the
// turns runtime (same id): the conversation is an ordinary copilot chat, and
// code_agent_run resolves this service's per-session meta (cwd, agent,
// policy, engine model) by the turn's session id. This service owns only the
// meta + workspace lifecycle (worktrees, merge-back, deletion) — messaging,
// stop, and permission flow are the chat runtime's, with no special casing.
export class CodeSessionService {
    private readonly sessions: ISessions;
    private readonly sessionRepo: ISessionRepo;
    private readonly codeModeManager: CodeModeManager;
    private readonly codeSessionsRepo: ICodeSessionsRepo;
    private readonly codeProjectsRepo: ICodeProjectsRepo;
    private readonly sessionBus: EmitterSessionBus;

    constructor({
        sessions,
        sessionRepo,
        codeModeManager,
        codeSessionsRepo,
        codeProjectsRepo,
        sessionBus,
    }: {
        sessions: ISessions;
        sessionRepo: ISessionRepo;
        codeModeManager: CodeModeManager;
        codeSessionsRepo: ICodeSessionsRepo;
        codeProjectsRepo: ICodeProjectsRepo;
        sessionBus: EmitterSessionBus;
    }) {
        this.sessions = sessions;
        this.sessionRepo = sessionRepo;
        this.codeModeManager = codeModeManager;
        this.codeSessionsRepo = codeSessionsRepo;
        this.codeProjectsRepo = codeProjectsRepo;
        this.sessionBus = sessionBus;
        this.sessionBus.subscribe((event) => {
            if (event.kind !== 'index-changed' || !event.entry?.title) return;
            void this.adoptChatTitle(event.sessionId, event.entry.title);
        });
    }

    // Sessions created before code mode moved onto the turns runtime have meta
    // files but no chat-session file, so the chat pane could not open them.
    // The runs->turns migration converts their old JSONL history into real
    // sessions; this backfill is the fallback for metas whose legacy run is
    // gone (deleted, quarantined). Runs before the session index's startup
    // scan so backfilled sessions get indexed — and exactly ONCE per install
    // (marker file), so boots converge instead of rescanning forever.
    async backfillChatSessions(): Promise<void> {
        const marker = path.join(WorkDir, 'code-mode', '.chat-sessions-backfilled');
        try {
            await fs.access(marker);
            return; // already ran
        } catch {
            // first run — proceed
        }
        const metas = await this.codeSessionsRepo.list().catch(() => [] as CodeSession[]);
        for (const meta of metas) {
            try {
                await this.sessionRepo.create({
                    type: 'session_created',
                    schemaVersion: 1,
                    sessionId: meta.id,
                    ts: meta.createdAt,
                    title: meta.title,
                });
            } catch {
                // Already exists (migrated with history, or a prior backfill),
                // or an id shape the session store can't hold — nothing to do.
            }
        }
        await fs.mkdir(path.dirname(marker), { recursive: true }).catch(() => {});
        await fs.writeFile(marker, new Date().toISOString()).catch(() => {});
    }

    async create(args: CreateSessionArgs): Promise<CodeSession> {
        const project = await this.codeProjectsRepo.get(args.projectId);
        if (!project) throw new Error(`Unknown project: ${args.projectId}`);

        // The session is a real chat session, created first so its id becomes
        // the code session id. Everything chat (messaging, stop, permission
        // cards, history) works on it with no code-mode special casing.
        //
        // No name given → the chat is created UNTITLED so the runtime titles
        // it from the first message (a placeholder, then a generated title);
        // the index-changed subscription in the constructor carries that into
        // the meta. Until then the meta wears a project-name placeholder so
        // the rail has something to show.
        const explicit = args.title?.trim();
        const sessionId = await this.sessions.createSession(explicit ? { title: explicit } : undefined);
        return this.createForSession(sessionId, { ...args, title: explicit || `${project.name} session` });
    }

    // Code sessions show the CHAT's title (rail, chat header). The runtime
    // titles untitled chats from their first message and renames flow through
    // the index; mirror those into the meta so every list of code sessions
    // stays in step. A rename made here (update → sessions.setTitle) comes
    // back as an equal title and is a no-op.
    private async adoptChatTitle(sessionId: string, title: string): Promise<void> {
        try {
            const meta = await this.codeSessionsRepo.get(sessionId);
            if (!meta || meta.title === title) return;
            await this.codeSessionsRepo.save({ ...meta, title });
        } catch {
            // Observational — a missed title never affects the session.
        }
    }

    /**
     * Adopt an EXISTING chat session as a code session: write the meta (and
     * optional worktree) keyed by its id. This is how Home's code dispatch
     * and the code_agent_run adoption hook materialize code sessions — the
     * session already exists (a to-do item's thread, a plain chat), and after
     * this the server-side pinning in code_agent_run resolves it like any
     * Code-section session. Adopt-once: existing meta is returned untouched.
     */
    async createForSession(sessionId: string, args: CreateSessionArgs): Promise<CodeSession> {
        // The Command Center session is the dispatcher — it assigns coding
        // work to OTHER threads and must never itself become a code session.
        // Guarded here (not just in the adoption hook) so no path can ever
        // pin the operator channel to a repo/worktree.
        const { getCommandCenterSessionId } = await import('../../home/command-center.js');
        const commandCenterId = await getCommandCenterSessionId().catch(() => null);
        if (commandCenterId && commandCenterId === sessionId) {
            throw new Error('The Command Center session is the dispatcher — it cannot become a code session.');
        }
        const project = await this.codeProjectsRepo.get(args.projectId);
        if (!project) throw new Error(`Unknown project: ${args.projectId}`);

        // Adopt-once must be ATOMIC: the runtime allows parallel tool calls
        // in one model response, so two code_agent_run calls can race here.
        // Without the lock both pass the existence check, both cut
        // worktrees, and the second save clobbers the first — one engine
        // then works in a worktree the system has no record of. The whole
        // read → (worktree) → save sequence runs under a per-session lock;
        // the loser re-reads the winner's meta and returns it.
        return withFileLock(`code-session-adopt:${sessionId}`, async () => {
            const existing = await this.codeSessionsRepo.get(sessionId);
            if (existing) return existing;

            // Meta title: the caller's, else the chat's own (a to-do session
            // is titled by its item text — keep that identity in the rail).
            let title = args.title?.trim();
            if (!title) {
                title = await this.sessions.getSession(sessionId).then((s) => s.title?.trim()).catch(() => undefined);
            }
            title = title || `${project.name} session`;

            let cwd = args.cwd ?? project.path;
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
                // Never freeze a transient posture: policy is stored only
                // when the caller carries an explicit user choice.
                ...(args.policy ? { policy: args.policy } : {}),
                cwd,
                ...(worktree ? { worktree } : {}),
                ...(args.agentModel ? { agentModel: args.agentModel } : {}),
                ...(args.agentEffort ? { agentEffort: args.agentEffort } : {}),
                createdAt: new Date().toISOString(),
            };
            await this.codeSessionsRepo.save(session);
            await persistRunWorkDir(sessionId, cwd);
            // One identity-change event; every "what kind of session is
            // this" cache (status tracker, Home registry, future ones)
            // corrects itself from the bus instead of per-cache hand-pokes.
            this.sessionBus.publish({ kind: 'code-adopted', sessionId });
            return session;
        });
    }

    /**
     * The repo coding work defaults into when no path is named: the
     * configured default project, or — when exactly one project is
     * registered — that project implicitly (the common single-repo case
     * needs no setup at all). Null when there are zero or several projects
     * and no explicit choice.
     */
    async resolveDefaultProject(): Promise<{ id: string; path: string; name: string } | null> {
        const projects = await this.codeProjectsRepo.list().catch(() => []);
        if (projects.length === 0) return null;
        try {
            const { lazyResolve } = await import('../../di/lazy-resolve.js');
            const configRepo = await lazyResolve<{ getConfig(): Promise<{ defaultProjectId?: string }> }>('codeModeConfigRepo');
            const configured = (await configRepo.getConfig()).defaultProjectId;
            if (configured) {
                const match = projects.find((p) => p.id === configured);
                if (match) return match;
                // A stale id (project was removed) falls through to the
                // single-project rule rather than dead-ending.
            }
        } catch {
            // Config unavailable — the single-project rule still applies.
        }
        return projects.length === 1 ? projects[0] : null;
    }

    /**
     * Clear code-mode residue whose chat session no longer exists: meta,
     * stored ACP conversation, and workdir sidecar. Sessions can be deleted
     * by paths that (correctly) know nothing of code-mode — the retention
     * sweep, pre-fix delete flows — and each leaves a ghost row in the Code
     * rail and a stale sidecar behind. Called from the app layer on the
     * retention cadence, AFTER the session sweep. Worktree checkouts are
     * deliberately left on disk: an unmerged worktree may hold the only
     * copy of the work; removal stays an explicit user decision.
     */
    async sweepOrphanedMeta(): Promise<number> {
        const live = new Set(this.sessions.listSessions().map((entry) => entry.sessionId));
        const metas = await this.codeSessionsRepo.list().catch(() => [] as CodeSession[]);
        let cleared = 0;
        for (const meta of metas) {
            if (live.has(meta.id)) continue;
            try {
                this.codeModeManager.dispose(meta.id);
                await clearStoredSession(meta.id);
                await this.codeSessionsRepo.remove(meta.id);
                await fs.rm(path.join(WorkDir, 'config', `workdir-${meta.id}.json`), { force: true }).catch(() => {});
                cleared += 1;
            } catch (error) {
                console.error(`[CodeSessions] failed to clear orphaned meta for ${meta.id}:`, error);
            }
        }
        return cleared;
    }

    /** The registered project containing an absolute path, if any — longest
     * path wins so nested registrations resolve to the closest project. */
    async findProjectForPath(absPath: string): Promise<{ id: string; path: string; name: string } | null> {
        const projects = await this.codeProjectsRepo.list().catch(() => []);
        let best: { id: string; path: string; name: string } | null = null;
        for (const project of projects) {
            const root = path.resolve(project.path);
            if (absPath === root || absPath.startsWith(root + path.sep)) {
                if (!best || root.length > path.resolve(best.path).length) best = project;
            }
        }
        return best;
    }

    async update(sessionId: string, patch: Partial<Pick<CodeSession, 'title' | 'policy' | 'agent' | 'agentModel' | 'agentEffort'>>): Promise<CodeSession> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (!session) throw new Error(`Unknown session: ${sessionId}`);
        const updated: CodeSession = { ...session, ...patch };
        // Model and effort are ids of ONE engine's catalog — a Codex model on
        // a Claude Code session is nonsense. Switching agents drops them back
        // to the engine default unless the same patch chooses new ones.
        if (patch.agent && patch.agent !== session.agent) {
            if (patch.agentModel === undefined) delete updated.agentModel;
            if (patch.agentEffort === undefined) delete updated.agentEffort;
        }
        await this.codeSessionsRepo.save(updated);
        if (patch.title && patch.title !== session.title) {
            // Keep the chat session's title (history list, notifications) in sync.
            await this.sessions.setTitle(sessionId, patch.title).catch(() => {});
        }
        return updated;
    }

    // Done is the user's own verdict on a session (or the natural end of a
    // merge-back). It touches nothing on disk: worktree, branch and chat all
    // stay, so reopening is just clearing the flag. Activity clears it too
    // (status tracker) so a done session that gets a message comes back.
    async setDone(sessionId: string, done: boolean): Promise<CodeSession> {
        const session = await this.codeSessionsRepo.get(sessionId);
        if (!session) throw new Error(`Unknown session: ${sessionId}`);
        const { doneAt: _previous, ...rest } = session;
        const updated: CodeSession = done ? { ...rest, doneAt: new Date().toISOString() } : rest;
        await this.codeSessionsRepo.save(updated);
        return updated;
    }

    // Stop whatever turn is live on the session's chat. The turn's abort
    // signal unwinds code_agent_run (ACP cancel → grace → force-kill) and
    // cancels any pending approval card.
    async stop(sessionId: string): Promise<void> {
        try {
            const state = await this.sessions.getSession(sessionId);
            if (state.latestTurnId) {
                await this.sessions.stopTurn(state.latestTurnId, 'user-requested');
            }
        } catch {
            // No chat session / no turns — nothing to stop.
        }
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
            // Merging back is the natural end of a session: file it under
            // Done as well. Reopen is one click if the user wasn't finished.
            const now = new Date().toISOString();
            await this.codeSessionsRepo.save({
                ...session,
                worktree: { ...session.worktree, mergedAt: now },
                doneAt: session.doneAt ?? now,
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
        // The chat session + its turn files; pre-runtime-move sessions may
        // have none, and their legacy run JSONL is left for retention.
        await this.sessions.deleteSession(sessionId).catch(() => {});
        await fs.rm(path.join(WorkDir, 'config', `workdir-${sessionId}.json`), { force: true }).catch(() => {});
    }
}
