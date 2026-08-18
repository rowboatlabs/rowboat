// Builtin tools: code domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import container from "../../../di/container.js";
import type { CodeModeManager } from "../../../code-mode/acp/manager.js";
import type { CodePermissionRegistry } from "../../../code-mode/acp/permission-registry.js";
import type { ICodeSessionsRepo } from "../../../code-mode/sessions/repo.js";
import type { CodeSessionService } from "../../../code-mode/sessions/service.js";
import { readStoredSession } from "../../../code-mode/acp/session-store.js";
import * as codeGitService from "../../../code-mode/git/service.js";
import { ICodeModeConfigRepo } from "../../../code-mode/repo.js";
import type { ApprovalPolicy, CodeRunEvent as CodeRunEventType } from "@x/shared/dist/code-mode.js";
import type { CodeRunFeed } from "../../../code-mode/feed.js";
import type { ToolContext } from "../exec-tool.js";
import { expandHomePath } from "../../../filesystem/files.js";
import { BuiltinToolsSchema } from "../types.js";



// Shrink a code-run timeline for durable storage: consecutive same-role message
// chunks merge into one event. Display-lossless — the timeline renderer
// concatenates consecutive messages anyway (CodingRunTimeline) — and typically
// collapses the ~90% of a run's events that are per-token text deltas.
// Everything else (tool calls/updates, plans, permissions) is kept verbatim in
// order: updates are id-keyed transitions and must not be merged.
export function coalesceCodeRunEvents(events: CodeRunEventType[]): CodeRunEventType[] {
    const out: CodeRunEventType[] = [];
    for (const event of events) {
        const last = out[out.length - 1];
        if (
            event.type === 'message' && last?.type === 'message' && last.role === event.role
        ) {
            out[out.length - 1] = { ...last, text: last.text + event.text };
        } else {
            out.push(event);
        }
    }
    return out;
}



