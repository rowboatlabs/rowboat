// Pure helpers for the Replicas ↔ Spaces contract (2026-09-28). The thread
// itself is the shared state between teammates: the dispatching Rowboat
// posts ONE handle line, and any member's Rowboat later finds the workspace
// by reading the thread. No protocol field, no server-side registry — the
// same "body carries a plain-text fallback" rule Spaces applies to polls.

export interface WorkspaceHandle {
    id: string;
    url: string | null;
}

const HANDLE_PREFIX = "Replicas workspace";

/** The exact line the agent posts (and later greps for). Backticks keep the id copyable. */
export function formatWorkspaceHandle(handle: WorkspaceHandle): string {
    return handle.url ? `${HANDLE_PREFIX} \`${handle.id}\` — ${handle.url}` : `${HANDLE_PREFIX} \`${handle.id}\``;
}

const HANDLE_RE = /Replicas workspace\s+`?([A-Za-z0-9][A-Za-z0-9_-]{5,})`?/gi;
const URL_RE = /https?:\/\/[^\s)>\]]*replicas\.dev\/[^\s)>\]]*/gi;
const ID_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{5,}$/;

/**
 * Workspace ids named in a text (a thread, a message, a tool argument), in
 * order of first appearance. Accepts the handle line, a bare replicas.dev
 * URL (last path segment that looks like an id), or a raw id.
 */
export function extractWorkspaceIds(text: string): string[] {
    const found: string[] = [];
    const push = (id: string | undefined) => {
        if (id && !found.includes(id)) found.push(id);
    };
    for (const match of text.matchAll(HANDLE_RE)) push(match[1]);
    for (const match of text.matchAll(URL_RE)) {
        const withoutQuery = match[0].split(/[?#]/)[0] ?? "";
        const segments = withoutQuery.split("/").filter(Boolean);
        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i]!;
            if (segment.includes(".")) continue; // the host
            if (ID_SEGMENT_RE.test(segment) && !/^(replica|replicas|workspace|workspaces|w|app|chat|chats)$/i.test(segment)) {
                push(segment);
                break;
            }
        }
    }
    return found;
}

/** A tool argument that may be an id, a handle line, or a URL → the id. */
export function resolveWorkspaceRef(ref: string): string | null {
    const trimmed = ref.trim();
    if (!trimmed) return null;
    const fromText = extractWorkspaceIds(trimmed);
    if (fromText.length > 0) return fromText[0]!;
    return ID_SEGMENT_RE.test(trimmed) ? trimmed : null;
}

const PR_URL_RE = /https?:\/\/(?:www\.)?(?:github\.com\/[^\s"'<>)]+?\/pull\/\d+|gitlab\.com\/[^\s"'<>)]+?\/-\/merge_requests\/\d+)/g;

/** Pull/merge request URLs in any text (event payloads, transcripts). */
export function findPullRequestUrls(text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(PR_URL_RE)) {
        const url = match[0].replace(/[.,;:]+$/, "");
        if (!found.includes(url)) found.push(url);
    }
    return found;
}

/** A short, stable slug for a workspace name from the task text. */
export function workspaceNameFor(task: string, salt: string = Date.now().toString(36)): string {
    const words = task
        .toLowerCase()
        .replace(/`[^`]*`/g, " ")
        .replace(/\[@[^\]]*\]\([^)]*\)/g, " ")
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w))
        .slice(0, 5);
    const base = words.join("-") || "task";
    return `${base}-${salt.slice(-4)}`.slice(0, 60);
}

const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "this", "that", "it", "is", "be", "at", "by",
    "please", "can", "you", "we", "our", "my", "me", "us", "rowboat", "replicas",
]);
