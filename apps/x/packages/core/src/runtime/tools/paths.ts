// Lenient ~-expansion for user-supplied paths in tool inputs. Distinct from
// filesystem/files.ts' private expandHomePath, which throws on empty input —
// tool entries want pass-through semantics for their own validation.

import * as path from "path";
import * as os from "os";

// Turn a user-supplied directory into a registered code project id. Reuses the
// same idempotent registry the Code-section picker writes to (add() validates the
// dir exists & is a directory, and dedupes by resolved path). Returns a soft
// `warning` — not an error — when the repo isn't yet worktree-ready, so the task
// still gets created and the copilot can tell the user what to fix.
export function expandHome(p: string): string {
    const t = p.trim();
    if (t === '~') return os.homedir();
    if (t.startsWith('~/') || t.startsWith(`~${path.sep}`)) return path.join(os.homedir(), t.slice(2));
    return t;
}
