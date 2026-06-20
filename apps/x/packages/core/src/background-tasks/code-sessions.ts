import fs from 'fs/promises';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import type { GitStatusFile } from '@x/shared/dist/code-sessions.js';
import container from '../di/container.js';
import type { CodeSessionService } from '../code-mode/sessions/service.js';
import type { ICodeProjectsRepo } from '../code-mode/projects/repo.js';
import * as gitService from '../code-mode/git/service.js';
import { extractAgentResponse } from '../agents/utils.js';
import { withFileLock } from '../knowledge/file-lock.js';
import { fetchTask, taskIndexPath } from './fileops.js';

const log = new PrefixLogger('BgTask:Code');

// A code session that hangs (engine wedged, never settles) shouldn't pin a
// "running…" row forever. After this long we finalize from whatever the
// worktree shows and tell the user to check the session.
const MAX_WATCH_MS = 90 * 60 * 1000;

// A single bg-task run must not spawn an unbounded fleet of code sessions — a
// weak model has called this 11+ times in one run. Cap per agent run.
const MAX_LAUNCHES_PER_RUN = 5;
const launchesPerRun = new Map<string, number>();

export interface LaunchCodeTaskArgs {
    /** The bg-task slug — used to find the pinned projectId and to write index.md. */
    taskSlug: string;
    /** The meeting these items came from — sessions are grouped under it in index.md. */
    meeting: string;
    /** Short human title for this unit of work (one row in index.md). */
    title: string;
    /** Short description of the item(s) being implemented (for the row). */
    items: string;
    /** The detailed, task-specific coding instruction written by the agent. */
    prompt: string;
    /** Optional extra context (e.g. the relevant meeting excerpt). */
    context?: string;
    /** The bg-task agent's runId — used to cap launches per run. */
    runId?: string;
}

export interface LaunchCodeTaskResult {
    success: boolean;
    sessionId?: string;
    branch?: string;
    worktreePath?: string;
    error?: string;
}

