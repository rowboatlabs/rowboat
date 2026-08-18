import type { TurnBusEvent } from "@x/shared/dist/turns.js";

// ---------------------------------------------------------------------------
// THE live per-session status machine over the turn event spine — the single
// source of transition truth. Two consumers project it:
//   - home/threads.ts (the Deck's registry) uses it directly;
//   - code-mode/sessions/status-tracker.ts projects underway→working,
//     clear→idle for its notification semantics.
// It lives here, on neutral ground, because both consumers must agree:
// lessons like "an answered ask-human arrives as a tool_result, not a
// *_resolved event" must land in ONE table — the era of hand-copying fixes
// between two parallel machines ended with this file.
// ---------------------------------------------------------------------------

export interface LiveTurnState {
    status: "underway" | "needs-you";
    /** The current tool's name, or "thinking"/"starting" between calls. */
    activity?: string;
    /** Why it needs the user, when status is needs-you. */
    attention?: string;
    startedAt?: string;
}

/**
 * What a spine event means for a session's live status. Pure. Returns the
 * next state, 'clear' on terminal events (the session settles), or null
 * when the event doesn't move the needle.
 */
export function transitionLive(
    prev: LiveTurnState | undefined,
    e: TurnBusEvent["event"],
): LiveTurnState | "clear" | null {
    switch (e.type) {
        case "turn_created":
            return { status: "underway", activity: "starting", startedAt: e.ts };
        case "model_call_requested":
            return { ...(prev ?? { status: "underway" }), status: prev?.status === "needs-you" ? prev.status : "underway", activity: "thinking" };
        case "tool_invocation_requested":
            return { ...(prev ?? { status: "underway" }), status: prev?.status === "needs-you" ? prev.status : "underway", activity: e.toolName };
        case "tool_permission_required":
            return { ...(prev ?? { status: "needs-you" }), status: "needs-you", attention: `waiting for your approval: ${e.toolName}` };
        case "turn_suspended": {
            const ask = e.pendingAsyncTools.find((t) => t.toolName === "ask-human");
            const question = ask
                ? (typeof (ask.input as { question?: unknown } | null)?.question === "string"
                    ? String((ask.input as { question: string }).question)
                    : "The agent needs your input.")
                : undefined;
            return {
                ...(prev ?? { status: "needs-you" }),
                status: "needs-you",
                attention: question ?? (e.pendingPermissions.length > 0 ? "waiting for your approval" : "waiting on you"),
            };
        }
        // An answered ask-human arrives as an async tool_result — there is
        // no *_resolved event for it (the lesson that had to be copied
        // between the two pre-extraction machines by hand).
        case "tool_permission_resolved":
        case "tool_result":
            if (prev?.status === "needs-you") {
                return { ...prev, status: "underway", attention: undefined };
            }
            return null;
        case "tool_progress": {
            const progress = e.progress;
            if (progress && typeof progress === "object" && !Array.isArray(progress)) {
                const kind = (progress as { kind?: unknown }).kind;
                if (kind === "code-run-permission-request") {
                    return { ...(prev ?? { status: "needs-you" }), status: "needs-you", attention: "the coding agent needs your approval" };
                }
                if (kind === "code-run-permission-resolved" && prev?.status === "needs-you") {
                    return { ...prev, status: "underway", attention: undefined };
                }
            }
            return null;
        }
        case "turn_completed":
        case "turn_failed":
        case "turn_cancelled":
            return "clear";
        default:
            return null;
    }
}