export const codeAgentRunTools: z.infer<typeof BuiltinToolsSchema> = {
    code_agent_run: {
        permission: "none",
        description: 'Run a coding/software task with the selected on-device coding agent (Claude Code or Codex) inside a project folder. Streams the agent\'s tool calls, file diffs, and plan into the chat and surfaces permission requests inline. Use this for ALL code-mode work (writing/editing/reading code, running tests, debugging, exploring a repo). Reuses one persistent session per chat, so follow-up requests keep context.',
        inputSchema: z.object({
            agent: z.enum(['claude', 'codex']).describe('Which coding agent to use: "claude" (Claude Code) or "codex". Set this to the active code-mode chip agent. Note: when the chip is set, the backend uses the chip agent regardless of this value — this only takes effect in the ask-human flow where no chip is set.'),
            cwd: z.string().optional().describe('Absolute path to the working directory / project folder the agent should operate in. OMIT this when the user has not named a path — the run then uses their default code repo (the single registered project, or the one picked in Settings → Code). Only pass a path the user actually named or that prior context established.'),
            prompt: z.string().describe('The full, self-contained coding instruction for the agent (file names, expected behavior, constraints).'),
        }),
        execute: async ({ agent, cwd, prompt }: { agent: 'claude' | 'codex', cwd?: string, prompt: string }, ctx?: ToolContext) => {
            if (!ctx) {
                throw new Error('code_agent_run requires run context (runId / streaming).');
            }
            // Code-section sessions pin agent/cwd/policy/model server-side: the
            // turn's chat session id IS the code session id, so resolve the meta
            // directly. This is authoritative — the model's arguments and the
            // composer chip are fallbacks for ad-hoc coding from a regular chat.
            let pinned = null;
            if (ctx.sessionId) {
                const sessionsRepo = container.resolve<ICodeSessionsRepo>('codeSessionsRepo');
                pinned = await sessionsRepo.get(ctx.sessionId).catch(() => null);
            }
            // Fallback approval policy (used for un-pinned runs and adoption):
            // the composer chip's, else global settings, else ask the user.
            let fallbackPolicy: ApprovalPolicy = 'ask';
            if (ctx.codePolicy) {
                fallbackPolicy = ctx.codePolicy;
            } else {
                try {
                    const cfg = await container.resolve<ICodeModeConfigRepo>('codeModeConfigRepo').getConfig();
                    if (cfg.approvalPolicy) fallbackPolicy = cfg.approvalPolicy;
                } catch {
                    // fall back to 'ask'
                }
            }
            // The working directory the run would target when un-pinned: the
            // chip/model argument, else the user's DEFAULT code repo — the
            // single registered project, or the one picked in Settings →
            // Code. This is what makes "just talk to it" dispatch work: no
            // path named anywhere still lands in the right repo. The service
            // resolves lazily inside each branch — explicit-cwd runs never
            // need it (and minimal test containers don't register it).
            const resolveService = (): CodeSessionService | null => {
                try {
                    return container.resolve<CodeSessionService>('codeSessionService');
                } catch {
                    return null;
                }
            };
            const namedCwd = ctx.codeCwd ?? cwd;
            let candidate: string | null = namedCwd ? path.resolve(expandHomePath(namedCwd)) : null;
            let defaultProject: { id: string; path: string; name: string } | null = null;
            if (!pinned && !candidate) {
                defaultProject = (await resolveService()?.resolveDefaultProject().catch(() => null)) ?? null;
                if (defaultProject) candidate = path.resolve(defaultProject.path);
            }
            // The adoption rule: any session that runs a coding engine IS a
            // code session. A session with no meta whose target resolves
            // inside a registered project gets meta written on the spot —
            // the run shows up in the Code section, status-tracked and
            // resumable. Isolation: the FIRST coding turn of a chat gets a
            // worktree (adoption completes before the engine spawns, so
            // nothing has touched disk yet); a chat that already ran the
            // engine keeps its established cwd — switching mid-conversation
            // would silently drop the coding agent's ACP context. Scratch
            // runs outside registered projects stay plain chats.
            let adoptedThisCall = false;
            const adoptionService = !pinned && ctx.sessionId && candidate ? resolveService() : null;
            // The Command Center session is the DISPATCHER — it assigns
            // coding work to other threads and must never itself become a
            // code session (that would pin the operator channel to one
            // repo/worktree). Its doctrine forbids code_agent_run there;
            // this guard makes a slip harmless rather than structural.
            let adoptable = !!adoptionService;
            if (adoptable) {
                const { getCommandCenterSessionId } = await import("../../../home/command-center.js");
                const commandCenterId = await getCommandCenterSessionId().catch(() => null);
                if (commandCenterId && commandCenterId === ctx.sessionId) adoptable = false;
            }
            if (adoptable && adoptionService && ctx.sessionId && candidate) {
                const project = defaultProject ?? await adoptionService.findProjectForPath(candidate).catch(() => null);
                if (project) {
                    const alreadyCoded = await readStoredSession(ctx.sessionId).catch(() => null);
                    let isolation: 'in-repo' | 'worktree' = 'in-repo';
                    if (!alreadyCoded) {
                        const info = await codeGitService.repoInfo(project.path).catch(() => null);
                        if (info?.isGitRepo && info.hasCommits) isolation = 'worktree';
                    }
                    try {
                        pinned = await adoptionService.createForSession(ctx.sessionId, {
                            projectId: project.id,
                            agent: ctx.codeMode ?? agent,
                            // NO policy: adoption must not freeze this turn's
                            // transient posture into permanent meta — every
                            // run keeps resolving chip → settings → ask
                            // until the user explicitly chooses in the rail.
                            isolation,
                            // Worktree runs work at the worktree root; in-repo
                            // runs keep the targeted path (may be a subdir).
                            ...(isolation === 'in-repo' ? { cwd: candidate } : {}),
                        });
                        adoptedThisCall = true;
                    } catch (err) {
                        if (isolation === 'worktree') {
                            // A failed worktree must NOT silently degrade into
                            // writing the user's checkout — surface it.
                            throw new Error(`code_agent_run: could not create an isolated worktree in ${project.name}: ${err instanceof Error ? err.message : String(err)}`);
                        }
                        // In-repo adoption is bookkeeping — the run proceeds
                        // untracked rather than failing coding work over it.
                    }
                }
            }
            // The composer chip is the source of truth for the agent outside a Code
            // session. The model's `agent` argument is only a fallback for the
            // ask-human flow (code mode not active, no chip set) — otherwise it can
            // anchor on the thread's earlier agent and ignore a chip change.
            const effectiveAgent = pinned?.agent ?? ctx.codeMode ?? agent;
            // Never trust the model's cwd argument over the session's. Expand `~` and
            // resolve to an absolute path: the engine is spawned with this as the
            // child's cwd, and `child_process.spawn` does NO shell tilde expansion.
            const effectiveCwdRaw = pinned?.cwd ?? candidate;
            if (!effectiveCwdRaw) {
                throw new Error('code_agent_run: no working directory — name a project folder, or register a repo in the Code section (one registered repo becomes the default; with several, pick one in Settings → Code).');
            }
            const effectiveCwd = path.resolve(expandHomePath(effectiveCwdRaw));
            // Fail loudly if the directory is missing. Otherwise the spawn below fails with
            // Node's misleading "spawn <command> ENOENT" (it blames the executable, not the
            // bad cwd), which reads as "the coding engine isn't installed" — see the enriched
            // message the model surfaces. A clear error lets the model/user fix the path.
            try {
                if (!(await fs.stat(effectiveCwd)).isDirectory()) throw new Error('not a directory');
            } catch {
                throw new Error(`code_agent_run: working directory does not exist: ${effectiveCwd}`);
            }
            const manager = container.resolve<CodeModeManager>('codeModeManager');
            const registry = container.resolve<CodePermissionRegistry>('codePermissionRegistry');

            // Approval policy: the session's (pinned meta) wins, else the
            // fallback chain resolved above.
            const policy: ApprovalPolicy = pinned?.policy ?? fallbackPolicy;

            // On stop, unblock any pending approval card so the broker stops waiting for
            // an answer that will never come. The ACP cancel + force-kill backstop that
            // actually ends the turn is handled inside manager.runPrompt via the signal
            // we pass below.
            const onAbort = () => registry.cancelRun(ctx.runId);
            if (ctx.signal.aborted) onAbort();
            else ctx.signal.addEventListener('abort', onAbort, { once: true });

            let finalText = '';
            const changedFiles = new Set<string>();
            // The full ordered timeline, published ONCE as a durable batch when the
            // run settles (see finally). The per-event copies below are ephemeral.
            const collected: CodeRunEventType[] = [];
            const feed = container.resolve<CodeRunFeed>('codeRunFeed');
            try {
                const result = await manager.runPrompt({
                    // Key the persistent ACP conversation by the chat session so
                    // follow-up turns resume the coding agent's context; headless
                    // turns (no session) stay keyed per turn.
                    runId: ctx.sessionId ?? ctx.runId,
                    agent: effectiveAgent,
                    cwd: effectiveCwd,
                    prompt,
                    policy,
                    ...(pinned?.agentModel ? { model: pinned.agentModel } : {}),
                    ...(pinned?.agentEffort ? { effort: pinned.agentEffort } : {}),
                    signal: ctx.signal,
                    onEvent: (event) => {
                        if (event.type === 'message' && event.role === 'agent') finalText += event.text;
                        if (event.type === 'tool_call_update') for (const f of event.diffs) changedFiles.add(f);
                        collected.push(event);
                        // Live rendering, two transports: the CodeRunFeed side-channel
                        // (turns-runtime chats — the runtime never sees this traffic)
                        // and the legacy runs bus (code-section tabs). Both ephemeral.
                        feed.broadcast({ toolCallId: ctx.toolCallId, event });
                        void ctx.publish({
                            runId: ctx.runId,
                            type: 'code-run-event',
                            toolCallId: ctx.toolCallId,
                            event,
                            subflow: [],
                        });
                    },
                    ask: (permAsk) => registry.request(ctx.runId, (requestId) => {
                        void ctx.publish({
                            runId: ctx.runId,
                            type: 'code-run-permission-request',
                            toolCallId: ctx.toolCallId,
                            requestId,
                            ask: permAsk,
                            subflow: [],
                        });
                    }),
                });
                return {
                    success: result.stopReason === 'end_turn',
                    stopReason: result.stopReason,
                    // The agent that actually ran (the chip), so the UI can label the run
                    // authoritatively rather than trusting the model's `agent` argument.
                    agent: effectiveAgent,
                    summary: finalText.trim(),
                    changedFiles: [...changedFiles],
                    // Adoption happened DURING this call — the turn's composed
                    // prompt predates the pin, so tell the model where work
                    // actually lives now (else it narrates stale paths).
                    ...(adoptedThisCall && pinned
                        ? {
                              adopted: {
                                  cwd: pinned.cwd,
                                  ...(pinned.worktree ? { branch: pinned.worktree.branch } : {}),
                                  note: 'This chat is now a tracked code session pinned to the cwd above (an isolated worktree when branch is set). Follow-up coding resumes there — cite these paths, not earlier ones.',
                              },
                          }
                        : {}),
                };
            } catch (error) {
                // A stop mid-run isn't a failure — report it as a clean cancellation.
                if (ctx.signal.aborted) {
                    return {
                        success: false,
                        stopReason: 'cancelled',
                        agent: effectiveAgent,
                        summary: finalText.trim(),
                        changedFiles: [...changedFiles],
                    };
                }
                throw new Error(`Coding agent failed: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                ctx.signal.removeEventListener('abort', onAbort);
                // Durable record for replay-on-reload — one event with the whole
                // (coalesced) timeline, on every settle path including errors and
                // cancellation, so partial runs keep their history too.
                if (collected.length > 0) {
                    await ctx.publish({
                        runId: ctx.runId,
                        type: 'code-run-events-batch',
                        toolCallId: ctx.toolCallId,
                        events: coalesceCodeRunEvents(collected),
                        subflow: [],
                    }).catch((e: unknown) => {
                        // History is best-effort (rethrowing here would mask the run's
                        // real outcome) — but a lost timeline must leave a trail, since
                        // this batch is the only durable record of the run's activity.
                        console.warn(`[code_agent_run] failed to persist code-run timeline: ${e instanceof Error ? e.message : String(e)}`);
                    });
                }
            }
        },
    },

    // ============================================================================
    // Browser Skills (browser-use/browser-harness domain-skills cache)
    // ============================================================================,
};

export const codeTaskTools: z.infer<typeof BuiltinToolsSchema> = {
    'launch-code-task': {
        permission: "none",
        description: "Launch an autonomous coding session that implements a unit of work in the bg-task's pinned code repo. ONLY usable from a coding background task (one with a configured code project). The session runs full-auto in its own isolated git worktree/branch — it never touches the user's checkout — and runs asynchronously: this returns as soon as the session is created, so you can launch several (one per group of related items) in the same run. The tool writes and later updates a row under a `## Code Sessions` section in the task's index.md — do NOT edit that section yourself. Write an excellent, fully self-contained `prompt`: the coding agent has no other context and no human to ask. Group related items into one call; split unrelated items into separate calls.",
        inputSchema: z.object({
            taskSlug: z.string().describe("The slug of THIS background task (it's in your run message, e.g. 'implement-meeting-items'). Used to find the pinned repo and to update index.md."),
            meeting: z.string().min(1).describe("The name/title of the meeting these items came from (e.g. 'Eng Sync — 2026-06-18'). Sessions are grouped under this heading in index.md so the user can see which meeting each change came from."),
            title: z.string().min(1).max(120).describe("Short human title for this unit of work — one line in index.md (e.g. 'Add retry to upload client')."),
            items: z.string().min(1).describe("Brief description of the action item(s) this session implements, for the summary row (e.g. 'Fix flaky upload + add retry; raised in standup')."),
            prompt: z.string().min(1).describe("The full, self-contained coding instruction. Include the concrete goal, relevant context from the meeting, any files/areas to look at, and what 'done' means. The agent runs autonomously with no human — be specific and complete."),
            context: z.string().optional().describe("Optional extra context, e.g. the relevant excerpt from the meeting."),
        }),
        execute: async (input: { taskSlug: string; meeting: string; title: string; items: string; prompt: string; context?: string }, ctx?: ToolContext) => {
            try {
                const { launchCodeTask } = await import("../../../background-tasks/code-sessions.js");
                const result = await launchCodeTask({
                    taskSlug: input.taskSlug,
                    meeting: input.meeting,
                    title: input.title,
                    items: input.items,
                    prompt: input.prompt,
                    ...(input.context ? { context: input.context } : {}),
                    ...(ctx?.runId ? { runId: ctx.runId } : {}),
                });
                return result;
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    },
};
