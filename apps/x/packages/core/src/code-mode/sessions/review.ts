import type { CodeSession } from '@x/shared/dist/code-sessions.js';
import * as gitService from '../git/service.js';

/**
 * One-line git accounting of a code session's unreviewed work — what its
 * worktree branch carries over the base, e.g. "+42 −18 across 5 files on
 * rowboat/<id>". Null when there is nothing to review: no worktree, already
 * merged or cleaned up, or an empty diff. The mechanical half of a review
 * receipt (the agent's narrative is the other half).
 */
export async function worktreeDiffstatLine(meta: CodeSession | null | undefined): Promise<string | null> {
    if (!meta?.worktree || meta.worktree.removedAt || meta.worktree.mergedAt) return null;
    try {
        const files = meta.worktree.baseBranch
            ? await gitService.changedSinceBase(meta.worktree.path, meta.worktree.baseBranch)
            : await gitService.status(meta.worktree.path);
        if (files.length === 0) return null;
        const ins = files.reduce((a, f) => a + (f.insertions ?? 0), 0);
        const del = files.reduce((a, f) => a + (f.deletions ?? 0), 0);
        return `+${ins} −${del} across ${files.length} file${files.length === 1 ? '' : 's'} on ${meta.worktree.branch}`;
    } catch {
        // Worktree may be gone mid-read — no line beats a wrong line.
        return null;
    }
}