// Wrap the agent-authored task body in a robust autonomous-coding scaffold so
// every launch gets a strong, self-contained first message regardless of how
// the agent phrased its part. The session runs full-auto (yolo) with no human.
function buildCodePrompt(args: { prompt: string; branch: string; context?: string }): string {
    const { prompt, branch, context } = args;
    return `You are an autonomous coding agent. There is NO human present to answer questions, approve steps, or review mid-way — make reasonable decisions and drive the task to a complete, working result on your own.

${context ? `## Context\n${context}\n\n` : ''}## Task
${prompt}

## Operating rules
- You are on an isolated branch/worktree (\`${branch}\`). Work only within this repository; your changes never touch the user's main checkout.
- Implement the task end-to-end. Do not stop half-way, leave TODOs/stubs, or defer work back to the user.
- Before you start, briefly explore the repo to match its existing conventions, structure, and style.
- After implementing, VERIFY: run the project's build / typecheck / lint and any directly relevant tests. Fix anything you break.
- Make small, logically-scoped git commits with clear messages as you go.
- Stay in scope — don't refactor unrelated code or make sweeping changes the task didn't ask for.
- If the task is genuinely ambiguous or blocked (missing dependency, contradictory requirement), make the safest reasonable partial progress and clearly flag what's blocked in your final summary — never guess in a way that could be destructive.

## When done
Finish your response with a section titled exactly \`## Summary\` as the LAST thing you write — nothing after it. Under it, put 2–5 short bullet points only: what you changed, which files/areas, how you verified it, and any follow-ups or blockers. No narration or preamble inside the summary (no "I then…", "Let me…") — just the facts. This section is shown to the user verbatim, so keep it clean and self-contained.`;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The code agent's final message is mostly streamed narration ("Let me view it
// in context…"). We instruct it to end with a `## Summary` section — extract just
// that. Fall back to the last paragraph if it didn't comply.
const SUMMARY_MAX_CHARS = 900;
function cleanSummary(text: string): string {
    if (!text) return '';
    let body: string;
    const idx = text.toLowerCase().lastIndexOf('## summary');
    if (idx >= 0) {
        body = text.slice(idx + '## summary'.length).trim();
    } else {
        const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
        body = paras.length ? paras[paras.length - 1] : text.trim();
    }
    // Drop empty lines and any leftover heading markers; keep bullet structure.
    const lines = body.split('\n').map((l) => l.replace(/^#+\s*/, '').trimEnd()).filter((l) => l.trim() !== '');
    let out = lines.join('\n').trim();
    if (out.length > SUMMARY_MAX_CHARS) out = out.slice(0, SUMMARY_MAX_CHARS).trimEnd() + '…';
    return out;
}

// Render a summary as a clean markdown blockquote, preserving its bullet lines.
function quoteSummary(summary: string): string[] {
    const cleaned = cleanSummary(summary);
    if (!cleaned) return [];
    return ['', ...cleaned.split('\n').map((l) => (l.trim() ? `> ${l.trim()}` : '>'))];
}

const SECTION_HEADING = '## Code Sessions';

function startMarker(id: string): string { return `<!-- cs-start:${id} -->`; }
function endMarker(id: string): string { return `<!-- cs-end:${id} -->`; }

function meetingHeading(meeting: string): string {
    return `### 📅 ${meeting}`;
}

function runningBlock(args: { sessionId: string; title: string; items: string; branch: string; worktreePath: string }): string {
    const { sessionId, title, items, branch, worktreePath } = args;
    return [
        startMarker(sessionId),
        `#### ⏳ ${title}`,
        `- **Items:** ${items}`,
        `- **Branch:** \`${branch}\``,
        `- **Worktree:** \`${worktreePath}\``,
        `- **Session:** \`${sessionId}\` _(running…)_`,
        endMarker(sessionId),
    ].join('\n');
}

// Append a "running" block for a freshly launched session, grouped under its
// meeting's heading inside the Code Sessions section (creating section/heading as
// needed). Serialized via the index.md file lock so concurrent launches don't
// clobber each other.
async function appendRunningBlock(slug: string, meeting: string, block: string): Promise<void> {
    const indexPath = taskIndexPath(slug);
    await withFileLock(indexPath, async () => {
        let content = '';
        try {
            content = await fs.readFile(indexPath, 'utf-8');
        } catch {
            content = '';
        }
        if (!content.includes(SECTION_HEADING)) {
            const sep = content.endsWith('\n') || content === '' ? '' : '\n';
            content += `${sep}\n${SECTION_HEADING}\n`;
        }

        const heading = meetingHeading(meeting);
        const lines = content.split('\n');
        const headingIdx = lines.findIndex((l) => l.trim() === heading);
        if (headingIdx === -1) {
            // New meeting group — append heading + block at the end.
            if (!content.endsWith('\n')) content += '\n';
            content += `\n${heading}\n\n${block}\n`;
        } else {
            // Existing meeting — insert this block right after the heading so
            // sessions stay grouped (newest first within the group).
            lines.splice(headingIdx + 1, 0, '', block);
            content = lines.join('\n');
        }
        await fs.writeFile(indexPath, content, 'utf-8');
    });
}

// Replace a session's block in place once its run settles.
async function finalizeBlock(slug: string, sessionId: string, block: string): Promise<void> {
    const indexPath = taskIndexPath(slug);
    await withFileLock(indexPath, async () => {
        let content = '';
        try {
            content = await fs.readFile(indexPath, 'utf-8');
        } catch {
            return; // nothing to finalize against
        }
        const re = new RegExp(`${escapeRegExp(startMarker(sessionId))}[\\s\\S]*?${escapeRegExp(endMarker(sessionId))}`);
        if (re.test(content)) {
            content = content.replace(re, block);
        } else {
            // The running block went missing (manual edit?) — append the final one.
            if (!content.endsWith('\n')) content += '\n';
            content += `\n${block}\n`;
        }
        await fs.writeFile(indexPath, content, 'utf-8');
    });
}

// Once the code turn settles, summarize from the worktree diff + the agent's
// final message and rewrite the row.
async function finalizeFromResult(
    slug: string,
    args: { sessionId: string; title: string; items: string; branch: string; worktreePath: string; baseBranch?: string; timedOut?: boolean; error?: string },
): Promise<void> {
    const { sessionId, title, items, branch, worktreePath, baseBranch, timedOut, error } = args;

    let summary = '';
    try {
        summary = (await extractAgentResponse(sessionId)) ?? '';
    } catch { /* best effort */ }

    // Count everything the session changed since it forked — including commits
    // (the autonomous scaffold tells the agent to commit, so working-tree status
    // alone would read as "no changes"). Fall back to working-tree status if we
    // don't know the base.
    let files: GitStatusFile[] = [];
    try {
        files = baseBranch
            ? await gitService.changedSinceBase(worktreePath, baseBranch)
            : await gitService.status(worktreePath);
    } catch { /* worktree may be gone */ }

    const ins = files.reduce((a, f) => a + (f.insertions ?? 0), 0);
    const del = files.reduce((a, f) => a + (f.deletions ?? 0), 0);

    let heading: string;
    let status: string;
    if (error) {
        heading = `#### ❌ ${title}`;
        status = `Failed — ${error}`;
    } else if (timedOut) {
        heading = `#### ⌛ ${title}`;
        status = `Timed out — open the session to check progress`;
    } else if (files.length > 0) {
        heading = `#### ✅ ${title}`;
        status = `Implemented — ${files.length} file(s) changed (+${ins} / -${del})`;
    } else {
        heading = `#### ⚠️ ${title}`;
        status = `No file changes — open the session for details`;
    }

    const fileLines = files.slice(0, 25).map((f) => `  - \`${f.path}\` (${f.state})`);
    const more = files.length > 25 ? [`  - …and ${files.length - 25} more`] : [];

    const block = [
        startMarker(sessionId),
        heading,
        `- **Items:** ${items}`,
        `- **Branch:** \`${branch}\``,
        `- **Session:** \`${sessionId}\``,
        `- **Status:** ${status}`,
        ...(files.length > 0 ? ['- **Files:**', ...fileLines, ...more] : []),
        ...quoteSummary(summary),
        endMarker(sessionId),
    ].join('\n');

    await finalizeBlock(slug, sessionId, block);
}

/**
 * Launch a coding session for a bg-task, asynchronously.
 *
 * Creates an isolated worktree session (yolo, direct, claude), fires the prompt
 * without waiting, writes a "running" row into the task's index.md, and detaches
 * a watcher that finalizes the row once the turn settles. Returns as soon as the
 * session exists so the bg-task agent can launch more groups (or finish).
 */
export async function launchCodeTask(args: LaunchCodeTaskArgs): Promise<LaunchCodeTaskResult> {
    const { taskSlug, meeting, title, items, prompt, context, runId } = args;

    // Per-run launch cap — stop a runaway agent from spawning a session fleet.
    if (runId) {
        const used = launchesPerRun.get(runId) ?? 0;
        if (used >= MAX_LAUNCHES_PER_RUN) {
            return { success: false, error: `Launch cap reached (${MAX_LAUNCHES_PER_RUN} code sessions per run). Group remaining items instead of launching more.` };
        }
        launchesPerRun.set(runId, used + 1);
    }

    const task = await fetchTask(taskSlug);
    if (!task) {
        return { success: false, error: `Background task '${taskSlug}' not found.` };
    }
    if (!task.projectId) {
        return { success: false, error: `Task '${taskSlug}' has no configured code project (repo). Set one to use launch-code-task.` };
    }

    const projectsRepo = container.resolve<ICodeProjectsRepo>('codeProjectsRepo');
    const project = await projectsRepo.get(task.projectId);
    if (!project) {
        return { success: false, error: `Configured code project '${task.projectId}' is no longer registered.` };
    }

    const codeSessionService = container.resolve<CodeSessionService>('codeSessionService');

    let session;
    try {
        session = await codeSessionService.create({
            projectId: project.id,
            title,
            agent: 'claude',
            mode: 'direct',
            policy: 'yolo',
            isolation: 'worktree',
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Could not create code session: ${msg}` };
    }

    const branch = session.worktree?.branch ?? 'rowboat/' + session.id;
    const baseBranch = session.worktree?.baseBranch ?? undefined;
    const worktreePath = session.cwd;

    await appendRunningBlock(taskSlug, meeting, runningBlock({
        sessionId: session.id, title, items, branch, worktreePath,
    }));

    const wrapped = buildCodePrompt({ prompt, branch, ...(context ? { context } : {}) });

    log.log(`${taskSlug} — launched session ${session.id} on ${branch}`);

    // Detached: drive the turn to completion, then finalize the index.md row.
    // `sendMessage` resolves when the turn settles (it awaits the engine and
    // never rejects on engine errors), so we don't need a separate completion
    // subscription — but we still cap it with a timeout so a wedged engine can't
    // pin the row at "running" forever.
    void (async () => {
        let timedOut = false;
        try {
            await Promise.race([
                codeSessionService.sendMessage(session.id, wrapped),
                new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, MAX_WATCH_MS)),
            ]);
        } catch (err) {
            log.log(`${taskSlug} — session ${session.id} errored: ${err instanceof Error ? err.message : String(err)}`);
        }
        try {
            await finalizeFromResult(taskSlug, {
                sessionId: session.id, title, items, branch, worktreePath, timedOut,
                ...(baseBranch ? { baseBranch } : {}),
            });
        } catch (err) {
            log.log(`${taskSlug} — finalize failed for ${session.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    })();

    return { success: true, sessionId: session.id, branch, worktreePath };
}
